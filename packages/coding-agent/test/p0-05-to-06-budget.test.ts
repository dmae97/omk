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

	it("enforces evaluateFinalRequestBudget at the live provider dispatch boundary (wrapBudgetStream) including wrapper overhead and verification reserve", async () => {
		const { createRequestAdmissionGuard } = await import("../src/core/request-context-admission.ts");
		const { wrapBudgetStream } = await import("../src/core/budget-stream.ts");
		const { RunBudget } = await import("../src/core/run-budget.ts");
		const { RequestInputAdmissionError } = await import("../src/core/request-admission-policy.ts");

		let providerCalled = false;
		const source = (() => {
			providerCalled = true;
			throw new Error("provider must not be dispatched when final request budget overflows");
		}) as never;

		// Raw tokens fit inside contextWindow (1000) - completion (100) - safety (0) = 900,
		// but 20 tools * 24 wrapper + 128 envelope = 608 wrapper overhead + 200 verification reserve overflows!
		const { createFallbackTokenCounter } = await import("../src/core/context-budget-token-counter.ts");
		const guard = createRequestAdmissionGuard(
			{ mode: "enforce", safetyRatio: 0, verificationReserveTokens: 200 },
			createFallbackTokenCounter(),
		);
		const budget = new RunBudget(undefined, () => {});
		const wrapped = wrapBudgetStream(source, budget, guard);

		const model = {
			id: "test-model",
			provider: "openai",
			api: "openai-responses",
			contextWindow: 1000,
			maxTokens: 100,
		} as never;
		const tools = Array.from({ length: 20 }, (_, i) => ({
			name: `t${i}`,
			description: "d",
			parameters: {},
		}));
		const context = {
			systemPrompt: "sys",
			messages: [{ role: "user", content: "x".repeat(800), timestamp: 1 }],
			tools,
		} as never;

		await expect(wrapped(model, context, { maxTokens: 100 })).rejects.toBeInstanceOf(RequestInputAdmissionError);
		expect(providerCalled).toBe(false);
		const snap = guard.snapshot();
		expect(snap.denied).toBe(1);
		expect(snap.last?.wrapperOverheadTokens).toBeGreaterThan(0);
		expect(snap.last?.verificationReserveTokens).toBe(200);
	});

	it("wires MultiSessionResourceLedger into SessionRunBudget execute/stream-completion/close and enforces fleet limits", async () => {
		const { mkdtempSync, rmSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { MultiSessionResourceLedger } = await import("../src/core/multi-session-resource-ledger.ts");
		const { SessionRunBudget } = await import("../src/core/session-run-budget.ts");

		const fleetDir = mkdtempSync(join(tmpdir(), "omk-p03-fleet-"));
		const prevDir = process.env.OMK_FLEET_LEDGER_DIR;
		const prevTokens = process.env.OMK_FLEET_MAX_TOKENS;
		process.env.OMK_FLEET_LEDGER_DIR = fleetDir;
		process.env.OMK_FLEET_MAX_TOKENS = "1000";
		try {
			const ledger = new MultiSessionResourceLedger(fleetDir);
			// Session 1 runs through SessionRunBudget and consumes 950 tokens
			const fakeAgent1 = {
				state: { isStreaming: false },
				streamFn: async () => ({
					result: async () => ({
						role: "assistant",
						usage: { input: 600, output: 350, cacheRead: 0, cacheWrite: 0, totalTokens: 950, cost: { total: 0 } },
					}),
				}),
			} as never;
			const run1 = new SessionRunBudget(fakeAgent1, {
				sessionId: () => "sess-alpha",
				assertIdle: () => {},
				stop: () => {},
				reject: () => {},
			});
			await run1.execute(undefined, async () => {
				const stream = await (
					fakeAgent1 as { streamFn: (...args: unknown[]) => Promise<{ result: () => Promise<unknown> }> }
				).streamFn(
					{ id: "m", provider: "openai", contextWindow: 100_000, maxTokens: 4000 },
					{ systemPrompt: "", messages: [], tools: [] },
					{},
				);
				await stream.result();
			});
			await new Promise((r) => setTimeout(r, 20));
			const snapAfterRun1 = ledger.snapshot();
			expect(snapAfterRun1.activeSessions).toBe(1);
			expect(snapAfterRun1.totalTokensUsed).toBe(950);

			// Session 2 tries to run when fleet token budget (1000) is already consumed by peer (950 + peer bump to 1000)
			ledger.heartbeat({
				sessionId: "sess-alpha",
				pid: process.pid,
				rssBytes: 64 * 1024 * 1024,
				cpuSlots: 1,
				tokensUsed: 1000,
				updatedAtMs: Date.now(),
			});
			const fakeAgent2 = {
				state: { isStreaming: false },
				streamFn: async () => {
					throw new Error("should not dispatch");
				},
			} as never;
			const run2 = new SessionRunBudget(fakeAgent2, {
				sessionId: () => "sess-beta",
				assertIdle: () => {},
				stop: () => {},
				reject: () => {},
			});
			await expect(run2.execute(undefined, async () => {})).rejects.toThrow(/fleet|budget/i);

			// Closing Session 1 releases its lease from the fleet ledger
			run1.close();
			expect(ledger.snapshot().activeSessions).toBe(0);
		} finally {
			if (prevDir === undefined) delete process.env.OMK_FLEET_LEDGER_DIR;
			else process.env.OMK_FLEET_LEDGER_DIR = prevDir;
			if (prevTokens === undefined) delete process.env.OMK_FLEET_MAX_TOKENS;
			else process.env.OMK_FLEET_MAX_TOKENS = prevTokens;
			rmSync(fleetDir, { recursive: true, force: true });
		}
	});
});
