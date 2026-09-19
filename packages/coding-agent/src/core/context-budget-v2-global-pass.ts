import {
	type ContextRepresentationCandidateV2,
	chooseHeadroomRepresentation,
	deriveRepresentationCandidates,
} from "./context-budget-headroom.ts";
import { writeRepresentationCacheV2 } from "./context-budget-v2-cache.ts";
import type { PlannedItemV2 } from "./context-budget-v2-scoring.ts";
import { type OptionalSelectionState, selectOptionalItem, toSelected } from "./context-budget-v2-selection.ts";
import type { SelectedRepresentationV2 } from "./context-budget-v2-types.ts";

/** Selection state after the floor-reservation passes; `usedTokens` is the running total so far. */
export type GlobalPassState = Omit<OptionalSelectionState, "floorReservation">;

export type PromotionState = Pick<
	GlobalPassState,
	| "allocation"
	| "available"
	| "cache"
	| "qualityPolicy"
	| "resolvedCandidates"
	| "selection"
	| "tierUsed"
	| "usedTokens"
>;

/**
 * Everything that happens once every tier has spent its floor: the global
 * pass admits still-unselected optional items in rank order under their tier
 * ceilings, then the promotion pass lets items admitted cheaply inside a floor
 * take a costlier representation with whatever budget is left. Returns the
 * final token usage.
 */
export function runGlobalSelectionPass(optionalPlanned: readonly PlannedItemV2[], state: GlobalPassState): number {
	let usedTokens = state.usedTokens;
	for (const planned of optionalPlanned) {
		if (state.selection.has(planned.item.id)) continue;
		usedTokens = selectOptionalItem(planned, { ...state, usedTokens });
	}
	return promoteSelectedRepresentations(optionalPlanned, { ...state, usedTokens });
}

/**
 * Re-offer each selected optional item its costlier representations against
 * the leftover budget (audit F03). The floor pass admits an item at whatever
 * fits the tier's remaining floor and the global pass then skips it by id,
 * so a pointer chosen under a small floor stayed a pointer while most of the
 * budget went unused. Runs once, in selection-rank order, after the global
 * pass; a swap happens only when the selection policy itself prefers the
 * costlier representation under the real remainder and it fits both the
 * tier ceiling and the global budget. It never demotes, never touches hard
 * items, and never spends beyond either cap. Returns the updated token usage.
 */
export function promoteSelectedRepresentations(
	optionalPlanned: readonly PlannedItemV2[],
	state: PromotionState,
): number {
	let usedTokens = state.usedTokens;
	for (const planned of optionalPlanned) {
		const current = state.selection.get(planned.item.id);
		if (current === undefined || current.kind === "omit") continue;
		const remaining = state.available - usedTokens;
		if (remaining <= 0) break;
		const ceiling = state.allocation.get(planned.item.tier)?.ceiling ?? state.available;
		const tierUsedWithout = state.tierUsed[planned.item.tier] - current.estimatedTokens;
		const candidates =
			state.resolvedCandidates?.get(planned.item.id) ??
			planned.candidates ??
			planned.item.representations ??
			deriveRepresentationCandidates(planned.item, state.qualityPolicy);
		const upgrades = candidates.filter(
			(candidate) =>
				candidate.kind !== "omit" &&
				candidate.estimatedTokens > current.estimatedTokens &&
				candidate.estimatedTokens <= remaining + current.estimatedTokens &&
				tierUsedWithout + candidate.estimatedTokens <= ceiling,
		);
		if (upgrades.length === 0) continue;
		// Let the policy rank the current choice against every affordable upgrade
		// under the real leftover; only a strictly costlier winner is a promotion.
		const chosen = chooseHeadroomRepresentation(
			{ ...planned.item, representations: [...upgrades, toCandidate(current)] },
			{
				tierUsedTokens: tierUsedWithout,
				tierCeilingTokens: ceiling,
				remainingGlobalTokens: remaining + current.estimatedTokens,
			},
			state.qualityPolicy,
		);
		if (chosen.kind === "omit" || chosen.estimatedTokens <= current.estimatedTokens) continue;
		if (state.cache) {
			writeRepresentationCacheV2({
				planned,
				selected: chosen,
				cache: state.cache,
				materializedEnabled: planned.item.representations === undefined,
			});
		}
		state.tierUsed[planned.item.tier] = tierUsedWithout + chosen.estimatedTokens;
		usedTokens += chosen.estimatedTokens - current.estimatedTokens;
		state.selection.set(planned.item.id, toSelected(planned.item.id, chosen));
	}
	return usedTokens;
}

function toCandidate(selected: SelectedRepresentationV2): ContextRepresentationCandidateV2 {
	return {
		kind: selected.kind,
		text: selected.text,
		estimatedTokens: selected.estimatedTokens,
		fidelity: selected.fidelity,
		sourceRef: selected.sourceRef,
		summaryHash: selected.summaryHash,
		compressorId: selected.compressorId,
		cache: selected.cache,
	};
}
