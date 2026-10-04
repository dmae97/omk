import { describe, expect, it, vi } from "vitest";
import type { ResourceAdmissionDecision } from "../src/core/resource-admission.ts";
import { launchSubagentLanes, type SubagentLaneContext } from "../src/core/subagent-lane-launcher.ts";
import { buildSubagentOrchestrationPlan } from "../src/core/subagent-orchestration.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";
import { phase3Gate } from "./fixtures/phase3-gate.ts";

function fixture() {
	const plan = buildSubagentOrchestrationPlan({
		runId: "boundary",
		spawnThreshold: 16,
		inventory: { tools: [], skills: [], mcp: [], hooks: [] },
		lanes: ["a", "b"].map((id) => ({ id, role: "security", task: id })),
	});
	const decision: ResourceAdmissionDecision = {
		schemaVersion: 1,
		decisionId: "boundary",
		snapshotDigest: "fixture",
		pressure: "normal",
		action: "allow",
		maxToolConcurrency: 2,
		maxParallelLanes: 1,
		maxHeavyProcesses: 2,
		reasons: ["resource.memory.low"],
		decidedAt: "2026-09-25T00:00:00Z",
	};
	return { plan, decision, promptRunId: "boundary", permitPool: new WorkloadPermitPool({ capacity: 2 }) };
}

describe("lane launch input admission", () => {
	it.each([0, 1])("rejects a hole at lane index %i before any launch or permit", async (hole) => {
		const input = fixture();
		const laneIds = ["a", "b"];
		delete laneIds[hole];
		const launchLane = vi.fn(async () => {});
		await expect(
			launchSubagentLanes({
				...input,
				plan: { ...input.plan, batches: [{ ...input.plan.batches[0], laneIds }] },
				heavyLaneIds: new Set<string>(),
				launchLane,
			}),
		).rejects.toThrow("lane.invalid_or_duplicate_id");
		expect(launchLane).not.toHaveBeenCalled();
		expect(input.permitPool.snapshot()).toMatchObject({ activeWeight: 0, queuedCount: 0 });
	});

	it.each([null, {}, "a,b"])("rejects non-array batches %j before dispatch", async (batches) => {
		const input = fixture();
		const plan = { ...input.plan };
		Reflect.set(plan, "batches", batches);
		const launchLane = vi.fn(async () => {});
		await expect(launchSubagentLanes({ ...input, plan, launchLane })).rejects.toThrow("lane.invalid_batch");
		expect(launchLane).not.toHaveBeenCalled();
	});

	it.each([null, {}, "a,b"])("rejects non-array lane ids %j before dispatch", async (laneIds) => {
		const input = fixture();
		const batch = { ...input.plan.batches[0] };
		Reflect.set(batch, "laneIds", laneIds);
		const launchLane = vi.fn(async () => {});
		await expect(
			launchSubagentLanes({ ...input, plan: { ...input.plan, batches: [batch] }, launchLane }),
		).rejects.toThrow("lane.invalid_batch");
		expect(launchLane).not.toHaveBeenCalled();
	});

	it("rejects a sparse batch list before executing a valid earlier batch", async () => {
		const input = fixture();
		const batches = [input.plan.batches[0], input.plan.batches[0]];
		delete batches[1];
		const launchLane = vi.fn(async () => {});
		await expect(launchSubagentLanes({ ...input, plan: { ...input.plan, batches }, launchLane })).rejects.toThrow(
			"lane.invalid_batch",
		);
		expect(launchLane).not.toHaveBeenCalled();
	});

	it.each([{ laneIds: ["a", "a"] }, { laneIds: ["a", ""] }])(
		"rejects invalid lane ids $laneIds before dispatch",
		async ({ laneIds }) => {
			const input = fixture();
			const launchLane = vi.fn(async () => {});
			await expect(
				launchSubagentLanes({
					...input,
					plan: { ...input.plan, batches: [{ ...input.plan.batches[0], laneIds }] },
					launchLane,
				}),
			).rejects.toThrow("lane.invalid_or_duplicate_id");
			expect(launchLane).not.toHaveBeenCalled();
		},
	);

	it("retains source order and frozen authority after the caller mutates its inputs", async () => {
		const input = fixture();
		const gate = phase3Gate<void>();
		const laneIds = ["a", "b"];
		const reasons: ResourceAdmissionDecision["reasons"][number][] = ["resource.memory.low"];
		const decision = { ...input.decision, reasons };
		const started: string[] = [];
		const contexts: SubagentLaneContext[] = [];
		const request = {
			...input,
			decision,
			plan: { ...input.plan, batches: [{ ...input.plan.batches[0], laneIds }] },
			launchLane: async (context: SubagentLaneContext) => {
				started.push(context.laneId);
				contexts.push(context);
				await gate.promise;
			},
		};
		const running = launchSubagentLanes(request);
		try {
			expect(started).toEqual(["a"]);
			laneIds[1] = "unauthorized";
			decision.maxParallelLanes = 20;
			reasons.push("resource.cpu.busy");
			request.launchLane = async () => {
				throw new Error("replaced");
			};
		} finally {
			gate.resolve();
		}
		const result = await running;
		expect(started).toEqual(["a", "b"]);
		expect(result.effectiveLaneWidth).toBe(1);
		expect(result.outcomes).toEqual([
			{ laneId: "a", status: "completed" },
			{ laneId: "b", status: "completed" },
		]);
		for (const context of contexts) {
			expect(context.decision.maxParallelLanes).toBe(1);
			expect(context.decision.reasons).toEqual(["resource.memory.low"]);
			expect(Object.isFrozen(context)).toBe(true);
			expect(Object.isFrozen(context.decision)).toBe(true);
			expect(Object.isFrozen(context.decision.reasons)).toBe(true);
		}
		expect(Object.isFrozen(decision)).toBe(false);
	});
});
