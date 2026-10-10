import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import finishCheck, {
	FINISH_CHECK_EVENT,
	FINISH_CHECK_LEDGER_ENTRY,
} from "../src/core/extensions/builtin/finish-check.ts";
import { FINISH_CHECK_VERIFY_ENTRY } from "../src/core/extensions/builtin/finish-check-reverify-stage.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { FINISH_CHECK_REVERIFY_FRACTION } from "../src/core/finish-check.ts";
import { FINISH_CHECK_REVERIFY_MARKER } from "../src/core/finish-check-reverify.ts";
import { bindActiveRemainingBudget, RemainingBudget } from "../src/core/remaining-budget.ts";

// spec 032 acceptance criteria 1–5, 8, 10–15 and 18: the verifier turn inside the finish-check flow.

const BUDGET_SEC = 900;
const TASK = "Fix the parser and save the symbols to out.txt.";
const COREWARS = "Your warrior must achieve at least a 75% win rate (75+ wins out of 100 battles) against `stone.red`.";
const ELF = "VERIFY 1: FAIL - parse new ELF; expected 0x401000; got 0x400000";
const KEEP = "Keep the currently saved output in place until a new version measures better";
const ON = { OMK_FINISH_CHECK_REVERIFY: "on", OMK_FINISH_CHECK_EXTRA_TURN: "on" };

type Handler = (event: unknown, ctx: unknown) => unknown;
const dirs: string[] = [];
afterEach(() => {
	bindActiveRemainingBudget(undefined);
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const settled = (text: string, stopReason = "stop") => ({
	messages: [{ role: "assistant", stopReason, content: [{ type: "text", text }] }],
});

function setup(env: NodeJS.ProcessEnv = ON, options: { hasUI?: boolean; budget?: boolean } = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "omk-reverify-flow-"));
	dirs.push(cwd);
	writeFileSync(join(cwd, "out.txt"), "v1");
	const handlers = new Map<string, Handler[]>();
	const sent: { text: string; deliverAs?: string }[] = [];
	const entries: { type: string; data: Record<string, unknown> }[] = [];
	const events: Record<string, unknown>[] = [];
	let pending = false;
	const ctx = { hasUI: options.hasUI ?? false, hasPendingMessages: () => pending, cwd };
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, opts?: { deliverAs?: string }) => sent.push({ text, deliverAs: opts?.deliverAs }),
		appendEntry: (type: string, data: Record<string, unknown>) => entries.push({ type, data }),
		events: {
			emit: (channel: string, data: Record<string, unknown>) => {
				if (channel === FINISH_CHECK_EVENT) events.push(data);
			},
			on: () => () => {},
		},
	} as unknown as ExtensionAPI;
	let clock = 0;
	const budgetEnv = options.budget === false ? {} : { OMK_TIME_BUDGET_SEC: String(BUDGET_SEC) };
	finishCheck(omk, { env: { ...budgetEnv, ...env }, now: () => clock });
	const fire = async (name: string, event: unknown) => {
		const results: unknown[] = [];
		for (const handler of handlers.get(name) ?? []) results.push(await handler(event, ctx));
		return results.find((result) => result !== undefined);
	};
	const at = (seconds: number) => {
		clock = seconds * 1000;
	};
	/** A task that wrote out.txt and first settles at `seconds`. */
	const work = async (task = TASK, seconds = 180) => {
		await fire("input", { type: "input", text: task, source: "interactive" });
		await fire("tool_execution_start", { toolName: "write", args: { path: "out.txt" } });
		await fire("tool_execution_end", { toolName: "write" });
		at(seconds);
		await fire("agent_settled", settled("done"));
	};
	const followUps = () => sent.filter((message) => message.deliverAs === "followUp").map((message) => message.text);
	const verifiers = () => followUps().filter((text) => text.startsWith(FINISH_CHECK_REVERIFY_MARKER));
	const setPending = (value: boolean) => {
		pending = value;
	};
	return { cwd, fire, at, work, sent, entries, events, followUps, verifiers, handlers, setPending };
}

describe("finish-check reverify flow: trigger", () => {
	it("sends one fresh verifier after the check turn of an early finish (AC1)", async () => {
		const run = setup();
		await run.work();
		expect(run.followUps()).toHaveLength(1);
		await run.fire("agent_settled", settled("checked"));
		expect(run.verifiers()).toHaveLength(1);
		const instruction = run.verifiers()[0];
		expect(instruction).toContain(TASK);
		expect(instruction).toContain("- out.txt");
		expect(instruction).toContain("build at least two new inputs");
		const [checkEnd, verifyStart] = run.events.slice(-2);
		expect(Object.keys(checkEnd).sort()).toEqual(["active", "ledger"]);
		expect(checkEnd.active).toBe(false);
		expect(verifyStart).toEqual({ active: true, stage: "verify" });
	});

	it("fires below 30% of the budget at the first settle and not at or above it (AC2, AC3)", async () => {
		for (const [seconds, expected] of [
			[269, 1],
			[270, 0],
			[450, 0],
		] as const) {
			const run = setup();
			await run.work(TASK, seconds);
			expect(seconds / BUDGET_SEC < FINISH_CHECK_REVERIFY_FRACTION).toBe(expected === 1);
			run.at(seconds + 10);
			await run.fire("agent_settled", settled("checked"));
			expect(run.verifiers(), String(seconds)).toHaveLength(expected);
		}
		const late = setup();
		await late.work(TASK, 260);
		late.at(330);
		await late.fire("agent_settled", settled("checked"));
		expect(late.verifiers()).toHaveLength(1);
	});

	it("never fires without a budget, in a UI session, or after an aborted check (AC5, AC13)", async () => {
		for (const run of [setup(ON, { budget: false }), setup({ ...ON, OMK_FINISH_CHECK: "always" }, { hasUI: true })]) {
			await run.work();
			await run.fire("agent_settled", settled("checked"));
			expect(run.verifiers()).toHaveLength(0);
		}
		const aborted = setup();
		await aborted.work();
		await aborted.fire("agent_settled", settled("", "aborted"));
		expect(aborted.verifiers()).toHaveLength(0);
	});

	it("fires on the shared run clock: loaded late, 0.30 is measured from run start", async () => {
		let clock = 0;
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: BUDGET_SEC * 1000, now: () => clock, startedAt: 0 }));
		clock = 200_000; // the extension loads at 22%; its own clock never moves in this test
		const early = setup();
		await early.fire("input", { type: "input", text: TASK, source: "interactive" });
		await early.fire("tool_execution_end", { toolName: "write" });
		clock = 260_000; // first settle at 28.9% of the run
		await early.fire("agent_settled", settled("done"));
		await early.fire("agent_settled", settled("checked"));
		expect(early.verifiers()).toHaveLength(1);

		clock = 200_000;
		const late = setup();
		await late.fire("input", { type: "input", text: TASK, source: "interactive" });
		await late.fire("tool_execution_end", { toolName: "write" });
		clock = 280_000; // first settle at 31.1% of the run, only 80 s after the extension loaded
		await late.fire("agent_settled", settled("done"));
		await late.fire("agent_settled", settled("checked"));
		expect(late.followUps()).toHaveLength(1);
		expect(late.verifiers()).toHaveLength(0);
	});
});

describe("finish-check reverify flow: fix turn", () => {
	async function toVerifier(env: NodeJS.ProcessEnv = ON, task = TASK, checkReply = "checked") {
		const run = setup(env);
		await run.work(task);
		await run.fire("agent_settled", settled(checkReply));
		expect(run.verifiers()).toHaveLength(1);
		return run;
	}

	it("turns a verifier FAIL into one fix turn and records round 2 (AC10)", async () => {
		const run = await toVerifier();
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(run.followUps()).toHaveLength(3);
		const fix = run.followUps()[2];
		expect(fix).toContain(ELF);
		expect(fix).toContain(KEEP);
		expect(run.entries.at(-1)).toMatchObject({ type: FINISH_CHECK_VERIFY_ENTRY, data: { verdict: "fail" } });
		expect(run.events.at(-1)).toMatchObject({ active: false, stage: "verify", verdict: "fail", fixTurn: true });
		await run.fire("agent_settled", settled("VERIFY 1: PASS - parse new ELF; expected 0x401000; got 0x401000"));
		expect(run.entries.at(-1)).toMatchObject({ type: FINISH_CHECK_VERIFY_ENTRY, data: { round: 2 } });
		await run.fire("agent_settled", settled("done"));
		expect(run.followUps()).toHaveLength(3);
		expect(run.verifiers()).toHaveLength(1);
	});

	it("voids a verifier that changed a deliverable; only the check ledger can still call for the turn (AC8)", async () => {
		const run = await toVerifier();
		writeFileSync(join(run.cwd, "out.txt"), "changed by the verifier");
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(run.followUps()).toHaveLength(2);
		expect(run.entries.at(-1)).toMatchObject({ data: { verdict: "void", mutated: true } });

		const both = await toVerifier(ON, COREWARS, "REQ 1: PASS - stone 74 >= 75");
		writeFileSync(join(both.cwd, "out.txt"), "changed");
		await both.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(both.followUps()).toHaveLength(3);
		expect(both.followUps()[2]).toContain("stone 74 >= 75");
		expect(both.followUps()[2]).not.toContain("VERIFY 1");
	});

	it("combines a check-ledger miss and a verifier FAIL into the single extra turn (AC11)", async () => {
		const run = await toVerifier(ON, COREWARS, "REQ 1: PASS - stone 74 >= 75");
		expect(run.followUps()).toHaveLength(2);
		await run.fire("agent_settled", settled(`${ELF}\nVERDICT: FAIL`));
		expect(run.followUps()).toHaveLength(3);
		expect(run.followUps()[2]).toContain(ELF);
		expect(run.followUps()[2]).toContain("stone 74 >= 75");
		await run.fire("agent_settled", settled("REQ 1: FAIL - stone 74 >= 75"));
		expect(run.followUps()).toHaveLength(3);

		const passing = await toVerifier(ON, COREWARS, "REQ 1: PASS - stone 74 >= 75");
		await passing.fire("agent_settled", settled("VERIFY 1: PASS - ok\nVERDICT: PASS"));
		expect(passing.followUps()).toHaveLength(3);
		expect(passing.followUps()[2]).not.toContain("VERIFY");
	});

	it("folds the go-measure nudge into the verifier, whose own miss gets the fix turn (AC12)", async () => {
		const run = await toVerifier(ON, COREWARS, "Looks good.");
		expect(run.verifiers()[0]).toContain("<label> <measured> <op> <limit>");
		expect(run.followUps()).toHaveLength(2);
		await run.fire("agent_settled", settled("REQ 1: FAIL - stone 74 >= 75\nVERDICT: FAIL"));
		expect(run.followUps()).toHaveLength(3);
		expect(run.followUps()[2]).toContain("stone 74 >= 75");
	});

	it("sends no fix turn for a passing, silent, aborted, interrupted or late verifier (AC13, AC14)", async () => {
		for (const reply of ["VERIFY 1: PASS - ok\nVERDICT: PASS", `${ELF}\nVERDICT: PASS`, "All good."]) {
			const run = await toVerifier();
			await run.fire("agent_settled", settled(reply));
			expect(run.followUps(), reply).toHaveLength(2);
		}
		const aborted = await toVerifier();
		await aborted.fire("agent_settled", settled(ELF, "aborted"));
		expect(aborted.followUps()).toHaveLength(2);
		const interrupted = await toVerifier();
		interrupted.setPending(true);
		await interrupted.fire("agent_settled", settled(ELF));
		expect(interrupted.followUps()).toHaveLength(2);
		const late = await toVerifier();
		late.at(0.86 * BUDGET_SEC);
		await late.fire("agent_settled", settled(ELF));
		expect(late.followUps()).toHaveLength(2);
		expect(late.entries.at(-1)).toMatchObject({ data: { verdict: "fail" } });
	});

	it("runs the verifier once per task; a new user task gets its own (AC15)", async () => {
		const run = await toVerifier();
		await run.fire("agent_settled", settled("VERDICT: PASS"));
		await run.fire("tool_execution_end", { toolName: "write" });
		await run.fire("agent_settled", settled("done again"));
		expect(run.verifiers()).toHaveLength(1);
		await run.work();
		await run.fire("agent_settled", settled("checked"));
		expect(run.verifiers()).toHaveLength(2);
	});

	it("with the extra-turn flag off, only the verifier's findings start the fix turn (AC18)", async () => {
		const off = { OMK_FINISH_CHECK_REVERIFY: "on" };
		const run = await toVerifier(off);
		await run.fire("agent_settled", settled(ELF));
		expect(run.followUps()).toHaveLength(3);

		const ledgerOnly = await toVerifier(off, COREWARS, "REQ 1: PASS - stone 74 >= 75");
		await ledgerOnly.fire("agent_settled", settled("VERDICT: PASS"));
		expect(ledgerOnly.followUps()).toHaveLength(2);

		const both = await toVerifier(off, COREWARS, "REQ 1: PASS - stone 74 >= 75");
		await both.fire("agent_settled", settled(ELF));
		expect(both.followUps()).toHaveLength(3);
		expect(both.followUps()[2]).toContain("stone 74 >= 75");
	});
});

describe("finish-check reverify flow: flag off (AC4)", () => {
	async function trace(env: NodeJS.ProcessEnv) {
		const run = setup(env);
		await run.work(COREWARS);
		await run.fire("agent_settled", settled("REQ 1: PASS - stone 74 >= 75"));
		await run.fire("agent_settled", settled("REQ 1: PASS - stone 76 >= 75"));
		await run.fire("agent_settled", settled("done"));
		return { sent: run.sent, entries: run.entries, events: run.events, handlers: [...run.handlers.keys()].sort() };
	}

	it("registers no new handlers and sends, records and emits exactly what main does", async () => {
		const main = ["agent_settled", "before_agent_start", "input", "message_end", "tool_execution_end"];
		for (const extra of [{}, { OMK_FINISH_CHECK_EXTRA_TURN: "on" }]) {
			const unset = await trace(extra);
			expect(unset.handlers).toEqual(main);
			expect(unset.entries.every((entry) => entry.type === FINISH_CHECK_LEDGER_ENTRY)).toBe(true);
			expect(unset.sent.some((message) => message.text.includes(FINISH_CHECK_REVERIFY_MARKER))).toBe(false);
			for (const value of ["off", "0", "maybe"]) {
				expect(await trace({ ...extra, OMK_FINISH_CHECK_REVERIFY: value })).toEqual(unset);
			}
		}
	});
});
