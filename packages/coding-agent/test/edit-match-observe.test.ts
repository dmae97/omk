import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subagentWorkerEnv } from "../examples/extensions/subagent/worker-env.ts";
import { RUN_LOG_DIR_ENV } from "../src/core/run-log.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createEditTool, createEditToolDefinition } from "../src/core/tools/edit.ts";
import {
	classifyEditMatchFailure,
	EDIT_MATCH_RUN_LOG,
	EDIT_SEQ_SESSION_CAP,
	editMatchObserver,
	editParentSessionId,
	editPathHash,
	editSeqSessionCount,
} from "../src/core/tools/edit-match-observe.ts";
import { EDIT_CASES } from "./edit-match-observe-cases.ts";

// Golden captured by running the same cases against main 9e03b40b77 (before this change).
const GOLDEN = JSON.parse(
	readFileSync(join(__dirname, "fixtures/edit-match-observe/golden-main.json"), "utf-8"),
) as Record<string, unknown>;

let dir: string;
let logDir: string;
let savedLogDir: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-edit-obs-"));
	logDir = mkdtempSync(join(tmpdir(), "omk-edit-obs-log-"));
	savedLogDir = process.env[RUN_LOG_DIR_ENV];
});
afterEach(() => {
	if (savedLogDir === undefined) delete process.env[RUN_LOG_DIR_ENV];
	else process.env[RUN_LOG_DIR_ENV] = savedLogDir;
	vi.restoreAllMocks();
	rmSync(dir, { recursive: true, force: true });
	rmSync(logDir, { recursive: true, force: true });
});

const runCase = async (name: string) => {
	const c = EDIT_CASES.find((x) => x.name === name)!;
	const p = join(dir, `${c.name}.txt`);
	writeFileSync(p, c.file);
	const tool = createEditTool(dir);
	try {
		const r = await tool.execute("id", { path: `${c.name}.txt`, edits: c.edits });
		return { ok: true, content: r.content, details: r.details, file: readFileSync(p, "utf-8") };
	} catch (e) {
		return { ok: false, error: (e as Error).message, file: readFileSync(p, "utf-8") };
	}
};

const logLines = () => {
	try {
		return readFileSync(join(logDir, `${EDIT_MATCH_RUN_LOG}.jsonl`), "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	} catch {
		return [];
	}
};

describe("edit match observation: tool output unchanged vs main", () => {
	for (const c of EDIT_CASES) {
		for (const logging of [false, true]) {
			it(`${c.name} (run log ${logging ? "on" : "off"}) is byte-identical to main`, async () => {
				if (logging) process.env[RUN_LOG_DIR_ENV] = logDir;
				else delete process.env[RUN_LOG_DIR_ENV];
				const got = await runCase(c.name);
				expect(JSON.stringify(got)).toBe(JSON.stringify(GOLDEN[c.name]));
			});
		}
	}
});

describe("edit match observation: run log lines", () => {
	beforeEach(() => {
		process.env[RUN_LOG_DIR_ENV] = logDir;
	});

	const expectations: [string, Record<string, unknown>][] = [
		["exact", { ok: true, edit_match_stage: 1, matchStages: [1], edits: 1 }],
		["fuzzy-trailing-ws", { ok: true, edit_match_stage: 2, matchStages: [2] }],
		["fuzzy-smart-quote", { ok: true, edit_match_stage: 2, matchStages: [2] }],
		["crlf-bom", { ok: true, edit_match_stage: 1 }],
		["multi", { ok: true, edit_match_stage: 2, matchStages: [1, 2], edits: 2 }],
		["not-found", { ok: false, reason: "not_found", editIndex: 0 }],
		["indent-only", { ok: false, reason: "indent_only", editIndex: 0 }],
		["duplicate", { ok: false, reason: "multiple_matches", editIndex: 0 }],
		["overlap", { ok: false, reason: "unknown", editIndex: null }],
		["no-op", { ok: false, reason: "unknown", editIndex: null }],
	];
	for (const [name, want] of expectations) {
		it(`${name} logs one edit_match line with pathHash`, async () => {
			await runCase(name);
			const lines = logLines();
			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatchObject({ event: "edit_match", ...want });
			expect(lines[0].pathHash).toBe(editPathHash(join(dir, `${name}.txt`)));
			expect(lines[0].pathHash).toMatch(/^[0-9a-f]{16}$/);
			expect(JSON.stringify(lines[0])).not.toContain(dir);
		});
	}

	it("failure then success on the same file share a pathHash; other files differ", async () => {
		const p = join(dir, "same.py");
		writeFileSync(p, "def f():\n    return 1\n");
		const tool = createEditTool(dir);
		await expect(
			tool.execute("a", { path: "same.py", edits: [{ oldText: "def f():\nreturn 1", newText: "x" }] }),
		).rejects.toThrow();
		await tool.execute("b", { path: "./same.py", edits: [{ oldText: "    return 1", newText: "    return 2" }] });
		await runCase("exact");
		const [fail, ok, other] = logLines();
		expect(fail).toMatchObject({ ok: false, reason: "indent_only" });
		expect(ok).toMatchObject({ ok: true, edit_match_stage: 1 });
		expect(fail.pathHash).toBe(ok.pathHash);
		expect(other.pathHash).not.toBe(ok.pathHash);
	});

	it("success path never calls the failure classifier", async () => {
		const spy = vi.spyOn(editMatchObserver, "classify");
		for (const name of ["exact", "fuzzy-trailing-ws", "crlf-bom", "multi"]) await runCase(name);
		expect(spy).not.toHaveBeenCalled();
		await runCase("not-found");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("seq counts per session from 1 and ts is ISO", async () => {
		const p = join(dir, "seq.txt");
		writeFileSync(p, "a\nb\nc\n");
		const def = createEditToolDefinition(dir);
		const ctx = { sessionManager: { getSessionId: () => "sess-123" } } as never;
		await def.execute("1", { path: "seq.txt", edits: [{ oldText: "a", newText: "A" }] }, undefined, undefined, ctx);
		await expect(
			def.execute("2", { path: "seq.txt", edits: [{ oldText: "zz", newText: "x" }] }, undefined, undefined, ctx),
		).rejects.toThrow();
		await def.execute("3", { path: "seq.txt", edits: [{ oldText: "b", newText: "B" }] }, undefined, undefined, ctx);
		await def.execute("4", { path: "seq.txt", edits: [{ oldText: "c", newText: "C" }] }, undefined, undefined, ctx);
		const lines = logLines();
		expect(lines.map((l) => l.seq)).toEqual([1, 2, 3, 4]);
		expect(lines.map((l) => l.ok)).toEqual([true, false, true, true]);
		for (const l of lines) {
			expect(l.sessionId).toBe("sess-123");
			expect(new Date(l.ts).toISOString()).toBe(l.ts);
		}
	});

	it("two sessions writing alternately to one file each get seq [1,2,...]", async () => {
		writeFileSync(join(dir, "s.txt"), "a\nb\nc\nd\ne\nf\n");
		const def = createEditToolDefinition(dir);
		const ctxA = { sessionManager: { getSessionId: () => "alt-A" } } as never;
		const ctxB = { sessionManager: { getSessionId: () => "alt-B" } } as never;
		const order: [never, string][] = [
			[ctxA, "a"],
			[ctxB, "b"],
			[ctxA, "c"],
			[ctxB, "d"],
			[ctxA, "e"],
			[ctxB, "f"],
		];
		for (const [ctx, ch] of order) {
			await def.execute(
				ch,
				{ path: "s.txt", edits: [{ oldText: ch, newText: ch.toUpperCase() }] },
				undefined,
				undefined,
				ctx,
			);
		}
		const lines = logLines();
		expect(lines.map((l) => l.sessionId)).toEqual(["alt-A", "alt-B", "alt-A", "alt-B", "alt-A", "alt-B"]);
		const seqOf = (id: string) => lines.filter((l) => l.sessionId === id).map((l) => l.seq);
		expect(seqOf("alt-A")).toEqual([1, 2, 3]);
		expect(seqOf("alt-B")).toEqual([1, 2, 3]);
		const keys = new Set(lines.map((l) => `${l.sessionId}:${l.seq}`));
		expect(keys.size).toBe(lines.length);
	});

	it("2-level nested workers: each line's parentSessionId is the immediate parent's sessionId", async () => {
		const savedRole = process.env.OMK_RUN_LOG_ROLE;
		const savedParent = process.env.OMK_RUN_LOG_PARENT_SESSION;
		try {
			// --no-session workers use SessionManager.inMemory, which still mints a uuidv7 id.
			const [lead, w1, w2] = [0, 1, 2].map(() => SessionManager.inMemory(dir).getSessionId());
			expect(new Set([lead, w1, w2]).size).toBe(3);
			for (const id of [lead, w1, w2]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
			writeFileSync(join(dir, "n.txt"), "a\nb\nc\n");
			const def = createEditToolDefinition(dir);
			const ctx = (id: string) => ({ sessionManager: { getSessionId: () => id } }) as never;
			delete process.env.OMK_RUN_LOG_ROLE;
			delete process.env.OMK_RUN_LOG_PARENT_SESSION;
			await def.execute(
				"1",
				{ path: "n.txt", edits: [{ oldText: "a", newText: "A" }] },
				undefined,
				undefined,
				ctx(lead),
			);
			const env1 = subagentWorkerEnv({ ...process.env }, undefined, lead);
			process.env.OMK_RUN_LOG_ROLE = env1.OMK_RUN_LOG_ROLE;
			process.env.OMK_RUN_LOG_PARENT_SESSION = env1.OMK_RUN_LOG_PARENT_SESSION;
			await def.execute(
				"2",
				{ path: "n.txt", edits: [{ oldText: "b", newText: "B" }] },
				undefined,
				undefined,
				ctx(w1),
			);
			const env2 = subagentWorkerEnv({ ...process.env }, undefined, w1);
			process.env.OMK_RUN_LOG_ROLE = env2.OMK_RUN_LOG_ROLE;
			process.env.OMK_RUN_LOG_PARENT_SESSION = env2.OMK_RUN_LOG_PARENT_SESSION;
			await def.execute(
				"3",
				{ path: "n.txt", edits: [{ oldText: "c", newText: "C" }] },
				undefined,
				undefined,
				ctx(w2),
			);
			const lines = logLines();
			expect(lines.map((l) => [l.sessionId, l.parentSessionId])).toEqual([
				[lead, null],
				[w1, lead],
				[w2, w1],
			]);
		} finally {
			if (savedRole === undefined) delete process.env.OMK_RUN_LOG_ROLE;
			else process.env.OMK_RUN_LOG_ROLE = savedRole;
			if (savedParent === undefined) delete process.env.OMK_RUN_LOG_PARENT_SESSION;
			else process.env.OMK_RUN_LOG_PARENT_SESSION = savedParent;
		}
	});

	it("worker line carries the lead's session id; lead line has parentSessionId null", async () => {
		const savedRole = process.env.OMK_RUN_LOG_ROLE;
		const savedParent = process.env.OMK_RUN_LOG_PARENT_SESSION;
		try {
			delete process.env.OMK_RUN_LOG_ROLE;
			delete process.env.OMK_RUN_LOG_PARENT_SESSION;
			await runCase("exact");
			const workerEnv = subagentWorkerEnv({ OMK_RUN_LOG_DIR: logDir }, undefined, "lead-sess");
			process.env.OMK_RUN_LOG_ROLE = workerEnv.OMK_RUN_LOG_ROLE;
			process.env.OMK_RUN_LOG_PARENT_SESSION = workerEnv.OMK_RUN_LOG_PARENT_SESSION;
			await runCase("not-found");
			const [leadLine, workerLine] = logLines();
			expect(leadLine).toMatchObject({ role: "lead", parentSessionId: null });
			expect(workerLine).toMatchObject({ role: "worker", ok: false, parentSessionId: "lead-sess" });
		} finally {
			if (savedRole === undefined) delete process.env.OMK_RUN_LOG_ROLE;
			else process.env.OMK_RUN_LOG_ROLE = savedRole;
			if (savedParent === undefined) delete process.env.OMK_RUN_LOG_PARENT_SESSION;
			else process.env.OMK_RUN_LOG_PARENT_SESSION = savedParent;
		}
	});

	it("parentSessionId is null for a lead even if the variable is stray", () => {
		expect(editParentSessionId({ OMK_RUN_LOG_PARENT_SESSION: "x" })).toBeNull();
		expect(editParentSessionId({ OMK_RUN_LOG_ROLE: "worker" })).toBeNull();
		expect(editParentSessionId({ OMK_RUN_LOG_ROLE: "worker", OMK_RUN_LOG_PARENT_SESSION: "p" })).toBe("p");
	});

	it("sessionId is null when the tool has no session context", async () => {
		await runCase("exact");
		expect(logLines()[0].sessionId).toBeNull();
	});

	it("run log off: no stage check and no classifier (same code path as main)", async () => {
		delete process.env[RUN_LOG_DIR_ENV];
		const stages = vi.spyOn(editMatchObserver, "stages");
		const classify = vi.spyOn(editMatchObserver, "classify");
		for (const c of EDIT_CASES) await runCase(c.name);
		expect(stages).not.toHaveBeenCalled();
		expect(classify).not.toHaveBeenCalled();
		process.env[RUN_LOG_DIR_ENV] = logDir;
		await runCase("exact");
		expect(stages).toHaveBeenCalledTimes(1);
	});

	it("writes nothing when the run log is off", async () => {
		delete process.env[RUN_LOG_DIR_ENV];
		await runCase("exact");
		await runCase("not-found");
		expect(logLines()).toEqual([]);
	});
});

describe("classifyEditMatchFailure", () => {
	it("classifies each reason", () => {
		const content = "if x:\n    y = 1\n    y = 1\nz\n";
		expect(classifyEditMatchFailure(content, [{ oldText: "if x:\ny = 1", newText: "" }]).reason).toBe("indent_only");
		expect(classifyEditMatchFailure(content, [{ oldText: "y = 1", newText: "" }]).reason).toBe("multiple_matches");
		expect(classifyEditMatchFailure(content, [{ oldText: "nope", newText: "" }]).reason).toBe("not_found");
		expect(classifyEditMatchFailure(content, [{ oldText: "", newText: "" }]).reason).toBe("unknown");
		expect(classifyEditMatchFailure(content, [{ oldText: "z", newText: "" }])).toEqual({
			reason: "unknown",
			editIndex: null,
		});
	});

	it("partial-line text with different indent is not indent_only", () => {
		expect(
			classifyEditMatchFailure("  x = 1\n  value = 2\n", [{ oldText: "x = 1\nvalue", newText: "" }]).reason,
		).toBe("not_found");
	});

	it("reports the first failing edit index", () => {
		expect(
			classifyEditMatchFailure("a\nb\n", [
				{ oldText: "a", newText: "" },
				{ oldText: "q", newText: "" },
			]),
		).toEqual({ reason: "not_found", editIndex: 1 });
	});
});

describe("edit match seq LRU cap", () => {
	it("keeps at most 1000 sessions and an active session's seq continues", () => {
		const env = { [RUN_LOG_DIR_ENV]: logDir } as NodeJS.ProcessEnv;
		const ctx = (id: string) => ({ sessionManager: { getSessionId: () => id } });
		const edits = [{ oldText: "a", newText: "A" }];
		const log = (id: string) => editMatchObserver.logSuccess("f.txt", "a", edits, ctx(id), env);
		log("active");
		for (let i = 0; i < EDIT_SEQ_SESSION_CAP + 50; i++) {
			log(`lru-${i}`);
			if (i % 100 === 0) log("active");
			expect(editSeqSessionCount()).toBeLessThanOrEqual(EDIT_SEQ_SESSION_CAP);
		}
		expect(editSeqSessionCount()).toBe(EDIT_SEQ_SESSION_CAP);
		log("active");
		log("lru-0");
		const all = logLines();
		const active = all.filter((l) => l.sessionId === "active").map((l) => l.seq);
		expect(active).toEqual(active.map((_, i) => i + 1));
		// lru-0 was evicted, so its counter restarts.
		expect(all.filter((l) => l.sessionId === "lru-0").map((l) => l.seq)).toEqual([1, 1]);
	});
});
