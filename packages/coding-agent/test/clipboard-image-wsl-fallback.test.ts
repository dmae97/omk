import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawnSync: vi.fn(() => {
		throw new Error("Windows screenshots must not depend on the WSLg BMP reader");
	}),
	loadPhoton: vi.fn(async () => null),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mocks.spawnSync,
	execFile: (
		_command: string,
		_args: string[],
		_options: unknown,
		callback: (error: null, stdout: string) => void,
	) => {
		const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6v6EAAAAASUVORK5CYII=";
		callback(null, `OMK_CLIPBOARD_PNG:${png}`);
	},
}));
vi.mock("../src/utils/photon.ts", () => ({ loadPhoton: mocks.loadPhoton }));
vi.mock("../src/utils/clipboard-native.ts", () => ({ clipboard: null }));

import { readClipboardImage } from "../src/utils/clipboard-image.ts";

describe("WSL screenshot acquisition when BMP conversion is unavailable", () => {
	test("uses Windows PNG directly without needing Photon or WSLg conversion", async () => {
		const image = await readClipboardImage({ env: { WSL_DISTRO_NAME: "Ubuntu" }, platform: "linux" });
		expect(image?.mimeType).toBe("image/png");
		expect(Array.from(image?.bytes.slice(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(mocks.spawnSync).not.toHaveBeenCalled();
		expect(mocks.loadPhoton).not.toHaveBeenCalled();
	});
});
