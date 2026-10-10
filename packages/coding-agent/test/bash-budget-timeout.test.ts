import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { bindActiveRemainingBudget, RemainingBudget, startRunBudgetClock } from "../src/core/remaining-budget.ts";
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

	it("counts from run start even when bash is first called late", async () => {
		const seen: Array<number | undefined> = [];
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				seen.push(opts.timeout);
				return { exitCode: 0 };
			},
		};
		let now = 0;
		startRunBudgetClock({ env: { OMK_TIME_BUDGET_SEC: "100" }, now: () => now });
		now = 60_000; // first bash call 60s into a 100s run: 40s left, 10s reserve
		const tool = createBashToolDefinition(process.cwd(), { operations });
		await tool.execute("c1", { command: "true", timeout: 300 }, undefined, undefined, emptyCtx);
		expect(seen).toEqual([30]);
	});

	it("without a bound clock behaves like main: timeout passes through, no lazy clock", async () => {
		const seen: Array<number | undefined> = [];
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				seen.push(opts.timeout);
				return { exitCode: 0 };
			},
		};
		const previous = process.env.OMK_TIME_BUDGET_SEC;
		process.env.OMK_TIME_BUDGET_SEC = "100";
		try {
			const tool = createBashToolDefinition(process.cwd(), { operations });
			await tool.execute("c1", { command: "true" }, undefined, undefined, emptyCtx);
			await tool.execute("c2", { command: "true", timeout: 1800 }, undefined, undefined, emptyCtx);
		} finally {
			if (previous === undefined) delete process.env.OMK_TIME_BUDGET_SEC;
			else process.env.OMK_TIME_BUDGET_SEC = previous;
		}
		expect(seen).toEqual([undefined, 1800]);
	});

	it("gives an omitted timeout the budget ceiling under a budget", async () => {
		const seen: Array<number | undefined> = [];
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				seen.push(opts.timeout);
				return { exitCode: 0 };
			},
		};
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: 100_000, now: () => 0, startedAt: 0 }));
		const tool = createBashToolDefinition(process.cwd(), { operations });
		await tool.execute("c1", { command: "true" }, undefined, undefined, emptyCtx);
		expect(seen).toEqual([90]);
	});

	it("lets a save command run near the end instead of a flat 1s", async () => {
		const seen: Array<number | undefined> = [];
		const operations: BashOperations = {
			exec: async (_command, _cwd, opts) => {
				seen.push(opts.timeout);
				return { exitCode: 0 };
			},
		};
		// 1000s budget, 60s left: inside the 100s reserve, save floor 30s.
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: 1_000_000, now: () => 940_000, startedAt: 0 }));
		const tool = createBashToolDefinition(process.cwd(), { operations });
		await tool.execute("c1", { command: "cp out /app/", timeout: 120 }, undefined, undefined, emptyCtx);
		expect(seen).toEqual([30]);
	});
});
