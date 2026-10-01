import { describe, expect, it } from "vitest";
import { applyDurableGoalCommand, createDurableGoal, nextDurableGoalTimestamp } from "../src/index.ts";

const T0 = "2026-08-19T00:00:00.000Z";
const T1 = "2026-08-19T00:01:00.000Z";

describe("SDK durable goal timestamps after a wall-clock step back", () => {
	const created = () => createDurableGoal({ id: "goal-1", objective: "Ship the verifier", maxRounds: 3, now: T1 });
	const behind = Date.parse(T0);

	it("rejects the raw wall clock but accepts the exported transition time", () => {
		const goal = created();
		const pause = { kind: "pause", ref: goal.ref } as const;

		expect(() => applyDurableGoalCommand(goal, pause, new Date(behind).toISOString())).toThrow(
			/goal timestamps must be monotonic/,
		);
		const paused = applyDurableGoalCommand(goal, pause, nextDurableGoalTimestamp(goal, undefined, behind));

		expect(paused.status).toBe("paused");
		expect(Date.parse(paused.updatedAt)).toBeGreaterThanOrEqual(Date.parse(T1));
	});

	it("advances a goal generation even when the clock has not moved past its start", () => {
		const goal = created();
		const edit = { kind: "edit", ref: goal.ref, objective: "Ship the verifier and its docs" } as const;

		expect(() => applyDurableGoalCommand(goal, edit, T1)).toThrow(/goal generation timestamp must advance/);
		const edited = applyDurableGoalCommand(goal, edit, nextDurableGoalTimestamp(goal, undefined, behind));

		expect(edited.objective).toBe("Ship the verifier and its docs");
		expect(Date.parse(edited.generationStartedAt)).toBeGreaterThan(Date.parse(T1));
	});
});
