import { describe, expect, it } from "vitest";
import type { ResourceAdmissionDecision } from "../src/core/resource-admission.ts";
import { launchSubagentLanes } from "../src/core/subagent-lane-launcher.ts";
import { buildSubagentOrchestrationPlan } from "../src/core/subagent-orchestration.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const decision: ResourceAdmissionDecision = {
	schemaVersion: 1,
	decisionId: "test",
	snapshotDigest: "test",
	pressure: "normal",
	action: "allow",
	maxToolConcurrency: 2,
	maxParallelLanes: 2,
	maxHeavyProcesses: 2,
	reasons: [],
	decidedAt: "2026-09-17T00:00:00Z",
};
function plan(dependent = true) {
	return buildSubagentOrchestrationPlan({
		runId: "test",
		spawnThreshold: 16,
		inventory: { tools: [], skills: [], mcp: [], hooks: [] },
		lanes: [
			{ id: "a", role: "security", task: "a" },
			{ id: "b", role: "security", task: "b", dependsOn: dependent ? ["a"] : [] },
		],
	});
}
describe("lane outcome and ownership", () => {
	it("does not dispatch a subsequent batch after semantic failure", async () => {
		const started: string[] = [];
		const result = await launchSubagentLanes({
			plan: plan(),
			promptRunId: "test",
			decision,
			permitPool: new WorkloadPermitPool({ capacity: 2 }),
			launchLane: async ({ laneId }) => {
				started.push(laneId);
				return { status: "failed" };
			},
		});
		expect(started).toEqual(["a"]);
		expect(result.outcomes).toEqual([
			{ laneId: "a", status: "failed" },
			{ laneId: "b", status: "blocked-dependency" },
		]);
	});
	it("holds the heavy permit until a late settlement and blocks following lanes", async () => {
		let finish: () => void = () => {};
		const settlement = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const pool = new WorkloadPermitPool({ capacity: 1 });
		const result = await launchSubagentLanes({
			plan: plan(),
			promptRunId: "test",
			decision,
			permitPool: pool,
			heavyLaneIds: new Set(["a"]),
			launchLane: async () => ({ status: "unsettled", settlement }),
		});
		expect(result.outcomes[0].status).toBe("unsettled");
		expect(result.outcomes[1].status).toBe("blocked-dependency");
		expect(pool.snapshot().activeWeight).toBe(1);
		finish();
		await settlement;
		expect(pool.snapshot().activeWeight).toBe(0);
	});
	it("runs light lanes without heavy capacity", async () => {
		const result = await launchSubagentLanes({
			plan: plan(false),
			promptRunId: "test",
			decision,
			permitPool: new WorkloadPermitPool({ capacity: 0 }),
			heavyLaneIds: new Set([]), // Explicit light-only declaration (spec finding F06).
			launchLane: async () => {},
		});
		expect(result.outcomes.map((o) => o.status)).toEqual(["completed", "completed"]);
	});
});
