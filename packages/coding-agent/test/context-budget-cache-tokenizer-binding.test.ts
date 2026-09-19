import { describe, expect, it } from "vitest";
import type { ContextBudgetItemV2 } from "../src/core/context-budget-headroom.ts";
import type { TokenCounterAdapter } from "../src/core/context-budget-token-counter.ts";
import { createMemoryContextBudgetCacheProviderV2 } from "../src/core/context-budget-v2-cache.ts";
import { planPromptContextBudgetV2 } from "../src/core/context-budget-v2-planner.ts";

/**
 * Materialized-cache tokenizer binding (re-verification finding, 2026-09-19).
 *
 * F01 made every derived representation's price depend on the planner's
 * counter. Two of the three cache layers bind that counter implicitly: the
 * plan key hashes each planned item's token counts, and an exact
 * representation key hashes a fingerprint containing `estimatedTokens`, so a
 * different counter simply misses. The materialized (semantic) key does not:
 * it is keyed by a 100-token bucket plus `keyBase.tokenizerId`, and the only
 * live caller never passes `tokenizerId`, so every counter shares the static
 * `heuristic-v1` key space. Two counters whose prices land in one bucket
 * therefore swap entries, and `validateSharedRepresentationCacheEntryV2`'s
 * `tokenizer_mismatch` check compares that constant against itself and passes.
 *
 * The invariant under test is F01's own contract: the price the selector
 * checked against the budget is the price this run's counter produces for the
 * admitted text. Legitimate same-counter reuse must keep working.
 */

function counterOf(adapterId: string, charsPerToken: number): TokenCounterAdapter {
	return {
		id: adapterId,
		priority: 0,
		isAvailable: () => true,
		supports: () => true,
		countText: (text, modelId) => ({
			tokens: Math.ceil(text.length / charsPerToken),
			method: "estimated",
			confidence: "medium",
			adapterId,
			modelId,
			notes: [],
		}),
	};
}

// Same family, different granularity: both price the 171-character summary
// into the single 100-token bucket, so only the tokenizer identity separates them.
const counterA = counterOf("counter-a", 4);
const counterB = counterOf("counter-b", 5);

const agedHistory: ContextBudgetItemV2 = {
	id: "aged",
	tier: "history",
	priority: "medium",
	text: "alpha omega ".repeat(50),
	ageTurns: 10,
};

function planWithCounter(
	provider: ReturnType<typeof createMemoryContextBudgetCacheProviderV2>,
	counter: TokenCounterAdapter,
) {
	return planPromptContextBudgetV2({
		maxTokens: 60,
		responseReserveTokens: 0,
		safetyMarginTokens: 0,
		items: [agedHistory],
		tokenCounter: counter,
		modelId: "m",
		cacheProvider: provider,
		cacheNowEpochMs: 500,
		promptHash: "p",
		query: "alpha omega",
		tierPolicy: { history: { floorPct: 0, ceilingPct: 1 } },
	});
}

describe("materialized representation cache is bound to the counter that priced it", () => {
	it("never serves one counter's price for another counter's run", () => {
		const provider = createMemoryContextBudgetCacheProviderV2();
		const first = planWithCounter(provider, counterA);
		const firstSelected = first.selectedRepresentations[0];
		expect(firstSelected?.kind, "fixture must select a materializable summary").toBe("summary");
		expect(firstSelected?.estimatedTokens).toBe(counterA.countText(firstSelected?.text ?? "", "m").tokens);

		const second = planWithCounter(provider, counterB);
		const selected = second.selectedRepresentations[0];
		expect(selected?.kind).toBe("summary");
		// The admitted price must be counter B's own count of the admitted text.
		expect(selected?.estimatedTokens).toBe(counterB.countText(selected?.text ?? "", "m").tokens);
		expect(second.usedTokens).toBe(selected?.estimatedTokens);
	});

	it("still reuses the materialized entry for the counter that wrote it", () => {
		const provider = createMemoryContextBudgetCacheProviderV2();
		planWithCounter(provider, counterA);
		const again = planWithCounter(provider, counterA);
		const selected = again.selectedRepresentations[0];
		expect(selected?.estimatedTokens).toBe(counterA.countText(selected?.text ?? "", "m").tokens);
		// A plan-cache hit short-circuits selection, so it is the reuse signal here;
		// the binding must not invalidate a run by the counter that wrote the entry.
		expect(again.observability.cache.planCache.hit, "same-counter reuse must survive the tokenizer binding").toBe(
			true,
		);
	});
});
