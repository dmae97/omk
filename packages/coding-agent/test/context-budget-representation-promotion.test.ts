import { describe, expect, it } from "vitest";
import type { ContextBudgetItemV2, ContextRepresentationCandidateV2 } from "../src/core/context-budget-headroom.ts";
import { makeContextBudgetItem, planContextBudgetWith } from "./context-budget-test-helpers.ts";

/**
 * Representation promotion (audit F03, 2026-09-19).
 *
 * The floor pass admits an item at whatever representation fits the tier's
 * remaining floor; the global pass then skips every already-selected item by
 * id. A pointer chosen under a 20-token floor therefore stayed a pointer
 * while 90 of 100 tokens went unused. After the global pass the planner now
 * re-offers each selected optional item its costlier representations against
 * the real leftover, and takes one only when the selection policy itself
 * prefers it and it fits both the tier ceiling and the global remainder.
 * Promotion never demotes, never touches hard items, and never exceeds a cap.
 */

function candidates(full: number, pointer?: number): ContextRepresentationCandidateV2[] {
	const list: ContextRepresentationCandidateV2[] = [
		{ kind: "full", text: "f".repeat(full * 4), estimatedTokens: full, fidelity: "exact" },
	];
	if (pointer !== undefined) {
		list.push({
			kind: "pointer",
			text: `<pointer uri="file:///p" hash="h" />`,
			estimatedTokens: pointer,
			fidelity: "bounded",
			sourceRef: { uri: "file:///p", contentHash: "h", retrievable: true },
		});
	}
	list.push({ kind: "omit", text: "", estimatedTokens: 0, fidelity: "lossy" });
	return list;
}

function chosen(plan: ReturnType<typeof planContextBudgetWith>, id: string) {
	return plan.selectedRepresentations.find((representation) => representation.itemId === id);
}

describe("representation promotion after the global pass", () => {
	it("promotes a floor-pass pointer to full text when the leftover budget allows it (audit counterexample)", () => {
		// available 100; current-files floor 20, ceiling 100; one item: full 100, pointer 10.
		const item: ContextBudgetItemV2 = makeContextBudgetItem({
			id: "only",
			tier: "current-files",
			priority: "high",
			text: "f".repeat(400),
			tokenEstimate: 100,
			sourceRef: { uri: "file:///p", contentHash: "h", retrievable: true },
			representations: candidates(100, 10),
		});
		const plan = planContextBudgetWith([item], {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0.2, ceilingPct: 1 } },
		});
		expect(chosen(plan, "only")?.kind).toBe("full");
		expect(plan.usedTokens).toBe(100);
	});

	it("does not promote past the tier ceiling even when global tokens remain", () => {
		const item: ContextBudgetItemV2 = makeContextBudgetItem({
			id: "capped",
			tier: "current-files",
			priority: "high",
			text: "f".repeat(400),
			tokenEstimate: 100,
			sourceRef: { uri: "file:///p", contentHash: "h", retrievable: true },
			representations: candidates(100, 10),
		});
		const plan = planContextBudgetWith([item], {
			maxTokens: 200,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0.1, ceilingPct: 0.4 } },
		});
		expect(chosen(plan, "capped")?.kind).toBe("pointer");
		expect(plan.usedTokens).toBe(10);
	});

	it("spends leftover on the higher-ranked item first and leaves the rest unchanged", () => {
		// available 100; floor 20 admits both pointers (10 each); leftover 80 fits
		// exactly one full text (80). The higher-scored item takes it.
		const make = (id: string, priority: ContextBudgetItemV2["priority"]): ContextBudgetItemV2 =>
			makeContextBudgetItem({
				id,
				tier: "current-files",
				priority,
				text: "f".repeat(320),
				tokenEstimate: 80,
				sourceRef: { uri: `file:///${id}`, contentHash: "h", retrievable: true },
				representations: candidates(80, 10),
			});
		const plan = planContextBudgetWith([make("low-item", "low"), make("high-item", "high")], {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0.2, ceilingPct: 1 } },
		});
		expect(chosen(plan, "high-item")?.kind).toBe("full");
		expect(chosen(plan, "low-item")?.kind).toBe("pointer");
		expect(plan.usedTokens).toBe(90);
	});

	it("never demotes an already-selected representation", () => {
		// Full text was admitted in the global pass under a loose budget; the
		// promotion pass must not swap it for a cheaper form.
		const item: ContextBudgetItemV2 = makeContextBudgetItem({
			id: "keep",
			tier: "history",
			priority: "medium",
			ageTurns: 10,
			text: "f".repeat(200),
			tokenEstimate: 50,
			sourceRef: { uri: "file:///p", contentHash: "h", retrievable: true },
			representations: candidates(50, 10),
		});
		const plan = planContextBudgetWith([item], {
			maxTokens: 1000,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { history: { floorPct: 0, ceilingPct: 1 } },
		});
		const first = chosen(plan, "keep")?.kind;
		expect(first).toBeDefined();
		const again = planContextBudgetWith([item], {
			maxTokens: 1000,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { history: { floorPct: 0, ceilingPct: 1 } },
		});
		expect(chosen(again, "keep")?.kind).toBe(first);
		expect(again.usedTokens).toBeGreaterThanOrEqual(plan.usedTokens);
	});
});
