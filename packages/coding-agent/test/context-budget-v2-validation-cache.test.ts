import { describe, expect, it } from "vitest";
import { createMemoryContextBudgetCacheProviderV2 } from "../src/core/context-budget-governor-v2.ts";
import { makeContextBudgetItem, planContextBudgetWith } from "./context-budget-test-helpers.ts";

const item = makeContextBudgetItem({ id: "context", tier: "history", text: "current context", tokenEstimate: 4 });

function hasInvalidInput(plan: ReturnType<typeof planContextBudgetWith>): boolean {
	return plan.diagnostics.some((entry) => entry.reason === "invalid_input");
}

describe("context input diagnostics across plan cache reuse", () => {
	it("does not hide duplicate-ID diagnostics behind a previously valid plan", () => {
		const cacheProvider = createMemoryContextBudgetCacheProviderV2();
		planContextBudgetWith([item], { cacheProvider });
		const invalid = planContextBudgetWith([item, { ...item, text: "duplicate" }], { cacheProvider });
		expect(hasInvalidInput(invalid)).toBe(true);
		expect(invalid.observability.cache.planCache.hit).toBe(false);
		expect(invalid.includedItemIds).toEqual([item.id]);
	});

	it("does not persist a duplicate-ID diagnostic into a later valid call", () => {
		const cacheProvider = createMemoryContextBudgetCacheProviderV2();
		// Hard items bypass representation caching, isolating the plan-cache contract.
		const requiredItem = { ...item, required: true };
		const invalid = planContextBudgetWith([requiredItem, requiredItem], { cacheProvider });
		expect(hasInvalidInput(invalid)).toBe(true);
		const valid = planContextBudgetWith([requiredItem], { cacheProvider });
		expect(hasInvalidInput(valid)).toBe(false);
		expect(valid.observability.cache.planCache.hit).toBe(false);
		const reused = planContextBudgetWith([requiredItem], { cacheProvider });
		expect(reused.observability.cache.planCache.hit).toBe(true);
	});

	it("retains recomputation diagnostics when invalid estimates sanitize to cached input", () => {
		const cacheProvider = createMemoryContextBudgetCacheProviderV2();
		const unestimated = { ...item, tokenEstimate: undefined };
		planContextBudgetWith([unestimated], { cacheProvider });
		const invalid = planContextBudgetWith([{ ...unestimated, tokenEstimate: Number.NaN }], { cacheProvider });
		expect(hasInvalidInput(invalid)).toBe(true);
		expect(invalid.observability.cache.planCache.hit).toBe(false);
	});
});
