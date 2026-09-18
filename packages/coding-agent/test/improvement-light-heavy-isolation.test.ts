import { describe, expect, it } from "vitest";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

describe("R07 light/heavy isolation through authority", () => {
	it.each([false, true])("runs light lanes with zero heavy capacity (mixed=%s)", async (mixed) => {
		const pool = new WorkloadPermitPool({ capacity: 0 });
		const authority = createSubagentLaneAuthority({
			runId: "r07",
			decision: {
				schemaVersion: 1,
				decisionId: "r07-admission",
				snapshotDigest: "test",
				pressure: "normal",
				action: "allow",
				maxToolConcurrency: 4,
				maxParallelLanes: 2,
				maxHeavyProcesses: 0,
				reasons: [],
				decidedAt: new Date(0).toISOString(),
			},
			permitPool: pool,
			inventory: { tools: [], skills: [], mcp: [], hooks: [] },
			noteDetachedChild: () => () => {},
		});
		const launched: string[] = [];
		const result = await authority.dispatchLanes({
			lanes: (mixed ? ["heavy", "light-a"] : ["light-a", "light-b"]).map((id) => ({
				id,
				role: "executor" as const,
				task: id,
				agentName: "test-agent",
			})),
			configuredMaxParallelLanes: 2,
			heavyLaneIds: new Set(mixed ? ["heavy"] : []),
			launchLane: async ({ laneId }) => {
				launched.push(laneId);
				expect(pool.snapshot().activeWeight).toBe(0);
			},
		});
		expect(result.blockers).toEqual([]);
		expect(launched.sort()).toEqual(mixed ? ["light-a"] : ["light-a", "light-b"]);
		expect(result.effectiveLaneWidth).toBe(2);
		expect(result.maxObservedConcurrency).toBeLessThanOrEqual(2);
		if (mixed) {
			expect(result.outcomes.find(({ laneId }) => laneId === "heavy")?.status).toBe("admission-deferred");
		}
		expect(pool.snapshot()).toEqual({ capacity: 0, activeWeight: 0, queuedCount: 0 });
	});
});
