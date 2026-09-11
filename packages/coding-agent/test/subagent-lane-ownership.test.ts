import { describe, expect, it } from "vitest";
import type { ResourceAdmissionDecision } from "../src/core/resource-admission.ts";
import { computeEffectiveLaneWidth, launchSubagentLanes } from "../src/core/subagent-lane-launcher.ts";
import { buildSubagentOrchestrationPlan } from "../src/core/subagent-orchestration.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const plan = buildSubagentOrchestrationPlan({
	runId: "run",
	lanes: [{ id: "child", role: "security", task: "inspect" }],
	inventory: { tools: [], skills: [], mcp: [], hooks: [] },
});
const decision: ResourceAdmissionDecision = {
	schemaVersion: 1,
	decisionId: "decision",
	snapshotDigest: "digest",
	pressure: "normal",
	action: "allow",
	maxToolConcurrency: 2,
	maxParallelLanes: 2,
	maxHeavyProcesses: 2,
	reasons: [],
	decidedAt: "2026-09-10T00:00:00.000Z",
};
const heavyLaneIds = new Set(["child"]);

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("subagent launch ownership", () => {
	it("respects the run's heavy-process ceiling even when the shared pool is larger", async () => {
		const lanes = ["a", "b"].map((id) => ({ id, role: "security" as const, task: `inspect ${id}` }));
		const result = await launchSubagentLanes({
			plan: buildSubagentOrchestrationPlan({
				runId: "run",
				lanes,
				inventory: { tools: [], skills: [], mcp: [], hooks: [] },
				spawnThreshold: 16,
			}),
			promptRunId: "run",
			decision: { ...decision, maxHeavyProcesses: 1 },
			permitPool: new WorkloadPermitPool({ capacity: 4 }),
			heavyLaneIds: new Set(["a", "b"]),
			launchLane: async () => {
				await Promise.resolve();
			},
		});
		expect(result.maxObservedConcurrency).toBe(1);
		expect(result.outcomes.every((outcome) => outcome.status === "completed")).toBe(true);
	});
	it.each(["planWidth", "admissionMaxParallelLanes", "availableHeavyPermits", "pathConflictFreeWidth"] as const)(
		"preserves zero authority in %s",
		(term) => {
			expect(
				computeEffectiveLaneWidth({
					planWidth: 2,
					admissionMaxParallelLanes: 2,
					availableHeavyPermits: 2,
					pathConflictFreeWidth: 2,
					[term]: 0,
				}),
			).toBe(0);
		},
	);

	it("starts no child when admission grants zero lanes", async () => {
		const started: string[] = [];
		const result = await launchSubagentLanes({
			plan,
			promptRunId: "run",
			decision: { ...decision, maxParallelLanes: 0 },
			permitPool: new WorkloadPermitPool(),
			launchLane: async ({ laneId }) => {
				started.push(laneId);
			},
		});
		expect(started).toEqual([]);
		expect(result.outcomes).toEqual([{ laneId: "child", status: "admission-deferred" }]);
	});

	it("rechecks cancellation after acquiring a permit and before dispatch", async () => {
		const controller = new AbortController();
		const pool = new WorkloadPermitPool();
		const started: string[] = [];
		const pending = launchSubagentLanes({
			plan,
			promptRunId: "run",
			decision,
			permitPool: pool,
			heavyLaneIds,
			signal: controller.signal,
			launchLane: async ({ laneId }) => {
				started.push(laneId);
			},
		});
		controller.abort();
		const result = await pending;
		expect(started).toEqual([]);
		expect(result.outcomes).toEqual([{ laneId: "child", status: "skipped-abort" }]);
		expect(pool.snapshot().activeWeight).toBe(0);
	});

	it("forwards cancellation but keeps the permit until the actual callback ends", async () => {
		const controller = new AbortController();
		const pool = new WorkloadPermitPool();
		const entered = deferred();
		const finish = deferred();
		let observedSignal: AbortSignal | undefined;
		let returned = false;
		const pending = launchSubagentLanes({
			plan,
			promptRunId: "run",
			decision,
			permitPool: pool,
			heavyLaneIds,
			signal: controller.signal,
			launchLane: async (context) => {
				observedSignal = context.signal;
				entered.resolve();
				await finish.promise;
			},
		}).then((result) => {
			returned = true;
			return result;
		});
		await entered.promise;
		controller.abort();
		const heldWeight = pool.snapshot().activeWeight;
		const returnedBeforeTermination = returned;
		finish.resolve();
		const result = await pending;
		expect(observedSignal).toBe(controller.signal);
		expect(heldWeight).toBe(1);
		expect(returnedBeforeTermination).toBe(false);
		expect(result.outcomes[0]?.status).toBe("cancelled");
		expect(pool.snapshot().activeWeight).toBe(0);
	});

	it("defers heavy work at critical pressure without blocking a read-only child", async () => {
		const started: string[] = [];
		const input = {
			plan,
			promptRunId: "run",
			decision: { ...decision, action: "defer-heavy" as const },
			permitPool: new WorkloadPermitPool(),
			launchLane: async ({ laneId }: { laneId: string }) => {
				started.push(laneId);
			},
		};
		const blocked = await launchSubagentLanes({ ...input, heavyLaneIds });
		expect(started).toEqual([]);
		expect(blocked.outcomes[0]?.status).toBe("admission-deferred");
		await launchSubagentLanes(input);
		expect(started).toEqual(["child"]);
	});
});
