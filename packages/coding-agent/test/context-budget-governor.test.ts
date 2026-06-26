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

	it("keeps malformed budget inputs finite, diagnostic, and observable", () => {
		const plan = planContextBudget({
			maxTokens: Number.NaN,
			responseReserveTokens: Number.POSITIVE_INFINITY,
			items: [
				{ id: "hard", kind: "system", priority: "hard", text: "hard", tokenEstimate: 4 },
				{ id: "optional", kind: "history", priority: "high", text: "optional", tokenEstimate: 2 },
			],
		});

		expect(plan.emergency).toBe(true);
		expect(plan.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reason: "invalid_budget", detail: expect.stringContaining("maxTokens") }),
				expect.objectContaining({
					reason: "invalid_budget",
					detail: expect.stringContaining("responseReserveTokens"),
				}),
			]),
		);
		expect(plan.observability.diagnosticReasons).toEqual([
			"hard_pin_over_capacity",
			"invalid_budget",
			"item_omitted",
		]);
		for (const value of [
			plan.maxTokens,
			plan.responseReserveTokens,
			plan.availableTokens,
			plan.usedTokens,
			plan.omittedTokens,
			plan.observability.tokens.available,
			plan.observability.tokens.used,
			plan.observability.tokens.omitted,
			plan.observability.tokens.tokenSavings,
		]) {
			expect(Number.isFinite(value)).toBe(true);
		}
	});

	it("sanitizes malformed item token estimates before scoring and hashing", () => {
		const input = {
			maxTokens: 10,
			items: [
				{
					id: "bad-estimate",
					kind: "tool-result" as const,
					priority: "high" as const,
					text: "SECRET_RAW_ITEM_TEXT",
					tokenEstimate: Number.POSITIVE_INFINITY,
				},
				{
					id: "negative-estimate",
					kind: "history" as const,
					priority: "medium" as const,
					text: "negative",
					tokenEstimate: -4,
				},
			],
		};

		const first = planContextBudget(input);
		const second = planContextBudget(input);

		expect(first).toEqual(second);
		expect(first.includedItems.map((item) => item.estimatedTokens)).toEqual([0, 0]);
		expect(first.diagnostics).toContainEqual(
			expect.objectContaining({
				itemId: "bad-estimate",
				reason: "invalid_budget",
				detail: expect.stringContaining("tokenEstimate"),
			}),
		);
		expect(first.planHash).toMatch(/^[a-f0-9]{64}$/u);
		expect(JSON.stringify(first.observability)).not.toContain("SECRET_RAW_ITEM_TEXT");
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

	it("selects the highest value optional combination instead of the highest single item", () => {
		const plan = planContextBudget({
			maxTokens: 10,
			items: [
				{
					id: "large-single",
					kind: "tool-result",
					priority: "medium",
					text: "large",
					tokenEstimate: 10,
					relevance: 1,
					recency: 1,
					evidenceValue: 1,
				},
				{
					id: "small-a",
					kind: "tool-result",
					priority: "medium",
					text: "small-a",
					tokenEstimate: 5,
					relevance: 0.5,
					recency: 1,
					evidenceValue: 1,
				},
				{
					id: "small-b",
					kind: "tool-result",
					priority: "medium",
					text: "small-b",
					tokenEstimate: 5,
					relevance: 0.5,
					recency: 1,
					evidenceValue: 1,
				},
			],
		});

		expect(plan.includedItems.map((item) => item.id)).toEqual(["small-a", "small-b"]);
		expect(plan.usedTokens).toBe(10);
	});

	it("applies redundancy penalties during optional selection", () => {
		const plan = planContextBudget({
			maxTokens: 8,
			items: [
				{
					id: "primary-copy",
					kind: "tool-result",
					priority: "medium",
					text: "primary",
					tokenEstimate: 4,
					relevance: 1,
					recency: 1,
					evidenceValue: 1,
					redundancyKey: "same-source",
				},
				{
					id: "duplicate-copy",
					kind: "tool-result",
					priority: "medium",
					text: "duplicate",
					tokenEstimate: 4,
					relevance: 0.95,
					recency: 1,
					evidenceValue: 1,
					redundancyKey: "same-source",
				},
				{
					id: "different-source",
					kind: "tool-result",
					priority: "medium",
					text: "different",
					tokenEstimate: 4,
					relevance: 0.5,
					recency: 1,
					evidenceValue: 1,
					redundancyKey: "different-source",
				},
			],
		});

		expect(plan.includedItems.map((item) => item.id)).toEqual(["primary-copy", "different-source"]);
		expect(plan.omittedItems.map((item) => item.id)).toEqual(["duplicate-copy"]);
	});
});
