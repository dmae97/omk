import { describe, expect, it } from "vitest";
import {
	type ContextBudgetItemV2,
	type ContextRepresentationCandidateV2,
	DEFAULT_HEADROOM_QUALITY_POLICY,
	isRepresentationEligible,
	scoreRepresentationPreferenceV2,
} from "../src/core/context-budget-headroom.ts";
import { makeContextBudgetItem, planContextBudgetWith } from "./context-budget-test-helpers.ts";

/**
 * Representation exchange (audit F04, 2026-09-19).
 *
 * Items are ranked by their cheapest admissible representation but admitted at
 * whatever the selector prefers, so a high-priority item priced at 10 for
 * ordering can consume 100 and displace two 45-token items. The audit's
 * counterexample: budget 100, A(full 100 / pointer 10, high) ranked first, then
 * B and C (full 45, medium). The planner took A at full text and omitted both
 * others; by the selector's own preference score that is 121 against 169.5 for
 * `A-pointer + B-full + C-full`, which costs exactly the same 100 tokens.
 *
 * The repair is bounded: after the global pass, a still-omitted item may pay
 * for its admission by stepping already-selected items down to their cheapest
 * admissible representation, applied all-or-nothing, never below a tier's floor
 * claim and never past a ceiling. This is not joint `(item, representation)`
 * optimization; the oracle below measures the gap that remains.
 */

const policy = DEFAULT_HEADROOM_QUALITY_POLICY;

function candidates(fullTokens: number, pointerTokens?: number): ContextRepresentationCandidateV2[] {
	const list: ContextRepresentationCandidateV2[] = [
		{ kind: "full", text: "f".repeat(fullTokens * 4), estimatedTokens: fullTokens, fidelity: "exact" },
	];
	if (pointerTokens !== undefined) {
		list.push({
			kind: "pointer",
			text: `<pointer uri="file:///p" hash="h" />`,
			estimatedTokens: pointerTokens,
			fidelity: "bounded",
			sourceRef: { uri: "file:///p", contentHash: "h", retrievable: true },
		});
	}
	list.push({ kind: "omit", text: "", estimatedTokens: 0, fidelity: "lossy" });
	return list;
}

function item(
	id: string,
	priority: ContextBudgetItemV2["priority"],
	fullTokens: number,
	pointerTokens?: number,
): ContextBudgetItemV2 {
	return makeContextBudgetItem({
		id,
		tier: "current-files",
		priority,
		text: "f".repeat(fullTokens * 4),
		tokenEstimate: fullTokens,
		...(pointerTokens === undefined ? {} : { sourceRef: { uri: "file:///p", contentHash: "h", retrievable: true } }),
		representations: candidates(fullTokens, pointerTokens),
	});
}

/** Exhaustive best sum of the selector's own preference score under both caps. */
function oracleUtility(items: readonly ContextBudgetItemV2[], budget: number, ceiling: number): number {
	const perItem = items.map((entry) =>
		(entry.representations ?? [])
			.filter((candidate) => candidate.kind === "omit" || isRepresentationEligible(candidate, entry, policy))
			.map((candidate) => ({
				cost: candidate.kind === "omit" ? 0 : candidate.estimatedTokens,
				utility: candidate.kind === "omit" ? 0 : scoreRepresentationPreferenceV2(candidate, entry, policy, false),
			})),
	);
	let best = 0;
	const walk = (index: number, cost: number, utility: number): void => {
		if (cost > budget || cost > ceiling) return;
		if (index === perItem.length) {
			best = Math.max(best, utility);
			return;
		}
		for (const choice of perItem[index]) walk(index + 1, cost + choice.cost, utility + choice.utility);
	};
	walk(0, 0, 0);
	return best;
}

function planUtility(plan: ReturnType<typeof planContextBudgetWith>, items: readonly ContextBudgetItemV2[]): number {
	let total = 0;
	for (const selected of plan.selectedRepresentations) {
		if (selected.kind === "omit") continue;
		const source = items.find((entry) => entry.id === selected.itemId);
		if (!source) continue;
		const candidate = (source.representations ?? []).find(
			(entry) => entry.kind === selected.kind && entry.estimatedTokens === selected.estimatedTokens,
		);
		if (candidate) total += scoreRepresentationPreferenceV2(candidate, source, policy, false);
	}
	return total;
}

function kindOf(plan: ReturnType<typeof planContextBudgetWith>, id: string): string | undefined {
	return plan.selectedRepresentations.find((representation) => representation.itemId === id)?.kind;
}

describe("representation exchange for breadth", () => {
	const audit = [item("a-high", "high", 100, 10), item("b-mid", "medium", 45), item("c-mid", "medium", 45)];

	it("pays for omitted items by stepping a selected item down to its cheapest form", () => {
		const plan = planContextBudgetWith(audit, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0, ceilingPct: 1 } },
		});
		expect(kindOf(plan, "a-high")).toBe("pointer");
		expect(kindOf(plan, "b-mid")).toBe("full");
		expect(kindOf(plan, "c-mid")).toBe("full");
		expect(plan.usedTokens).toBe(100);
	});

	it("reaches the brute-force optimum on the audit counterexample", () => {
		const plan = planContextBudgetWith(audit, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0, ceilingPct: 1 } },
		});
		const oracle = oracleUtility(audit, 100, 100);
		expect(oracle).toBeGreaterThan(0);
		expect(planUtility(plan, audit)).toBe(oracle);
	});

	it("reports an exchanged-in item as included and not as omitted", () => {
		const plan = planContextBudgetWith(audit, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0, ceilingPct: 1 } },
		});
		expect(plan.includedItemIds).toEqual(["a-high", "b-mid", "c-mid"]);
		expect(plan.omittedItemIds).toEqual([]);
		expect(plan.omittedTokens).toBe(0);
		expect(plan.omittedHighPriority).toBe(false);
		expect(plan.retrievalFallbacks).toEqual([]);
	});

	it("does not demote when the freed tokens still cannot admit the omitted item", () => {
		// A frees 90 by stepping to its pointer, but B needs 95: no admission,
		// so A must keep the representation the policy chose for it.
		const items = [item("a-high", "high", 100, 10), item("b-big", "medium", 95)];
		const plan = planContextBudgetWith(items, {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0, ceilingPct: 1 } },
		});
		expect(kindOf(plan, "a-high")).toBe("full");
		expect(plan.omittedItemIds).toContain("b-big");
	});

	it("leaves no omitted item that still fits, and never breaches a cap (randomized)", () => {
		// mulberry32: deterministic instances, so a counterexample is reproducible.
		let seed = 0x9e3779b9;
		const rnd = (): number => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const pick = <T>(values: readonly T[]): T => values[Math.floor(rnd() * values.length)];
		const between = (low: number, high: number): number => low + Math.floor(rnd() * (high - low + 1));

		for (let instance = 0; instance < 200; instance++) {
			const items: ContextBudgetItemV2[] = [];
			for (let index = 0; index < between(1, 4); index++) {
				const full = between(5, 60);
				const pointer = rnd() < 0.5 ? between(2, Math.max(2, full - 1)) : undefined;
				items.push(
					makeContextBudgetItem({
						id: `i${index}`,
						tier: pick(["current-files", "history"] as const),
						priority: pick(["high", "medium", "low"] as const),
						text: "f".repeat(full * 4),
						tokenEstimate: full,
						ageTurns: between(0, 12),
						...(pointer === undefined
							? {}
							: { sourceRef: { uri: `file:///${index}`, contentHash: "h", retrievable: true } }),
						representations: candidates(full, pointer),
					}),
				);
			}
			const plan = planContextBudgetWith(items, {
				maxTokens: between(20, 150),
				responseReserveTokens: 0,
				safetyMarginTokens: 0,
				tierPolicy: {
					"current-files": { floorPct: rnd() * 0.3, ceilingPct: 0.4 + rnd() * 0.6 },
					history: { floorPct: rnd() * 0.3, ceilingPct: 0.4 + rnd() * 0.6 },
				},
			});
			const where = `instance ${instance}`;
			expect(plan.usedTokens, where).toBeLessThanOrEqual(plan.availableTokens);
			expect(
				plan.includedItemIds.filter((id) => plan.omittedItemIds.includes(id)),
				where,
			).toEqual([]);
			for (const allocation of plan.tierAllocations) {
				expect(allocation.usedTokens, `${where} ${allocation.tier}`).toBeLessThanOrEqual(allocation.ceilingTokens);
			}
			const remaining = plan.availableTokens - plan.usedTokens;
			for (const id of plan.omittedItemIds) {
				const source = items.find((entry) => entry.id === id);
				if (!source) continue;
				const cheapest = (source.representations ?? [])
					.filter((candidate) => candidate.kind !== "omit" && isRepresentationEligible(candidate, source, policy))
					.reduce<number | undefined>(
						(low, candidate) =>
							low === undefined ? candidate.estimatedTokens : Math.min(low, candidate.estimatedTokens),
						undefined,
					);
				if (cheapest === undefined) continue;
				const tier = plan.tierAllocations.find((allocation) => allocation.tier === source.tier);
				const tierRemaining = (tier?.ceilingTokens ?? 0) - (tier?.usedTokens ?? 0);
				const fits = cheapest <= remaining && cheapest <= tierRemaining;
				expect(fits, `${where}: omitted "${id}" still fits at ${cheapest}`).toBe(false);
			}
		}
	});

	it("never steps a donor below its tier's floor claim", () => {
		// current-files floor 60 is spent on A; demoting A to its 10-token pointer
		// would drop the tier under its reservation, so the history item stays out.
		const donor = item("a-high", "high", 60, 10);
		const other = makeContextBudgetItem({
			id: "h-old",
			tier: "history",
			priority: "medium",
			ageTurns: 10,
			text: "h".repeat(360),
			tokenEstimate: 90,
			representations: candidates(90),
		});
		const plan = planContextBudgetWith([donor, other], {
			maxTokens: 100,
			responseReserveTokens: 0,
			safetyMarginTokens: 0,
			tierPolicy: { "current-files": { floorPct: 0.6, ceilingPct: 1 }, history: { floorPct: 0, ceilingPct: 1 } },
		});
		expect(kindOf(plan, "a-high")).toBe("full");
		expect(plan.omittedItemIds).toContain("h-old");
	});
});
