import { afterEach, describe, expect, it } from "vitest";
import {
	bindActiveRemainingBudget,
	createRemainingBudgetFromEnv,
	ensureActiveRemainingBudget,
	getActiveRemainingBudget,
	REMAINING_BUDGET_HARD_KILL_FRACTION,
	REMAINING_BUDGET_SAVE_RESERVE_FRACTION,
	RemainingBudget,
	resolveTimeBudgetMs,
} from "../src/core/remaining-budget.ts";
import { createEnvRemainingBudgetFraction } from "../src/core/remaining-budget-fraction.ts";

afterEach(() => {
	bindActiveRemainingBudget(undefined);
});

describe("resolveTimeBudgetMs", () => {
	it("parses positive seconds and rejects junk", () => {
		expect(resolveTimeBudgetMs("100")).toBe(100_000);
		expect(resolveTimeBudgetMs(undefined)).toBeUndefined();
		expect(resolveTimeBudgetMs("0")).toBeUndefined();
		expect(resolveTimeBudgetMs("-3")).toBeUndefined();
		expect(resolveTimeBudgetMs("nope")).toBeUndefined();
	});
});

describe("RemainingBudget", () => {
	it("tracks remaining fraction and excluded waits", () => {
		let now = 1_000;
		const budget = new RemainingBudget({ budgetMs: 100_000, now: () => now, startedAt: 1_000 });
		expect(budget.remainingFraction()).toBeCloseTo(1);
		now = 1_000 + 40_000;
		expect(budget.remainingFraction()).toBeCloseTo(0.6);
		budget.addExcludedWaitMs(10_000);
		expect(budget.remainingFraction()).toBeCloseTo(0.7);
	});

	it("clamps bash timeouts below the save reserve", () => {
		let now = 0;
		const budget = new RemainingBudget({ budgetMs: 100_000, now: () => now, startedAt: 0 });
		// At t=0, available = 100s - 10s reserve = 90s
		const early = budget.clampBashTimeoutSec(300);
		expect(early.timeoutSec).toBe(90);
		expect(early.clamped).toBe(true);
		expect(early.policy).toBe("soft");

		now = 80_000; // 20s left, reserve 10s => available 10s
		const mid = budget.clampBashTimeoutSec(300);
		expect(mid.timeoutSec).toBe(10);
		expect(mid.policy).toBe("soft");

		now = 95_000; // 5% left => hard
		expect(budget.remainingFraction()).toBeLessThanOrEqual(REMAINING_BUDGET_HARD_KILL_FRACTION);
		const late = budget.clampBashTimeoutSec(300);
		expect(late.timeoutSec).toBe(1);
		expect(late.policy).toBe("hard");
	});

	it("does not raise a short requested timeout", () => {
		const budget = new RemainingBudget({ budgetMs: 100_000, now: () => 0, startedAt: 0 });
		const result = budget.clampBashTimeoutSec(30);
		expect(result.timeoutSec).toBe(30);
		expect(result.clamped).toBe(false);
	});

	it("keeps save reserve at 10% of the total budget", () => {
		const budget = new RemainingBudget({ budgetMs: 1_000_000, now: () => 0, startedAt: 0 });
		expect(budget.reserveMs()).toBe(1_000_000 * REMAINING_BUDGET_SAVE_RESERVE_FRACTION);
	});
});

describe("active RemainingBudget binding", () => {
	it("lazily binds from OMK_TIME_BUDGET_SEC", () => {
		expect(getActiveRemainingBudget()).toBeUndefined();
		const budget = ensureActiveRemainingBudget({
			env: { OMK_TIME_BUDGET_SEC: "60" },
			now: () => 5_000,
		});
		expect(budget?.budgetMs).toBe(60_000);
		expect(getActiveRemainingBudget()).toBe(budget);
	});

	it("createEnvRemainingBudgetFraction prefers the active clock", () => {
		let now = 0;
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: 100_000, now: () => now, startedAt: 0 }));
		const remaining = createEnvRemainingBudgetFraction();
		expect(remaining()).toBeCloseTo(1);
		now = 50_000;
		expect(remaining()).toBeCloseTo(0.5);
	});

	it("follows an active clock bound after the fraction helper is created", () => {
		let now = 0;
		const remaining = createEnvRemainingBudgetFraction();
		expect(remaining()).toBeUndefined();
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: 100_000, now: () => now, startedAt: 0 }));
		expect(remaining()).toBeCloseTo(1);
		now = 75_000;
		expect(remaining()).toBeCloseTo(0.25);
	});

	it("createEnvRemainingBudgetFraction can still take an explicit env clock", () => {
		let now = 1_000;
		const remaining = createEnvRemainingBudgetFraction({
			env: { OMK_TIME_BUDGET_SEC: "100" },
			now: () => now,
			startedAt: 1_000,
		});
		expect(remaining()).toBeCloseTo(1);
		now = 1_000 + 80_000;
		expect(remaining()).toBeCloseTo(0.2);
		expect(createEnvRemainingBudgetFraction({ env: {} })()).toBeUndefined();
	});

	it("createRemainingBudgetFromEnv returns undefined without the env", () => {
		expect(createRemainingBudgetFromEnv({ env: {} })).toBeUndefined();
	});
});
