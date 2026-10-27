/**
 * Spec 112: `OMK_JSON_SESSION_INFO` (default on; `0`/`false`/`off` opts out) writes `omk_session_info` lines into the `--mode json` stream.
 * Real AgentSession + faux provider + real print mode; stdout is captured through the output guard.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool, StreamFn } from "omk-agent-core";
import { type Context, fauxAssistantMessage, streamSimple } from "omk-ai";
import { systemHash, toolsHash } from "omk-ai/prompt-hash";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subagentWorkerEnv } from "../../examples/extensions/subagent/worker-env.ts";
import {
	createJsonSessionInfoEmitter,
	createJsonSessionInfoStreamFn,
	JSON_SESSION_INFO_ENV,
	jsonSessionInfoEnabled,
} from "../../src/core/json-session-info.ts";
import {
	createLlmCallRunLogStreamFn,
	LLM_CALL_RUN_LOG,
	resetLlmCallRunLogClock,
} from "../../src/core/llm-call-run-log.ts";
import { RUN_LOG_DIR_ENV } from "../../src/core/run-log.ts";
import { runPrintMode } from "../../src/modes/print-mode.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const printIo = vi.hoisted(() => ({ output: [] as string[] }));
vi.mock("../../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	writeRawStdout: (text: string) => printIo.output.push(text),
}));

function tool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: Type.Object({ path: Type.String({ description: `${name} path` }) }),
		execute: async () => ({ content: [{ type: "text", text: `${name} ok` }], details: {} }),
	};
}

const harnesses: Harness[] = [];
const dirs: string[] = [];
const savedEnv = { info: process.env[JSON_SESSION_INFO_ENV], runLog: process.env[RUN_LOG_DIR_ENV] };
afterEach(() => {
	printIo.output = [];
	vi.restoreAllMocks();
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
	for (const [name, value] of [
		[JSON_SESSION_INFO_ENV, savedEnv.info],
		[RUN_LOG_DIR_ENV, savedEnv.runLog],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

interface RunResult {
	lines: Array<Record<string, unknown>>;
	stdout: string;
	requests: Context[];
	runLog: Array<Record<string, unknown>>;
	runLogFiles: Record<string, unknown[]>;
	exitCode: number;
}

/**
 * One `--mode json` print run. The stream stack mirrors sdk-provider-stream:
 * run log -> session info -> provider. `between` runs before each follow-up prompt.
 */
async function run(options: {
	flag: string | undefined;
	messages?: string[];
	between?: (harness: Harness, index: number) => void;
	prepare?: (harness: Harness) => void;
	extensionFactories?: HarnessOptions["extensionFactories"];
}): Promise<RunResult> {
	if (options.flag === undefined) delete process.env[JSON_SESSION_INFO_ENV];
	else process.env[JSON_SESSION_INFO_ENV] = options.flag;
	const logDir = mkdtempSync(join(tmpdir(), "omk-112-runlog-"));
	dirs.push(logDir);
	process.env[RUN_LOG_DIR_ENV] = logDir;
	resetLlmCallRunLogClock();

	const harness = await createHarness({
		tools: [tool("read"), tool("grep")],
		systemPrompt: "base system",
		extensionFactories: options.extensionFactories,
	});
	harnesses.push(harness);
	options.prepare?.(harness);
	const followUps = options.messages ?? [];
	harness.setResponses([fauxAssistantMessage("one"), ...followUps.map((_, i) => fauxAssistantMessage(`r${i}`))]);
	const requests: Context[] = [];
	const capture: StreamFn = (model, context, streamOptions) => {
		requests.push(JSON.parse(JSON.stringify(context)) as Context);
		return streamSimple(model, context, streamOptions);
	};
	harness.session.agent.streamFn = createLlmCallRunLogStreamFn(createJsonSessionInfoStreamFn(capture));

	let promptIndex = 0;
	const originalPrompt = harness.session.prompt.bind(harness.session);
	harness.session.prompt = (async (...args: Parameters<typeof originalPrompt>) => {
		if (promptIndex > 0) options.between?.(harness, promptIndex);
		promptIndex += 1;
		return originalPrompt(...args);
	}) as typeof harness.session.prompt;

	const host = {
		session: harness.session,
		setRebindSession: () => {},
		newSession: async () => undefined,
		fork: async () => ({ cancelled: true }),
		switchSession: async () => undefined,
		dispose: async () => {},
	};
	vi.spyOn(console, "error").mockImplementation(() => {});
	const exitCode = await runPrintMode(host as unknown as Parameters<typeof runPrintMode>[0], {
		mode: "json",
		initialMessage: "hello",
		messages: followUps,
	});
	const stdout = printIo.output.join("");
	printIo.output = [];
	const lines = stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	const files = readdirSync(logDir);
	const runLog = files.includes(`${LLM_CALL_RUN_LOG}.jsonl`)
		? readFileSync(join(logDir, `${LLM_CALL_RUN_LOG}.jsonl`), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>)
		: [];
	const runLogFiles = Object.fromEntries(
		files.sort().map((f) => [
			f,
			readFileSync(join(logDir, f), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as unknown),
		]),
	);
	return { lines, stdout, requests, runLog, runLogFiles, exitCode };
}

const infoLines = (r: RunResult) => r.lines.filter((line) => line.type === "omk_session_info");
const VOLATILE = new Set([
	"timestamp",
	"t",
	"pid",
	"requestedAtMs",
	"durationMs",
	"gapMs",
	"id",
	"promptRunId",
	"api",
	"runId",
	"sessionId",
	"parentSessionId",
	"responseId",
	"cwd",
]);
/** Drops wall-clock and random fields (and each harness's temp cwd) so two runs compare byte-for-byte. */
function stable(value: unknown): unknown {
	if (typeof value === "string") return value.replace(/\/tmp\/pi-suite-[\w-]+/g, "<cwd>");
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([key]) => !VOLATILE.has(key))
				.map(([key, inner]) => [key, stable(inner)]),
		);
	}
	return value;
}

describe("spec 112 OMK_JSON_SESSION_INFO", () => {
	it("flag parsing: default on; only 0/false/off (case-insensitive, trimmed) opt out", () => {
		for (const value of ["0", "false", "off", "OFF", " False ", " 0"])
			expect(jsonSessionInfoEnabled({ [JSON_SESSION_INFO_ENV]: value })).toBe(false);
		for (const value of [undefined, "", "1", "true", "yes"])
			expect(jsonSessionInfoEnabled({ [JSON_SESSION_INFO_ENV]: value })).toBe(true);
	});

	it("default on: unset flag writes the session-info line like flag=1", async () => {
		const unset = await run({ flag: undefined });
		const on = await run({ flag: "1" });
		expect(infoLines(unset)).toHaveLength(1);
		expect(unset.lines.map((line) => line.type)).toEqual(on.lines.map((line) => line.type));
		expect(Object.keys(infoLines(unset)[0] as object).sort()).toEqual(Object.keys(infoLines(on)[0] as object).sort());
	});

	it("criterion 1: flag off returns the inner stream itself and writes no session-info line", async () => {
		const inner: StreamFn = streamSimple;
		expect(createJsonSessionInfoStreamFn(inner, { [JSON_SESSION_INFO_ENV]: "0" })).toBe(inner);
		expect(createJsonSessionInfoStreamFn(inner, { [JSON_SESSION_INFO_ENV]: "false" })).toBe(inner);
		const off = await run({ flag: "off" });
		const zero = await run({ flag: "0" });
		expect(off.exitCode).toBe(0);
		expect(infoLines(off)).toEqual([]);
		expect(off.stdout).not.toContain("omk_session_info");
		expect(stable(zero.lines)).toEqual(stable(off.lines));
	});

	it("criterion 1/3: flag on only adds lines; the other stdout lines and provider requests equal flag off", async () => {
		const off = await run({ flag: "0" });
		const on = await run({ flag: "1" });
		expect(stable(on.lines.filter((line) => line.type !== "omk_session_info"))).toEqual(stable(off.lines));
		expect(on.requests).toHaveLength(1);
		expect(stable(on.requests)).toEqual(stable(off.requests));
	});

	it("criterion 2: exactly one line at index 1 with exactly the spec keys", async () => {
		const on = await run({ flag: "1" });
		const info = infoLines(on);
		expect(info).toHaveLength(1);
		expect(on.lines.indexOf(info[0]!)).toBe(1);
		expect(on.lines[0]!.type).toBe("session");
		expect(Object.keys(info[0]!)).toEqual(["type", "seq", "systemHash", "toolsHash", "systemPrompt", "tools"]);
		expect(info[0]!.seq).toBe(1);
		const tools = info[0]!.tools as Array<Record<string, unknown>>;
		expect(tools.map((t) => t.name)).toEqual(["read", "grep"]);
		for (const t of tools) expect(Object.keys(t)).toEqual(["name", "description", "parameters"]);
	});

	it("criterion 2b: systemPrompt is the string the provider got and the hashes equal the run log", async () => {
		const on = await run({ flag: "1" });
		const [info] = infoLines(on);
		const [request] = on.requests;
		expect(info!.systemPrompt).toBe(request!.systemPrompt);
		expect(info!.systemHash).toBe(systemHash(request!));
		expect(info!.toolsHash).toBe(toolsHash(request!));
		expect(on.runLog).toHaveLength(1);
		expect(on.runLog[0]!.systemHash).toBe(info!.systemHash);
		expect(on.runLog[0]!.toolsHash).toBe(info!.toolsHash);
	});

	it("decision (a): setup prompt/tools equal the first real request -> exactly one line, seq 1 only", async () => {
		const on = await run({ flag: "1" });
		const info = infoLines(on);
		expect(info.map((line) => line.seq)).toEqual([1]);
		expect(on.requests).toHaveLength(1);
		expect(info[0]!.systemHash).toBe(systemHash(on.requests[0]!));
		expect(info[0]!.toolsHash).toBe(toolsHash(on.requests[0]!));
		expect(info[0]!.systemHash).toBe(on.runLog[0]!.systemHash);
		expect(info[0]!.toolsHash).toBe(on.runLog[0]!.toolsHash);
	});

	/** seq 2 must come from the real request: after seq 1, before that request's assistant events, hashes = its llm-call line. */
	function expectSeq2FromRequest(on: RunResult, changed: "system" | "tools") {
		const info = infoLines(on);
		expect(info.map((line) => line.seq)).toEqual([1, 2]);
		const [first, second] = info as [Record<string, unknown>, Record<string, unknown>];
		expect(on.lines.indexOf(first)).toBe(1);
		const assistantStart = on.lines.findIndex(
			(line) => line.type === "message_start" && (line.message as { role?: string })?.role === "assistant",
		);
		expect(on.lines.indexOf(second)).toBeLessThan(assistantStart);
		const [request] = on.requests;
		expect(on.requests).toHaveLength(1);
		expect(second.systemHash).toBe(systemHash(request!));
		expect(second.toolsHash).toBe(toolsHash(request!));
		expect(second.systemHash).toBe(on.runLog[0]!.systemHash);
		expect(second.toolsHash).toBe(on.runLog[0]!.toolsHash);
		// Only the part that really changed in the request differs from seq 1.
		if (changed === "tools") {
			expect(second.toolsHash).not.toBe(first.toolsHash);
			expect(second.systemHash).toBe(first.systemHash);
		} else {
			expect(second.systemHash).not.toBe(first.systemHash);
			expect(second.toolsHash).toBe(first.toolsHash);
			expect(second.systemPrompt).toBe(request!.systemPrompt);
		}
	}

	it("decision (b): prepareTools narrows the sent tools -> seq 2 before that request, hashes = its llm-call line", async () => {
		const on = await run({
			flag: "1",
			prepare: (harness) => {
				harness.session.agent.prepareTools = (tools) => tools.filter((t) => t.name === "read");
			},
		});
		expectSeq2FromRequest(on, "tools");
		expect((infoLines(on)[1]!.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["read"]);
	});

	it("decision (b): an extension rewrites the system prompt -> seq 2 before that request, hashes = its llm-call line", async () => {
		const on = await run({
			flag: "1",
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", async () => ({ systemPrompt: "extension system prompt" }));
				},
			],
		});
		expectSeq2FromRequest(on, "system");
		expect(infoLines(on)[1]!.systemPrompt).toBe("extension system prompt");
	});

	it("criterion 2a: unchanged hashes across prompts write no new line", async () => {
		const on = await run({ flag: "1", messages: ["again", "and again"] });
		expect(on.requests).toHaveLength(3);
		expect(infoLines(on)).toHaveLength(1);
	});

	it("criterion 2a: a tool-set change writes exactly one new line with seq+1 and the new hashes", async () => {
		const on = await run({
			flag: "1",
			messages: ["after change", "still changed"],
			between: (harness, index) => {
				if (index === 1) harness.session.setActiveToolsByName(["read"]);
			},
		});
		const info = infoLines(on);
		expect(info.map((line) => line.seq)).toEqual([1, 2]);
		expect(info[1]!.toolsHash).not.toBe(info[0]!.toolsHash);
		expect((info[1]!.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["read"]);
		// The new line precedes the events of the request it describes and matches its run-log line.
		expect(info[1]!.toolsHash).toBe(on.runLog[1]!.toolsHash);
		expect(info[1]!.systemHash).toBe(on.runLog[1]!.systemHash);
		expect(info[1]!.systemPrompt).toBe(on.requests[1]!.systemPrompt);
	});

	it("criterion 4: run-log lines are identical with the flag on and off (modulo time and pid)", async () => {
		const off = await run({ flag: "0", messages: ["again"] });
		const on = await run({ flag: "1", messages: ["again"] });
		expect(on.runLog).toHaveLength(2);
		// Each harness has its own temp cwd inside the system prompt, so systemHash and the faux
		// token counts differ per run; pin them to each run's own request instead.
		for (const r of [on, off]) {
			for (const [i, line] of r.runLog.entries()) expect(line.systemHash).toBe(systemHash(r.requests[i]!));
		}
		const perRun = new Set(["systemHash", "input", "output", "totalTokens", "costTotal"]);
		const strip = (lines: Array<Record<string, unknown>>) =>
			lines.map((line) => Object.fromEntries(Object.entries(line).filter(([k]) => !perRun.has(k))));
		expect(stable(strip(on.runLog))).toEqual(stable(strip(off.runLog)));
		expect(Object.keys(on.runLogFiles)).toEqual(Object.keys(off.runLogFiles));
		for (const name of Object.keys(on.runLogFiles).filter((f) => f !== `${LLM_CALL_RUN_LOG}.jsonl`))
			expect(stable(strip(on.runLogFiles[name] as Array<Record<string, unknown>>))).toEqual(
				stable(strip(off.runLogFiles[name] as Array<Record<string, unknown>>)),
			);
		expect(JSON.stringify(on.runLogFiles)).not.toContain("omk_session_info");
		expect(JSON.stringify(on.runLogFiles)).not.toContain("base system");
	});

	it("criterion 2c: subagent workers inherit the flag through their env", () => {
		const env = subagentWorkerEnv({ [JSON_SESSION_INFO_ENV]: "1", PATH: "/bin" }, "0", "lead");
		expect(env[JSON_SESSION_INFO_ENV]).toBe("1");
		expect(jsonSessionInfoEnabled(env)).toBe(true);
	});

	it("emitter: seq counts written lines only and re-emits when the system prompt alone changes", () => {
		const out: string[] = [];
		const emitter = createJsonSessionInfoEmitter((line) => out.push(line));
		const tools = [{ name: "read", description: "d", parameters: Type.Object({}) }];
		expect(emitter.observe({ systemPrompt: "a", tools })).toBe(true);
		expect(emitter.observe({ systemPrompt: "a", tools })).toBe(false);
		expect(emitter.observe({ systemPrompt: "b", tools })).toBe(true);
		expect(emitter.observe({ systemPrompt: "b", tools: [] })).toBe(true);
		const parsed = out.map((line) => JSON.parse(line));
		expect(parsed.map((line) => line.seq)).toEqual([1, 2, 3]);
		expect(parsed[1].systemHash).toBe(systemHash({ systemPrompt: "b" }));
		expect(parsed[2].tools).toEqual([]);
		expect(out.every((line) => line.endsWith("\n") && !line.slice(0, -1).includes("\n"))).toBe(true);
	});
});
