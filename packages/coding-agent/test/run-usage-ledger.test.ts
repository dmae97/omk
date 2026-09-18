import { expect, it } from "vitest";
import { planBudgetAdmission, RunUsageLedger } from "../src/core/run-usage-ledger.ts";
import { runUsageOperation } from "../src/core/run-usage-operation.ts";

it("denies consumed 6 + reserved 3 + new 2 against cap 10 without changing state", () => {
	const ledger = new RunUsageLedger({ inputTokens: 10 });
	ledger.reserve("a", "request-a", { inputTokens: 6 });
	ledger.settle("a");
	ledger.recordUsage("usage-a", "a", { inputTokens: 6 });
	ledger.reserve("b", "request-b", { inputTokens: 3 });
	const before = ledger.snapshot();
	expect(() => ledger.reserve("c", "request-c", { inputTokens: 2 })).toThrow("budget.exceeded");
	expect(ledger.snapshot()).toEqual(before);
});

it("retains unknown usage and ownership on close, accepts late idempotent usage", () => {
	const ledger = new RunUsageLedger({ inputTokens: 10 });
	ledger.reserve("a", "r", { inputTokens: 8 });
	ledger.close();
	expect(ledger.snapshot().ownedAttempts).toBe(1);
	ledger.settle("a");
	expect(ledger.snapshot().units.inputTokens).toMatchObject({ total: null, reserved: 8 });
	ledger.recordUsage("u", "a", { inputTokens: 6 });
	ledger.recordUsage("u", "a", { inputTokens: 6 });
	expect(ledger.snapshot().units.inputTokens).toMatchObject({ total: 6, reserved: 0 });
	expect(ledger.snapshot().usageEvents).toBe(1);
	expect(() => ledger.recordUsage("u", "a", { inputTokens: 7 })).toThrow("conflict");
	expect(() => ledger.recordUsage("another", "a", { inputTokens: 7 })).toThrow("already_recorded");
});

it("counts retries separately from requests in a local adapter fixture", async () => {
	const ledger = new RunUsageLedger();
	for (const [attemptId, requestId, transports] of [
		["main", "main", 3],
		["continuation", "continuation", 1],
		["summary", "summary", 1],
		["child", "child", 1],
	] as const) {
		await runUsageOperation(ledger, { attemptId, requestId, reservation: {} }, async () => {
			for (let n = 0; n < transports; n++) ledger.recordTransport(`${attemptId}-${n}`, attemptId);
			ledger.recordUsage(`usage-${attemptId}`, attemptId, { inputTokens: 2, outputTokens: 1 });
		});
	}
	expect(ledger.snapshot()).toMatchObject({ logicalRequests: 4, attempts: 4, transportAttempts: 6, ownedAttempts: 0 });
	expect(ledger.snapshot().units.inputTokens.total).toBe(8);
});

it("does not refund failed requests or classify missing transport evidence as a transmission", async () => {
	const ledger = new RunUsageLedger();
	await expect(
		runUsageOperation(ledger, { attemptId: "a", requestId: "r", reservation: {} }, async () => {
			throw new Error("failed");
		}),
	).rejects.toThrow("failed");
	ledger.reserve("retry", "r");
	expect(ledger.snapshot()).toMatchObject({ logicalRequests: 1, attempts: 2, transportAttempts: 0, ownedAttempts: 1 });
	expect(ledger.snapshot().units.inputTokens.total).toBeNull();
});

it("retains reservation while an operation remains pending", async () => {
	const ledger = new RunUsageLedger({ inputTokens: 10 });
	let finish!: () => void;
	const pending = runUsageOperation(
		ledger,
		{ attemptId: "a", requestId: "r", reservation: { inputTokens: 7 } },
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	ledger.recordUsage("u", "a", { inputTokens: 2 });
	expect(ledger.snapshot().units.inputTokens.reserved).toBe(5);
	ledger.close();
	expect(ledger.snapshot().ownedAttempts).toBe(1);
	finish();
	await pending;
	expect(ledger.snapshot().ownedAttempts).toBe(0);
});

it("blocks unknown finalized usage and invalid inputs without mutation", () => {
	const ledger = new RunUsageLedger({ inputTokens: 10 });
	ledger.reserve("a", "r", { inputTokens: 1 });
	ledger.settle("a");
	const before = ledger.snapshot();
	expect(() => ledger.reserve("b", "r", { inputTokens: 1 })).toThrow("unknown_usage");
	for (const inputTokens of [-1, NaN, Infinity]) {
		expect(() => ledger.recordUsage("u", "a", { inputTokens })).toThrow("invalid_amount");
	}
	expect(ledger.snapshot()).toEqual(before);
	expect(() => ledger.recordUsage("u", "missing", {})).toThrow("unknown_attempt");
	expect(() => ledger.reserve("a", "r", {})).toThrow("duplicate_attempt");
});

it("validates finite arithmetic, zero caps, and entry bounds", () => {
	expect(planBudgetAdmission({ settled: 6, reserved: 2, requested: 2, cap: 10 })).toBe(true);
	expect(planBudgetAdmission({ settled: 0, reserved: 0, requested: 1, cap: 0 })).toBe(false);
	expect(() => planBudgetAdmission({ settled: Number.MAX_SAFE_INTEGER, reserved: 1, requested: 1 })).toThrow();
	const ledger = new RunUsageLedger({}, 1);
	ledger.reserve("a", "r");
	ledger.recordTransport("t", "a");
	ledger.recordTransport("t", "a");
	expect(ledger.snapshot().transportAttempts).toBe(1);
	expect(() => ledger.reserve("b", "r")).toThrow("entry_limit");
});
