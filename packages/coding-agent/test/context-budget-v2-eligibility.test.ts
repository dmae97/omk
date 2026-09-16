import { describe, expect, it } from "vitest";
import type { ContextBudgetItemV2 } from "../src/core/context-budget-headroom.ts";
import { makeContextBudgetItem, planContextBudgetWith } from "./context-budget-test-helpers.ts";

/**
 * T-CTX-E01 (audit §11.2): the density denominator must only price
 * representations the chooser can actually pick. An ineligible 1-token
 * pointer (non-retrievable source) must not rank an 80-token item ahead of
 * two genuinely denser 40-token items.
 */

function itemWithCandidates(
	id: string,
	text: string,
	tokenEstimate: number,
	extra: Partial<ContextBudgetItemV2>,
	candidates: ContextBudgetItemV2["representations"],
): ContextBudgetItemV2 {
	return makeContextBudgetItem({
		id,
		tier: "current-files",
		text,
		tokenEstimate,
		representations: candidates,
		...extra,
	});
}

describe("context-budget representation eligibility (T-CTX-E01)", () => {
	it("an ineligible pointer does not inflate an item's admission rank", () => {
		const budget = 80;
		// A: full cost 80, plus a 1-token pointer that is ineligible — the
		// sourceRef is not retrievable, so the chooser can never pick it.
		const itemA = itemWithCandidates(
			"A",
			"a".repeat(400),
			80,
			{ priority: "high", sourceRef: { uri: "file:///a", contentHash: "h-a", retrievable: false } },
			[
				{ kind: "full", text: "a".repeat(400), estimatedTokens: 80, fidelity: "exact" },
				{
					kind: "pointer",
					text: "see file",
					estimatedTokens: 1,
					fidelity: "lossy",
					sourceRef: { uri: "file:///a", contentHash: "h-a", retrievable: false },
				},
				{ kind: "omit", text: "", estimatedTokens: 0, fidelity: "lossy" },
			],
		);
		const itemB = itemWithCandidates("B", "b".repeat(200), 40, { priority: "high" }, [
			{ kind: "full", text: "b".repeat(200), estimatedTokens: 40, fidelity: "exact" },
			{ kind: "omit", text: "", estimatedTokens: 0, fidelity: "lossy" },
		]);
		const itemC = itemWithCandidates("C", "c".repeat(200), 40, { priority: "high" }, [
			{ kind: "full", text: "c".repeat(200), estimatedTokens: 40, fidelity: "exact" },
			{ kind: "omit", text: "", estimatedTokens: 0, fidelity: "lossy" },
		]);

		const fullTierPolicy = Object.fromEntries(
			["system", "active-goal", "current-files", "tools", "skills", "mcp", "history", "evidence", "scratch"].map(
				(tier) => [tier, { floorPct: 0, ceilingPct: 1 }],
			),
		);
		const plan = planContextBudgetWith([itemA, itemB, itemC], {
			maxTokens: budget,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: fullTierPolicy,
		});

		// Eligibility-aware ranking admits B and C (utility 100+99); ranking by
		// the ineligible pointer cost would admit A alone (utility ~115) instead.
		expect([...plan.includedItemIds].sort()).toEqual(["B", "C"]);
	});

	it("an eligible retrievable pointer still prices the item cheaply", () => {
		const budget = 10;
		const item = itemWithCandidates(
			"A",
			"a".repeat(400),
			80,
			{ priority: "high", sourceRef: { uri: "file:///a", contentHash: "h-a", retrievable: true } },
			[
				{ kind: "full", text: "a".repeat(400), estimatedTokens: 80, fidelity: "exact" },
				{
					kind: "pointer",
					text: "see file",
					estimatedTokens: 1,
					fidelity: "reversible",
					sourceRef: { uri: "file:///a", contentHash: "h-a", retrievable: true },
				},
				{ kind: "omit", text: "", estimatedTokens: 0, fidelity: "lossy" },
			],
		);
		const plan = planContextBudgetWith([item], {
			maxTokens: budget,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
		});
		expect(plan.includedItemIds).toEqual(["A"]);
		expect(plan.selectedRepresentations[0]?.kind).toBe("pointer");
	});
});
