import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeUnifiedSessionQuota, MultiSessionResourceLedger } from "../src/core/multi-session-resource-ledger.ts";

let leaseDir: string;

beforeEach(() => {
	leaseDir = mkdtempSync(join(tmpdir(), "omk-p1-fleet-"));
});

afterEach(() => {
	rmSync(leaseDir, { recursive: true, force: true });
});

describe("P1-1: MultiSessionResourceLedger & unified RAM/CPU/token quota", () => {
	it("aggregates independent active sessions and prunes dead PIDs and expired leases", () => {
		const ledger = new MultiSessionResourceLedger(leaseDir, { ttlMs: 30_000 });
		ledger.heartbeat({
			sessionId: "sess-a",
			pid: 1001,
			rssBytes: 512 * 1024 * 1024,
			cpuSlots: 2,
			tokensUsed: 15_000,
			updatedAtMs: 100_000,
		});
		ledger.heartbeat({
			sessionId: "sess-b",
			pid: 1002,
			rssBytes: 256 * 1024 * 1024,
			cpuSlots: 1,
			tokensUsed: 5_000,
			updatedAtMs: 105_000,
		});
		ledger.heartbeat({
			sessionId: "sess-dead",
			pid: 9999,
			rssBytes: 1024 * 1024 * 1024,
			cpuSlots: 4,
			tokensUsed: 90_000,
			updatedAtMs: 105_000,
		});
		ledger.heartbeat({
			sessionId: "sess-stale",
			pid: 1003,
			rssBytes: 512 * 1024 * 1024,
			cpuSlots: 2,
			tokensUsed: 40_000,
			updatedAtMs: 50_000,
		});

		const alivePids = new Set([1001, 1002, 1003]);
		const summary = ledger.snapshot(110_000, (pid) => alivePids.has(pid));

		expect(summary.activeSessions).toBe(2);
		expect(summary.prunedStaleSessions).toBe(2);
		expect(summary.totalRssBytes).toBe(768 * 1024 * 1024);
		expect(summary.totalCpuSlots).toBe(3);
		expect(summary.totalTokensUsed).toBe(20_000);
	});

	it("throttles fair-share CPU and token quotas when multiple sessions compete and denies on RAM/token exhaustion", () => {
		const ledger = new MultiSessionResourceLedger(leaseDir, { ttlMs: 60_000 });
		ledger.heartbeat({
			sessionId: "sess-1",
			pid: 2001,
			rssBytes: 1024 * 1024 * 1024,
			cpuSlots: 3,
			tokensUsed: 60_000,
			updatedAtMs: 10_000,
		});
		ledger.heartbeat({
			sessionId: "sess-2",
			pid: 2002,
			rssBytes: 512 * 1024 * 1024,
			cpuSlots: 2,
			tokensUsed: 20_000,
			updatedAtMs: 10_000,
		});
		const summary = ledger.snapshot(15_000, () => true);

		const throttled = computeUnifiedSessionQuota(
			summary,
			{
				maxTotalRssBytes: 2 * 1024 * 1024 * 1024,
				maxTotalCpuSlots: 6,
				maxTotalTokens: 100_000,
			},
			{ sessionId: "sess-3", requestedCpuSlots: 4, requestedTokens: 50_000 },
		);
		expect(throttled.status).toBe("throttle");
		expect(throttled.allocatedCpuSlots).toBe(1);
		expect(throttled.allocatedTokenCap).toBe(20_000);
		expect(throttled.reasons).toContain("fleet.fair_share.throttled");

		const denied = computeUnifiedSessionQuota(
			summary,
			{
				maxTotalRssBytes: 1500 * 1024 * 1024,
				maxTotalCpuSlots: 6,
				maxTotalTokens: 80_000,
			},
			{ sessionId: "sess-3", requestedCpuSlots: 1, requestedTokens: 10_000 },
		);
		expect(denied.status).toBe("deny_budget");
		expect(denied.reasons).toContain("fleet.ram.exceeded");
		expect(denied.reasons).toContain("fleet.tokens.exhausted");
	});

	it("rejects unsafe session IDs containing path traversal characters", () => {
		const ledger = new MultiSessionResourceLedger(leaseDir);
		expect(() =>
			ledger.heartbeat({
				sessionId: "../escape",
				pid: process.pid,
				rssBytes: 1024,
				cpuSlots: 1,
				tokensUsed: 0,
				updatedAtMs: Date.now(),
			}),
		).toThrow(/invalid sessionId/i);
	});
});
