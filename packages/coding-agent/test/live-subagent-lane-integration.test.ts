import { describe, expect, it } from "vitest";
import type { CapabilityInventory } from "../src/core/loadouts.ts";
import { RESOURCE_ADMISSION_VERSION, type ResourceAdmissionDecision } from "../src/core/resource-admission.ts";
import { SessionPromptLifecycle } from "../src/core/session-prompt-lifecycle.ts";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

function makeDecision(overrides: Partial<ResourceAdmissionDecision> = {}): ResourceAdmissionDecision {
	return {
		schemaVersion: RESOURCE_ADMISSION_VERSION,
		decisionId: "admission-test",
		snapshotDigest: "digest",
		pressure: "normal",
		action: "allow",
		maxToolConcurrency: 8,
		maxParallelLanes: 8,
		maxHeavyProcesses: 2,
		reasons: [],
		decidedAt: new Date(0).toISOString(),
		...overrides,
	};
}

const EMPTY_INVENTORY: CapabilityInventory = {
	tools: [],
	skills: [],
	mcp: [],
	hooks: [],
};

function laneSpec(id: string, writeScope?: string[]) {
	return {
		id,
		role: "executor" as const,
		task: `task for ${id}`,
		agentName: "test-agent",
		...(writeScope ? { writeScope } : {}),
	};
}

describe("live subagent lane funnel (spec 020)", () => {
	it("dispatchLanes launches admitted lanes with typed outcomes and settles", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const { finish } = lifecycle.begin("prompt-run-live-1");
		const authority = createSubagentLaneAuthority({
			runId: "run-live-1",
			promptRunId: "prompt-run-live-1",
			decision: makeDecision(),
			permitPool: new WorkloadPermitPool({ capacity: 2 }),
			inventory: EMPTY_INVENTORY,
			noteDetachedChild: () => lifecycle.noteDetachedChild(),
		});

		const launched: string[] = [];
		const dispatch = await authority.dispatchLanes({
			lanes: [laneSpec("a"), laneSpec("b")],
			spawnPlan: {
				whyParallel: "two independent tasks",
				whyNotLocal: "isolated contexts",
				independence: "no dependencies",
				expectedReceiptShape: "results",
				maxInlineTokens: 1024,
			},
			launchLane: async ({ laneId }) => {
				launched.push(laneId);
			},
		});

		expect(dispatch.blockers).toHaveLength(0);
		expect(launched.sort()).toEqual(["a", "b"]);
		expect(dispatch.outcomes.map((o) => o.status)).toEqual(["completed", "completed"]);
		expect(dispatch.maxObservedConcurrency).toBe(2);

		let settled: unknown = null;
		finish("completed", (event) => {
			settled = event;
		});
		expect(settled).not.toBeNull();
	});

	it("parent admission narrows the caller's configured cap", async () => {
		const lifecycle = new SessionPromptLifecycle();
		lifecycle.begin("prompt-run-live-2");
		const authority = createSubagentLaneAuthority({
			runId: "run-live-2",
			promptRunId: "prompt-run-live-2",
			decision: makeDecision({ maxParallelLanes: 1 }),
			permitPool: new WorkloadPermitPool({ capacity: 4 }),
			inventory: EMPTY_INVENTORY,
			noteDetachedChild: () => lifecycle.noteDetachedChild(),
		});

		let active = 0;
		let maxActive = 0;
		const dispatch = await authority.dispatchLanes({
			lanes: [laneSpec("a"), laneSpec("b"), laneSpec("c")],
			configuredMaxParallelLanes: 8,
			launchLane: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
			},
		});
		expect(dispatch.effectiveLaneWidth).toBe(1);
		expect(maxActive).toBe(1);
	});

	it("heavy lanes draw the shared permit pool (serial under capacity 1)", async () => {
		const lifecycle = new SessionPromptLifecycle();
		lifecycle.begin("prompt-run-live-3");
		const pool = new WorkloadPermitPool({ capacity: 1 });
		const authority = createSubagentLaneAuthority({
			runId: "run-live-3",
			promptRunId: "prompt-run-live-3",
			decision: makeDecision({ maxHeavyProcesses: 1 }),
			permitPool: pool,
			inventory: EMPTY_INVENTORY,
			noteDetachedChild: () => lifecycle.noteDetachedChild(),
		});

		const order: string[] = [];
		const dispatch = await authority.dispatchLanes({
			lanes: [laneSpec("heavy-a"), laneSpec("heavy-b")],
			configuredMaxParallelLanes: 4,
			heavyLaneIds: new Set(["heavy-a", "heavy-b"]),
			permitWaitTimeoutMs: 2000,
			launchLane: async ({ laneId }) => {
				order.push(`start:${laneId}`);
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push(`end:${laneId}`);
			},
		});
		expect(order).toEqual(["start:heavy-a", "end:heavy-a", "start:heavy-b", "end:heavy-b"]);
		expect(dispatch.maxObservedConcurrency).toBe(1);
	});

	it("parent abort yields skipped-abort and drains settlement counters", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const { finish } = lifecycle.begin("prompt-run-live-4");
		const controller = new AbortController();
		const authority = createSubagentLaneAuthority({
			runId: "run-live-4",
			promptRunId: "prompt-run-live-4",
			decision: makeDecision({ maxParallelLanes: 1 }),
			permitPool: new WorkloadPermitPool({ capacity: 2 }),
			inventory: EMPTY_INVENTORY,
			signal: controller.signal,
			noteDetachedChild: () => lifecycle.noteDetachedChild(),
		});

		const dispatch = await authority.dispatchLanes({
			lanes: [laneSpec("a"), laneSpec("b")],
			configuredMaxParallelLanes: 2,
			signal: controller.signal,
			launchLane: async ({ laneId }) => {
				if (laneId === "a") {
					await new Promise((resolve) => setTimeout(resolve, 5));
					controller.abort();
				}
			},
		});
		const statuses = dispatch.outcomes.map((o) => o.status);
		expect(statuses).toContain("skipped-abort");

		let settled: unknown = null;
		finish("aborted", (event) => {
			settled = event;
		});
		expect(settled).not.toBeNull();
	});
});
