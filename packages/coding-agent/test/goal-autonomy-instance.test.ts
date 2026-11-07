import { recordToolTerminalCause } from "omk-agent-core";
import { describe, expect, it, vi } from "vitest";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import type { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import { GoalAutonomy } from "../src/core/extensions/builtin/goal-autonomy.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";

const goal = (now: string) => createDurableGoal({ id: "session", objective: now, maxRounds: 8, now });
const autonomy = () => new GoalAutonomy({ appendEntry: () => {} }, new GoalAcceptance());

describe("goal autonomy instance safety", () => {
	it("latches an unknown side effect across a later clean observation", () => {
		const current = goal("2026-10-01T00:00:00.000Z");
		const owner = autonomy();
		recordToolTerminalCause("queued-unknown", "timeout");
		owner.observe(current, [{ role: "toolResult", toolCallId: "queued-unknown", toolName: "bash" }], 0, "one");
		expect(owner.observe(current, [], 0, "two").lastSideEffect).toBe("unknown");
		owner.resumed(current);
		expect(owner.observe(current, [], 0, "three").lastSideEffect).toBe("ok");
	});

	it("does not apply an old instance stop to a replacement with the same store id", async () => {
		const old = goal("2026-10-01T00:00:00.000Z");
		const replacement = goal("2026-10-02T00:00:00.000Z");
		const transition = vi.fn();
		const store = { current: async () => replacement, transition } as unknown as DurableGoalStore;
		await autonomy().stop(store, old, "outcome-unknown", { ui: { notify: () => {} } } as never);
		expect(transition).not.toHaveBeenCalled();
	});
});
