import { afterEach, describe, expect, it, vi } from "vitest";
import { decideGoalContinuation, type GoalAutonomyInput } from "../src/core/goal-continuation.ts";

const base = { status: "active" as const, completedRounds: 1, maxRounds: 3, hasQueuedMessages: false };
const ok: GoalAutonomyInput = { spentUsd: 0, lastSideEffect: "ok", scopeChanged: false, nowMs: 0 };

afterEach(() => vi.unstubAllEnvs());

describe("decideGoalContinuation (spec 119)", () => {
	it.each(["unset", "", "1", "true", "yes"])("default on: OMK_GOAL_AUTONOMY=%s applies autonomy stops", (value) => {
		if (value !== "unset") vi.stubEnv("OMK_GOAL_AUTONOMY", value);
		else vi.stubEnv("OMK_GOAL_AUTONOMY", undefined as unknown as string);
		const stops: GoalAutonomyInput = {
			budget: { maxCostUsd: 0.01, deadlineIso: "2000-01-01T00:00:00.000Z" },
			spentUsd: undefined,
			lastSideEffect: "unknown",
			scopeChanged: true,
			nowMs: Date.now(),
		};
		expect(decideGoalContinuation({ ...base, autonomy: stops })).not.toEqual(decideGoalContinuation(base));
	});

	it.each(["0", "false", "off", "OFF", " 0 "])("G0: OMK_GOAL_AUTONOMY=%s ignores autonomy fields", (value) => {
		vi.stubEnv("OMK_GOAL_AUTONOMY", value);
		const stops: GoalAutonomyInput = {
			budget: { maxCostUsd: 0.01, deadlineIso: "2000-01-01T00:00:00.000Z" },
			spentUsd: undefined,
			lastSideEffect: "unknown",
			scopeChanged: true,
			nowMs: Date.now(),
		};
		expect(decideGoalContinuation({ ...base, autonomy: stops })).toEqual(decideGoalContinuation(base));
		expect(decideGoalContinuation({ ...base, maxRounds: 20, completedRounds: 10, autonomy: stops })).toEqual({
			continue: true,
			reason: "active-goal",
		});
	});

	describe("flag on", () => {
		const on = () => vi.stubEnv("OMK_GOAL_AUTONOMY", "1");

		it("AU4: outcome-unknown, scope-changed, budget-limit, deadline, round-limit", () => {
			on();
			const d = (autonomy: Partial<GoalAutonomyInput>, rounds = 1) =>
				decideGoalContinuation({ ...base, completedRounds: rounds, autonomy: { ...ok, ...autonomy } }).reason;
			expect(d({})).toBe("active-goal");
			expect(d({ lastSideEffect: "unknown" })).toBe("outcome-unknown");
			expect(d({ scopeChanged: true })).toBe("scope-changed");
			expect(d({ budget: { maxCostUsd: 1 }, spentUsd: 1 })).toBe("budget-limit");
			expect(d({ budget: { maxCostUsd: 1 }, spentUsd: 0.99 })).toBe("active-goal");
			expect(d({ budget: { deadlineIso: new Date(1000).toISOString() }, nowMs: 1000 })).toBe("deadline");
			expect(d({}, 3)).toBe("round-limit");
		});

		it("AU4: unknown cost or undeterminable remaining budget is budget-limit, never 0", () => {
			on();
			const d = (autonomy: Partial<GoalAutonomyInput>) =>
				decideGoalContinuation({ ...base, autonomy: { ...ok, ...autonomy } }).reason;
			expect(d({ budget: { maxCostUsd: 5 }, spentUsd: undefined })).toBe("budget-limit");
			expect(d({ budget: { maxCostUsd: 5 }, spentUsd: Number.NaN })).toBe("budget-limit");
			expect(d({ budget: { maxCostUsd: Number.NaN }, spentUsd: 0 })).toBe("budget-limit");
			expect(d({ budget: { deadlineIso: "not a date" } })).toBe("deadline");
		});

		it("G5: maxRounds above 8 is capped", () => {
			on();
			expect(decideGoalContinuation({ ...base, maxRounds: 50, completedRounds: 8, autonomy: ok }).reason).toBe(
				"round-limit",
			);
		});

		it("queued and not-active keep main order", () => {
			on();
			expect(
				decideGoalContinuation({ ...base, hasQueuedMessages: true, autonomy: { ...ok, lastSideEffect: "unknown" } })
					.reason,
			).toBe("queued");
			expect(decideGoalContinuation({ ...base, status: "paused", autonomy: ok }).reason).toBe("not-active");
		});
	});
});
