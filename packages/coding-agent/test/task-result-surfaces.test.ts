import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { GoalAcceptanceFlow } from "../src/core/extensions/builtin/goal-controller-acceptance.ts";
import type { GoalAcceptance } from "../src/core/goal-acceptance.ts";
import type { GoalAcceptanceResult } from "../src/core/goal-verification.ts";
import type { PromptSettledEvent } from "../src/core/prompt-settlement.ts";
import { buildTaskResultEvent, type TaskResultEvent } from "../src/core/task-result.ts";
import { TaskResultCollector } from "../src/core/task-result-collector.ts";
import { formatTaskResultLine } from "../src/core/task-result-format.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { serializeJsonLine } from "../src/modes/rpc/jsonl.ts";
import { createAssistantMessage, createRuntimeHost } from "./print-mode-fixtures.ts";

// Pins the pre-default-on output shape: explicitly opt out of the default-on flag(s).
const saved_OMK_JSON_SESSION_INFO = process.env.OMK_JSON_SESSION_INFO;
beforeAll(() => {
	process.env.OMK_JSON_SESSION_INFO = "0";
});
afterAll(() => {
	if (saved_OMK_JSON_SESSION_INFO === undefined) delete process.env.OMK_JSON_SESSION_INFO;
	else process.env.OMK_JSON_SESSION_INFO = saved_OMK_JSON_SESSION_INFO;
});

const printIo = vi.hoisted(() => ({ output: [] as string[] }));
vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	writeRawStdout: (text: string) => printIo.output.push(text),
}));

const keep = process.env.OMK_TASK_RESULT;
afterEach(() => {
	printIo.output = [];
	vi.restoreAllMocks();
	if (keep === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = keep;
});

const settled: PromptSettledEvent = {
	type: "prompt_settled",
	promptRunId: "fixture",
	outcome: "completed",
	durationMs: 1,
};
const taskResult: TaskResultEvent = buildTaskResultEvent({
	settled,
	facts: [{ id: "goal-acceptance:r-1", source: "host_receipt", status: "failed", required: true, receiptId: "r-1" }],
	modelClaims: [{ source: "model_text", says: "passed", text: "All tests passed." }],
});

/** Print mode over a fake session that emits the given events during the prompt. */
async function print(mode: "text" | "json", events: readonly object[]) {
	const host = createRuntimeHost(createAssistantMessage({ text: "All tests passed." }));
	host.session.subscribe.mockImplementation((listener: (event: object) => void) => {
		host.session.prompt.mockImplementationOnce(async () => {
			for (const event of events) listener(event);
		});
		return () => {};
	});
	const stderr: string[] = [];
	vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
		stderr.push(String(chunk));
		return true;
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
	const exitCode = await runPrintMode(host as unknown as Parameters<typeof runPrintMode>[0], {
		mode,
		initialMessage: "fixture",
	});
	return { exitCode, stdout: printIo.output.join(""), stderr: stderr.join("") };
}

describe("print mode (spec 096 B7/B8)", () => {
	it("B7 golden: flag off, text stdout and exit code are byte-identical to today", async () => {
		delete process.env.OMK_TASK_RESULT;
		const out = await print("text", [settled]);
		expect(out).toEqual({ exitCode: 0, stdout: "All tests passed.\n", stderr: "" });
	});

	it("B7 golden: flag off, json stdout is exactly the settled event line", async () => {
		delete process.env.OMK_TASK_RESULT;
		const out = await print("json", [settled]);
		expect(out.stdout).toBe(`${JSON.stringify(settled)}\n`);
		expect(out.exitCode).toBe(0);
	});

	it("B8: flag on, text stdout and exit code unchanged even when the host check failed; line goes to stderr", async () => {
		process.env.OMK_TASK_RESULT = "1";
		const out = await print("text", [settled, taskResult]);
		expect(out.exitCode).toBe(0);
		expect(out.stdout).toBe("All tests passed.\n");
		expect(out.stderr).toBe(`${formatTaskResultLine(taskResult.projection)}\n`);
	});
});

describe("print golden: flag off vs on (spec 096 B7/B8)", () => {
	it("text mode: stdout and exit code identical; flag on adds exactly one stderr line", async () => {
		delete process.env.OMK_TASK_RESULT;
		const off = await print("text", [settled]);
		printIo.output = [];
		vi.restoreAllMocks();
		process.env.OMK_TASK_RESULT = "1";
		const on = await print("text", [settled, taskResult]);
		expect(on.stdout).toBe(off.stdout);
		expect(on.exitCode).toBe(off.exitCode);
		expect(off.stderr).toBe("");
		expect(on.stderr.split("\n").filter(Boolean)).toEqual([formatTaskResultLine(taskResult.projection)]);
	});

	it("json mode: flag on stdout is the flag-off stdout plus the one task_result line", async () => {
		delete process.env.OMK_TASK_RESULT;
		const off = await print("json", [settled]);
		printIo.output = [];
		vi.restoreAllMocks();
		process.env.OMK_TASK_RESULT = "1";
		const on = await print("json", [settled, taskResult]);
		expect(on.stdout).toBe(`${off.stdout}${JSON.stringify(taskResult)}\n`);
		expect(on.exitCode).toBe(off.exitCode);
		expect(on.stderr).toBe("");
	});
});

describe("B1: every surface renders the same projection", () => {
	it("print json, RPC JSONL and the TUI/print-text line agree on check and coverage", async () => {
		process.env.OMK_TASK_RESULT = "1";
		const printJson = (await print("json", [settled, taskResult])).stdout
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		const fromPrint = printJson.find((e) => e.type === "task_result") as TaskResultEvent;
		const fromRpc = JSON.parse(serializeJsonLine(taskResult)) as TaskResultEvent;
		expect(fromPrint.projection).toEqual(taskResult.projection);
		expect(fromRpc.projection).toEqual(fromPrint.projection);
		const line = formatTaskResultLine(fromRpc.projection);
		expect(line).toBe(formatTaskResultLine(fromPrint.projection));
		expect(line).toBe(
			"task result: execution completed, check required_failed (host_receipt), checks 1/1, receipts 1 (host check observation, not task correctness)",
		);
	});
});

describe("goal-controller-acceptance wiring", () => {
	beforeEach(() => vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0")); // mock ctx has no session id; lifecycle defaults on
	afterEach(() => vi.unstubAllEnvs());
	const result: GoalAcceptanceResult = {
		receiptId: "r-9",
		digest: "d",
		capturedAt: "2026-10-21T00:00:00.000Z",
		status: "failed",
		exitCode: 1,
		passed: false,
		gateReason: "exit 1",
		workspace: { sha256: "s", completeness: "complete" } as GoalAcceptanceResult["workspace"],
		outputTail: "",
	};

	async function settleOnce() {
		const bus = createEventBus();
		const collector = new TaskResultCollector(bus);
		collector.begin("fixture");
		const entries: string[] = [];
		const goal = { ref: { id: "g", revision: 1 }, completedRounds: 1, maxRounds: 1, status: "active" };
		const acceptance = {
			approvedCommand: () => "npm test",
			check: async () => ({ command: "npm test", result, goal }),
			checkIdentity: () => undefined,
			currentWorkspaceSha256: () => "s",
		} as unknown as GoalAcceptance;
		const flow = new GoalAcceptanceFlow(
			{ appendEntry: (type: string) => entries.push(type), events: bus },
			acceptance,
			() => {},
		);
		const store = { current: async () => null } as never;
		const ctx = {
			cwd: "/tmp",
			signal: undefined,
			hasPendingMessages: () => false,
			ui: { notify: () => {} },
		} as never;
		await flow.settle(store, goal as never, { continue: false, reason: "max_rounds" } as never, ctx);
		const event = collector.finish(settled, undefined);
		collector.dispose();
		return { entries, event };
	}

	it("flag off: goal acceptance publishes nothing; entries unchanged", async () => {
		delete process.env.OMK_TASK_RESULT;
		const { entries, event } = await settleOnce();
		expect(entries).toEqual(["goal_verification"]);
		expect(event.projection.facts).toEqual([]);
	});

	it("flag on: the receipt becomes one required host fact", async () => {
		process.env.OMK_TASK_RESULT = "1";
		const { entries, event } = await settleOnce();
		expect(entries).toEqual(["goal_verification"]);
		expect(event.projection.facts).toEqual([
			{ id: "goal-acceptance:r-9", source: "host_receipt", status: "failed", required: true, receiptId: "r-9" },
		]);
		expect(event.projection.check).toBe("required_failed");
	});
});
