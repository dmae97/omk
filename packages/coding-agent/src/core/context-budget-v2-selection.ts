import {
	type ContextBudgetItemV2,
	type ContextBudgetTierV2,
	type ContextRepresentationCandidateV2,
	type ContextSourceRefV2,
	chooseHeadroomRepresentation,
	deriveRepresentationCandidates,
} from "./context-budget-headroom.ts";
import {
	applyRepresentationCacheV2,
	type ContextBudgetSelectionCacheV2,
	writeRepresentationCacheV2,
} from "./context-budget-v2-cache.ts";
import { recordContextBudgetRepresentationCacheHitV2 } from "./context-budget-v2-cache-telemetry.ts";
import { computeCoverageGap } from "./context-budget-v2-coverage.ts";
import { applyRedundancyPenalties, type PlannedItemV2 } from "./context-budget-v2-scoring.ts";
import {
	ALL_TIERS_V2,
	type QualityDiagnosticV2,
	type SelectedRepresentationV2,
	type TierBudgetAllocationV2,
} from "./context-budget-v2-types.ts";

export interface OptionalSelectionState {
	/** Per-tier caps; `floor` is the tier's reservation, which the exchange pass must not raid. */
	readonly allocation: ReadonlyMap<ContextBudgetTierV2, { readonly ceiling: number; readonly floor?: number }>;
	readonly available: number;
	readonly cache?: ContextBudgetSelectionCacheV2;
	readonly diagnostics: QualityDiagnosticV2[];
	readonly omitted: ContextBudgetItemV2[];
	readonly qualityPolicy: Parameters<typeof chooseHeadroomRepresentation>[2];
	readonly retrievalFallbacks: ContextSourceRefV2[];
	readonly selection: Map<string, SelectedRepresentationV2>;
	readonly tierUsed: Record<ContextBudgetTierV2, number>;
	readonly usedTokens: number;
	/**
	 * Floor-reservation pass state. When set and the item belongs to this
	 * tier, the call admits it only while the tier's floor has headroom; an
	 * item that cannot fit inside the remaining floor is left unselected
	 * (never omitted) for the later global pass to reconsider under the
	 * tier's ceiling.
	 */
	readonly floorReservation?: { readonly tier: ContextBudgetTierV2; readonly floorTokens: number };
	/**
	 * Cache-resolved candidates per item, shared across the floor and global
	 * passes so one item does not double-count provider reads (negative hits,
	 * stale rejects, misses) or repeat materialization work when it is
	 * reconsidered.
	 */
	readonly resolvedCandidates?: Map<string, readonly ContextRepresentationCandidateV2[]>;
}

export function applyPlannerRedundancyPenalties(plannedItems: PlannedItemV2[]): void {
	const penalties = applyRedundancyPenalties(plannedItems.filter((planned) => !planned.isHard));
	for (const planned of plannedItems) {
		const penalty = penalties.get(planned.item.id);
		if (penalty === undefined) continue;
		planned.redundancyPenalty = penalty;
		planned.effectiveScore = planned.baseScore - penalty;
	}
}

export function selectHardItem(
	planned: PlannedItemV2,
	selection: Map<string, SelectedRepresentationV2>,
	tierUsed: Record<ContextBudgetTierV2, number>,
): number {
	const candidate: ContextRepresentationCandidateV2 = {
		kind: "full",
		text: planned.item.text,
		estimatedTokens: planned.fullTokens,
		fidelity: planned.item.tokenEstimate !== undefined ? "exact" : "bounded",
		sourceRef: planned.item.sourceRef,
	};
	selection.set(planned.item.id, toSelected(planned.item.id, candidate));
	tierUsed[planned.item.tier] += planned.fullTokens;
	return planned.fullTokens;
}

export function selectOptionalItem(planned: PlannedItemV2, state: OptionalSelectionState): number {
	const floorPass =
		state.floorReservation !== undefined && planned.item.tier === state.floorReservation.tier
			? state.floorReservation
			: undefined;
	if (floorPass !== undefined && state.tierUsed[planned.item.tier] >= floorPass.floorTokens) {
		// This tier's guaranteed claim is already spent; leave the item for the
		// global pass rather than consuming another tier's budget.
		return state.usedTokens;
	}
	if (state.usedTokens >= state.available) {
		if (floorPass === undefined) omitItem(planned, state);
		return state.usedTokens;
	}
	// During the floor pass the binding cap is the tier's remaining floor;
	// afterwards the tier's ceiling (or the global remainder) applies.
	const tierCeiling =
		floorPass !== undefined
			? floorPass.floorTokens
			: (state.allocation.get(planned.item.tier)?.ceiling ?? state.available);
	const remaining = Math.max(0, state.available - state.usedTokens);
	// Prefer the planner-priced candidates: re-deriving here with the default
	// heuristic would price the chosen text differently from the ranking cost.
	const candidates =
		planned.candidates ??
		planned.item.representations ??
		deriveRepresentationCandidates(planned.item, state.qualityPolicy);
	const materializedEnabled = planned.item.representations === undefined;
	let cachedCandidates = state.resolvedCandidates?.get(planned.item.id);
	if (cachedCandidates === undefined) {
		cachedCandidates = state.cache
			? applyRepresentationCacheV2({ planned, candidates, cache: state.cache, materializedEnabled })
			: candidates;
		state.resolvedCandidates?.set(planned.item.id, cachedCandidates);
	}
	const chosen = chooseHeadroomRepresentation(
		{ ...planned.item, representations: cachedCandidates },
		{
			tierUsedTokens: state.tierUsed[planned.item.tier],
			tierCeilingTokens: tierCeiling,
			remainingGlobalTokens: remaining,
		},
		state.qualityPolicy,
	);
	if (chosen.kind === "omit") {
		if (floorPass !== undefined) {
			// No admissible representation fits inside the remaining floor; the
			// global pass may still admit it against the tier's ceiling.
			return state.usedTokens;
		}
		const tierRemaining = Math.max(0, tierCeiling - state.tierUsed[planned.item.tier]);
		const globalFit = cachedCandidates.filter(
			(candidate) => candidate.kind !== "omit" && candidate.estimatedTokens <= remaining,
		);
		if (globalFit.length > 0 && globalFit.every((candidate) => candidate.estimatedTokens > tierRemaining)) {
			state.diagnostics.push({
				reason: "tier_ceiling_exceeded",
				itemId: planned.item.id,
				detail: `${planned.item.tier} item "${planned.item.id}" needs ${Math.min(
					...globalFit.map((candidate) => candidate.estimatedTokens),
				)} tokens with ${tierRemaining} tier tokens remaining`,
			});
		}
		omitItem(planned, state);
		return state.usedTokens;
	}
	if (state.tierUsed[planned.item.tier] + chosen.estimatedTokens > tierCeiling) {
		if (floorPass !== undefined) {
			return state.usedTokens;
		}
		state.diagnostics.push({
			reason: "tier_ceiling_exceeded",
			itemId: planned.item.id,
			detail: `${planned.item.tier} item "${planned.item.id}" needs ${chosen.estimatedTokens} tokens with ${Math.max(0, tierCeiling - state.tierUsed[planned.item.tier])} tier tokens remaining`,
		});
		omitItem(planned, state);
		return state.usedTokens;
	}
	if (state.usedTokens + chosen.estimatedTokens > state.available) {
		if (floorPass === undefined) omitItem(planned, state);
		return state.usedTokens;
	}
	if (state.cache) {
		if (chosen.cache?.hit === true) {
			recordContextBudgetRepresentationCacheHitV2(
				state.cache.telemetry,
				chosen.kind,
				chosen.cache.keyKind,
				planned.fullTokens,
			);
		}
		writeRepresentationCacheV2({ planned, selected: chosen, cache: state.cache, materializedEnabled });
	}
	state.selection.set(planned.item.id, toSelected(planned.item.id, chosen));
	state.tierUsed[planned.item.tier] += chosen.estimatedTokens;
	return state.usedTokens + chosen.estimatedTokens;
}

export function emitOmissionDiagnostics(
	omitted: readonly ContextBudgetItemV2[],
	diagnostics: QualityDiagnosticV2[],
	retrievalFallbacks: ContextSourceRefV2[],
): void {
	for (const item of omitted) {
		if (item.priority === "high" || item.required === true) {
			diagnostics.push({
				reason: "omitted_high_priority",
				itemId: item.id,
				detail: `${item.tier} item "${item.id}" could not fit within the prompt budget`,
			});
		}
		if (item.sourceRef?.retrievable) {
			diagnostics.push({
				reason: "restore_on_demand_hint",
				itemId: item.id,
				detail: `retrievable "${item.id}" kept as fallback via ${item.sourceRef.uri}`,
			});
			retrievalFallbacks.push(item.sourceRef);
		}
	}
}

export function emitCoverageDiagnostics(
	query: string | undefined,
	selection: ReadonlyMap<string, SelectedRepresentationV2>,
	diagnostics: QualityDiagnosticV2[],
): void {
	const coverage = computeCoverageGap(
		query,
		[...selection.values()].map((representation) => representation.text),
	);
	if (!coverage.gap) return;
	diagnostics.push({
		reason: "coverage_gap",
		detail: `query terms not covered by selected context: ${coverage.missing.join(", ")}`,
	});
}

export function buildTierAllocations(
	allocation: ReadonlyMap<
		ContextBudgetTierV2,
		{ readonly floor: number; readonly ceiling: number; readonly allocated: number }
	>,
	demand: ReadonlyMap<ContextBudgetTierV2, { readonly hard: number }>,
	tierUsed: Record<ContextBudgetTierV2, number>,
): TierBudgetAllocationV2[] {
	return ALL_TIERS_V2.map((tier) => {
		const raw = allocation.get(tier) ?? { floor: 0, ceiling: 0, allocated: 0 };
		return {
			tier,
			floorTokens: raw.floor,
			ceilingTokens: raw.ceiling,
			allocatedTokens: raw.allocated,
			usedTokens: tierUsed[tier],
			hardTokens: demand.get(tier)?.hard ?? 0,
		};
	});
}

export function createTierUsage(): Record<ContextBudgetTierV2, number> {
	return Object.fromEntries(ALL_TIERS_V2.map((tier) => [tier, 0])) as Record<ContextBudgetTierV2, number>;
}

export function toSelected(itemId: string, candidate: ContextRepresentationCandidateV2): SelectedRepresentationV2 {
	return {
		itemId,
		kind: candidate.kind,
		text: candidate.text,
		estimatedTokens: candidate.estimatedTokens,
		fidelity: candidate.fidelity,
		sourceRef: candidate.sourceRef,
		summaryHash: candidate.summaryHash,
		compressorId: candidate.compressorId,
		cache: candidate.cache,
	};
}

function omitItem(
	planned: PlannedItemV2,
	state: Pick<OptionalSelectionState, "diagnostics" | "omitted" | "retrievalFallbacks">,
): void {
	state.omitted.push(planned.item);
	if (planned.item.sourceRef?.retrievable) {
		state.diagnostics.push({
			reason: "retrieval_miss_risk",
			itemId: planned.item.id,
			detail: `retrievable ${planned.item.tier} item "${planned.item.id}" omitted; keep pointer for restore-on-demand`,
		});
		state.retrievalFallbacks.push(planned.item.sourceRef);
	}
}
