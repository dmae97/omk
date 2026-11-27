import { describe, expect, it } from "vitest";
import { allocateDynamicReasoningBudget } from "../src/metacognition/dynamic-reasoning-budget.ts";

const LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;

describe("P2-1: allocateDynamicReasoningBudget", () => {
	it("escalates reasoning level on low metacognitive confidence or repeated failures", () => {
		const res = allocateDynamicReasoningBudget({
			baseLevel: "medium",
			availableLevels: LEVELS,
			confidence: 0.35,
			consecutiveFailures: 2,
			remainingBudgetFraction: 0.7,
			riskLevel: "medium",
			verificationStale: false,
		});
		expect(res.level).toBe("xhigh");
		expect(res.escalationDelta).toBe(2);
		expect(res.reasons).toContain("metacog.low_confidence");
		expect(res.reasons).toContain("metacog.repeated_failures");
	});

	it("never downgrades high-risk or stale-verification turns even under tight budget", () => {
		const res = allocateDynamicReasoningBudget({
			baseLevel: "medium",
			availableLevels: LEVELS,
			confidence: 0.95,
			consecutiveFailures: 0,
			remainingBudgetFraction: 0.15,
			riskLevel: "high",
			verificationStale: true,
		});
		expect(res.level).toBe("high");
		expect(res.escalationDelta).toBeGreaterThanOrEqual(0);
		expect(res.reasons).toContain("metacog.safety_floor");
	});

	it("conserves reasoning budget on high-confidence low-risk turns when remaining budget is tight", () => {
		const res = allocateDynamicReasoningBudget({
			baseLevel: "medium",
			availableLevels: LEVELS,
			confidence: 0.92,
			consecutiveFailures: 0,
			remainingBudgetFraction: 0.25,
			riskLevel: "low",
			verificationStale: false,
		});
		expect(res.level).toBe("low");
		expect(res.escalationDelta).toBe(-1);
		expect(res.reasons).toContain("metacog.budget_conserve");
	});
});
