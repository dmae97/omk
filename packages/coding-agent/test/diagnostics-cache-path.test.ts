import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake checker: every spawn emits `fakeOutput.current` and exits 0. No real tsc.
const fakeOutput = vi.hoisted(() => ({ current: "", spawns: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: () => {
			fakeOutput.spawns++;
			const child = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
				kill: () => void;
			};
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = () => {};
			const out = fakeOutput.current;
			queueMicrotask(() => {
				child.stdout.emit("data", Buffer.from(out));
				child.emit("close", 0);
			});
			return child;
		},
	};
});

const { createDiagnosticsToolDefinition } = await import("../src/core/tools/diagnostics.ts");
const { withFileMutationQueue } = await import("../src/core/tools/file-mutation-queue.ts");

type Details = { readonly diagnostics: readonly { path: string; message: string }[] };
async function run(cwd: string, path: string) {
	const tool = createDiagnosticsToolDefinition(cwd);
	const result = await tool.execute(
		"tc",
		{ path, language: "typescript" } as never,
		undefined,
		undefined,
		{} as never,
	);
	return result.details as Details;
}

describe("diagnostics cache + path filter (regression)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-diag-fix-"));
		writeFileSync(join(root, "tsconfig.json"), "{}");
		fakeOutput.spawns = 0;
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("never returns the pre-edit cached result after an edit (same mtime/size, within TTL)", async () => {
		const file = join(root, "a.ts");
		writeFileSync(file, "export const x = 1;\n");
		const fixed = new Date("2026-01-01T00:00:00Z");
		utimesSync(file, fixed, fixed);
		fakeOutput.current = "a.ts(1,14): error TS2322: pre-edit error\n";
		expect((await run(root, "a.ts")).diagnostics.map((d) => d.message)).toEqual(["pre-edit error"]);

		// Edit through the tool queue; keep mtime and size identical so only the
		// mutation signal can invalidate the cache.
		await withFileMutationQueue(file, async () => {
			writeFileSync(file, "export const y = 1;\n");
			utimesSync(file, fixed, fixed);
		});
		fakeOutput.current = "a.ts(1,14): error TS2322: post-edit error\n";
		expect((await run(root, "a.ts")).diagnostics.map((d) => d.message)).toEqual(["post-edit error"]);
		expect(fakeOutput.spawns).toBe(2);
	});

	it("never returns the pre-edit cached result after an out-of-queue edit (bash) that changes size", async () => {
		const file = join(root, "a.ts");
		writeFileSync(file, "export const x = 1;\n");
		fakeOutput.current = "a.ts(1,14): error TS2322: pre-edit error\n";
		await run(root, "a.ts");
		writeFileSync(file, "export const x = 1;\nexport const z: number = 'no';\n");
		fakeOutput.current = "a.ts(2,14): error TS2322: post-edit error\n";
		expect((await run(root, "a.ts")).diagnostics.map((d) => d.message)).toEqual(["post-edit error"]);
	});

	it("still serves the cache when nothing changed (behavior preserved)", async () => {
		writeFileSync(join(root, "a.ts"), "export {};\n");
		fakeOutput.current = "a.ts(1,1): error TS1: e\n";
		await run(root, "a.ts");
		await run(root, "a.ts");
		expect(fakeOutput.spawns).toBe(1);
	});

	it("a.ts does not match data.ts", async () => {
		writeFileSync(join(root, "a.ts"), "export {};\n");
		fakeOutput.current = "data.ts(1,1): error TS1: in data\na.ts(2,1): error TS1: in a\n";
		const { diagnostics } = await run(root, "a.ts");
		expect(diagnostics.map((d) => d.path)).toEqual(["a.ts"]);
	});

	it("matches across cwd/root difference by absolute path", async () => {
		const sub = join(root, "src");
		const { mkdirSync } = await import("node:fs");
		mkdirSync(sub);
		writeFileSync(join(sub, "a.ts"), "export {};\n");
		fakeOutput.current = "src/a.ts(1,1): error TS1: hit\nother/a.ts(1,1): error TS1: miss\n";
		const { diagnostics } = await run(sub, "a.ts");
		expect(diagnostics.map((d) => d.message)).toEqual(["hit"]);
	});
});
