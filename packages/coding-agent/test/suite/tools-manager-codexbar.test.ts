import type { SpawnSyncReturns } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CODEXBAR_DOWNLOAD_MESSAGE = "CodexBar auto-download is not configured; install codexbar on PATH.";

const mocks = vi.hoisted(() => ({
	spawnSync: vi.fn<(command: string, args: readonly string[], options?: unknown) => SpawnSyncReturns<Buffer>>(),
	existsSync: vi.fn<(path: string) => boolean>(),
	fetch: vi.fn(),
}));

vi.mock("child_process", () => ({
	spawnSync: mocks.spawnSync,
}));

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>();
	return {
		...actual,
		existsSync: mocks.existsSync,
	};
});

function spawnCommandMissing(): SpawnSyncReturns<Buffer> {
	return {
		pid: 0,
		output: [Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)],
		stdout: Buffer.alloc(0),
		stderr: Buffer.alloc(0),
		status: null,
		signal: null,
		error: Object.assign(new Error("spawnSync ENOENT"), { code: "ENOENT" }),
	};
}

function spawnVersionOk(): SpawnSyncReturns<Buffer> {
	return {
		pid: 1,
		output: [Buffer.alloc(0), Buffer.from("codexbar 0.0.0\n"), Buffer.alloc(0)],
		stdout: Buffer.from("codexbar 0.0.0\n"),
		stderr: Buffer.alloc(0),
		status: 0,
		signal: null,
	};
}

describe("tools-manager codexbar PATH-only gate", () => {
	let previousOffline: string | undefined;

	beforeEach(() => {
		previousOffline = process.env.OMK_OFFLINE;
		delete process.env.OMK_OFFLINE;
		mocks.spawnSync.mockReset();
		mocks.existsSync.mockReset();
		mocks.fetch.mockReset();
		mocks.existsSync.mockReturnValue(false);
		vi.resetModules();
	});

	afterEach(() => {
		if (previousOffline === undefined) {
			delete process.env.OMK_OFFLINE;
		} else {
			process.env.OMK_OFFLINE = previousOffline;
		}
	});

	it("getToolPath accepts codexbar as ManagedTool", async () => {
		mocks.spawnSync.mockImplementation((command, args) => {
			if (command === "codexbar" && args[0] === "--version") {
				return spawnVersionOk();
			}
			return spawnCommandMissing();
		});

		const { getToolPath } = await import("../../src/utils/tools-manager.ts");
		expect(getToolPath("codexbar")).toBe("codexbar");
	});

	it("codexbar TOOLS entry is PATH-first with no downloadable asset (algorithm C3 / tools-manager 75-81)", async () => {
		mocks.spawnSync.mockReturnValue(spawnCommandMissing());

		const { ensureTool } = await import("../../src/utils/tools-manager.ts");
		globalThis.fetch = mocks.fetch as unknown as typeof fetch;

		const result = await ensureTool("codexbar", true);

		expect(result).toBeUndefined();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("ensureTool(codexbar, true) with OMK_OFFLINE=1 returns undefined without throwing", async () => {
		process.env.OMK_OFFLINE = "1";
		mocks.spawnSync.mockReturnValue(spawnCommandMissing());

		const { ensureTool } = await import("../../src/utils/tools-manager.ts");
		globalThis.fetch = mocks.fetch as unknown as typeof fetch;

		await expect(ensureTool("codexbar", true)).resolves.toBeUndefined();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("preferSystemBinary resolves PATH before local bin when codexbar responds to --version", async () => {
		mocks.spawnSync.mockImplementation((command, args) => {
			if (command === "codexbar" && args[0] === "--version") {
				return spawnVersionOk();
			}
			return spawnCommandMissing();
		});
		mocks.existsSync.mockImplementation((path) => path.includes("codexbar"));

		const { getToolPath } = await import("../../src/utils/tools-manager.ts");
		expect(getToolPath("codexbar")).toBe("codexbar");
	});

	it("missing PATH binary yields null from getToolPath without local install", async () => {
		mocks.spawnSync.mockReturnValue(spawnCommandMissing());
		mocks.existsSync.mockReturnValue(false);

		const { getToolPath } = await import("../../src/utils/tools-manager.ts");
		expect(getToolPath("codexbar")).toBeNull();
	});

	it("ensureTool without offline skips network when auto-download is unsupported (getAssetName null)", async () => {
		mocks.spawnSync.mockReturnValue(spawnCommandMissing());
		mocks.existsSync.mockReturnValue(false);

		const { ensureTool } = await import("../../src/utils/tools-manager.ts");
		globalThis.fetch = mocks.fetch as unknown as typeof fetch;

		const result = await ensureTool("codexbar", true);
		expect(result).toBeUndefined();
		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(CODEXBAR_DOWNLOAD_MESSAGE).toContain("install codexbar on PATH");
	});
});
