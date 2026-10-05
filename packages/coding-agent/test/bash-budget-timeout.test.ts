import { afterEach, describe, expect, it } from "vitest";
import { bindActiveRemainingBudget, RemainingBudget } from "../src/core/remaining-budget.ts";
import { type BashOperations, createBashToolDefinition } from "../src/core/tools/bash.ts";

afterEach(() => {
	bindActiveRemainingBudget(undefined);
});

describe("bash budget timeout clamp", () => {
	it("passes a clamped timeout to exec when RemainingBudget is set", async () => {
		const seen: number[] = [];
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				seen.push(opts.timeout ?? -1);
				throw new Error(`timeout:${opts.timeout}`);
			},
		};
		const budget = new RemainingBudget({ budgetMs: 100_000, now: () => 0, startedAt: 0 });
		const tool = createBashToolDefinition(process.cwd(), { operations, remainingBudget: budget });
		await expect(tool.execute("c1", { command: "sleep 999", timeout: 300 })).rejects.toThrow(
			/90 seconds.*left on the run budget/i,
		);
		expect(seen).toEqual([90]);
	});

	it("uses the hard-kill message near budget exhaustion", async () => {
		const now = 95_000;
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				throw new Error(`timeout:${opts.timeout}`);
			},
		};
		const budget = new RemainingBudget({ budgetMs: 100_000, now: () => now, startedAt: 0 });
		const tool = createBashToolDefinition(process.cwd(), { operations, remainingBudget: budget });
		await expect(tool.execute("c1", { command: "sleep 999", timeout: 300 })).rejects.toThrow(
			/nearly exhausted|save outputs/i,
		);
	});
});
