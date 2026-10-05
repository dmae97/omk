import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { bindActiveRemainingBudget, RemainingBudget } from "../src/core/remaining-budget.ts";
import { type BashOperations, createBashToolDefinition } from "../src/core/tools/bash.ts";

afterEach(() => {
	bindActiveRemainingBudget(undefined);
});

const emptyCtx = {} as ExtensionContext;

describe("bash budget timeout clamp", () => {
	it("passes a clamped timeout to exec when RemainingBudget is set", async () => {
		const seen: number[] = [];
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				seen.push(opts.timeout ?? -1);
				throw new Error(`timeout:${opts.timeout}`);
			},
		};
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: 100_000, now: () => 0, startedAt: 0 }));
		const tool = createBashToolDefinition(process.cwd(), { operations });
		await expect(
			tool.execute("c1", { command: "sleep 999", timeout: 300 }, undefined, undefined, emptyCtx),
		).rejects.toThrow(/90 seconds.*left on the run budget/i);
		expect(seen).toEqual([90]);
	});

	it("uses the hard-kill message near budget exhaustion", async () => {
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				throw new Error(`timeout:${opts.timeout}`);
			},
		};
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: 100_000, now: () => 95_000, startedAt: 0 }));
		const tool = createBashToolDefinition(process.cwd(), { operations });
		await expect(
			tool.execute("c1", { command: "sleep 999", timeout: 300 }, undefined, undefined, emptyCtx),
		).rejects.toThrow(/nearly exhausted|save outputs/i);
	});
});
