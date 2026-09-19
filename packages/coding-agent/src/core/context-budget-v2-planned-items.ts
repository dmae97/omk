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

/**
 * Identity of the adapter that actually prices this run's text.
 *
 * Every representation price now depends on the planner's counter (audit F01),
 * but the materialized representation key is bucketed rather than exact, so the
 * static `heuristic-v1` default let two counters share one key space: a run
 * could admit text at a price its own counter never produced, and the entry's
 * `tokenizer_mismatch` check compared that constant against itself. Probe a
 * non-empty string, because `countText("")` short-circuits to the fallback
 * estimator in the registry and would report the wrong adapter.
 */
export function resolveEffectiveTokenizerIdV2(tokenCounter: TokenCounterAdapter | undefined, modelId: string): string {
	return (tokenCounter ?? createFallbackTokenCounter()).countText(" ", modelId).adapterId;
}

export function createPlannedItems(
	items: readonly ContextBudgetItemV2[],
	tokenCounter: TokenCounterAdapter | undefined,
	modelId: string,
	qualityPolicy?: Parameters<typeof deriveRepresentationCandidates>[1],
): PlannedItemV2[] {
	const counter = tokenCounter ?? createFallbackTokenCounter();
	// One counter prices the full text and every derived representation, so
	// the selector compares like with like (audit F01: a ratio-priced summary
	// was admitted into a budget its materialized text could not fit).
	const countTokens = (text: string): number => counter.countText(text, modelId).tokens;
	return items.map((item) => {
		const overrideTokenEstimate = item.tokenEstimate ?? countTokens(item.text);
		const itemWithTokens =
			item.tokenEstimate === undefined ? { ...item, tokenEstimate: overrideTokenEstimate } : item;
		const fullTokens = fullTextTokens(itemWithTokens);
		const isHard = item.priority === "hard" || item.required === true;
		const baseScore = isHard ? Number.POSITIVE_INFINITY : scoreContextBudgetItemV2(itemWithTokens, fullTokens);
		const candidates =
			itemWithTokens.representations ?? deriveRepresentationCandidates(itemWithTokens, qualityPolicy, countTokens);
		return {
			item: itemWithTokens,
			fullTokens,
			admissibleTokens: minAdmissibleTokens(candidates, itemWithTokens, qualityPolicy, fullTokens),
			candidates,
			contentHash: contentHashOf(item.text),
			baseScore,
			redundancyPenalty: 0,
			effectiveScore: baseScore,
			isHard,
		};
	});
}
