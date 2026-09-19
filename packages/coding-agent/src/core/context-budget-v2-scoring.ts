import type {
	ContextBudgetItemV2,
	ContextBudgetPriorityV2,
	ContextBudgetTierV2,
	ContextRepresentationCandidateV2,
} from "./context-budget-headroom.ts";

export interface PlannedItemV2 {
	readonly item: ContextBudgetItemV2;
	readonly fullTokens: number;
	/**
	 * Cheapest non-omit representation cost, i.e. the true marginal cost of
	 * admitting this item at all. Equals `fullTokens` when the item has no
	 * cheaper pointer/summary/headroom representation.
	 */
	readonly admissibleTokens: number;
	/**
	 * Representations priced with the planner's token counter. Selection must
	 * choose from these rather than re-deriving with a different estimator, or
	 * the cost an item was ranked on and the cost it pays can diverge.
	 */
	readonly candidates?: readonly ContextRepresentationCandidateV2[];
	readonly contentHash: string;
	readonly baseScore: number;
	redundancyPenalty: number;
	effectiveScore: number;
	readonly isHard: boolean;
}

const PRIORITY_WEIGHT_V2: Record<ContextBudgetPriorityV2, number> = {
	hard: 1_000_000,
	high: 120,
	medium: 60,
	low: 15,
};

/** E-folding time in turns: at this age the factor is exp(-1), not one half. */
const RECENCY_TIME_CONSTANT_BY_TIER: Readonly<Record<ContextBudgetTierV2, number>> = {
	system: 999,
	"active-goal": 12,
	"current-files": 8,
	tools: 4,
	skills: 6,
	mcp: 6,
	history: 3,
	evidence: 8,
	scratch: 2,
};

export function scoreContextBudgetItemV2(item: ContextBudgetItemV2, estimatedTokens: number): number {
	if (item.priority === "hard") {
		return Number.POSITIVE_INFINITY;
	}
	const priority = PRIORITY_WEIGHT_V2[item.priority];
	const relevance = clamp01(item.relevance) * 25;
	const recency = deriveRecency(item) * 15;
	const evidence = clamp01(item.evidenceValue) * 25;
	const cost = Math.sqrt(Math.max(0, estimatedTokens)) * 0.55;
	return priority + relevance + recency + evidence - cost;
}

export function applyRedundancyPenalties(items: readonly PlannedItemV2[]): Map<string, number> {
	const penalties = new Map<string, number>();
	const groups = new Map<string, PlannedItemV2[]>();
	for (const planned of items) {
		if (!planned.item.redundancyKey) {
			continue;
		}
		const group = groups.get(planned.item.redundancyKey);
		if (group) {
			group.push(planned);
		} else {
			groups.set(planned.item.redundancyKey, [planned]);
		}
	}
	for (const group of groups.values()) {
		if (group.length <= 1) {
			continue;
		}
		group.sort((a, b) => {
			if (b.baseScore !== a.baseScore) {
				return b.baseScore - a.baseScore;
			}
			return a.item.id.localeCompare(b.item.id);
		});
		for (let index = 1; index < group.length; index++) {
			const duplicate = group[index];
			penalties.set(duplicate.item.id, redundancyPenalty(duplicate.fullTokens) * index);
		}
	}
	return penalties;
}

/**
 * Order optional items for the budgeted 0/1 knapsack the planner greedily fills.
 *
 * Value density (effective score per token) is the primary key. Ordering by
 * priority class first would let a single expensive `high` item evict an
 * arbitrary number of far denser `medium` items, which makes the greedy
 * unbounded-bad against the optimal packing. Priority still shapes the outcome
 * through `PRIORITY_WEIGHT_V2` in the score numerator, and non-negotiable
 * context uses `hard`/`required`, which the planner pins before this ordering
 * is consulted. Remaining keys break ties into a deterministic total order.
 */
export function compareOptionalForSelection(a: PlannedItemV2, b: PlannedItemV2): number {
	const aDensity = density(a);
	const bDensity = density(b);
	if (bDensity !== aDensity) {
		return bDensity - aDensity;
	}
	const aScore = Number.isNaN(a.effectiveScore) ? Number.NEGATIVE_INFINITY : a.effectiveScore;
	const bScore = Number.isNaN(b.effectiveScore) ? Number.NEGATIVE_INFINITY : b.effectiveScore;
	if (bScore !== aScore) return bScore - aScore;
	const priorityDelta = priorityRank(b.item.priority) - priorityRank(a.item.priority);
	if (priorityDelta !== 0) {
		return priorityDelta;
	}
	const aTokens = Number.isNaN(a.fullTokens) ? Number.POSITIVE_INFINITY : a.fullTokens;
	const bTokens = Number.isNaN(b.fullTokens) ? Number.POSITIVE_INFINITY : b.fullTokens;
	if (aTokens !== bTokens) return aTokens - bTokens;
	return a.item.id.localeCompare(b.item.id);
}

function priorityRank(priority: ContextBudgetPriorityV2): number {
	switch (priority) {
		case "hard":
			return 4;
		case "high":
			return 3;
		case "medium":
			return 2;
		case "low":
			return 1;
	}
}

function clamp01(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

function deriveRecency(item: ContextBudgetItemV2): number {
	if (item.recency !== undefined) {
		return clamp01(item.recency);
	}
	const age = item.ageTurns ?? 0;
	const timeConstant = RECENCY_TIME_CONSTANT_BY_TIER[item.tier] ?? 6;
	return clamp01(Math.exp(-age / timeConstant));
}

function redundancyPenalty(tokens: number): number {
	return Math.max(10, Math.sqrt(Math.max(0, tokens)) * 0.8);
}

/**
 * Value per token of the CHEAPEST admissible representation. Dividing by
 * `fullTokens` would systematically penalize retrievable or summarizable items,
 * which are exactly the items the planner admits cheaply when the budget is
 * tight — the regime where this ordering decides anything at all.
 */
function density(planned: PlannedItemV2): number {
	if (!Number.isFinite(planned.effectiveScore) || planned.effectiveScore <= 0) {
		return planned.effectiveScore > 0 ? planned.effectiveScore : 0;
	}
	const value = planned.effectiveScore / Math.max(planned.admissibleTokens, 1);
	return Number.isNaN(value) ? 0 : value;
}
