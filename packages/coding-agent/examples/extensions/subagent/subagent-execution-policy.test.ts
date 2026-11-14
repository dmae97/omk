import { describe, expect, it } from "vitest";
import { childExecutionBudgetMs, exceedsParallelTaskLimit, resolveSubagentExecutionPolicy } from "./deadline-budget.ts";

describe("subagent execution policy", () => {
	it.each([
		["off", 1, 4, 120_000],
		["minimal", 1, 4, 120_000],
		["low", 1, 4, 180_000],
		["medium", 2, 6, 240_000],
		["high", 2, 8, 360_000],
		["xhigh", 3, 8, 480_000],
		["max", 4, 12, 600_000],
		["ultra", 4, 16, 840_000],
	] as const)("bounds %s instead of creating a process per requested task", (effort, concurrency, tasks, budget) => {
		const policy = resolveSubagentExecutionPolicy(effort, 100);
		expect(policy).toEqual({
			unbounded: false,
			maxParallelTasks: tasks,
			concurrency,
			defaultExecutionBudgetMs: budget,
		});
		expect(exceedsParallelTaskLimit(policy, tasks + 1)).toBe(true);
		expect(resolveSubagentExecutionPolicy(effort, 1).concurrency).toBe(1);
	});

	it("explicit execution budgets cannot remove Ultra concurrency or count limits", () => {
		expect(resolveSubagentExecutionPolicy("ultra", 12, true)).toEqual(resolveSubagentExecutionPolicy("ultra", 12));
	});

	it.each([undefined, "unknown", "__proto__"])("uses bounded high defaults for %s", (effort) => {
		expect(resolveSubagentExecutionPolicy(effort, 10)).toEqual(resolveSubagentExecutionPolicy("high", 10));
	});

	it("reserves parent integration time and rejects unavailable capacity", () => {
		expect(childExecutionBudgetMs(120_000, undefined)).toBe(120_000);
		expect(childExecutionBudgetMs(120_000, 90_000)).toBe(60_000);
		expect(childExecutionBudgetMs(120_000, 30_000)).toBe(0);
		expect(childExecutionBudgetMs(120_000, -10)).toBe(0);
		expect(childExecutionBudgetMs(120_000, Number.NaN)).toBe(0);
	});
});
