import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPromptImageAttachment } from "../src/core/prompt-attachment.ts";

const mocks = vi.hoisted(() => ({
	execFile:
		vi.fn<
			(
				command: string,
				args: string[],
				options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
				callback: (error: Error | null, stdout: string) => void,
			) => void
		>(),
	spawnSync: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile, spawnSync: mocks.spawnSync }));
vi.mock("../src/utils/clipboard-native.ts", () => ({ clipboard: null }));

import { readClipboardImage } from "../src/utils/clipboard-image.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6v6EAAAAASUVORK5CYII=";
const env = { WSL_DISTRO_NAME: "Ubuntu-24.04", WSL_INTEROP: "/run/interop", OPENAI_API_KEY: "test-not-a-real-secret" };

beforeEach(() => {
	mocks.execFile.mockReset();
	mocks.spawnSync.mockReset();
	mocks.spawnSync.mockReturnValue({ status: 1, stdout: Buffer.alloc(0) });
});

describe("Windows capture to WSL prompt", () => {
	it("reads Windows PNG in memory asynchronously before any stale Linux clipboard", async () => {
		// Given a Windows screenshot, when image paste is requested.
		mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
			callback(null, `OMK_CLIPBOARD_PNG:${PNG}`),
		);
		const image = await readClipboardImage({ platform: "linux", env });
		// Then it is ready for the existing prompt attachment store; no temp-file bridge is used.
		expect(image).not.toBeNull();
		if (!image) throw new Error("Expected screenshot");
		expect(createPromptImageAttachment(image.bytes, "clipboard")).toMatchObject({
			mimeType: "image/png",
			width: 1,
			height: 1,
		});
		expect(mocks.spawnSync).not.toHaveBeenCalled();
		const [command, args, options] = mocks.execFile.mock.calls[0];
		expect(command).toContain("WindowsPowerShell/v1.0/powershell.exe");
		expect(args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-STA"]));
		expect(args.join(" ")).toContain("MemoryStream");
		expect(args.join(" ")).not.toContain("ExecutionPolicy");
		expect(options).toMatchObject({ cwd: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0" });
		expect(options.env.OPENAI_API_KEY).toBeUndefined();
		expect(options.timeout).toBeGreaterThan(0);
		expect(options.maxBuffer).toBeLessThan(20 * 1024 * 1024);
	});

	it("does not paste stale Linux image data after Windows clipboard becomes empty", async () => {
		mocks.execFile.mockImplementation((_command, _args, _options, callback) => callback(null, "OMK_CLIPBOARD_EMPTY"));
		const image = await readClipboardImage({ platform: "linux", env });
		expect(image).toBeNull();
		expect(mocks.spawnSync).not.toHaveBeenCalled();
	});

	it("falls back to the PATH executable only when the fixed Windows location is absent", async () => {
		mocks.execFile.mockImplementation((command, _args, _options, callback) => {
			if (command.startsWith("/mnt/")) callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "");
			else callback(null, `OMK_CLIPBOARD_PNG:${PNG}`);
		});
		const image = await readClipboardImage({ platform: "linux", env });
		expect(image?.mimeType).toBe("image/png");
		expect(mocks.execFile.mock.calls.map((call) => call[0])).toEqual([
			"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
			"powershell.exe",
		]);
	});

	it("rejects malformed Windows data instead of disguising it as a PNG", async () => {
		mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
			callback(null, "OMK_CLIPBOARD_PNG:bm90LWFuLWltYWdl"),
		);
		await expect(readClipboardImage({ platform: "linux", env })).rejects.toThrow(/clipboard.*PNG/i);
	});

	it("uses Linux clipboard fallback if Windows interop is unavailable", async () => {
		mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
			callback(Object.assign(new Error("missing"), { code: "ENOENT" }), ""),
		);
		mocks.spawnSync.mockImplementation((command: string, args: string[]) => {
			if (command === "wl-paste")
				return {
					status: 0,
					stdout: args.includes("--list-types") ? Buffer.from("image/png\n") : Buffer.from(PNG, "base64"),
				};
			return { status: 1, stdout: Buffer.alloc(0) };
		});
		const image = await readClipboardImage({ platform: "linux", env });
		expect(image?.mimeType).toBe("image/png");
		expect(mocks.execFile).toHaveBeenCalledTimes(2);
	});

	it("keeps timeouts bounded without retrying the same Windows backend via PATH", async () => {
		mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
			callback(Object.assign(new Error("timeout"), { killed: true }), ""),
		);
		await expect(readClipboardImage({ platform: "linux", env })).rejects.toThrow(/timeout/);
		expect(mocks.execFile).toHaveBeenCalledOnce();
	});

	it("surfaces Windows image-size rejection before decoding or trying Linux", async () => {
		mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
			callback(null, "OMK_CLIPBOARD_TOO_LARGE"),
		);
		await expect(readClipboardImage({ platform: "linux", env })).rejects.toThrow(/size limit/);
		expect(mocks.spawnSync).not.toHaveBeenCalled();
	});

	it("reports backend failure when both Windows and Linux readers are unavailable", async () => {
		mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
			callback(Object.assign(new Error("denied"), { code: 1 }), ""),
		);
		await expect(readClipboardImage({ platform: "linux", env })).rejects.toThrow(/Windows clipboard/i);
	});
});
