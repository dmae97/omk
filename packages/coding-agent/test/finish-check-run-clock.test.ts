import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import finishCheck from "../src/core/extensions/builtin/finish-check.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { FINISH_CHECK_SAVE_NOW_MESSAGE } from "../src/core/finish-check.ts";
import { bindActiveRemainingBudget, RemainingBudget, readRunBudget } from "../src/core/remaining-budget.ts";

// spec 036: finish-check's 0.75 / 0.85 / 0.90 checks read the shared run clock, whose origin is run start.
const BUDGET_SEC = 100;
const COREWARS =
	"Your warrior must achieve at least a 75% win rate (75+ wins out of 100 battles) against `stone.red`, `vampire.red`, and `paper.red`.";
const MISSED = "REQ 1: PASS - stone 74 >= 75; paper 78 >= 75; vampire 82 >= 75";

type Handler = (event: unknown, ctx: unknown) => unknown;
const ctx = { hasUI: false, hasPendingMessages: () => false };
const settled = (text: string) => ({
	messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text }] }],
});

let clock = 0;
const dirs: string[] = [];

afterEach(() => {
	bindActiveRemainingBudget(undefined);
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** Binds the shared clock at t=0, then loads finish-check at `loadAtMs`, as `runPrintMode` would. */
function loadAt(
	loadAtMs: number,
	env: NodeJS.ProcessEnv = {},
	snapshot?: { now: () => number; sleep: (ms: number) => Promise<void> },
) {
	clock = 0;
	bindActiveRemainingBudget(new RemainingBudget({ budgetMs: BUDGET_SEC * 1000, now: () => clock, startedAt: 0 }));
	clock = loadAtMs;
	const handlers = new Map<string, Handler[]>();
	const sent: { text: string; deliverAs?: string }[] = [];
	const events: Record<string, unknown>[] = [];
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, options?: { deliverAs?: string }) =>
			sent.push({ text, deliverAs: options?.deliverAs }),
		appendEntry: () => {},
		events: { emit: (_channel: string, data: Record<string, unknown>) => events.push(data), on: () => () => {} },
	} as unknown as ExtensionAPI;
	// Unless a case measures a snapshot wait, the extension's own clock never moves,
	// so only the shared clock can trigger a threshold.
	finishCheck(omk, {
		env: { OMK_TIME_BUDGET_SEC: String(BUDGET_SEC), ...env },
		now: snapshot?.now ?? (() => 0),
		sleep: snapshot?.sleep,
	});
	const fire = async (name: string, event: unknown) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	const followUps = () => sent.filter((message) => message.deliverAs === "followUp");
	return { fire, sent, events, followUps };
}

describe("finish-check on the shared run clock (spec 036)", () => {
	it("counts from run start, not from extension load: loaded at 60 s of 100 s reads 0.6", async () => {
		const run = loadAt(60_000);
		await run.fire("input", { text: "task", source: "interactive" });
		clock = 70_000;
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.sent).toHaveLength(0);
		clock = 76_000;
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.sent).toEqual([{ text: FINISH_CHECK_SAVE_NOW_MESSAGE, deliverAs: "steer" }]);
	});

	it("skips the verification turn past 90% of the shared clock", async () => {
		const run = loadAt(60_000);
		await run.fire("input", { text: "task", source: "interactive" });
		await run.fire("tool_execution_end", { toolName: "write" });
		clock = 91_000;
		await run.fire("agent_settled", settled("done"));
		expect(run.followUps()).toHaveLength(0);
	});

	it("refuses the spec 035 extra turn past 85% of the shared clock", async () => {
		const run = loadAt(70_000, { OMK_FINISH_CHECK_EXTRA_TURN: "on" });
		await run.fire("input", { text: COREWARS, source: "interactive" });
		await run.fire("tool_execution_end", { toolName: "write" });
		clock = 72_000;
		await run.fire("agent_settled", settled("done"));
		expect(run.followUps()).toHaveLength(1);
		clock = 86_000;
		await run.fire("agent_settled", settled(MISSED));
		expect(run.followUps()).toHaveLength(1);
		expect(run.events.at(-1)).not.toHaveProperty("extraTurn");
	});

	it("takes the harness snapshot wait out of the shared clock", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-finish-clock-"));
		dirs.push(dir);
		const sleep = async (ms: number) => {
			clock += ms;
			if (clock >= 90_000) writeFileSync(join(dir, "pre-check-1.done"), "");
		};
		const run = loadAt(0, { OMK_FINISH_CHECK_SNAPSHOT_DIR: dir }, { now: () => clock, sleep });
		await run.fire("input", { text: "task", source: "interactive" });
		await run.fire("tool_execution_end", { toolName: "write" });
		clock = 40_000;
		await run.fire("agent_settled", settled("done"));
		expect(run.followUps()).toHaveLength(1);
		expect(clock).toBeGreaterThanOrEqual(90_000);
		expect(readRunBudget()?.elapsedFraction).toBeCloseTo(0.4, 2);
	});
});
