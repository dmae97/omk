import { describe, expect, it } from "vitest";
import { getTokenOptimizerRuntimeStatus, LosslessCompressor, TokenOptimizer } from "../src/core/token-optimizer.ts";

describe("LosslessCompressor", () => {
	it("does not remove repeated words or abbreviate domain phrases", () => {
		const query = "large language model model model context window";
		const result = new LosslessCompressor().compress(query);

		expect(result).toEqual({ compressed: query, tokensSaved: 0 });
	});
});

describe("TokenOptimizer", () => {
	it("preserves the prompt and reports no synthetic token savings", () => {
		const query = "large language model model model context window";
		const result = new TokenOptimizer().optimize(query);

		expect(result.optimizedQuery).toBe(query);
		expect(result.tokensSaved).toBe(0);
		expect(result.cacheHit).toBe(false);
		expect(result.technique).toBe("whitespace_normalization");
	});

	it("reports legacy quarantine compatibility status", () => {
		expect(getTokenOptimizerRuntimeStatus()).toEqual({
			optimizerId: "legacy-token-optimizer",
			status: "quarantined_compatibility",
			active: false,
			activeContextBudgetOptimizer: "context-budget-v2",
			compatibilityOnly: true,
		});
	});
});
