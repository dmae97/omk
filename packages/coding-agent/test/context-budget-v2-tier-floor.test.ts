import { describe, expect, it } from "vitest";
import type { ContextBudgetItemV2 } from "../src/core/context-budget-headroom.ts";
import { makeContextBudgetItem, planContextBudgetWith } from "./context-budget-test-helpers.ts";

/**
 * T-CTX-F01..F04 (audit §11): a tier's floor is a real reservation, not a
 * lower bound on its ceiling. The floor-reservation pass spends each tier's
 * guaranteed claim on its own items before leftovers compete globally under
 * tier ceilings.
 */

function fullOnly(text: string, tokens: number): ContextBudgetItemV2["representations"] {
	return [
		{ estimatedTokens: tokens, fidelity: "exact", kind: "full", text },
		{ estimatedTokens: 0, fidelity: "lossy", kind: "omit", text: "" },
	];
}

function selectedIds(plan: ReturnType<typeof planContextBudgetWith>): string[] {
	return plan.selectedRepresentations
		.filter((representation) => representation.kind !== "omit")
		.map((representation) => representation.itemId);
}

describe("tier floor is a reservation (audit G-C01)", () => {
	it("a higher-density item in another tier cannot starve a tier's guaranteed floor", () => {
		// available = 100. A-tier ceiling 100%: its 100-token item would consume
		// the whole budget first under the old ceiling-only semantics, leaving
		// nothing for B-tier's floor of 30.
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({
				evidenceValue: 1,
				id: "a-bulky",
				priority: "high",
				relevance: 1,
				representations: fullOnly("a-bulky", 100),
				text: "a-bulky",
				tier: "current-files",
				tokenEstimate: 100,
			}),
			makeContextBudgetItem({
				id: "b-floor",
				priority: "medium",
				representations: fullOnly("b-floor", 30),
				text: "b-floor",
				tier: "evidence",
				tokenEstimate: 30,
			}),
			makeContextBudgetItem({
				id: "b-extra",
				priority: "medium",
				representations: fullOnly("b-extra", 30),
				text: "b-extra",
				tier: "evidence",
				tokenEstimate: 30,
			}),
		];

		const plan = planContextBudgetWith(items, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: {
				"current-files": { ceilingPct: 1, floorPct: 0 },
				evidence: { ceilingPct: 0.5, floorPct: 0.3 },
			},
		});

		const selected = selectedIds(plan);
		// The floor pass admits one 30-token evidence item before a-bulky
		// competes; a-bulky (100) no longer fits, and the second evidence item
		// would exceed evidence's 50 ceiling. Which of the two identical
		// candidates fills the floor is a tiebreak detail, not the contract.
		expect(selected.length).toBe(1);
		expect(selected[0]).toMatch(/^b-/);
		expect(plan.omittedItemIds).toContain("a-bulky");
	});

	it("lets a tier spend past its floor up to its ceiling against leftover budget", () => {
		// evidence: floor 20, ceiling 60 — after the floor covers one item, the
		// rest compete globally against remaining budget.
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({
				id: "b-1",
				priority: "high",
				representations: fullOnly("b-1", 20),
				text: "b-1",
				tier: "evidence",
				tokenEstimate: 20,
			}),
			makeContextBudgetItem({
				id: "b-2",
				priority: "medium",
				representations: fullOnly("b-2", 20),
				text: "b-2",
				tier: "evidence",
				tokenEstimate: 20,
			}),
			makeContextBudgetItem({
				id: "b-3",
				priority: "medium",
				representations: fullOnly("b-3", 20),
				text: "b-3",
				tier: "evidence",
				tokenEstimate: 20,
			}),
		];

		const plan = planContextBudgetWith(items, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: {
				evidence: { ceilingPct: 0.6, floorPct: 0.2 },
			},
		});

		expect(selectedIds(plan).sort()).toEqual(["b-1", "b-2", "b-3"]);
		expect(plan.usedTokens).toBe(60);
	});

	it("reports when the summed floors cannot fit the budget instead of pretending a guarantee", () => {
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({
				id: "a-1",
				priority: "medium",
				representations: fullOnly("a-1", 10),
				text: "a-1",
				tier: "current-files",
				tokenEstimate: 10,
			}),
		];

		const plan = planContextBudgetWith(items, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: {
				"current-files": { ceilingPct: 1, floorPct: 0.9 },
				evidence: { ceilingPct: 0.6, floorPct: 0.5 },
			},
		});

		// Floors sum to 90 + 50 = 140 > 100: the plan must say so rather than
		// silently degrade to unordered behavior.
		expect(plan.diagnostics.some((diagnostic) => diagnostic.reason === "tier_floor_over_budget")).toBe(true);
	});

	it("leaves items for the global pass when they cannot fit inside the remaining floor", () => {
		// evidence floor 30: a 40-token item cannot fit inside it but fits under
		// the 60 ceiling; it must not be omitted during the floor pass.
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({
				id: "b-wide",
				priority: "high",
				representations: fullOnly("b-wide", 40),
				text: "b-wide",
				tier: "evidence",
				tokenEstimate: 40,
			}),
			makeContextBudgetItem({
				id: "b-small",
				priority: "medium",
				representations: fullOnly("b-small", 20),
				text: "b-small",
				tier: "evidence",
				tokenEstimate: 20,
			}),
		];

		const plan = planContextBudgetWith(items, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: {
				evidence: { ceilingPct: 0.6, floorPct: 0.3 },
			},
		});

		// b-wide skips the floor (40 > 30), b-small fills it (20), then b-wide
		// is admitted globally (40 ≤ ceiling 60, 60 ≤ budget 100).
		expect(selectedIds(plan).sort()).toEqual(["b-small", "b-wide"]);
		expect(plan.omittedItemIds).not.toContain("b-wide");
	});
});

describe("planner input boundary (audit §13)", () => {
	it("drops a duplicate item id instead of double-counting and overwriting the selection", () => {
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({ id: "dup", text: "first", tier: "evidence", tokenEstimate: 10 }),
			makeContextBudgetItem({ id: "dup", text: "second", tier: "evidence", tokenEstimate: 10 }),
		];
		const plan = planContextBudgetWith(items, { maxTokens: 100, responseReserveTokens: 0, safetyMarginTokens: 0 });
		expect(plan.selectedRepresentations.length).toBe(1);
		expect(plan.usedTokens).toBe(10);
		expect(plan.diagnostics.some((diagnostic) => diagnostic.reason === "invalid_input")).toBe(true);
	});

	it("drops an item with an unregistered tier rather than corrupting tier accounting", () => {
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({ id: "ghost", text: "ghost", tier: "bogus" as never, tokenEstimate: 10 }),
		];
		const plan = planContextBudgetWith(items, { maxTokens: 100, responseReserveTokens: 0, safetyMarginTokens: 0 });
		expect(plan.selectedRepresentations.length).toBe(0);
		expect(plan.diagnostics.some((diagnostic) => diagnostic.reason === "invalid_input")).toBe(true);
	});

	it("recomputes a non-finite tokenEstimate from text instead of poisoning budget sums", () => {
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({ id: "nan", text: "some text here", tier: "evidence", tokenEstimate: Number.NaN }),
		];
		const plan = planContextBudgetWith(items, { maxTokens: 100, responseReserveTokens: 0, safetyMarginTokens: 0 });
		expect(plan.diagnostics.some((diagnostic) => diagnostic.reason === "invalid_input")).toBe(true);
		expect(plan.selectedRepresentations.length).toBe(1);
		expect(Number.isFinite(plan.usedTokens)).toBe(true);
		expect(plan.usedTokens).toBeGreaterThan(0);
	});

	it("drops a representation whose cost is negative while keeping the item's valid representations", () => {
		const items: ContextBudgetItemV2[] = [
			makeContextBudgetItem({
				id: "neg-rep",
				representations: [
					{ estimatedTokens: -5, fidelity: "exact", kind: "full", text: "neg" },
					{ estimatedTokens: 10, fidelity: "exact", kind: "full", text: "ok" },
					{ estimatedTokens: 0, fidelity: "lossy", kind: "omit", text: "" },
				],
				text: "neg-rep",
				tier: "evidence",
				tokenEstimate: 10,
			}),
		];
		const plan = planContextBudgetWith(items, { maxTokens: 100, responseReserveTokens: 0, safetyMarginTokens: 0 });
		expect(plan.diagnostics.some((diagnostic) => diagnostic.reason === "invalid_input")).toBe(true);
		expect(plan.selectedRepresentations.length).toBe(1);
		expect(plan.selectedRepresentations[0]?.estimatedTokens).toBe(10);
	});
});
