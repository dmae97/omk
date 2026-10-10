import { describe, expect, it } from "vitest";
import finishCheck, {
	FINISH_CHECK_EVENT,
	FINISH_CHECK_LEDGER_ENTRY,
} from "../src/core/extensions/builtin/finish-check.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import {
	decideExtraTurn,
	FINISH_CHECK_EXTRA_TURN_FRACTION,
	FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE,
	FINISH_CHECK_MAX_EXTRA_TURNS,
	FINISH_CHECK_SAVE_NOW_FRACTION,
	FINISH_CHECK_SKIP_FRACTION,
	FINISH_CHECK_WRAP_UP_MESSAGE,
} from "../src/core/finish-check.ts";
import { extractRequirements, parseFinishCheckLedger } from "../src/core/finish-check-requirements.ts";

// spec 035 requirement 2: one extra turn per task, for a missed limit or an unmeasured one.

const COREWARS =
	"Your warrior must achieve at least a 75% win rate (75+ wins out of 100 battles) against `stone.red`, `vampire.red`, and `paper.red`, and achieve at least a 33% win rate (33+ wins out of 100 battles) against `snake.red` and `g2-clear.red`.";
const FASTTEXT =
	"The final model size needs to be less than 150MB but get at least 0.62 accuracy on a private test set.";
const BUDGET_SEC = 3600;
const R2_SETTLE_MS = 2_772_000; // corewars r2 ended at 2772 s of 3600 s (77%)

const MISSED = "REQ 1: PASS - stone 74 >= 75; paper 70 >= 75; vampire 82 >= 75; snake 7 >= 33; g2-clear 39 >= 33";
const MET = "REQ 1: PASS - stone 75 >= 75; paper 78 >= 75; vampire 82 >= 75; snake 33 >= 33; g2-clear 39 >= 33";

type Handler = (event: unknown, ctx: unknown) => unknown;
const ctx = { hasUI: false, hasPendingMessages: () => false };
const settled = (text: string, stopReason = "stop") => ({
	messages: [{ role: "assistant", stopReason, content: [{ type: "text", text }] }],
});

/** Runs a task to the point where the finish check has been sent, at `settleMs` into the budget. */
async function toCheck(prompt: string, settleMs = R2_SETTLE_MS, env: NodeJS.ProcessEnv = {}) {
	const handlers = new Map<string, Handler[]>();
	const sent: { text: string; deliverAs?: string }[] = [];
	const entries: { type: string; data: { items: unknown[]; round?: number } }[] = [];
	const events: { channel: string; data: Record<string, unknown> }[] = [];
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, options?: { deliverAs?: string }) =>
			sent.push({ text, deliverAs: options?.deliverAs }),
		appendEntry: (type: string, data: { items: unknown[]; round?: number }) => entries.push({ type, data }),
		events: {
			emit: (channel: string, data: Record<string, unknown>) => events.push({ channel, data }),
			on: () => () => {},
		},
	} as unknown as ExtensionAPI;
	const fire = async (name: string, event: unknown, context: unknown = ctx) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, context);
	};
	let clock = 0;
	const setClock = (ms: number) => {
		clock = ms;
	};
	finishCheck(omk, { env: { OMK_TIME_BUDGET_SEC: String(BUDGET_SEC), ...env }, now: () => clock });
	const startTask = async (text: string) => {
		await fire("input", { type: "input", text, source: "interactive" });
		await fire("tool_execution_end", { toolName: "write" });
		clock = settleMs;
		await fire("agent_settled", settled("done"));
	};
	await startTask(prompt);
	const followUps = () => sent.filter((message) => message.deliverAs === "followUp");
	expect(followUps()).toHaveLength(1);
	return { fire, sent, entries, events, followUps, startTask, setClock };
}

describe("finish-check extra turn: threshold retry", () => {
	it("refuses completion when the run's own comparison misses the limit (corewars r2, 74 < 75)", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MISSED));
		expect(run.followUps()).toHaveLength(2);
		const message = run.followUps()[1].text;
		expect(message).toContain("the task is not complete");
		expect(message).toContain("REQ 1:");
		expect(message).toContain("stone 74 >= 75; paper 70 >= 75; snake 7 >= 33");
		expect(message).toContain("Keep the currently saved output in place until a new version measures better");
		expect(run.events.at(-1)).toMatchObject({
			channel: FINISH_CHECK_EVENT,
			data: { active: false, extraTurn: "threshold", extraTurnIds: [1] },
		});
		// The extra turn is ordinary work: no check-turn tool cap or wrap-up steer.
		for (let i = 0; i < 20; i++) await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.sent.some((message) => message.text === FINISH_CHECK_WRAP_UP_MESSAGE)).toBe(false);
	});

	it("refuses on an honest FAIL line too", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled("REQ 1: FAIL - stone 74 >= 75"));
		expect(run.followUps()).toHaveLength(2);
		expect(run.events.at(-1)?.data.extraTurn).toBe("threshold");
	});

	it("accepts 75 >= 75 and ends exactly as before", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MET));
		const ledger = parseFinishCheckLedger(MET, extractRequirements(COREWARS));
		expect(run.followUps()).toHaveLength(1);
		expect(run.entries).toEqual([{ type: FINISH_CHECK_LEDGER_ENTRY, data: { items: ledger } }]);
		expect(run.events.at(-1)).toEqual({ channel: FINISH_CHECK_EVENT, data: { active: false, ledger } });
	});

	it("ends after the extra turn even if it still misses the limit", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MISSED));
		await run.fire("agent_settled", settled("REQ 1: FAIL - stone 74 >= 75"));
		expect(run.followUps()).toHaveLength(2);
		expect(run.entries[1].data.round).toBe(2);
		expect(run.entries[1].data.items[0]).toMatchObject({ status: "fail", gaps: ["stone 74 >= 75"] });
		await run.fire("agent_settled", settled("ok"));
		expect(run.followUps()).toHaveLength(2);
	});

	it("records a passing extra turn", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MISSED));
		await run.fire("agent_settled", settled(MET.replace("stone 75", "stone 77")));
		expect(run.followUps()).toHaveLength(2);
		expect(run.entries[1].data).toMatchObject({ round: 2, items: [{ status: "pass" }] });
	});
});

describe("finish-check extra turn: which message is read", () => {
	const turn = (...texts: string[]) => ({
		messages: texts
			.flatMap((text) => [
				{ role: "assistant", stopReason: "toolUse", content: [{ type: "text", text }] },
				{ role: "toolResult", content: [{ type: "text", text: "REQ 1: PASS - stone 99 >= 75" }] },
			])
			.concat([{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done." }] }]),
	});

	it("reads the latest assistant message of the turn that has REQ lines", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", turn("REQ 1: PASS - stone 70 >= 75", MET, "Saving the output."));
		expect(run.followUps()).toHaveLength(1);
		expect(run.entries[0].data.items[0]).toMatchObject({ status: "pass", hasMeasurement: true });
	});

	it("still finds a miss written before the final summary", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", turn(MISSED));
		expect(run.events.at(-1)?.data.extraTurn).toBe("threshold");
	});
});

describe("finish-check extra turn: go-measure nudge", () => {
	it("nudges once when a numeric item has no REQ line", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled("Looks good."));
		expect(run.followUps()).toHaveLength(2);
		const message = run.followUps()[1].text;
		expect(message).toContain("were not measured");
		expect(message).not.toContain("not complete");
		expect(run.events.at(-1)?.data.extraTurn).toBe("measure");
	});

	it("nudges once when a PASS has no comparison", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled("REQ 1: PASS - all opponents beaten"));
		expect(run.events.at(-1)?.data.extraTurn).toBe("measure");
	});

	it("gives no second turn when the nudge reveals a miss", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled("Looks good."));
		await run.fire("agent_settled", settled("REQ 1: FAIL - stone 74 >= 75"));
		expect(run.followUps()).toHaveLength(2);
		expect(run.entries[1].data).toMatchObject({ round: 2, items: [{ status: "fail", gaps: ["stone 74 >= 75"] }] });
	});

	it("gives no second turn when the nudge still measures nothing", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled("Looks good."));
		await run.fire("agent_settled", settled("Still looks good."));
		expect(run.followUps()).toHaveLength(2);
		expect(run.entries[1].data).toMatchObject({ round: 2, items: [{ status: "unreported" }] });
	});
});

describe("finish-check extra turn: one per task", () => {
	const both = `${COREWARS}\n${FASTTEXT}`;

	it("combines a miss and an unmeasured item into one message, then stops", async () => {
		const run = await toCheck(both);
		await run.fire("agent_settled", settled("REQ 1: FAIL - stone 74 >= 75"));
		expect(run.followUps()).toHaveLength(2);
		expect(run.followUps()[1].text).toContain("not complete");
		expect(run.followUps()[1].text).toContain("were not measured");
		expect(run.events.at(-1)?.data).toMatchObject({ extraTurn: "both", extraTurnIds: [1, 2] });
		await run.fire("agent_settled", settled("REQ 1: PASS - stone 76 >= 75"));
		expect(run.followUps()).toHaveLength(2);
	});

	it("does not nudge after a threshold retry leaves an item unmeasured", async () => {
		const run = await toCheck(both);
		await run.fire(
			"agent_settled",
			settled("REQ 1: FAIL - stone 74 >= 75\nREQ 2: PASS - size 90MB < 150MB; acc 0.7 >= 0.62"),
		);
		expect(run.events.at(-1)?.data.extraTurn).toBe("threshold");
		await run.fire("agent_settled", settled("REQ 1: PASS - stone 76 >= 75"));
		expect(run.followUps()).toHaveLength(2);
	});

	it("gives a new user task its own allowance", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MISSED));
		await run.fire("agent_settled", settled(MISSED));
		expect(run.followUps()).toHaveLength(2);
		await run.startTask(COREWARS);
		await run.fire("agent_settled", settled(MISSED));
		expect(run.followUps()).toHaveLength(4);
	});

	it("ends after an aborted extra turn and does not restart it on resume", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MISSED));
		await run.fire("agent_settled", settled("", "aborted"));
		expect(run.entries[1].data).toMatchObject({ round: 2, items: [{ status: "unreported" }] });
		// Our own follow-ups (and other extension input) arrive as extension input and keep the used allowance.
		await run.fire("input", { type: "input", text: "continue", source: "extension" });
		await run.fire("tool_execution_end", { toolName: "write" });
		await run.fire("agent_settled", settled(MISSED));
		expect(run.followUps()).toHaveLength(2);
	});

	it("allows at most one extra turn", () => {
		expect(FINISH_CHECK_MAX_EXTRA_TURNS).toBe(1);
		const input = {
			extraTurnsUsed: 1,
			failing: 1,
			unmeasured: 1,
			aborted: false,
			hasPendingMessages: false,
			elapsedFraction: 0.1,
		};
		expect(decideExtraTurn(input)).toBeUndefined();
		expect(decideExtraTurn({ ...input, extraTurnsUsed: 0 })).toBe("both");
		expect(decideExtraTurn({ ...input, extraTurnsUsed: 0, elapsedFraction: undefined })).toBe("both");
	});
});

describe("finish-check extra turn: gates and scope", () => {
	it("keeps the 85% cutoff between the save-now and skip thresholds", () => {
		expect(FINISH_CHECK_SAVE_NOW_FRACTION).toBeLessThan(FINISH_CHECK_EXTRA_TURN_FRACTION);
		expect(FINISH_CHECK_EXTRA_TURN_FRACTION).toBeLessThan(FINISH_CHECK_SKIP_FRACTION);
	});

	it("does not extend a run past the cutoff (3080 s of 3600 s = 85.6%)", async () => {
		const lateMs = 3_080_000;
		expect(lateMs / (BUDGET_SEC * 1000)).toBeGreaterThanOrEqual(FINISH_CHECK_EXTRA_TURN_FRACTION);
		for (const reply of [MISSED, "Looks good."]) {
			const run = await toCheck(COREWARS, lateMs);
			await run.fire("agent_settled", settled(reply));
			expect(run.followUps()).toHaveLength(1);
			expect(run.entries).toHaveLength(1);
			expect(run.events.at(-1)?.data.extraTurn).toBeUndefined();
		}
	});

	it("does not extend an aborted check or one the user interrupted", async () => {
		const aborted = await toCheck(COREWARS);
		await aborted.fire("agent_settled", settled(MISSED, "aborted"));
		expect(aborted.followUps()).toHaveLength(1);
		const interrupted = await toCheck(COREWARS);
		await interrupted.fire("agent_settled", settled(MISSED), { ...ctx, hasPendingMessages: () => true });
		expect(interrupted.followUps()).toHaveLength(1);
	});

	it("tells the extra turn once to save and stop at 90% of the budget", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MISSED));
		const stops = () => run.sent.filter((message) => message.text === FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE);
		run.setClock(3_200_000); // 88.9%
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(stops()).toHaveLength(0);
		run.setClock(3_240_000); // 90%
		await run.fire("tool_execution_end", { toolName: "bash" });
		await run.fire("message_end", { message: { role: "assistant" } });
		run.setClock(3_400_000);
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(stops()).toEqual([{ text: FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE, deliverAs: "steer" }]);
	});

	it("sends no stop steer outside the extra turn", async () => {
		const run = await toCheck(COREWARS);
		await run.fire("agent_settled", settled(MET));
		run.setClock(3_500_000);
		await run.fire("tool_execution_end", { toolName: "bash" });
		await run.fire("message_end", { message: { role: "assistant" } });
		expect(run.sent.some((message) => message.text === FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE)).toBe(false);
	});

	it("leaves path-only tasks unchanged", async () => {
		for (const reply of ["REQ 1: FAIL - /app/out.csv missing", "Done."]) {
			const run = await toCheck("Save the result to /app/out.csv.");
			await run.fire("agent_settled", settled(reply));
			expect(run.followUps()).toHaveLength(1);
		}
	});
});
