import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSubagentLoopGuard, type ExtensionAPI } from "open-multi-agent-kit";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import registerSubagent from "./index.ts";
import { processGroupState } from "./managed-process-tree.ts";
import type { SingleResult } from "./subagent-runtime-types.ts";
import { createSubagentStream } from "./subagent-stream.ts";

interface Tool {
	execute(id: string, params: unknown, signal: AbortSignal, onUpdate: undefined, ctx: unknown): Promise<ToolResult>;
}
interface ToolResult {
	readonly content: readonly { readonly type: string; readonly text?: string }[];
	readonly details?: { readonly results: readonly SingleResult[] };
	readonly isError?: boolean;
}

// 072 mock caps (sha256 5c4339659def…837582): mock regression tests only.
const MOCK_CAPS = { turns: 18, billedTokens: 70_254, wallMs: 5_700 } as const;
const LOOPS = {
	identical: "identical_call",
	"same-error": "same_error",
	"ping-pong": "ping_pong",
	"self-spawn": "nested_spawn",
	"no-progress": "no_progress",
} as const;
const RUNTIME_FLAG = "OMK_SUBAGENT_RUNTIME";

const originalArgv = process.argv[1];
const originalEnv = { ...process.env };
let cwd = "";

beforeAll(async () => {
	cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-071-loop-guard-"));
	await fs.promises.mkdir(path.join(cwd, ".omk", "agents"), { recursive: true });
	await fs.promises.mkdir(path.join(cwd, "agent-home"), { recursive: true });
	await fs.promises.writeFile(
		path.join(cwd, ".omk", "agents", "loop-agent.md"),
		"---\nname: loop-agent\ndescription: Spec 071 loop guard fixture\n---\nFollow the scripted trajectory.\n",
		"utf8",
	);
});
afterEach(() => {
	process.argv[1] = originalArgv;
	for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
	Object.assign(process.env, originalEnv);
});
afterAll(async () => {
	await fs.promises.rm(cwd, { recursive: true, force: true });
});

async function runTasks(
	tasks: readonly string[],
	runtime: string | undefined,
	extraEnv: Record<string, string> = {},
): Promise<ToolResult> {
	process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-loop.mjs");
	process.env.OMK_CODING_AGENT_DIR = path.join(cwd, "agent-home");
	process.env.OMK_TRUST_PROJECT = "0";
	if (runtime === undefined) delete process.env[RUNTIME_FLAG];
	else process.env[RUNTIME_FLAG] = runtime;
	Object.assign(process.env, extraEnv);
	let registered: Tool | undefined;
	const api = {
		registerTool(tool: Tool) {
			registered = tool;
		},
	} as unknown as ExtensionAPI;
	registerSubagent(api);
	if (!registered) throw new Error("subagent tool was not registered");
	return await registered.execute(
		"loop-guard-call",
		{
			tasks: tasks.map((task) => ({ agent: "loop-agent", task })),
			agentScope: "project",
			confirmProjectAgents: false,
			executionBudgetMs: 120_000,
			maxResumeAttempts: 1,
		},
		new AbortController().signal,
		undefined,
		{ cwd, hasUI: false },
	);
}

const billed = (result: SingleResult) =>
	result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheWrite;

function chunk<T>(items: readonly T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
}

async function runAll(tasks: readonly string[], runtime: string | undefined): Promise<SingleResult[]> {
	const results: SingleResult[] = [];
	for (const batch of chunk(tasks, 8)) results.push(...((await runTasks(batch, runtime)).details?.results ?? []));
	return results;
}

function loopSummary(tasks: readonly string[], results: readonly SingleResult[]) {
	const summary = { stopped: 0, emptySuccess: 0, orphans: 0, retries: 0, overCap: 0, wrongRule: 0, noPartial: 0 };
	for (const [index, result] of results.entries()) {
		const scenario = tasks[index]?.split(":")[0] as keyof typeof LOOPS;
		if (result.exitCode !== 0 && result.stopReason === "error" && result.loopGuard) summary.stopped += 1;
		if (result.exitCode === 0) summary.emptySuccess += 1;
		if (result.loopGuard?.rule !== LOOPS[scenario]) summary.wrongRule += 1;
		if (!result.errorMessage?.includes(`subagent.loop_guard.${LOOPS[scenario]}`) || result.messages.length === 0)
			summary.noPartial += 1;
		if (!result.process?.terminationObserved || processGroupState(result.process.pid) !== "gone")
			summary.orphans += 1;
		if ((result.deadline?.attempts.length ?? 0) !== 1 || (result.deadline?.resumeCount ?? 0) !== 0)
			summary.retries += 1;
		if (
			result.usage.turns > MOCK_CAPS.turns ||
			billed(result) > MOCK_CAPS.billedTokens ||
			(result.process?.elapsedMs ?? 0) > MOCK_CAPS.wallMs
		)
			summary.overCap += 1;
	}
	return summary;
}

/** Optional metrics dump for reports (set LOOP_GUARD_METRICS_FILE); the assertions above do not depend on it. */
function writeMetrics(name: string, tasks: readonly string[], results: readonly SingleResult[]): void {
	const file = process.env.LOOP_GUARD_METRICS_FILE;
	if (!file) return;
	const byRule: Record<string, number> = {};
	for (const result of results) {
		const rule = result.loopGuard?.rule ?? (result.exitCode === 0 ? "completed" : "error");
		byRule[rule] = (byRule[rule] ?? 0) + 1;
	}
	const max = (pick: (result: SingleResult) => number) => Math.max(0, ...results.map(pick));
	const metrics = {
		name,
		n: tasks.length,
		byRule,
		maxTurns: max((result) => result.usage.turns),
		maxBilledTokens: max(billed),
		maxElapsedMs: Math.round(max((result) => result.process?.elapsedMs ?? 0)),
		caps: MOCK_CAPS,
	};
	fs.appendFileSync(file, `${JSON.stringify(metrics)}\n`);
}

const CLEAN = { emptySuccess: 0, orphans: 0, retries: 0, overCap: 0, wrongRule: 0, noPartial: 0 };

describe("spec 071 loop guard is always on (no flag)", () => {
	it("stops 100 deliberately looping workers on the default path: in caps, 0 orphans, 0 retries, 100 % errors", async () => {
		const tasks = Object.keys(LOOPS).flatMap((scenario) =>
			Array.from({ length: 20 }, (_, seed) => `${scenario}:${seed}`),
		);
		expect(tasks).toHaveLength(100);
		const results = await runAll(tasks, undefined);
		writeMetrics("loops-default", tasks, results);
		expect(results).toHaveLength(100);
		expect(loopSummary(tasks, results)).toEqual({ stopped: 100, ...CLEAN });
	}, 300_000);

	it.each(["0", "1"])(
		"OMK_SUBAGENT_RUNTIME=%s does not switch the guard: all 5 rule families stop",
		async (flag) => {
			const tasks = Object.keys(LOOPS).flatMap((scenario) => [`${scenario}:0`, `${scenario}:1`]);
			const results = await runAll(tasks, flag);
			writeMetrics(`loops-flag-${flag}`, tasks, results);
			expect(loopSummary(tasks, results)).toEqual({ stopped: 10, ...CLEAN });
		},
		120_000,
	);

	it("lets 120 varied normal tasks (10 families incl. polling, retries, re-reads, grep/rg no match) finish: 0 wrong stops", async () => {
		const tasks = Array.from({ length: 120 }, (_, seed) => `normal:${seed}`);
		const results = await runAll(tasks, undefined);
		writeMetrics("normal-default", tasks, results);
		expect(results).toHaveLength(120);
		expect(
			results.filter((result) => result.loopGuard || result.exitCode !== 0).map((result) => result.task),
		).toEqual([]);
		expect(results.map((result) => result.output)).toEqual(tasks.map((_, seed) => `normal task ${seed} done`));
	}, 300_000);

	it("reports the stop to the lead as an error with the reason and the partial output", async () => {
		const response = await runTasks(["identical:7"], undefined);
		expect(response.isError).toBe(true);
		const text = response.content.map((part) => part.text ?? "").join("\n");
		expect(text).toContain("subagent.loop_guard.identical_call");
		expect(response.details?.results[0]?.loopGuard).toMatchObject({
			code: "loop_guard",
			rule: "identical_call",
			count: 3,
			partial: true,
		});
	}, 60_000);
});

/** Values that differ per run: the test cwd, mkdtemp suffixes and the attempt's remaining milliseconds. */
function normalizeRequest(line: string): string {
	return line
		.split(cwd)
		.join("<CWD>")
		.replace(/omk-subagent-checkpoint-[A-Za-z0-9]{6}/g, "omk-subagent-checkpoint-<RND>")
		.replace(/omk-subagent-[A-Za-z0-9]{6}\//g, "omk-subagent-<RND>/")
		.replace(/about \d+ms/g, "about <MS>ms");
}

const streamResult = (): SingleResult => ({
	agent: "a",
	agentSource: "project",
	task: "t",
	exitCode: 0,
	messages: [],
	stderr: "",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
});

// #279 turned these 7 harness flags default on; main 1ff132d200 predates all of them.
const PR279_DEFAULT_ON_FLAGS = [
	"OMK_EDIT_DIAGNOSTICS",
	"OMK_EXEC_TRUNCATE_MIDDLE",
	"OMK_JSON_SESSION_INFO",
	"OMK_GOAL_AUTONOMY",
	"OMK_SKILL_ADMISSION",
	"OMK_SKILL_AUTO_LOAD",
	"OMK_EVIDENCE_LIFECYCLE",
] as const;
const pinnedOff = Object.fromEntries(PR279_DEFAULT_ON_FLAGS.map((k) => [k, "0"]));
const readGolden = () =>
	JSON.parse(
		fs.readFileSync(path.join(import.meta.dirname, "fixtures", "first-request.main-1ff132d200.json"), "utf8"),
	) as Record<string, string>;

async function recordFirstRequest(name: string, flag: string | undefined, extraEnv: Record<string, string>) {
	const requestFile = path.join(cwd, `request-${name}.jsonl`);
	await fs.promises.rm(requestFile, { force: true });
	await runTasks(["normal:0"], flag, { OMK_FAKE_REQUEST_FILE: requestFile, ...extraEnv });
	return normalizeRequest((await fs.promises.readFile(requestFile, "utf8")).trim());
}

describe("spec 071 flag off: the guard only observes", () => {
	it.each([
		["unset", undefined],
		["0", "0"],
	])(
		"OMK_SUBAGENT_RUNTIME=%s: the first request to the model is byte-identical to main 1ff132d200",
		async (name, flag) => {
			// Pin all 7 #279 flags off so this compares only OMK_SUBAGENT_RUNTIME against main. The pins are
			// inherited into the recorded worker env; strip exactly those injected `"KEY":"0",` entries, except where
			// the worker itself sets the same entry on main (OMK_SKILL_AUTO_LOAD), which stays in the golden.
			let recorded = await recordFirstRequest(name, flag, pinnedOff);
			const golden = readGolden()[name];
			for (const key of PR279_DEFAULT_ON_FLAGS) {
				const entry = `"${key}":"0",`;
				if (golden.includes(entry)) continue;
				expect(recorded.split(entry).length - 1).toBe(1);
				recorded = recorded.replace(entry, "");
			}
			expect(recorded).toBe(golden);
		},
		60_000,
	);

	it.each([
		["unset", undefined],
		["0", "0"],
	])(
		"OMK_SUBAGENT_RUNTIME=%s with #279 flags at defaults: first request differs from main only by --no-skills",
		async (name, flag) => {
			const recorded = await recordFirstRequest(`default-${name}`, flag, {});
			const golden = readGolden()[name];
			const anchor = '"--no-extensions",';
			expect(golden.split(anchor)).toHaveLength(2);
			expect(recorded).toBe(golden.replace(anchor, `${anchor}"--no-skills",`));
		},
		60_000,
	);

	it("a guard that does not stop leaves the stream result byte-identical", () => {
		const all = fs
			.readFileSync(path.join(import.meta.dirname, "fixtures", "loop-guard-stream.jsonl"), "utf8")
			.trim()
			.split("\n");
		const lines = `${[...all.slice(0, 4), all[8]].join("\n")}\n`;
		const legacy = streamResult();
		const legacyStream = createSubagentStream(legacy);
		legacyStream.stdout(lines);
		legacyStream.finish(true);
		const guarded = streamResult();
		const guardedStream = createSubagentStream(guarded, undefined, undefined, createSubagentLoopGuard());
		guardedStream.stdout(lines);
		expect(guardedStream.finish(true)).toBeUndefined();
		expect(JSON.stringify(guarded)).toBe(JSON.stringify(legacy));
	});

	it("the looping stream with a guard stops at the third identical call+result", () => {
		const lines = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "loop-guard-stream.jsonl"), "utf8");
		const result = streamResult();
		const stream = createSubagentStream(result, undefined, undefined, createSubagentLoopGuard());
		expect(() => stream.stdout(lines)).toThrow("subagent.loop_guard.identical_call");
		expect(stream.finish(true)).toContain("subagent.loop_guard.identical_call");
		expect(result.messages).toHaveLength(6);
		expect(result.loopGuard).toMatchObject({ rule: "identical_call", usage: { turns: 3 } });
	});
});
