import { expect, it, vi } from "vitest";
import { RunUsageLedger } from "../src/core/run-usage-ledger.ts";
import { runUsageOperation } from "../src/core/run-usage-operation.ts";

it("settles the admitted attempt even if the caller changes its input", async () => {
	const ledger = new RunUsageLedger();
	ledger.reserve("other", "other-request");
	const input = { attemptId: "original", requestId: "request", reservation: {} };
	await runUsageOperation(ledger, input, async () => {
		input.attemptId = "other";
	});

	expect(() => ledger.recordTransport("late-original", "original")).toThrow("budget.closed");
	expect(() => ledger.recordTransport("still-other", "other")).not.toThrow();
	expect(ledger.snapshot().ownedAttempts).toBe(1);
});

it("preserves the operation error when caller input changes during failure", async () => {
	const ledger = new RunUsageLedger();
	const input = { attemptId: "original", requestId: "request", reservation: {} };
	const failure = new Error("operation failed");
	await expect(
		runUsageOperation(ledger, input, async () => {
			input.attemptId = "missing";
			throw failure;
		}),
	).rejects.toBe(failure);
	expect(ledger.snapshot()).toMatchObject({ attempts: 1, ownedAttempts: 0 });
});

it("does not invoke or settle an operation denied admission", async () => {
	const ledger = new RunUsageLedger({ inputTokens: 10 });
	ledger.reserve("held", "request", { inputTokens: 9 });
	const before = ledger.snapshot();
	const operation = vi.fn(async () => "should not run");
	await expect(
		runUsageOperation(
			ledger,
			{ attemptId: "denied", requestId: "request", reservation: { inputTokens: 2 } },
			operation,
		),
	).rejects.toThrow("budget.exceeded");
	expect(operation).not.toHaveBeenCalled();
	expect(ledger.snapshot()).toEqual(before);
});

it("retains ownership after cancellation until settlement, then accepts late usage", async () => {
	const ledger = new RunUsageLedger({ inputTokens: 10 });
	const controller = new AbortController();
	let finish!: () => void;
	const pending = runUsageOperation(
		ledger,
		{ attemptId: "original", requestId: "request", reservation: { inputTokens: 8 } },
		() =>
			new Promise<void>((resolve) => {
				controller.signal.addEventListener("abort", () => {
					finish = resolve;
				});
			}),
	);
	controller.abort();
	try {
		expect(ledger.snapshot().ownedAttempts).toBe(1);
		expect(ledger.snapshot().units.inputTokens).toMatchObject({ reserved: 8, total: null });
	} finally {
		finish();
		await pending;
	}
	expect(ledger.snapshot().ownedAttempts).toBe(0);
	expect(() => ledger.reserve("next", "next", { inputTokens: 1 })).toThrow("budget.unknown_usage");
	ledger.recordUsage("late", "original", { inputTokens: 6 });
	ledger.reserve("next", "next", { inputTokens: 4 });
	expect(ledger.snapshot().units.inputTokens).toMatchObject({ accounted: 6, reserved: 4, total: null });
});

it("rejects cross-attempt attribution conflicts without changing the ledger", () => {
	const ledger = new RunUsageLedger();
	ledger.reserve("a", "shared");
	ledger.reserve("b", "shared");
	ledger.recordTransport("transport", "a");
	ledger.settle("a");
	ledger.close();
	ledger.recordUsage("usage", "a", { inputTokens: 3 });
	const before = ledger.snapshot();
	expect(() => ledger.recordTransport("transport", "b")).toThrow("budget.transport_conflict");
	expect(() => ledger.recordUsage("usage", "b", { inputTokens: 3 })).toThrow("budget.usage_conflict");
	expect(ledger.snapshot()).toEqual(before);
	expect(before).toMatchObject({ logicalRequests: 1, attempts: 2, ownedAttempts: 1 });
});
