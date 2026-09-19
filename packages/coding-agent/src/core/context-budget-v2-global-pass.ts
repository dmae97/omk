import {
	type ContextRepresentationCandidateV2,
	chooseHeadroomRepresentation,
	deriveRepresentationCandidates,
	isRepresentationEligible,
	scoreRepresentationPreferenceV2,
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
 * Everything that happens once every tier has spent its floor:
 *
 * 1. the global pass admits still-unselected optional items in rank order
 *    under their tier ceilings;
 * 2. the exchange pass lets a still-omitted item pay for its admission by
 *    stepping selected items down to their cheapest admissible form (F04);
 * 3. the promotion pass spends whatever is left on costlier representations
 *    the policy prefers (F03).
 *
 * Breadth is settled before quality: an exchange that admits another item
 * cannot be undone by a promotion, because promotion only spends the budget
 * the exchange left. Returns the final token usage.
 */
export function runGlobalSelectionPass(optionalPlanned: readonly PlannedItemV2[], state: GlobalPassState): number {
	let usedTokens = state.usedTokens;
	for (const planned of optionalPlanned) {
		if (state.selection.has(planned.item.id)) continue;
		usedTokens = selectOptionalItem(planned, { ...state, usedTokens });
	}
	usedTokens = exchangeForOmittedItems(optionalPlanned, { ...state, usedTokens });
	return promoteSelectedRepresentations(optionalPlanned, { ...state, usedTokens });
}

/** Representations the planner priced for this item, in the order selection saw them. */
function candidatesFor(planned: PlannedItemV2, state: PromotionState): readonly ContextRepresentationCandidateV2[] {
	return (
		state.resolvedCandidates?.get(planned.item.id) ??
		planned.candidates ??
		planned.item.representations ??
		deriveRepresentationCandidates(planned.item, state.qualityPolicy)
	);
}

/** Cheapest representation the policy would allow at all, ignoring budget. */
function cheapestAdmissible(
	planned: PlannedItemV2,
	state: PromotionState,
): ContextRepresentationCandidateV2 | undefined {
	let best: ContextRepresentationCandidateV2 | undefined;
	for (const candidate of candidatesFor(planned, state)) {
		if (candidate.kind === "omit") continue;
		if (!isRepresentationEligible(candidate, planned.item, state.qualityPolicy)) continue;
		if (best === undefined || candidate.estimatedTokens < best.estimatedTokens) best = candidate;
	}
	return best;
}

interface PlannedExchange {
	readonly swaps: ReadonlyArray<{
		readonly donor: PlannedItemV2;
		readonly from: SelectedRepresentationV2;
		readonly to: ContextRepresentationCandidateV2;
	}>;
	readonly freed: number;
}

/**
 * Plan the cheapest set of step-downs that makes room for `cost` tokens in
 * `target`'s tier, or `undefined` when no admissible set exists.
 *
 * Donors are ordered by the preference the policy loses per token freed, so
 * the item whose fidelity matters least to the policy yields first. A donor is
 * skipped when stepping it down would drop its tier below the floor it is
 * currently honouring: the floor is a reservation, not a budget to raid. An
 * empty swap list is legitimate — an earlier exchange may already have freed
 * enough for this item.
 */
function planExchange(
	target: PlannedItemV2,
	cost: number,
	optionalPlanned: readonly PlannedItemV2[],
	state: PromotionState,
	usedTokens: number,
): PlannedExchange | undefined {
	const ceilingOf = (tier: PlannedItemV2["item"]["tier"]): number =>
		state.allocation.get(tier)?.ceiling ?? state.available;
	const floorOf = (tier: PlannedItemV2["item"]["tier"]): number => state.allocation.get(tier)?.floor ?? 0;
	const projected = new Map<string, number>();
	const tierNow = (tier: PlannedItemV2["item"]["tier"]): number => projected.get(tier) ?? state.tierUsed[tier];

	const donors = [];
	for (const donor of optionalPlanned) {
		if (donor.item.id === target.item.id) continue;
		const current = state.selection.get(donor.item.id);
		if (current === undefined || current.kind === "omit") continue;
		const cheap = cheapestAdmissible(donor, state);
		if (cheap === undefined || cheap.estimatedTokens >= current.estimatedTokens) continue;
		const freed = current.estimatedTokens - cheap.estimatedTokens;
		const from = toCandidate(current);
		const loss =
			scoreRepresentationPreferenceV2(from, donor.item, state.qualityPolicy, false) -
			scoreRepresentationPreferenceV2(cheap, donor.item, state.qualityPolicy, false);
		donors.push({ donor, current, cheap, freed, lossPerToken: loss / freed });
	}
	donors.sort((a, b) => a.lossPerToken - b.lossPerToken || a.donor.item.id.localeCompare(b.donor.item.id));

	const swaps: Array<PlannedExchange["swaps"][number]> = [];
	let freed = 0;
	const fits = (): boolean =>
		cost <= state.available - (usedTokens - freed) && tierNow(target.item.tier) + cost <= ceilingOf(target.item.tier);
	for (const entry of donors) {
		if (fits()) break;
		const after = tierNow(entry.donor.item.tier) - entry.freed;
		if (tierNow(entry.donor.item.tier) >= floorOf(entry.donor.item.tier) && after < floorOf(entry.donor.item.tier)) {
			continue;
		}
		projected.set(entry.donor.item.tier, after);
		swaps.push({ donor: entry.donor, from: entry.current, to: entry.cheap });
		freed += entry.freed;
	}
	return fits() ? { swaps, freed } : undefined;
}

/**
 * Admit still-omitted items by exchanging fidelity for coverage (audit F04).
 *
 * Ranking prices an item by its cheapest admissible representation but the
 * selector may admit it at full text, so one item ranked on a 10-token pointer
 * can spend 100 and displace two 45-token items the policy would rather keep.
 * After the global pass, each omitted item in rank order may buy its cheapest
 * admissible form by stepping selected items down to theirs. The whole exchange
 * is applied or none of it is; tier floors and ceilings hold throughout. This
 * is a bounded repair, not joint `(item, representation)` optimization.
 */
function exchangeForOmittedItems(optionalPlanned: readonly PlannedItemV2[], state: GlobalPassState): number {
	let usedTokens = state.usedTokens;
	for (const target of optionalPlanned) {
		if (state.selection.has(target.item.id)) continue;
		const admit = cheapestAdmissible(target, state);
		if (admit === undefined) continue;
		const exchange = planExchange(target, admit.estimatedTokens, optionalPlanned, state, usedTokens);
		if (exchange === undefined) continue;
		for (const swap of exchange.swaps) {
			state.tierUsed[swap.donor.item.tier] += swap.to.estimatedTokens - swap.from.estimatedTokens;
			state.selection.set(swap.donor.item.id, toSelected(swap.donor.item.id, swap.to));
			writeSelected(swap.donor, swap.to, state);
		}
		state.tierUsed[target.item.tier] += admit.estimatedTokens;
		state.selection.set(target.item.id, toSelected(target.item.id, admit));
		writeSelected(target, admit, state);
		// The global pass already recorded this item as omitted; an admitted item
		// must leave that list, or the plan reports it as both included and
		// omitted and bills its full text in omittedTokens.
		const omittedIndex = state.omitted.findIndex((entry) => entry.id === target.item.id);
		if (omittedIndex >= 0) state.omitted.splice(omittedIndex, 1);
		usedTokens = usedTokens - exchange.freed + admit.estimatedTokens;
	}
	return usedTokens;
}

function writeSelected(
	planned: PlannedItemV2,
	selected: ContextRepresentationCandidateV2,
	state: PromotionState,
): void {
	if (!state.cache) return;
	writeRepresentationCacheV2({
		planned,
		selected,
		cache: state.cache,
		materializedEnabled: planned.item.representations === undefined,
	});
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
function promoteSelectedRepresentations(optionalPlanned: readonly PlannedItemV2[], state: PromotionState): number {
	let usedTokens = state.usedTokens;
	for (const planned of optionalPlanned) {
		const current = state.selection.get(planned.item.id);
		if (current === undefined || current.kind === "omit") continue;
		const remaining = state.available - usedTokens;
		if (remaining <= 0) break;
		const ceiling = state.allocation.get(planned.item.tier)?.ceiling ?? state.available;
		const tierUsedWithout = state.tierUsed[planned.item.tier] - current.estimatedTokens;
		const upgrades = candidatesFor(planned, state).filter(
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
		writeSelected(planned, chosen, state);
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
