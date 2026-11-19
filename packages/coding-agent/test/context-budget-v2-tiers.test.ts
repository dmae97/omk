import { describe, expect, it } from "vitest";
import type { ContextBudgetTierV2 } from "../src/core/context-budget-headroom.ts";
import type { PlannedItemV2 } from "../src/core/context-budget-v2-scoring.ts";
import { allocateTiers, computeTierDemand, type RawTierDemand } from "../src/core/context-budget-v2-tiers.ts";
import { ALL_TIERS_V2, DEFAULT_TIER_POLICY_V2, type TierBudgetPolicyV2 } from "../src/core/context-budget-v2-types.ts";

function plannedItem(tier: ContextBudgetTierV2, fullTokens: number, isHard: boolean): PlannedItemV2 {
	return {
		item: { tier },
		fullTokens,
		isHard,
	} as unknown as PlannedItemV2;
}

describe("computeTierDemand", () => {
	it("starts every tier at zero demand for an empty plan", () => {
		const demand = computeTierDemand([]);
		for (const tier of ALL_TIERS_V2) {
			expect(demand.get(tier)).toEqual({ demand: 0, hard: 0 });
		}
	});

	it("sums demand per tier and tracks hard tokens separately", () => {
		const demand = computeTierDemand([plannedItem("system", 100, true), plannedItem("system", 50, false)]);
		expect(demand.get("system")).toEqual({ demand: 150, hard: 100 });
	});
});

describe("allocateTiers", () => {
	const demand = new Map<ContextBudgetTierV2, RawTierDemand>([
		["system", { demand: 150, hard: 100 }],
		["history", { demand: 500, hard: 0 }],
		["tools", { demand: 200, hard: 200 }],
	]);

	it("floors and ceilings system from the default policy and allocates its demand", () => {
		const out = allocateTiers(1000, DEFAULT_TIER_POLICY_V2, demand);
		expect(out.get("system")).toEqual({ floor: 250, ceiling: 450, allocated: 150 });
	});

	it("caps soft history demand at the floor", () => {
		const out = allocateTiers(1000, DEFAULT_TIER_POLICY_V2, demand);
		expect(out.get("history")).toEqual({ floor: 100, ceiling: 300, allocated: 100 });
	});

	it("admits hard tools demand above the ceiling", () => {
		const out = allocateTiers(1000, DEFAULT_TIER_POLICY_V2, demand);
		expect(out.get("tools")?.allocated).toBe(200);
		expect(out.get("tools")?.ceiling).toBe(120);
	});

	it("allocates zero to a tier missing from the demand map", () => {
		const out = allocateTiers(1000, DEFAULT_TIER_POLICY_V2, demand);
		expect(out.get("active-goal")?.allocated).toBe(0);
	});

	it("clamps the ceiling up to the floor when the policy inverts them", () => {
		const policy: Readonly<Record<ContextBudgetTierV2, TierBudgetPolicyV2>> = {
			...DEFAULT_TIER_POLICY_V2,
			system: { floorPct: 0.5, ceilingPct: 0.1 },
		};
		const out = allocateTiers(1000, policy, demand);
		expect(out.get("system")).toEqual({ floor: 500, ceiling: 500, allocated: 150 });
	});

	it("zeroes every floor and ceiling when nothing is available", () => {
		const out = allocateTiers(0, DEFAULT_TIER_POLICY_V2, demand);
		for (const tier of ALL_TIERS_V2) {
			expect(out.get(tier)?.floor).toBe(0);
			expect(out.get(tier)?.ceiling).toBe(0);
		}
	});
});
