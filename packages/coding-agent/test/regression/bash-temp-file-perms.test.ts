import { existsSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeBashWithOperations } from "../../src/core/bash-executor.ts";
import type { BashOperations } from "../../src/core/tools/bash.ts";
import { OutputAccumulator } from "../../src/core/tools/output-accumulator.ts";
import { DEFAULT_MAX_BYTES } from "../../src/core/tools/truncate.ts";

function fakeOperations(chunks: string[], options?: { fail?: boolean }): BashOperations {
	return {
		exec: async (_command, _cwd, { onData }) => {
			for (const chunk of chunks) {
				onData(Buffer.from(chunk, "utf-8"));
			}
			if (options?.fail) {
				throw new Error("exec failed");
			}
			return { exitCode: 0 };
		},
	};
}

function listBashTempFiles(): Set<string> {
	return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("omk-bash-") && name.endsWith(".log")));
}

function expectOwnerOnly(path: string): void {
	if (process.platform === "win32") {
		return;
	}
	const mode = statSync(path).mode & 0o777;
	// No group/other access bits: the file may contain secrets from command output.
	expect(mode & 0o077).toBe(0);
}

describe("bash full-output temp files (perms + cleanup)", () => {
	const createdFiles: string[] = [];

	afterEach(async () => {
		for (const file of createdFiles.splice(0)) {
			await rm(file, { force: true });
		}
	});

	it("creates the overflow temp file with owner-only permissions and keeps it when the path is reported", async () => {
		// ~2x the byte limit so the output is truncated and spilled to a temp file.
		const line = `${"x".repeat(99)}\n`;
		const chunks = Array.from({ length: Math.ceil((DEFAULT_MAX_BYTES * 2) / line.length) }, () => line);

		const result = await executeBashWithOperations("big-output", process.cwd(), fakeOperations(chunks));

		expect(result.truncated).toBe(true);
		expect(result.fullOutputPath).toBeDefined();
		const path = result.fullOutputPath as string;
		createdFiles.push(path);
		// The write stream opens asynchronously; wait for the file to land on disk.
		await vi.waitFor(() => {
			expect(existsSync(path)).toBe(true);
		});
		expectOwnerOnly(path);
	});

	it("deletes the temp file when the command completes without truncation (path never reported)", async () => {
		// Raw bytes exceed the spill threshold (temp file gets created mid-stream),
		// but the sanitized output is tiny, so no truncation is reported.
		const ansiNoise = "\u001b[31m\u001b[0m".repeat(Math.ceil(DEFAULT_MAX_BYTES / 4));
		const before = listBashTempFiles();

		const result = await executeBashWithOperations(
			"ansi-noise",
			process.cwd(),
			fakeOperations([ansiNoise, "hello\n"]),
		);

		expect(result.truncated).toBe(false);
		expect(result.output).toBe("hello\n");
		expect(result.fullOutputPath).toBeUndefined();
		const leaked = [...listBashTempFiles()].filter((name) => !before.has(name));
		for (const name of leaked) {
			createdFiles.push(join(tmpdir(), name));
		}
		expect(leaked).toEqual([]);
	});

	it("deletes the temp file when the command throws (path never reported)", async () => {
		const line = `${"x".repeat(99)}\n`;
		const chunks = Array.from({ length: Math.ceil((DEFAULT_MAX_BYTES * 2) / line.length) }, () => line);
		const before = listBashTempFiles();

		await expect(
			executeBashWithOperations("failing-output", process.cwd(), fakeOperations(chunks, { fail: true })),
		).rejects.toThrow("exec failed");

		const leaked = [...listBashTempFiles()].filter((name) => !before.has(name));
		for (const name of leaked) {
			createdFiles.push(join(tmpdir(), name));
		}
		expect(leaked).toEqual([]);
	});

	it("creates OutputAccumulator temp files with owner-only permissions", async () => {
		const accumulator = new OutputAccumulator({ maxBytes: 256, maxLines: 10 });
		accumulator.append(Buffer.from("y".repeat(1024), "utf-8"));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		await accumulator.closeTempFile();

		expect(snapshot.fullOutputPath).toBeDefined();
		const path = snapshot.fullOutputPath as string;
		createdFiles.push(path);
		expect(existsSync(path)).toBe(true);
		expectOwnerOnly(path);
	});
});
