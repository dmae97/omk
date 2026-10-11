import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import finishCheck from "../src/core/extensions/builtin/finish-check.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";

// spec 032 AC19–21 and spec 035 AC28: finish-check writes its trigger, verifier and extra-turn decisions
// to <OMK_RUN_LOG_DIR>/finish-check.jsonl (spec 042), because bench runs keep no session entries.

const BUDGET_SEC = 900;
const TASK = "Fix the parser and save the symbols to out.txt. SECRET-TASK-TEXT";
const COREWARS = "Your warrior must achieve at least a 75% win rate (75+ wins out of 100 battles) against `stone.red`.";
const ELF = "VERIFY 1: FAIL - parse new ELF; expected 0x401000; got 0x400000";
const BOTH = { OMK_FINISH_CHECK_REVERIFY: "on", OMK_FINISH_CHECK_EXTRA_TURN: "on" };
const AUTO_FIELDS = ["t", "elapsedFraction", "pid", "role"];

type Handler = (event: unknown, ctx: unknown) => unknown;
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const settled = (text: string, stopReason = "stop") => ({
	messages: [{ role: "assistant", stopReason, content: [{ type: "text", text }] }],
});

function setup(env: NodeJS.ProcessEnv, options: { hasUI?: boolean; budget?: boolean; logDir?: boolean } = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "omk-fc-runlog-"));
	dirs.push(cwd);
	const logDir = join(cwd, "logs");
	writeFileSync(join(cwd, "out.txt"), "v1");
	const handlers = new Map<string, Handler[]>();
	const sent: { text: string; deliverAs?: string }[] = [];
	let pending = false;
	const ctx = { hasUI: options.hasUI ?? false, hasPendingMessages: () => pending, cwd };
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, opts?: { deliverAs?: string }) => sent.push({ text, deliverAs: opts?.deliverAs }),
		appendEntry: () => {},
		events: { emit: () => {}, on: () => () => {} },
	} as unknown as ExtensionAPI;
	let clock = 0;
	finishCheck(omk, {
		env: {
			...(options.budget === false ? {} : { OMK_TIME_BUDGET_SEC: String(BUDGET_SEC) }),
			...(options.logDir === false ? {} : { OMK_RUN_LOG_DIR: logDir }),
			...env,
		},
		now: () => clock,
	});
	const fire = async (name: string, event: unknown) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	const at = (seconds: number) => {
		clock = seconds * 1000;
	};
	const work = async (task = TASK, seconds = 180) => {
		await fire("input", { type: "input", text: task, source: "interactive" });
		await fire("tool_execution_start", { toolName: "write", args: { path: "out.txt" } });
		await fire("tool_execution_end", { toolName: "write" });
		at(seconds);
		await fire("agent_settled", settled("done"));
	};
	const file = join(logDir, "finish-check.jsonl");
	const raw = () => (existsSync(file) ? readFileSync(file, "utf8") : "");
	const lines = () =>
		raw()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	const ofType = (type: string) => lines().filter((line) => line.type === type);
	const followUps = () => sent.filter((message) => message.deliverAs === "followUp");
	const setPending = (value: boolean) => {
		pending = value;
	};
	return { cwd, logDir, fire, at, work, raw, lines, ofType, followUps, setPending };
}

describe("finish-check run log: spec 032 trigger (AC19)", () => {
	it("logs a fired trigger with the first-settle fraction", async () => {
		const run = setup(BOTH);
		await run.work();
		run.at(300);
		await run.fire("agent_settled", settled("checked"));
		expect(run.ofType("reverify-trigger")).toEqual([
			expect.objectContaining({ type: "reverify-trigger", fired: true, reason: null, firstSettleFraction: 0.2 }),
		]);
	});

	it("logs why the verifier did not run", async () => {
		const cases: [string, ReturnType<typeof setup>, string][] = [];
		const late = setup(BOTH);
		await late.work(TASK, 450);
		cases.push(["late", late, "checked"]);
		const noBudget = setup(BOTH, { budget: false });
		await noBudget.work();
		cases.push(["no-budget", noBudget, "checked"]);
		const ui = setup({ ...BOTH, OMK_FINISH_CHECK: "always" }, { hasUI: true });
		await ui.work();
		cases.push(["ui", ui, "checked"]);
		const aborted = setup(BOTH);
		await aborted.work();
		cases.push(["check-aborted", aborted, ""]);
		const pending = setup(BOTH);
		await pending.work();
		pending.setPending(true);
		cases.push(["pending-input", pending, "checked"]);
		for (const [reason, run, reply] of cases) {
			await run.fire("agent_settled", settled(reply, reason === "check-aborted" ? "aborted" : "stop"));
			expect(run.ofType("reverify-trigger"), reason).toEqual([expect.objectContaining({ fired: false, reason })]);
		}
		expect(late.ofType("reverify-trigger")[0].firstSettleFraction).toBe(0.5);
		expect(noBudget.ofType("reverify-trigger")[0].firstSettleFraction).toBeNull();
	});
});

describe("finish-check run log: spec 032 result (AC20)", () => {
	async function toVerifier(env: NodeJS.ProcessEnv = BOTH) {
		const run = setup(env);
		await run.work();
		run.at(200);
		await run.fire("agent_settled", settled("checked"));
		expect(run.followUps()).toHaveLength(2);
		return run;
	}

	it("logs the verdict, its cost and the fix turn", async () => {
		const run = await toVerifier();
		for (let i = 0; i < 3; i++) await run.fire("tool_execution_end", { toolName: "bash" });
		run.at(290);
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(run.followUps()).toHaveLength(3);
		const [result] = run.ofType("reverify-result");
		expect(result).toMatchObject({
			verdict: "fail",
			passed: 0,
			failed: 1,
			changed: [],
			deliverables: 1,
			toolCalls: 3,
			fixTurn: true,
		});
		expect(result.verifyStartFraction).toBeCloseTo(200 / BUDGET_SEC);
		expect(result.verifyEndFraction).toBeCloseTo(290 / BUDGET_SEC);
		expect(result.fixTurnFraction).toBeCloseTo(290 / BUDGET_SEC);
		for (const key of ["costUsd", "inputTokens", "outputTokens", "totalTokens"]) expect(result[key]).toBe(0);
	});

	it("lists the changed deliverable paths of a void verifier", async () => {
		const run = await toVerifier();
		writeFileSync(join(run.cwd, "out.txt"), "changed by the verifier");
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(run.ofType("reverify-result")).toEqual([
			expect.objectContaining({ verdict: "void", changed: ["out.txt"], fixTurn: false, fixTurnFraction: null }),
		]);
	});

	it("logs fixTurn: false with the extra-turn flag off", async () => {
		const run = await toVerifier({ OMK_FINISH_CHECK_REVERIFY: "on" });
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(run.followUps()).toHaveLength(2);
		expect(run.ofType("reverify-result")).toEqual([
			expect.objectContaining({ verdict: "fail", fixTurn: false, fixTurnFraction: null }),
		]);
		expect(run.ofType("extra-turn")).toEqual([]);
	});

	it("logs the shared extra turn as a reverify fix", async () => {
		const run = await toVerifier();
		run.at(290);
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		const [decision] = run.ofType("extra-turn");
		expect(decision).toMatchObject({ used: true, reasons: ["reverify-fix"] });
		expect(decision.extraTurnFraction).toBeCloseTo(290 / BUDGET_SEC);
	});
});

describe("finish-check run log: off and private (AC21)", () => {
	it("writes nothing without OMK_RUN_LOG_DIR or with the flags off", async () => {
		const unset = setup(BOTH, { logDir: false });
		await unset.work();
		await unset.fire("agent_settled", settled("checked"));
		expect(existsSync(unset.logDir)).toBe(false);
		const off = setup({});
		await off.work(COREWARS);
		await off.fire("agent_settled", settled("REQ 1: PASS - stone 74 >= 75"));
		expect(existsSync(off.logDir)).toBe(false);
	});

	it("never logs task text or model output and leaves the shared fields to appendRunLog", async () => {
		const run = setup(BOTH);
		await run.work();
		await run.fire("agent_settled", settled("check reply SECRET-REPLY"));
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(run.lines().length).toBeGreaterThanOrEqual(3);
		expect(run.raw()).not.toContain("SECRET");
		expect(run.raw()).not.toContain("parse new ELF");
		for (const line of run.lines()) {
			expect(line.role).toBe("lead");
			expect(line.pid).toBe(process.pid);
			expect(typeof line.t).toBe("number");
			expect(line.elapsedFraction).toBeNull();
			expect(
				Object.keys(line)
					.filter((key) => AUTO_FIELDS.includes(key))
					.sort(),
			).toEqual([...AUTO_FIELDS].sort());
		}
	});
});

describe("finish-check run log: spec 035 extra turn (AC28)", () => {
	const EXTRA = { OMK_FINISH_CHECK_EXTRA_TURN: "on" };
	async function check(reply: string, seconds = 693, env: NodeJS.ProcessEnv = EXTRA) {
		const run = setup(env);
		await run.work(COREWARS, seconds);
		await run.fire("agent_settled", settled(reply));
		return run;
	}

	it("logs whether the extra turn was used, why, and when", async () => {
		const threshold = await check("REQ 1: PASS - stone 74 >= 75");
		expect(threshold.followUps()).toHaveLength(2);
		const [line] = threshold.ofType("extra-turn");
		expect(line).toMatchObject({ used: true, reasons: ["below-threshold"] });
		expect(line.extraTurnFraction).toBeCloseTo(0.77);
		expect((await check("Looks good.")).ofType("extra-turn")).toEqual([
			expect.objectContaining({ used: true, reasons: ["unmeasured"] }),
		]);
		expect((await check("REQ 1: PASS - stone 75 >= 75")).ofType("extra-turn")).toEqual([
			expect.objectContaining({ used: false, reasons: [] }),
		]);
		expect((await check("REQ 1: PASS - stone 74 >= 75", 0.86 * BUDGET_SEC)).ofType("extra-turn")).toEqual([
			expect.objectContaining({ used: false, reasons: ["below-threshold"] }),
		]);
	});

	it("writes no 035 line with the extra-turn flag off and no 032 line without the reverify flag", async () => {
		const off = await check("REQ 1: PASS - stone 74 >= 75", 693, {});
		expect(off.lines()).toEqual([]);
		const extraOnly = await check("REQ 1: PASS - stone 74 >= 75");
		expect(extraOnly.lines().map((line) => line.type)).toEqual(["extra-turn"]);
	});
});
