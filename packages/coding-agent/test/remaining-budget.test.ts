import { afterEach, describe, expect, it } from "vitest";
import {
	bindActiveRemainingBudget,
	createRemainingBudgetFromEnv,
	excludeRunBudgetWaitMs,
	getActiveRemainingBudget,
	REMAINING_BUDGET_HARD_KILL_FRACTION,
	REMAINING_BUDGET_SAVE_RESERVE_FRACTION,
	RemainingBudget,
	readRunBudget,
	resolveBashTimeoutForBudget,
	resolveTimeBudgetMs,
	startRunBudgetClock,
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

		now = 80_000; // 20s left, reserve 10s => available 10s, save floor min(30, 20-5) = 15s
		const mid = budget.clampBashTimeoutSec(300);
		expect(mid.timeoutSec).toBe(15);
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
	it("startRunBudgetClock binds once per process from the process time origin", () => {
		expect(getActiveRemainingBudget()).toBeUndefined();
		const budget = startRunBudgetClock({ env: { OMK_TIME_BUDGET_SEC: "60" }, now: () => 5_000 });
		expect(budget?.budgetMs).toBe(60_000);
		expect(getActiveRemainingBudget()).toBe(budget);
		// Origin is process start (0 on the performance timeline), not the call time.
		expect(budget?.elapsedMs()).toBe(5_000);
		expect(startRunBudgetClock({ env: { OMK_TIME_BUDGET_SEC: "999" } })).toBe(budget);
	});

	it("startRunBudgetClock binds nothing without OMK_TIME_BUDGET_SEC", () => {
		expect(startRunBudgetClock({ env: {} })).toBeUndefined();
		expect(getActiveRemainingBudget()).toBeUndefined();
		expect(readRunBudget()).toBeUndefined();
	});

	it("defaults to the monotonic performance.now() clock", () => {
		const budget = new RemainingBudget({ budgetMs: 1_000_000 });
		const before = performance.now();
		const elapsed = budget.elapsedMs();
		expect(elapsed).toBeGreaterThanOrEqual(0);
		expect(elapsed).toBeLessThanOrEqual(performance.now() - before + 50);
		const origin = new RemainingBudget({ budgetMs: 1_000_000, startedAt: 0 });
		expect(origin.elapsedMs()).toBeGreaterThanOrEqual(before);
		expect(origin.elapsedMs()).toBeLessThan(Date.now()); // not epoch-based
	});

	it("readRunBudget reports the shared origin and excludeRunBudgetWaitMs shifts it", () => {
		let now = 30_000;
		startRunBudgetClock({ env: { OMK_TIME_BUDGET_SEC: "100" }, now: () => now });
		expect(readRunBudget()).toEqual({
			budgetMs: 100_000,
			elapsedMs: 30_000,
			remainingMs: 70_000,
			elapsedFraction: 0.3,
			remainingFraction: 0.7,
		});
		excludeRunBudgetWaitMs(10_000);
		now = 50_000;
		expect(readRunBudget()?.elapsedFraction).toBeCloseTo(0.4);
	});

	it("save floor: a command inside the reserve still gets up to 30s, never past the end", () => {
		let now = 0;
		const budget = new RemainingBudget({ budgetMs: 1_000_000, now: () => now, startedAt: 0 });
		const at = (remainingSec: number) => {
			now = 1_000_000 - remainingSec * 1000;
			return budget.clampBashTimeoutSec(300);
		};
		expect(at(5)).toMatchObject({ timeoutSec: 1, policy: "hard" });
		expect(at(20)).toMatchObject({ timeoutSec: 15, policy: "hard" });
		expect(at(40)).toMatchObject({ timeoutSec: 30, policy: "hard" });
		expect(at(95)).toMatchObject({ timeoutSec: 30, policy: "hard" });
		expect(at(140)).toMatchObject({ timeoutSec: 40, policy: "soft" });
		expect(at(20).timeoutSec).toBeLessThanOrEqual(20 - 5);
	});

	it("resolveBashTimeoutForBudget passes the timeout through without a budget", () => {
		expect(resolveBashTimeoutForBudget(undefined, undefined)).toEqual({
			effectiveTimeoutSec: undefined,
			clamp: undefined,
		});
		expect(resolveBashTimeoutForBudget(1800, undefined).effectiveTimeoutSec).toBe(1800);
		const budget = new RemainingBudget({ budgetMs: 100_000, now: () => 0, startedAt: 0 });
		expect(resolveBashTimeoutForBudget(undefined, budget)).toMatchObject({
			effectiveTimeoutSec: 90,
			clamp: { clamped: true },
		});
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
