/**
 * Spec 106 C1 — settled-failure scope (OMK_LANE_FAILURE_SCOPE=1).
 * DG1 (independent branch continues, overall not complete), DG3 (join waits
 * on every parent), DG4 (writer failure keeps the legacy global block), plus
 * flag-off equivalence with the legacy batch blocker.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityInventory, NamedResource } from "../src/core/loadouts.ts";
import type { ResourceAdmissionDecision } from "../src/core/resource-admission.ts";
import { launchSubagentLanes, type SubagentLaneContext } from "../src/core/subagent-lane-launcher.ts";
import { buildSubagentOrchestrationPlan, type SubagentLaneSpec } from "../src/core/subagent-orchestration.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const resource = (kind: NamedResource["kind"], name: string): NamedResource => ({ kind, name });
const inventoryWith = (tools: readonly string[]): CapabilityInventory => ({
	tools: tools.map((name) => resource("tool", name)),
	skills: ["coding-standards", "debugging", "testing-guide"].map((name) => resource("skill", name)),
	mcp: [],
	hooks: [],
});
/** Read-only tools: lanes built from this inventory are non-writing. */
const readOnlyInventory = inventoryWith(["read", "grep", "find", "ls", "report_finding"]);
const decision: ResourceAdmissionDecision = {
	schemaVersion: 1,
	decisionId: "res-adm-isolation",
	snapshotDigest: "digest",
	pressure: "normal",
	action: "allow",
	maxToolConcurrency: 4,
	maxParallelLanes: 2,
	maxHeavyProcesses: 2,
	reasons: [],
	decidedAt: "2026-10-22T00:00:00.000Z",
};

async function run(lanes: SubagentLaneSpec[], fail: ReadonlySet<string>, tools = readOnlyInventory) {
	const plan = buildSubagentOrchestrationPlan({
		runId: "iso",
		lanes,
		inventory: tools,
		spawnThreshold: 16,
		maxParallelLanes: 2,
	});
	expect(plan.blockers).toEqual([]);
	const started: string[] = [];
	const result = await launchSubagentLanes({
		plan,
		promptRunId: "iso",
		decision,
		permitPool: new WorkloadPermitPool({ capacity: 2 }),
		launchLane: async ({ laneId }: SubagentLaneContext) => {
			started.push(laneId);
			if (fail.has(laneId)) return { status: "failed" as const };
		},
	});
	const status = Object.fromEntries(result.outcomes.map((outcome) => [outcome.laneId, outcome.status]));
	return { status, started, complete: result.allLanesCompleted };
}

const twoBranches: SubagentLaneSpec[] = [
	{ id: "A", role: "security", task: "A" },
	{ id: "B", role: "security", task: "B", dependsOn: ["A"] },
	{ id: "C", role: "security", task: "C" },
	{ id: "D", role: "security", task: "D", dependsOn: ["C"] },
];

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("lane failure isolation — flag off (legacy)", () => {
	it("A fails ⇒ B and D both blocked (unchanged behavior)", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "0");
		const { status, complete } = await run(twoBranches, new Set(["A"]));
		expect(status).toEqual({ A: "failed", B: "blocked-dependency", C: "completed", D: "blocked-dependency" });
		expect(complete).toBe(false);
	});
});

describe("lane failure isolation — flag on", () => {
	it("DG1: A fails ⇒ B blocked, C and D run, overall NOT complete", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const { status, started, complete } = await run(twoBranches, new Set(["A"]));
		expect(status).toEqual({ A: "failed", B: "blocked-dependency", C: "completed", D: "completed" });
		expect(started).not.toContain("B");
		expect(complete).toBe(false);
	});

	it("DG1 transitive: A→B→E chain is blocked past the failure", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const lanes = [...twoBranches, { id: "E", role: "security" as const, task: "E", dependsOn: ["B"] }];
		const { status, complete } = await run(lanes, new Set(["A"]));
		expect(status.E).toBe("blocked-dependency");
		expect(status.D).toBe("completed");
		expect(complete).toBe(false);
	});

	it("DG3: join with two parents stays unstarted when one parent failed", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const lanes: SubagentLaneSpec[] = [
			{ id: "A", role: "security", task: "A" },
			{ id: "C", role: "security", task: "C" },
			{ id: "J", role: "security", task: "J", dependsOn: ["A", "C"] },
		];
		const { status, started, complete } = await run(lanes, new Set(["C"]));
		expect(status).toEqual({ A: "completed", C: "failed", J: "blocked-dependency" });
		expect(started).not.toContain("J");
		expect(complete).toBe(false);
	});

	it("DG4: a failed writer keeps the legacy global block", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const lanes: SubagentLaneSpec[] = [
			{ id: "W", role: "executor", task: "write", writeScope: ["src/a.ts"] },
			{ id: "C", role: "security", task: "C" },
			{ id: "D", role: "security", task: "D", dependsOn: ["C"] },
		];
		const { status, started } = await run(lanes, new Set(["W"]));
		expect(status.W).toBe("failed");
		expect(status.D).toBe("blocked-dependency");
		expect(started).not.toContain("D");
	});

	it("write-capable tool (bash) with empty writeSet is a writer: its failure blocks the next batch", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const { status, started, complete } = await run(
			twoBranches,
			new Set(["A"]),
			inventoryWith(["read", "grep", "bash"]),
		);
		expect(status).toEqual({ A: "failed", B: "blocked-dependency", C: "completed", D: "blocked-dependency" });
		expect(started).not.toContain("D");
		expect(complete).toBe(false);
	});

	it("unsettled lane keeps the global block and its permit until settlement", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const plan = buildSubagentOrchestrationPlan({
			runId: "iso",
			lanes: twoBranches,
			inventory: readOnlyInventory,
			spawnThreshold: 16,
			maxParallelLanes: 2,
		});
		const pool = new WorkloadPermitPool({ capacity: 2 });
		let settle: () => void = () => {};
		const settlement = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const result = await launchSubagentLanes({
			plan,
			promptRunId: "iso",
			decision,
			permitPool: pool,
			heavyLaneIds: new Set(["A"]),
			launchLane: async ({ laneId }: SubagentLaneContext) =>
				laneId === "A" ? { status: "unsettled" as const, settlement } : undefined,
		});
		const status = Object.fromEntries(result.outcomes.map((outcome) => [outcome.laneId, outcome.status]));
		expect(status).toEqual({ A: "unsettled", B: "blocked-dependency", C: "completed", D: "blocked-dependency" });
		expect(pool.snapshot().activeWeight).toBe(1);
		settle();
		await settlement;
		await new Promise((resolve) => setImmediate(resolve));
		expect(pool.snapshot().activeWeight).toBe(0);
	});

	it("all lanes completed ⇒ complete", async () => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const { complete } = await run(twoBranches, new Set());
		expect(complete).toBe(true);
	});
});

describe("OMK_LANE_FAILURE_SCOPE default", () => {
	it("is on when unset; 0/false/off opt out", async () => {
		const { laneFailureScopeEnabled } = await import("../src/core/subagent-lane-failure-scope.ts");
		expect(laneFailureScopeEnabled({})).toBe(true);
		for (const v of ["0", "false", "OFF"]) expect(laneFailureScopeEnabled({ OMK_LANE_FAILURE_SCOPE: v })).toBe(false);
	});
});
