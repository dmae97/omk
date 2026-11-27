import { describe, expect, it } from "vitest";
import { evaluateFinalRequestBudget } from "../src/core/final-request-budget.ts";
import { createLiveChildResourceGuard } from "../src/core/live-child-resource-guard.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

describe("P0-05: live child resource guard retains permits and enforces memory/cancel caps", () => {
	it("retains permit while a live child is unsettled and releases only after settlement resolves", async () => {
		const pool = new WorkloadPermitPool({ capacity: 1 });
		const guard = createLiveChildResourceGuard({ permitPool: pool, maxRssBytes: 1024 * 1024 * 1024 });

		let resolveChild!: () => void;
		const childSettlement = new Promise<void>((r) => {
			resolveChild = r;
		});

		const outcome = await guard.runTracked({
			requestId: "child-1",
			promptRunId: "run-1",
			currentRssBytes: 256 * 1024 * 1024,
			execute: async () => ({ status: "unsettled", settlement: childSettlement }),
		});

		expect(outcome.status).toBe("unsettled");
		// Permit MUST still be held because child is alive!
		expect(pool.snapshot().activeWeight).toBe(1);
		expect(guard.liveUnsettledCount()).toBe(1);

		// A competing child must not bypass the held permit.
		await expect(
			guard.runTracked({
				requestId: "child-2",
				promptRunId: "run-1",
				currentRssBytes: 256 * 1024 * 1024,
				timeoutMs: 25,
				execute: async () => ({ status: "completed" }),
			}),
		).resolves.toMatchObject({ status: "permit_denied" });

		// Once settlement resolves, permit is released cleanly.
		resolveChild();
		await childSettlement;
		await new Promise((r) => setTimeout(r, 10));
		expect(pool.snapshot().activeWeight).toBe(0);
		expect(guard.liveUnsettledCount()).toBe(0);
	});

	it("rejects launch when current RSS already exceeds declared memory budget", async () => {
		const pool = new WorkloadPermitPool({ capacity: 2 });
		const guard = createLiveChildResourceGuard({ permitPool: pool, maxRssBytes: 512 * 1024 * 1024 });

		const outcome = await guard.runTracked({
			requestId: "child-oom",
			promptRunId: "run-1",
			currentRssBytes: 700 * 1024 * 1024,
			execute: async () => ({ status: "completed" }),
		});
		expect(outcome).toEqual({ status: "memory_budget_exceeded", reason: "rss_exceeds_max" });
		expect(pool.snapshot().activeWeight).toBe(0);
	});
});

describe("P0-06: final provider request context budget includes tools, wrapper overhead, and verification headroom", () => {
	it("rejects a request that fits raw messages but overflows once tool schemas, wrappers, and verification reserve are counted", () => {
		const decision = evaluateFinalRequestBudget({
			contextWindow: 100_000,
			systemTokens: 8_000,
			messageTokens: 70_000,
			messageCount: 40,
			toolSchemaTokens: 12_000,
			toolCount: 25,
			imageTokens: 0,
			completionReserveTokens: 8_000,
			verificationReserveTokens: 6_000,
		});

		expect(decision.fits).toBe(false);
		expect(decision.wrapperOverheadTokens).toBeGreaterThan(0);
		expect(decision.totalRequiredTokens).toBeGreaterThan(100_000);
		expect(decision.overflowTokens).toBeGreaterThan(0);
		expect(decision.verificationReserveProtected).toBe(false);
	});

	it("admits a request when all final provider payload components plus completion and verification reserves fit", () => {
		const decision = evaluateFinalRequestBudget({
			contextWindow: 200_000,
			systemTokens: 8_000,
			messageTokens: 70_000,
			messageCount: 40,
			toolSchemaTokens: 12_000,
			toolCount: 25,
			imageTokens: 1_000,
			completionReserveTokens: 8_000,
			verificationReserveTokens: 6_000,
		});

		expect(decision.fits).toBe(true);
		expect(decision.overflowTokens).toBe(0);
		expect(decision.verificationReserveProtected).toBe(true);
		expect(decision.remainingHeadroomTokens).toBeGreaterThan(0);
	});
});
