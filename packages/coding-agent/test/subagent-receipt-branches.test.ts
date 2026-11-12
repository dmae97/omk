/**
 * Receipt consumers depend on the producers whose receipts they read, so independent
 * produce → review branches stay parallel in the ready frontier. Deterministic: lanes settle
 * only through manual deferreds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityInventory, NamedResource } from "../src/core/loadouts.ts";
import type { ResourceAdmissionDecision } from "../src/core/resource-admission.ts";
import { launchSubagentLanes, type SubagentLaneContext } from "../src/core/subagent-lane-launcher.ts";
import { buildSubagentOrchestrationPlan, type SubagentLaneSpec } from "../src/core/subagent-orchestration.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const resource = (kind: NamedResource["kind"], name: string): NamedResource => ({ kind, name });
const inventory: CapabilityInventory = {
	tools: ["read", "grep", "find", "ls", "report_finding", "edit", "write", "bash"].map((name) =>
		resource("tool", name),
	),
	skills: ["coding-standards", "debugging", "testing-guide"].map((name) => resource("skill", name)),
	mcp: [],
	hooks: [],
};
const decision: ResourceAdmissionDecision = {
	schemaVersion: 1,
	decisionId: "res-adm-receipts",
	snapshotDigest: "digest",
	pressure: "normal",
	action: "allow",
	maxToolConcurrency: 4,
	maxParallelLanes: 4,
	maxHeavyProcesses: 2,
	reasons: [],
	decidedAt: "2026-11-12T00:00:00.000Z",
};

/** Two produce → review branches: each critic reads only its own producer's receipt. */
const branches: SubagentLaneSpec[] = [
	{
		id: "PA",
		role: "security",
		task: "audit auth",
		readScope: ["src/auth"],
		evidenceOutput: ".omk/runs/<goal>/auth.md",
	},
	{ id: "PB", role: "security", task: "audit api", readScope: ["src/api"], evidenceOutput: ".omk/runs/<goal>/api.md" },
	{ id: "CA", role: "critic", task: "critique auth audit", readScope: [".omk/runs/rcpt/auth.md"] },
	{ id: "CB", role: "critic", task: "critique api audit", readScope: [".omk/runs/rcpt/api.md"] },
];

const plan = (lanes: readonly SubagentLaneSpec[]) =>
	buildSubagentOrchestrationPlan({ runId: "rcpt", lanes, inventory, spawnThreshold: 16, maxParallelLanes: 4 });
const deps = (built: ReturnType<typeof plan>, id: string) =>
	built.laneGrants.find((grant) => grant.laneId === id)?.dependsOn;

const flush = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

function controlled(lanes: readonly SubagentLaneSpec[]) {
	const built = plan(lanes);
	expect(built.blockers).toEqual([]);
	const started: string[] = [];
	const waiters = new Map<string, (failed?: boolean) => void>();
	const result = launchSubagentLanes({
		plan: built,
		promptRunId: "rcpt",
		decision,
		permitPool: new WorkloadPermitPool({ capacity: 4 }),
		launchLane: ({ laneId }: SubagentLaneContext) => {
			started.push(laneId);
			return new Promise((resolve) => {
				waiters.set(laneId, (failed) => resolve(failed ? { status: "failed" as const } : undefined));
			});
		},
	});
	return {
		started,
		result,
		finish: async (laneId: string, failed = false) => {
			await flush();
			const waiter = waiters.get(laneId);
			if (!waiter) throw new Error(`lane ${laneId} not started`);
			waiter(failed);
			await flush();
		},
	};
}

afterEach(() => vi.unstubAllEnvs());

describe("receipt consumer dependencies", () => {
	it("a consumer depends on the producer whose receipt it reads, not on every producer", () => {
		const built = plan(branches);
		expect(deps(built, "CA")).toEqual(["PA"]);
		expect(deps(built, "CB")).toEqual(["PB"]);
		expect(built.route).toMatchObject({ nodeCount: 4, edgeCount: 2 });
	});

	it("a consumer of the whole run directory still waits for every producer", () => {
		const built = plan([
			...branches.slice(0, 2),
			{ id: "C", role: "critic", task: "final", readScope: [".omk/runs/rcpt"] },
		]);
		expect(deps(built, "C")).toEqual(["PA", "PB"]);
	});

	it("an explicit dependency is kept and a glob read stays conservative", () => {
		const built = plan([
			...branches.slice(0, 2),
			{ id: "C", role: "critic", task: "auth only", readScope: [".omk/runs/rcpt/auth.md"], dependsOn: ["PB"] },
			{ id: "G", role: "critic", task: "all receipts", readScope: [".omk/runs/rcpt/*.md"] },
		]);
		expect(deps(built, "C")).toEqual(["PA", "PB"]);
		expect(deps(built, "G")).toEqual(["PA", "PB"]);
	});

	it("ready frontier: a branch's review starts when its own producer finishes", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const run = controlled(branches);
		await flush();
		expect(run.started.sort()).toEqual(["PA", "PB"]);
		await run.finish("PA");
		// Before this change CA also waited for PB; now it starts while PB is still running.
		expect(run.started).toContain("CA");
		expect(run.started).not.toContain("CB");
		await run.finish("CA");
		await run.finish("PB");
		await run.finish("CB");
		const result = await run.result;
		expect(result.allLanesCompleted).toBe(true);
	});

	it("narrower edges do not weaken the failure scope: a failed write-capable producer still blocks new starts", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const run = controlled(branches);
		// The security loadout grants bash, so its failure may have left workspace changes.
		await run.finish("PA", true);
		await run.finish("PB");
		const result = await run.result;
		const status = Object.fromEntries(result.outcomes.map((outcome) => [outcome.laneId, outcome.status]));
		expect(status).toEqual({ PA: "failed", PB: "completed", CA: "blocked-dependency", CB: "blocked-dependency" });
		expect(run.started.sort()).toEqual(["PA", "PB"]);
		expect(result.allLanesCompleted).toBe(false);
	});

	it("writers sharing a path stay serialized and a cycle is still a blocker", () => {
		const built = plan([
			{ id: "W1", role: "executor", task: "w1", writeScope: ["src/a.ts"], evidenceOutput: ".omk/runs/<goal>/w1.md" },
			{ id: "W2", role: "executor", task: "w2", writeScope: ["src/a.ts"] },
		]);
		expect(built.batches.map((batch) => batch.laneIds)).toEqual([["W1"], ["W2"]]);
		const cyclic = plan([
			{ id: "X", role: "security", task: "x", dependsOn: ["Y"] },
			{ id: "Y", role: "security", task: "y", dependsOn: ["X"] },
		]);
		expect(cyclic.blockers.some((blocker) => blocker.includes("cycle"))).toBe(true);
	});
});
