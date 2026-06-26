import { describe, expect, it } from "vitest";
import {
	AdaptiveBudget,
	getTokenOptimizerRuntimeStatus,
	LazyExecutor,
	LosslessCompressor,
	TokenOptimizer,
} from "../src/core/token-optimizer.ts";

describe("LosslessCompressor", () => {
	it("does not remove repeated words or abbreviate domain phrases", () => {
		const query = "large language model model model context window";
		const result = new LosslessCompressor().compress(query);

		expect(result).toEqual({ compressed: query, tokensSaved: 0 });
	});

	it("handles empty input without synthetic savings", () => {
		expect(new LosslessCompressor().compress("")).toEqual({ compressed: "", tokensSaved: 0 });
	});
});

describe("LazyExecutor", () => {
	it("memoizes results until forced or cleared", () => {
		const executor = new LazyExecutor();
		let calls = 0;
		const run = (): number => {
			calls += 1;
			return calls;
		};

		expect(executor.execute("task", run)).toBe(1);
		expect(executor.execute("task", run)).toBe(1);
		expect(executor.execute("task", run, true)).toBe(2);
		executor.clear();
		expect(executor.execute("task", run)).toBe(3);
	});
});

describe("AdaptiveBudget", () => {
	it("emits budget events and preserves usage on rejected allocation", () => {
		const budget = new AdaptiveBudget(10);
		const exceededEvents: Array<{ used: number; requested: number; budget: number }> = [];
		const adjustedEvents: Array<{ newBudget: number }> = [];
		budget.on("budgetExceeded", (event: { used: number; requested: number; budget: number }) => {
			exceededEvents.push(event);
		});
		budget.on("budgetAdjusted", (event: { newBudget: number }) => {
			adjustedEvents.push(event);
		});

		expect(budget.allocate(7)).toBe(true);
		expect(budget.allocate(4)).toBe(false);
		budget.adjustBudget(12);

		expect(budget.getStats()).toEqual({ budget: 12, used: 7, remaining: 5, utilization: 7 / 12 });
		expect(exceededEvents).toEqual([{ used: 7, requested: 4, budget: 10 }]);
		expect(adjustedEvents).toEqual([{ newBudget: 12 }]);
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
		expect(result.budgetExceeded).toBe(false);
	});

	it("exposes over-budget optimization without charging rejected tokens", () => {
		const optimizer = new TokenOptimizer(1);
		const result = optimizer.optimize("supercalifragilisticexpialidocious");

		expect(result.optimizedQuery).toBe("supercalifragilisticexpialidocious");
		expect(result.budgetExceeded).toBe(true);
		expect(optimizer.getBudgetStats().used).toBe(0);
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
