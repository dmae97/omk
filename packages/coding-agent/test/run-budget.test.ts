import { Agent, type StreamFn } from "omk-agent-core";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	isBuiltinStreamFn,
	registerFauxProvider,
	streamSimple,
} from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunBudget } from "../src/core/run-budget.ts";
import { RunBudgetPolicyError, snapshotRunBudgetLimits } from "../src/core/run-budget-policy.ts";
import { SessionRunBudget, wrapBudgetStream } from "../src/core/session-run-budget.ts";

afterEach(() => vi.useRealTimers());

describe("run budget policy and reservations", () => {
	it("does not let an unbounded prompt borrow another prompt's active budget", async () => {
		const runtime = new SessionRunBudget(new Agent(), { assertIdle: () => {}, stop: () => {}, reject: () => {} });
		let finish = () => {};
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const first = runtime.execute({ maxRequests: 1 }, () => gate);
		const competing = vi.fn(async () => {});
		try {
			await expect(runtime.execute(undefined, competing)).rejects.toThrow(/already processing/i);
			expect(competing).not.toHaveBeenCalled();
		} finally {
			finish();
			await first;
		}
	});
	it.each([
		null,
		[],
		{},
		{ unknown: 1 },
		{ maxRequests: -1 },
		{ maxRequests: 0.5 },
		{ maxRequests: NaN },
		{ maxRequests: Infinity },
		{ timeoutMs: 2147483648 },
		{ maxRequests: undefined },
	])("rejects malformed limits: %j", (value) => {
		expect(() => snapshotRunBudgetLimits(value)).toThrow(RunBudgetPolicyError);
	});

	it("rejects accessors and inherited limits without evaluating them", () => {
		const getter = vi.fn(() => 10);
		expect(() => snapshotRunBudgetLimits(Object.defineProperty({}, "maxRequests", { get: getter }))).toThrow(
			RunBudgetPolicyError,
		);
		expect(() => snapshotRunBudgetLimits(Object.create({ maxRequests: 10 }))).toThrow(RunBudgetPolicyError);
		expect(getter).not.toHaveBeenCalled();
	});

	it("reserves synchronously and never refunds issued requests on release", () => {
		const stop = vi.fn();
		const budget = new RunBudget({ maxRequests: 2, maxConcurrentRequests: 2 }, stop);
		const first = budget.admit();
		const second = budget.admit();
		first();
		first();
		expect(budget.snapshot()).toMatchObject({ requestsStarted: 2, activeRequests: 1 });
		expect(() => budget.admit()).toThrow("requests");
		expect(stop).toHaveBeenCalledTimes(1);
		expect(budget.snapshot().activeRequests).toBe(1);
		second();
		budget.close();
	});

	it("uses one monotonic deadline despite wall-clock changes", async () => {
		vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout", "Date"] });
		const stop = vi.fn();
		const budget = new RunBudget({ timeoutMs: 100 }, stop);
		await vi.advanceTimersByTimeAsync(40);
		vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
		expect(budget.remainingMs).toBe(60);
		await vi.advanceTimersByTimeAsync(60);
		expect(budget.failure?.code).toBe("deadline");
		expect(budget.signal.aborted).toBe(true);
		expect(stop).toHaveBeenCalledTimes(1);
		budget.close();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps a stream reservation until terminal metadata and blocks concurrent dispatch", async () => {
		const faux = registerFauxProvider();
		const budget = new RunBudget({ maxConcurrentRequests: 1 }, () => {});
		const stream = createAssistantMessageEventStream();
		let starts = 0;
		const source: StreamFn = () => {
			starts += 1;
			return stream;
		};
		const wrapped = wrapBudgetStream(source, budget);
		try {
			await wrapped(faux.getModel(), { messages: [] });
			expect(budget.snapshot().activeRequests).toBe(1);
			await expect(wrapped(faux.getModel(), { messages: [] })).rejects.toMatchObject({ code: "concurrency" });
			expect(starts).toBe(1);
			budget.close();
			expect(budget.snapshot().activeRequests).toBe(1);
			stream.end(fauxAssistantMessage("done"));
			await stream.result();
			expect(budget.snapshot().activeRequests).toBe(0);
		} finally {
			budget.close();
			faux.unregister();
		}
	});

	it("rejects captured old stream wrappers and retains builtin credential branding", async () => {
		const faux = registerFauxProvider();
		const stop = vi.fn();
		const budget = new RunBudget({ maxRequests: 1 }, stop);
		const wrapped = wrapBudgetStream(streamSimple, budget);
		try {
			expect(isBuiltinStreamFn(wrapped)).toBe(true);
			budget.close();
			await expect(wrapped(faux.getModel(), { messages: [] })).rejects.toMatchObject({ code: "closed" });
			expect(stop).not.toHaveBeenCalled();
			expect(budget.snapshot().requestsStarted).toBe(0);
		} finally {
			budget.close();
			faux.unregister();
		}
	});
});
