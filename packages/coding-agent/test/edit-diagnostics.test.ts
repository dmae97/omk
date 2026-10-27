import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 107 unit tests. A fake collector is injected; no real tsc. The only test that
// reaches the real collector mocks spawn so abort can be observed killing the child.
const spawned = vi.hoisted(() => ({ kills: 0, children: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: (command: string) => {
			const child = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
				kill: () => void;
			};
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = () => {
				spawned.kills++;
				queueMicrotask(() => child.emit("close", null));
			};
			// `command -v` probes exit at once; checkers hang until killed.
			if (command === "sh") queueMicrotask(() => child.emit("close", 0));
			else spawned.children++;
			return child;
		},
	};
});

const { createEditToolDefinition } = await import("../src/core/tools/edit.ts");
const { createWriteToolDefinition } = await import("../src/core/tools/write.ts");
const { collectFileDiagnostics } = await import("../src/core/tools/diagnostics-checkers.ts");
const diagModule = await import("../src/core/tools/edit-diagnostics.ts");
const {
	diffNewDiagnostics,
	flushEditDiagnosticsSession,
	formatNewDiagnostics,
	normalizeDiagnosticMessage,
	setCheckerVersionProbeForTest,
	setEditDiagnosticsCollectorForTest,
} = diagModule;
type DiagnosticLine = import("../src/core/tools/diagnostics-checkers.ts").DiagnosticLine;
type FileDiagnosticsResult = import("../src/core/tools/diagnostics-checkers.ts").FileDiagnosticsResult;

function textOf(result: { content: readonly { type: string }[] }): string {
	const first = result.content[0];
	return first.type === "text" ? (first as unknown as { text: string }).text : "";
}

let root: string;
let logDir: string;
let restore: (() => void) | undefined;
const savedEnv = { ...process.env };

function err(
	path: string,
	line: number,
	message: string,
	severity: DiagnosticLine["severity"] = "error",
): DiagnosticLine {
	return { language: "typescript", severity, path: join(root, path), line, column: 1, message };
}

/** Collector returning `results[i]` for the i-th call (0 = baseline, 1 = post). */
function fake(results: (FileDiagnosticsResult | (() => Promise<FileDiagnosticsResult>))[]) {
	const calls: { timeoutMs: number; signal?: AbortSignal }[] = [];
	restore = setEditDiagnosticsCollectorForTest(async (_cwd, _path, options) => {
		calls.push(options);
		const next = results[calls.length - 1] ?? { lines: [] };
		return typeof next === "function" ? next() : next;
	});
	return calls;
}

function readLog(name: string): Record<string, unknown>[] {
	const file = join(logDir, `${name}.jsonl`);
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function edit(path: string, oldText: string, newText: string, signal?: AbortSignal) {
	const tool = createEditToolDefinition(root);
	return tool.execute("t", { path, edits: [{ oldText, newText }] }, signal, undefined, {} as never);
}

async function write(path: string, content: string) {
	const tool = createWriteToolDefinition(root);
	return tool.execute("t", { path, content }, undefined, undefined, {} as never);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-edit-diag-"));
	logDir = join(root, ".runlog");
	process.env.OMK_RUN_LOG_DIR = logDir;
	process.env.OMK_EDIT_DIAGNOSTICS = "1";
	delete process.env.OMK_EDIT_DIAGNOSTICS_TIMEOUT_MS;
	writeFileSync(join(root, "a.ts"), "const x = 1;\n");
	spawned.kills = 0;
	spawned.children = 0;
});

afterEach(() => {
	flushEditDiagnosticsSession();
	restore?.();
	restore = undefined;
	process.env = { ...savedEnv };
	rmSync(root, { recursive: true, force: true });
});

describe("flag off: byte-identical", () => {
	it("edit and write results equal the pre-feature shape and never call the checker", async () => {
		for (const value of ["0", "false", "off", "OFF"]) {
			if (value === undefined) delete process.env.OMK_EDIT_DIAGNOSTICS;
			else process.env.OMK_EDIT_DIAGNOSTICS = value;
			const calls = fake([{ lines: [err("a.ts", 1, "boom")] }, { lines: [err("a.ts", 1, "new")] }]);
			writeFileSync(join(root, "a.ts"), "const x = 1;\n");
			const e = await edit("a.ts", "1", "2");
			expect(JSON.stringify(e)).toBe(
				JSON.stringify({
					content: [{ type: "text", text: "Successfully replaced 1 block(s) in a.ts." }],
					details: {
						diff: e.details?.diff,
						patch: e.details?.patch,
						firstChangedLine: e.details?.firstChangedLine,
					},
				}),
			);
			expect(Object.keys(e.details ?? {})).toEqual(["diff", "patch", "firstChangedLine"]);
			const w = await write("b.ts", "let y = 2;\n");
			expect(w).toStrictEqual({
				content: [{ type: "text", text: "Successfully wrote 11 bytes to b.ts" }],
				details: undefined,
			});
			expect(calls).toHaveLength(0);
			restore?.();
		}
		expect(readLog("edit-diag")).toEqual([]);
	});
});

describe("flag on", () => {
	it("lists a new error and hides pre-existing and shifted errors", async () => {
		fake([
			{ lines: [err("a.ts", 3, "old error"), err("b.ts", 1, "other old")] },
			{
				lines: [
					err("a.ts", 9, "old error"),
					err("b.ts", 1, "other old"),
					err("a.ts", 1, "Property 'foo' does not exist"),
				],
			},
		]);
		const r = await edit("a.ts", "1", "2");
		expect(r.content[0]).toEqual({
			type: "text",
			text: "Successfully replaced 1 block(s) in a.ts.\nNew diagnostics after this edit (1, vs pre-edit baseline):\nERROR a.ts:1:1 Property 'foo' does not exist",
		});
		expect(r.details?.newDiagnostics?.outcome).toBe("reported");
		expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("const x = 2;\n");
		const log = readLog("edit-diag");
		expect(log).toHaveLength(1);
		expect(log[0]).toMatchObject({ tool: "edit", outcome: "reported", newErrors: 1, editedFileErrors: 1, files: 1 });
		expect((log[0].keys as { file: string; key: string }[])[0].key).toMatch(/^[0-9a-f]{16}$/);
		expect(JSON.stringify(log[0])).not.toContain("foo");
	});

	it("appends nothing when an error is fixed or nothing changed", async () => {
		fake([{ lines: [err("a.ts", 1, "bad")] }, { lines: [] }]);
		const r = await edit("a.ts", "1", "2");
		expect(r.content[0]).toEqual({ type: "text", text: "Successfully replaced 1 block(s) in a.ts." });
		expect(r.details?.newDiagnostics?.outcome).toBe("none");
		expect(readLog("edit-diag")[0]).toMatchObject({ outcome: "none", newErrors: 0 });
	});

	it("never lists warnings", async () => {
		fake([{ lines: [] }, { lines: [err("a.ts", 1, "unused", "warning"), err("a.ts", 2, "info", "info")] }]);
		const r = await edit("a.ts", "1", "2");
		expect(r.content[0]).toEqual({ type: "text", text: "Successfully replaced 1 block(s) in a.ts." });
	});

	it("timeout: nothing appended, edit-diag-timeout logged, edit still succeeds", async () => {
		const calls = fake([{ lines: [] }, { lines: [], skipped: "tsc spawn failed", timedOut: true }]);
		const r = await edit("a.ts", "1", "2");
		expect(r.content[0]).toEqual({ type: "text", text: "Successfully replaced 1 block(s) in a.ts." });
		expect(r.details?.newDiagnostics?.outcome).toBe("timeout");
		expect(readLog("edit-diag-timeout")).toEqual([expect.objectContaining({ tool: "edit", phase: "post" })]);
		expect(calls[0].timeoutMs).toBe(10_000);
		expect(calls[1].timeoutMs).toBeLessThanOrEqual(10_000);
	});

	it("baseline timeout skips the post-check", async () => {
		const calls = fake([{ lines: [], skipped: "tsc spawn failed", timedOut: true }]);
		const r = await edit("a.ts", "1", "2");
		expect(textOf(r)).toBe("Successfully replaced 1 block(s) in a.ts.");
		expect(calls).toHaveLength(1);
		expect(readLog("edit-diag-timeout")[0]).toMatchObject({ phase: "baseline" });
	});

	it("missing checker, spawn failure and a throwing checker: nothing appended, still succeeds", async () => {
		for (const results of [
			[{ lines: [], skipped: "no tsconfig found" }],
			[{ lines: [] }, { lines: [], skipped: "tsc spawn failed" }],
			[() => Promise.reject(new Error("crash"))],
		] as const) {
			writeFileSync(join(root, "a.ts"), "const x = 1;\n");
			fake([...results]);
			const r = await edit("a.ts", "1", "2");
			expect(textOf(r)).toBe("Successfully replaced 1 block(s) in a.ts.");
			expect(r.details?.newDiagnostics?.outcome).toBe("skipped");
			restore?.();
		}
		expect(readLog("edit-diag-timeout")).toEqual([]);
	});

	it("files without a checker skip both checks", async () => {
		writeFileSync(join(root, "notes.md"), "hi\n");
		const calls = fake([]);
		const r = await edit("notes.md", "hi", "ho");
		expect(r.details).not.toHaveProperty("newDiagnostics");
		expect(calls).toHaveLength(0);
	});

	it("cross-file errors come after edited-file errors; cap 5 files / 20 entries", async () => {
		const post: DiagnosticLine[] = [];
		for (let f = 0; f < 7; f++) for (let i = 0; i < 4; i++) post.push(err(`o${f}.ts`, i + 1, `e${f}.${i}`));
		post.push(err("a.ts", 1, "mine"));
		fake([{ lines: [] }, { lines: post }]);
		const r = await edit("a.ts", "1", "2");
		const lines = textOf(r).split("\n");
		expect(lines[1]).toBe("New diagnostics after this edit (29, vs pre-edit baseline):");
		expect(lines[2]).toBe("ERROR a.ts:1:1 mine");
		const entries = lines.filter((l) => l.startsWith("ERROR "));
		expect(entries).toHaveLength(17); // a.ts + 4 other files × 4 = 5 files
		expect(new Set(entries.map((l) => l.split(":")[0])).size).toBe(5);
		expect(lines.at(-1)).toBe("... 12 more");
	});

	it("20-entry cap", () => {
		const fresh = Array.from({ length: 25 }, (_, i) => err("a.ts", i + 1, `e${i}`));
		const text = formatNewDiagnostics(root, fresh)!;
		expect(text.split("\n").filter((l) => l.startsWith("ERROR "))).toHaveLength(20);
		expect(text.endsWith("... 5 more")).toBe(true);
	});

	it("multiset: a second identical error is new", () => {
		const before = [err("a.ts", 1, "dup")];
		const after = [err("a.ts", 1, "dup"), err("a.ts", 7, "dup")];
		expect(diffNewDiagnostics(before, after, join(root, "a.ts"))).toHaveLength(1);
	});

	it("stale: file changed between snapshot and report ⇒ report skipped", async () => {
		fake([
			{ lines: [] },
			async () => {
				writeFileSync(join(root, "a.ts"), "const x = 99;\n");
				return { lines: [err("a.ts", 1, "new")] };
			},
		]);
		const r = await edit("a.ts", "1", "2");
		expect(textOf(r)).toBe("Successfully replaced 1 block(s) in a.ts.");
		expect(r.details?.newDiagnostics?.outcome).toBe("stale");
		expect(readLog("edit-diag")[0]).toMatchObject({ outcome: "stale" });
	});

	it("mutation lock is released before the post-check", async () => {
		let releasePost!: () => void;
		const postGate = new Promise<void>((r) => {
			releasePost = r;
		});
		fake([
			{ lines: [] },
			async () => {
				await postGate;
				return { lines: [] };
			},
			{ lines: [] },
			{ lines: [] },
		]);
		const first = edit("a.ts", "1", "2");
		await vi.waitFor(() => expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("const x = 2;\n"));
		// Second edit on the same file completes while the first's post-check is blocked.
		const second = await edit("a.ts", "2", "3");
		expect(textOf(second)).toBe("Successfully replaced 1 block(s) in a.ts.");
		releasePost();
		const r = await first;
		expect(r.details?.newDiagnostics?.outcome).toBe("stale");
	});

	it("never rejects or reverts the edit", async () => {
		fake([{ lines: [] }, { lines: [err("a.ts", 1, "broken")] }]);
		const r = await edit("a.ts", "1", "oops(");
		expect(r.details?.newDiagnostics?.outcome).toBe("reported");
		expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("const x = oops(;\n");
	});

	it("write to a new file: empty baseline, checker runs once (post only)", async () => {
		const calls = fake([{ lines: [err("n.ts", 1, "bad")] }]);
		const r = await write("n.ts", "let = ;\n");
		expect(calls).toHaveLength(1);
		expect(textOf(r)).toBe(
			"Successfully wrote 8 bytes to n.ts\nNew diagnostics after this edit (1, vs pre-edit baseline):\nERROR n.ts:1:1 bad",
		);
		expect(r.details?.newDiagnostics.outcome).toBe("reported");
	});

	it("write over an existing file uses a baseline", async () => {
		const calls = fake([{ lines: [err("a.ts", 1, "old")] }, { lines: [err("a.ts", 1, "old")] }]);
		const r = await write("a.ts", "const x = 3;\n");
		expect(calls).toHaveLength(2);
		expect(textOf(r)).toBe("Successfully wrote 13 bytes to a.ts");
	});

	it("abort during the post-check kills the checker child and releases the queue", async () => {
		writeFileSync(join(root, "tsconfig.json"), "{}");
		let calls = 0;
		// Baseline returns at once; the post-check goes to the real collector (spawn is mocked to hang).
		restore = setEditDiagnosticsCollectorForTest(async (cwd, path, options) =>
			calls++ === 0 ? { lines: [] } : collectFileDiagnostics(cwd, path, options),
		);
		const aborter = new AbortController();
		const pending = edit("a.ts", "1", "2", aborter.signal);
		await vi.waitFor(() => expect(spawned.children).toBe(1));
		aborter.abort();
		await expect(pending).rejects.toThrow("Operation aborted");
		expect(spawned.kills).toBe(1);
		process.env.OMK_EDIT_DIAGNOSTICS = "0";
		const next = await createEditToolDefinition(root).execute(
			"t",
			{ path: "a.ts", edits: [{ oldText: "2", newText: "4" }] },
			undefined,
			undefined,
			{} as never,
		);
		expect(textOf(next)).toContain("Successfully replaced");
	});
});

describe("message normalization (Tech Lead ruling 3)", () => {
	it("strips line/column numbers and position notations", () => {
		const forms = ["a.ts(12,5): Cannot find name 'foo'.", "a.ts(40,1): Cannot find name 'foo'."];
		expect(normalizeDiagnosticMessage(forms[0])).toBe(normalizeDiagnosticMessage(forms[1]));
		expect(normalizeDiagnosticMessage("see a.ts:12:5 for foo")).toBe(
			normalizeDiagnosticMessage("see a.ts:99:2 for foo"),
		);
		expect(normalizeDiagnosticMessage("unused at line 12, col 5")).toBe(
			normalizeDiagnosticMessage("unused at line 30, col 8"),
		);
		expect(normalizeDiagnosticMessage("Type 'string' is not assignable")).toBe("Type 'string' is not assignable");
	});

	it("inserting lines above an existing error reports 0 new errors", async () => {
		writeFileSync(join(root, "a.ts"), "const x: number = 'bad';\n");
		const before = err(
			"a.ts",
			1,
			"Declared at a.ts(1,7): Type 'string' is not assignable to type 'number'. (line 1, col 7)",
		);
		const after = {
			...err("a.ts", 4, "Declared at a.ts(4,7): Type 'string' is not assignable to type 'number'. (line 4, col 7)"),
			column: 7,
		};
		fake([{ lines: [before] }, { lines: [after] }]);
		const r = await edit("a.ts", "const x", "// one\n// two\n// three\nconst x");
		expect(textOf(r)).toBe("Successfully replaced 1 block(s) in a.ts.");
		expect(r.details?.newDiagnostics?.outcome).toBe("none");
		expect(r.details?.newDiagnostics?.total).toBe(0);
		expect(readLog("edit-diag")[0]).toMatchObject({ outcome: "none", newErrors: 0 });
	});

	it("log keys hash the normalized message, so a shifted error keeps its key", () => {
		const a = diffNewDiagnostics([], [err("a.ts", 1, "x at line 3")], join(root, "a.ts"));
		const b = diffNewDiagnostics(
			[err("a.ts", 9, "x at line 9")],
			[err("a.ts", 1, "x at line 3")],
			join(root, "a.ts"),
		);
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(0);
	});
});

describe("new file without baseline (Tech Lead ruling 2)", () => {
	it("counts only errors inside the new file; other files are excluded", async () => {
		fake([{ lines: [err("n.ts", 1, "bad"), err("other.ts", 2, "pre-existing elsewhere")] }]);
		const r = await write("n.ts", "let = ;\n");
		expect(textOf(r)).toBe(
			"Successfully wrote 8 bytes to n.ts\nNew diagnostics after this edit (1, vs pre-edit baseline):\nERROR n.ts:1:1 bad",
		);
		expect(readLog("edit-diag")[0]).toMatchObject({ newErrors: 1, files: 1 });
	});
});

describe("shadow mode (Tech Lead ruling 1)", () => {
	it("runs the checker, logs mode/diagMs, and returns results byte-identical to OFF", async () => {
		const results = () => [{ lines: [] }, { lines: [err("a.ts", 1, "brand new error")] }];
		const arms: Record<string, { edit: string; write: string; calls: number }> = {};
		for (const mode of ["off", "shadow"] as const) {
			if (mode === "off") process.env.OMK_EDIT_DIAGNOSTICS = "0";
			else process.env.OMK_EDIT_DIAGNOSTICS = "shadow";
			writeFileSync(join(root, "a.ts"), "const x = 1;\n");
			writeFileSync(join(root, "b.ts"), "let y = 1;\n");
			let calls = fake([...results(), { lines: [] }, { lines: [err("b.ts", 1, "also new")] }]);
			const e = await edit("a.ts", "1", "2");
			const w = await write("b.ts", "let y = 2;\n");
			arms[mode] = { edit: JSON.stringify(e), write: JSON.stringify(w), calls: calls.length };
			calls = [];
			restore?.();
			restore = undefined;
		}
		expect(arms.shadow.edit).toBe(arms.off.edit);
		expect(arms.shadow.write).toBe(arms.off.write);
		expect(arms.off.calls).toBe(0);
		expect(arms.shadow.calls).toBe(4);
		const log = readLog("edit-diag");
		expect(log).toHaveLength(2);
		for (const line of log) {
			expect(line).toMatchObject({ mode: "shadow", outcome: "reported", newErrors: 1 });
			expect(typeof line.diagMs).toBe("number");
			expect(line.diagMs).toBe((line.baselineMs as number) + (line.postMs as number));
		}
	});

	it("ON logs mode: on with diagMs", async () => {
		fake([{ lines: [] }, { lines: [] }]);
		await edit("a.ts", "1", "2");
		expect(readLog("edit-diag")[0]).toMatchObject({ mode: "on", outcome: "none" });
		expect(typeof readLog("edit-diag")[0].diagMs).toBe("number");
	});
});

describe("checkerRan and checker versions (spec 107 pre-registration)", () => {
	const versions = { tsc: "Version 5.9.3", pyright: null, ruff: "ruff 0.6.9" };

	it("checkerRan true when the checker executed; versions probed once per session", async () => {
		let probes = 0;
		const restoreProbe = setCheckerVersionProbeForTest(async () => {
			probes++;
			return versions;
		});
		try {
			fake([{ lines: [] }, { lines: [] }, { lines: [] }, { lines: [] }]);
			await edit("a.ts", "1", "2");
			await edit("a.ts", "2", "3");
			await new Promise((r) => setTimeout(r, 0));
			expect(probes).toBe(1);
			expect(readLog("edit-diag").map((l) => l.checkerRan)).toEqual([true, true]);
			expect(readLog("edit-diag-checkers")).toHaveLength(1);
			expect(readLog("edit-diag-checkers")[0]).toMatchObject({ mode: "on", ...versions });
			expect(flushEditDiagnosticsSession()).toMatchObject({ checkerRan: true, checks: 4, checkerRuns: 4 });
			expect(readLog("edit-diag-session")).toEqual([
				expect.objectContaining({ mode: "on", checkerRan: true, checkerVersions: versions }),
			]);
		} finally {
			restoreProbe();
		}
	});

	it("checker missing: checkerRan false, no version probe, edit text unchanged", async () => {
		let probes = 0;
		const restoreProbe = setCheckerVersionProbeForTest(async () => {
			probes++;
			return versions;
		});
		try {
			fake([{ lines: [], skipped: "no tsconfig found" }]);
			const result = await edit("a.ts", "1", "2");
			expect(textOf(result)).toBe("Successfully replaced 1 block(s) in a.ts.");
			expect(readLog("edit-diag")[0]).toMatchObject({ outcome: "skipped", checkerRan: false });
			expect(probes).toBe(0);
			expect(flushEditDiagnosticsSession()).toMatchObject({ checkerRan: false, checks: 1, checkerRuns: 0 });
			expect(readLog("edit-diag-checkers")).toEqual([]);
		} finally {
			restoreProbe();
		}
	});

	it("a timed-out checker counts as executed", async () => {
		fake([{ lines: [], skipped: "tsc timed out", timedOut: true }]);
		await edit("a.ts", "1", "2");
		expect(readLog("edit-diag")[0]).toMatchObject({ outcome: "timeout", checkerRan: true });
	});

	it("a version probe that rejects never fails the edit", async () => {
		const restoreProbe = setCheckerVersionProbeForTest(async () => {
			throw new Error("boom");
		});
		try {
			fake([{ lines: [] }, { lines: [] }]);
			const result = await edit("a.ts", "1", "2");
			await new Promise((r) => setTimeout(r, 0));
			expect(textOf(result)).toBe("Successfully replaced 1 block(s) in a.ts.");
			expect(readLog("edit-diag-checkers")).toEqual([]);
		} finally {
			restoreProbe();
		}
	});

	it("OFF: no session state, no session/checkers lines", async () => {
		process.env.OMK_EDIT_DIAGNOSTICS = "0";
		fake([]);
		await edit("a.ts", "1", "2");
		expect(flushEditDiagnosticsSession()).toBeUndefined();
		// edit-match.jsonl is main's unflagged run-log observer (edit-match-observe.ts); only edit-diag* must be absent.
		const files = existsSync(logDir) ? readdirSync(logDir) : [];
		expect(files.filter((f) => f.startsWith("edit-diag"))).toEqual([]);
	});

	it("ON/shadow with zero edits or no checker-backed file: exactly one session line, checkerRan=false", async () => {
		for (const mode of ["1", "shadow"] as const) {
			process.env.OMK_EDIT_DIAGNOSTICS = mode;
			createEditToolDefinition(root);
			expect(flushEditDiagnosticsSession()).toMatchObject({ checkerRan: false, checks: 0, checkerRuns: 0 });
			const calls = fake([]);
			writeFileSync(join(root, "n.md"), "a\n");
			await edit("n.md", "a", "b");
			expect(calls).toHaveLength(0);
			flushEditDiagnosticsSession();
			restore?.();
			restore = undefined;
		}
		const lines = readLog("edit-diag-session");
		expect(lines).toHaveLength(4);
		for (const l of lines) {
			expect(l).toMatchObject({ checkerRan: false, checks: 0, checkerRuns: 0, checkerVersions: null });
		}
	});
});

describe("custom operations (remote) skip diagnostics", () => {
	const localEditOps = {
		readFile: (p: string) => Promise.resolve(readFileSync(p)),
		writeFile: (p: string, c: string) => Promise.resolve(writeFileSync(p, c)),
		access: () => Promise.resolve(),
	};
	const localWriteOps = {
		writeFile: (p: string, c: string) => Promise.resolve(writeFileSync(p, c)),
		mkdir: () => Promise.resolve(),
	};

	for (const mode of ["1", "shadow"]) {
		it(`OMK_EDIT_DIAGNOSTICS=${mode}: edit and write with custom operations never call the collector`, async () => {
			process.env.OMK_EDIT_DIAGNOSTICS = mode;
			const calls = fake([{ lines: [] }, { lines: [err("a.ts", 1, "new")] }]);
			const e = await createEditToolDefinition(root, { operations: localEditOps }).execute(
				"t",
				{ path: "a.ts", edits: [{ oldText: "1", newText: "2" }] },
				undefined,
				undefined,
				{} as never,
			);
			expect(textOf(e)).toBe("Successfully replaced 1 block(s) in a.ts.");
			expect(Object.keys(e.details ?? {})).toEqual(["diff", "patch", "firstChangedLine"]);
			const w = await createWriteToolDefinition(root, { operations: localWriteOps }).execute(
				"t",
				{ path: "b.ts", content: "let y = 2;\n" },
				undefined,
				undefined,
				{} as never,
			);
			expect(w).toStrictEqual({
				content: [{ type: "text", text: "Successfully wrote 11 bytes to b.ts" }],
				details: undefined,
			});
			expect(calls).toHaveLength(0);
			expect(readLog("edit-diag")).toEqual([]);
		});

		it(`OMK_EDIT_DIAGNOSTICS=${mode}: default operations still call the collector`, async () => {
			process.env.OMK_EDIT_DIAGNOSTICS = mode;
			const calls = fake([{ lines: [] }, { lines: [] }, { lines: [] }, { lines: [] }]);
			await edit("a.ts", "1", "2");
			expect(calls.length).toBeGreaterThan(0);
			const afterEdit = calls.length;
			await write("b.ts", "let y = 2;\n");
			expect(calls.length).toBeGreaterThan(afterEdit);
		});
	}
});
