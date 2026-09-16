import {
	type ContextBudgetItemV2,
	type ContextRepresentationCandidateV2,
	deriveRepresentationCandidates,
	fullTextTokens,
	type HeadroomQualityPolicyV2,
	isRepresentationEligible,
} from "./context-budget-headroom.ts";
import { createFallbackTokenCounter, type TokenCounterAdapter } from "./context-budget-token-counter.ts";
import { contentHashOf } from "./context-budget-v2-plan-hash.ts";
import { type PlannedItemV2, scoreContextBudgetItemV2 } from "./context-budget-v2-scoring.ts";

// Cheapest representation the chooser could actually pick: only candidates
// passing the selection policy gate count, so a pointer the chooser would
// reject cannot make an item look cheaper to admit than it is.
function minAdmissibleTokens(
	candidates: readonly ContextRepresentationCandidateV2[],
	item: ContextBudgetItemV2,
	policy: HeadroomQualityPolicyV2 | undefined,
	fullTokens: number,
): number {
	let min = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		if (
			candidate.kind !== "omit" &&
			isRepresentationEligible(candidate, item, policy) &&
			candidate.estimatedTokens < min
		) {
			min = candidate.estimatedTokens;
		}
	}
	return Math.max(1, Number.isFinite(min) ? min : fullTokens);
}

export function createPlannedItems(
	items: readonly ContextBudgetItemV2[],
	tokenCounter: TokenCounterAdapter | undefined,
	modelId: string,
	qualityPolicy?: Parameters<typeof deriveRepresentationCandidates>[1],
): PlannedItemV2[] {
	const counter = tokenCounter ?? createFallbackTokenCounter();
	return items.map((item) => {
		const overrideTokenEstimate = item.tokenEstimate ?? counter.countText(item.text, modelId).tokens;
		const itemWithTokens =
			item.tokenEstimate === undefined ? { ...item, tokenEstimate: overrideTokenEstimate } : item;
		const fullTokens = fullTextTokens(itemWithTokens);
		const isHard = item.priority === "hard" || item.required === true;
		const baseScore = isHard ? Number.POSITIVE_INFINITY : scoreContextBudgetItemV2(itemWithTokens, fullTokens);
		const candidates =
			itemWithTokens.representations ?? deriveRepresentationCandidates(itemWithTokens, qualityPolicy);
		return {
			item: itemWithTokens,
			fullTokens,
			admissibleTokens: minAdmissibleTokens(candidates, itemWithTokens, qualityPolicy, fullTokens),
			contentHash: contentHashOf(item.text),
			baseScore,
			redundancyPenalty: 0,
			effectiveScore: baseScore,
			isHard,
		};
	});
}
