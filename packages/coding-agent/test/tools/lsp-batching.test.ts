import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { join } from "node:path";
import { createTempDirSync } from "@oh-my-pi/pi-utils";
import * as lspConfig from "$c/lsp/config";
import { createLspWritethrough } from "$c/lsp/index";

describe("createLspWritethrough batching", () => {
	let tempDir: ReturnType<typeof createTempDirSync>;

	beforeEach(() => {
		tempDir = createTempDirSync("@omp-lsp-batch-");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		tempDir.remove();
	});

	it("defers LSP work until the batch flush", async () => {
		const loadConfigSpy = vi
			.spyOn(lspConfig, "loadConfig")
			.mockResolvedValue({ servers: {}, idleTimeoutMs: undefined });
		const getServersSpy = vi.spyOn(lspConfig, "getServersForFile").mockReturnValue([]);
		const writethrough = createLspWritethrough(tempDir.path, { enableFormat: true, enableDiagnostics: true });

		const fileA = join(tempDir.path, "a.ts");
		const fileB = join(tempDir.path, "b.ts");
		const batchId = `batch-${Date.now()}`;

		const firstResult = await writethrough(fileA, "const a = 1;\n", undefined, undefined, {
			id: batchId,
			flush: false,
		});

		expect(firstResult).toBeUndefined();
		expect(getServersSpy).toHaveBeenCalledTimes(0);
		expect(loadConfigSpy).toHaveBeenCalledTimes(0);
		expect(await Bun.file(fileA).text()).toBe("const a = 1;\n");

		const secondResult = await writethrough(fileB, "const b = 2;\n", undefined, undefined, {
			id: batchId,
			flush: true,
		});

		expect(secondResult).toBeUndefined();
		expect(getServersSpy).toHaveBeenCalledTimes(2);
		expect(loadConfigSpy).toHaveBeenCalledTimes(1);
		expect(await Bun.file(fileA).text()).toBe("const a = 1;\n");
		expect(await Bun.file(fileB).text()).toBe("const b = 2;\n");
	});

	it("runs LSP immediately when no batch is provided", async () => {
		const loadConfigSpy = vi
			.spyOn(lspConfig, "loadConfig")
			.mockResolvedValue({ servers: {}, idleTimeoutMs: undefined });
		const getServersSpy = vi.spyOn(lspConfig, "getServersForFile").mockReturnValue([]);
		const writethrough = createLspWritethrough(tempDir.path, { enableFormat: true, enableDiagnostics: true });

		const filePath = join(tempDir.path, "single.ts");
		const result = await writethrough(filePath, "const single = true;\n");

		expect(result).toBeUndefined();
		expect(getServersSpy).toHaveBeenCalledTimes(1);
		expect(loadConfigSpy).toHaveBeenCalledTimes(1);
		expect(await Bun.file(filePath).text()).toBe("const single = true;\n");
	});
});
