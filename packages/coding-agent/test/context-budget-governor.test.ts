import { describe, expect, it } from "vitest";
import { planContextBudget, scoreContextBudgetItem } from "../src/core/context-budget-governor.ts";

describe("context budget governor", () => {
	it("keeps hard pins, scores optional items, and omits low-priority overflow", () => {
		const plan = planContextBudget({
			maxTokens: 22,
			items: [
				{ id: "tools", kind: "system", priority: "hard", text: "tools", tokenEstimate: 4 },
				{ id: "active-skill", kind: "skill", priority: "high", text: "active", tokenEstimate: 8, relevance: 1 },
				{ id: "old-log", kind: "tool-result", priority: "low", text: "log", tokenEstimate: 20, relevance: 0.1 },
			],
		});

		expect(plan.includedItems.map((item) => item.id)).toEqual(["tools", "active-skill"]);
		expect(plan.omittedItems.map((item) => item.id)).toEqual(["old-log"]);
		expect(plan.usedTokens).toBe(12);
		expect(plan.emergency).toBe(false);
		expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/u);
	});

	it("is deterministic and reports hard-pin over-capacity as emergency", () => {
		const input = {
			maxTokens: 5,
			items: [
				{
					id: "parent",
					kind: "context-pointer" as const,
					priority: "hard" as const,
					text: "parent",
					tokenEstimate: 9,
				},
			],
		};

		const first = planContextBudget(input);
		const second = planContextBudget(input);
		expect(first).toEqual(second);
		expect(first.emergency).toBe(true);
		expect(first.diagnostics).toContainEqual(expect.objectContaining({ reason: "hard_pin_over_capacity" }));
	});

	it("rewards relevance and penalizes token cost", () => {
		const focused = scoreContextBudgetItem(
			{ id: "a", kind: "skill", priority: "medium", text: "a", relevance: 1, evidenceValue: 1 },
			10,
		);
		const noisy = scoreContextBudgetItem(
			{ id: "b", kind: "skill", priority: "medium", text: "b", relevance: 0, evidenceValue: 0 },
			1000,
		);
		expect(focused).toBeGreaterThan(noisy);
	});
});
