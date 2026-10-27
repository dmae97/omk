import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeBashWithOperations } from "../../src/core/bash-executor.ts";
import type { BashOperations } from "../../src/core/tools/bash.ts";
import { DEFAULT_MAX_BYTES } from "../../src/core/tools/truncate.ts";

// Regression: executeBashWithOperations used to drop whole leading chunks from its rolling buffer. A single
// 120 KB line delivered as ~78 KB + ~42 KB kept only 42 KB; truncateTail then saw < 50 KB and returned
// truncated: false with no fullOutputPath, silently losing ~78 KB. The policy stays tail-only (truncateTail);
// the fix only makes the buffer keep enough tail and reports truncated whenever leading output was evicted.

const opsFromChunks = (chunks: Buffer[]): BashOperations => ({
	exec: async (_command, _cwd, { onData }) => {
		for (const chunk of chunks) onData(chunk);
		return { exitCode: 0 };
	},
});

const spills: string[] = [];
afterEach(() => {
	for (const p of spills.splice(0)) rmSync(p, { force: true });
});

const run = async (chunks: Buffer[]) => {
	const result = await executeBashWithOperations("x", "/", opsFromChunks(chunks));
	if (result.fullOutputPath) spills.push(result.fullOutputPath);
	return result;
};

describe("bash executor tail-drop truncation", () => {
	it("keeps the tail and reports truncated: true for a single 120 KB line split 78 KB + 42 KB", async () => {
		const line = `${"a".repeat(78 * 1024)}${"b".repeat(42 * 1024 - 8)}TAIL-END`;
		const buf = Buffer.from(line);
		const result = await run([buf.subarray(0, 78 * 1024), buf.subarray(78 * 1024)]);

		expect(result.truncated).toBe(true);
		expect(result.output.endsWith("TAIL-END")).toBe(true);
		expect(Buffer.byteLength(result.output, "utf-8")).toBe(DEFAULT_MAX_BYTES);
		expect(result.fullOutputPath).toBeDefined();
		expect(existsSync(result.fullOutputPath!)).toBe(true);
		expect(readFileSync(result.fullOutputPath!, "utf-8")).toBe(line);
	});

	it("keeps a UTF-8 safe tail for a long multibyte single line split mid-character", async () => {
		const line = `${"가".repeat(40 * 1024)}끝`; // 3 bytes each, ~120 KB
		const buf = Buffer.from(line);
		const cut = 78 * 1024 + 1; // not on a character boundary
		const result = await run([buf.subarray(0, cut), buf.subarray(cut)]);

		expect(result.truncated).toBe(true);
		expect(result.output.endsWith("끝")).toBe(true);
		expect(result.output).not.toContain("\uFFFD");
		expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(Buffer.byteLength(result.output, "utf-8")).toBeGreaterThan(DEFAULT_MAX_BYTES - 3);
		expect(readFileSync(result.fullOutputPath!, "utf-8")).toBe(line);
	});

	it("keeps whole tail lines for mixed short lines followed by a long last line", async () => {
		const head = Array.from({ length: 500 }, (_, i) => `line-${i}`).join("\n");
		const longLine = `${"z".repeat(70 * 1024)}LAST`;
		const result = await run([
			Buffer.from(`${head}\n`),
			Buffer.from(longLine.slice(0, 40 * 1024)),
			Buffer.from(longLine.slice(40 * 1024)),
		]);

		expect(result.truncated).toBe(true);
		expect(result.output.endsWith("LAST")).toBe(true);
		expect(result.output).not.toContain("line-0\n");
		expect(Buffer.byteLength(result.output, "utf-8")).toBe(DEFAULT_MAX_BYTES);
	});

	it("reports truncated: false and no spill file when output fits", async () => {
		const result = await run([Buffer.from("hello\n"), Buffer.from("world")]);
		expect(result.truncated).toBe(false);
		expect(result.output).toBe("hello\nworld");
		expect(result.fullOutputPath).toBeUndefined();
	});

	it("reports truncated: false for a single line of exactly 50 KB", async () => {
		const line = "q".repeat(DEFAULT_MAX_BYTES);
		const result = await run([Buffer.from(line.slice(0, 30000)), Buffer.from(line.slice(30000))]);
		expect(result.truncated).toBe(false);
		expect(result.output).toBe(line);
		expect(result.fullOutputPath).toBeUndefined();
	});

	it("reports truncated: true, keeps the tail and the full spill file on the cancelled path too", async () => {
		const line = `${"a".repeat(78 * 1024)}${"b".repeat(42 * 1024 - 8)}TAIL-END`;
		const buf = Buffer.from(line);
		const controller = new AbortController();
		const ops: BashOperations = {
			exec: async (_command, _cwd, { onData }) => {
				onData(buf.subarray(0, 78 * 1024));
				onData(buf.subarray(78 * 1024));
				controller.abort();
				throw new Error("aborted");
			},
		};
		const result = await executeBashWithOperations("x", "/", ops, { signal: controller.signal });
		if (result.fullOutputPath) spills.push(result.fullOutputPath);

		expect(result.cancelled).toBe(true);
		expect(result.truncated).toBe(true);
		expect(result.output.endsWith("TAIL-END")).toBe(true);
		expect(Buffer.byteLength(result.output, "utf-8")).toBe(DEFAULT_MAX_BYTES);
		expect(result.fullOutputPath).toBeDefined();
		await vi.waitFor(() => expect(readFileSync(result.fullOutputPath!, "utf-8")).toBe(line));
	});
});
