import type { ContextBudgetTierV2 } from "./context-budget-headroom.ts";
import type { PlannedItemV2 } from "./context-budget-v2-scoring.ts";
import { ALL_TIERS_V2, type TierBudgetPolicyV2 } from "./context-budget-v2-types.ts";

export interface RawTierDemand {
	readonly demand: number;
	readonly hard: number;
}

export interface RawTierAllocation {
	readonly floor: number;
	readonly ceiling: number;
	readonly allocated: number;
}

export function computeTierDemand(plannedItems: readonly PlannedItemV2[]): Map<ContextBudgetTierV2, RawTierDemand> {
	const demand = new Map<ContextBudgetTierV2, RawTierDemand>();
	for (const tier of ALL_TIERS_V2) {
		demand.set(tier, { demand: 0, hard: 0 });
	}
	for (const planned of plannedItems) {
		const entry = demand.get(planned.item.tier) ?? { demand: 0, hard: 0 };
		demand.set(planned.item.tier, {
			demand: entry.demand + planned.fullTokens,
			hard: entry.hard + (planned.isHard ? planned.fullTokens : 0),
		});
	}
	return demand;
}

export function allocateTiers(
	available: number,
	policy: Readonly<Record<ContextBudgetTierV2, TierBudgetPolicyV2>>,
	demand: Map<ContextBudgetTierV2, RawTierDemand>,
): Map<ContextBudgetTierV2, RawTierAllocation> {
	const out = new Map<ContextBudgetTierV2, RawTierAllocation>();

	for (const tier of ALL_TIERS_V2) {
		const floor = Math.max(0, Math.floor(policy[tier].floorPct * available));
		const ceiling = Math.max(floor, Math.floor(policy[tier].ceilingPct * available));
		const entry = demand.get(tier) ?? { demand: 0, hard: 0 };
		const want = Math.max(entry.demand, entry.hard);
		// `allocated` is the tier's guaranteed claim — what the floor pass is
		// entitled to spend on this tier's own items before global competition:
		// its hard demand (always admitted) or, beyond that, its demand capped
		// at the floor. The previous residual-redistribution loop could never
		// move this number on normal input (min(want, max(ceiling, hard)) makes
		// want-allocated or ceiling-allocated zero), so it is removed rather
		// than kept as dead code. Leftover budget competes globally in the
		// ceiling-bounded selection pass instead.
		out.set(tier, { floor, ceiling, allocated: Math.min(want, Math.max(floor, entry.hard)) });
	}
	return out;
}
