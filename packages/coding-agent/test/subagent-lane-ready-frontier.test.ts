/**
 * Spec 106 DG2 — ready frontier (OMK_LANE_READY_QUEUE, default on; 0/false/off opt out).
 * Deterministic: lanes resolve only through manual deferreds; no wall clock.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityInventory, NamedResource } from "../src/core/loadouts.ts";
import type { ResourceAdmissionDecision } from "../src/core/resource-admission.ts";
import type { LaneOutcome } from "../src/core/subagent-lane-contract.ts";
import { launchSubagentLanes, type SubagentLaneContext } from "../src/core/subagent-lane-launcher.ts";
import { LANE_FRONTIER_RUN_LOG, laneReadyFrontierEnabled } from "../src/core/subagent-lane-ready-frontier.ts";
import { buildSubagentOrchestrationPlan, type SubagentLaneSpec } from "../src/core/subagent-orchestration.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const resource = (kind: NamedResource["kind"], name: string): NamedResource => ({ kind, name });
const inventoryWith = (tools: readonly string[]): CapabilityInventory => ({
	tools: tools.map((name) => resource("tool", name)),
	skills: ["coding-standards", "debugging", "testing-guide"].map((name) => resource("skill", name)),
	mcp: [],
	hooks: [],
});
const readOnly = inventoryWith(["read", "grep", "find", "ls", "report_finding"]);
const writeTools = inventoryWith(["read", "grep", "edit", "write", "bash"]);
const decisionWith = (maxParallelLanes: number): ResourceAdmissionDecision => ({
	schemaVersion: 1,
	decisionId: "res-adm-frontier",
	snapshotDigest: "digest",
	pressure: "normal",
	action: "allow",
	maxToolConcurrency: 4,
	maxParallelLanes,
	maxHeavyProcesses: 2,
	reasons: [],
	decidedAt: "2026-10-22T00:00:00.000Z",
});

type Status = "completed" | "failed";
interface Deferred {
	resolve: (status?: Status) => void;
}

const flush = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Controlled run: every lane waits for an explicit resolve unless listed in `instant`. */
function controlled(
	lanes: SubagentLaneSpec[],
	opts: { width?: number; tools?: CapabilityInventory; instant?: boolean } = {},
) {
	const width = opts.width ?? 2;
	const plan = buildSubagentOrchestrationPlan({
		runId: "frontier",
		lanes,
		inventory: opts.tools ?? readOnly,
		spawnThreshold: 16,
		maxParallelLanes: width,
	});
	expect(plan.blockers).toEqual([]);
	const started: string[] = [];
	const running = new Set<string>();
	let peak = 0;
	const waiters = new Map<string, Deferred>();
	const fails = new Set<string>();
	const result = launchSubagentLanes({
		plan,
		promptRunId: "frontier",
		decision: decisionWith(width),
		permitPool: new WorkloadPermitPool({ capacity: 4 }),
		launchLane: ({ laneId }: SubagentLaneContext) => {
			started.push(laneId);
			running.add(laneId);
			peak = Math.max(peak, running.size);
			if (opts.instant) {
				running.delete(laneId);
				return Promise.resolve(fails.has(laneId) ? { status: "failed" as const } : undefined);
			}
			return new Promise((resolve) => {
				waiters.set(laneId, {
					resolve: (status = "completed") => {
						running.delete(laneId);
						resolve(status === "failed" ? { status: "failed" as const } : undefined);
					},
				});
			});
		},
	});
	return {
		plan,
		started,
		running,
		peak: () => peak,
		fails,
		finish: async (laneId: string, status?: Status) => {
			await flush();
			const waiter = waiters.get(laneId);
			if (!waiter) throw new Error(`lane ${laneId} not started`);
			waiter.resolve(status);
			await flush();
		},
		result,
	};
}

const statusOf = (outcomes: readonly LaneOutcome[]) =>
	Object.fromEntries(outcomes.map((outcome) => [outcome.laneId, outcome.status]));

const twoBranches: SubagentLaneSpec[] = [
	{ id: "A", role: "security", task: "A" },
	{ id: "B", role: "security", task: "B", dependsOn: ["A"] },
	{ id: "C", role: "security", task: "C" },
	{ id: "D", role: "security", task: "D", dependsOn: ["C"] },
];

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("DG2 ready frontier", () => {
	it("flag off (counterexample pinned): B waits for C's batch barrier", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "0");
		const run = controlled(twoBranches);
		await run.finish("A");
		expect(run.started).toEqual(["A", "C"]);
		await run.finish("C");
		expect(run.started).toEqual(["A", "C", "B", "D"]);
		await run.finish("B");
		await run.finish("D");
		expect(statusOf((await run.result).outcomes)).toEqual({
			A: "completed",
			B: "completed",
			C: "completed",
			D: "completed",
		});
	});

	it("flag on: A completes ⇒ B starts while C is still running", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const run = controlled(twoBranches);
		await run.finish("A");
		expect(run.started).toEqual(["A", "C", "B"]);
		expect(run.running.has("C")).toBe(true);
		await run.finish("C");
		expect(run.started).toEqual(["A", "C", "B", "D"]);
		await run.finish("B");
		await run.finish("D");
		const result = await run.result;
		expect(statusOf(result.outcomes)).toEqual({ A: "completed", B: "completed", C: "completed", D: "completed" });
		expect(result.outcomes.map((o) => o.laneId)).toEqual(["A", "C", "B", "D"]);
		expect(result.allLanesCompleted).toBe(true);
	});

	it("concurrency cap is still respected", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const lanes: SubagentLaneSpec[] = ["A", "B", "C", "D", "E"].map((id) => ({ id, role: "security", task: id }));
		const run = controlled(lanes, { width: 2 });
		await flush();
		expect(run.started).toEqual(["A", "B"]);
		await run.finish("B");
		expect(run.started).toEqual(["A", "B", "C"]);
		await run.finish("A");
		await run.finish("C");
		await run.finish("D");
		await run.finish("E");
		const result = await run.result;
		expect(run.peak()).toBe(2);
		expect(result.maxObservedConcurrency).toBeLessThanOrEqual(result.effectiveLaneWidth);
		expect(result.allLanesCompleted).toBe(true);
	});

	it("DG4: write-conflicting lanes stay serialized in plan order", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const lanes: SubagentLaneSpec[] = [
			{ id: "W1", role: "executor", task: "w1", writeScope: ["src/a.ts"] },
			{ id: "W2", role: "executor", task: "w2", writeScope: ["src/a.ts"] },
			{ id: "R", role: "security", task: "r" },
		];
		const run = controlled(lanes, { tools: writeTools, width: 3 });
		await flush();
		const first = run.started[0];
		expect(run.started).toEqual([first]);
		await run.finish(first);
		const second = run.started[1];
		expect(run.running.size).toBe(1);
		await run.finish(second);
		const third = run.started[2];
		await run.finish(third);
		const result = await run.result;
		expect(run.peak()).toBe(1);
		// Same start order as the plan's batches.
		expect(run.started).toEqual(run.plan.batches.flatMap((batch) => batch.laneIds));
		expect(result.allLanesCompleted).toBe(true);
	});

	it("DG1 unchanged with both flags on: A fails ⇒ B blocked, C and D complete, overall NOT complete", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
		const run = controlled(twoBranches);
		await run.finish("A", "failed");
		await run.finish("C");
		await run.finish("D");
		const result = await run.result;
		expect(statusOf(result.outcomes)).toEqual({
			A: "failed",
			B: "blocked-dependency",
			C: "completed",
			D: "completed",
		});
		expect(run.started).not.toContain("B");
		expect(result.allLanesCompleted).toBe(false);
	});

	it("frontier on, failure scope off: a failure stops new starts (legacy global block)", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "0");
		const run = controlled(twoBranches);
		await run.finish("A", "failed");
		await run.finish("C");
		const result = await run.result;
		expect(statusOf(result.outcomes)).toEqual({
			A: "failed",
			B: "blocked-dependency",
			C: "completed",
			D: "blocked-dependency",
		});
		expect(result.allLanesCompleted).toBe(false);
	});

	it("DG3: join waits for every parent", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const lanes: SubagentLaneSpec[] = [
			{ id: "A", role: "security", task: "A" },
			{ id: "C", role: "security", task: "C" },
			{ id: "J", role: "security", task: "J", dependsOn: ["A", "C"] },
		];
		const run = controlled(lanes);
		await run.finish("A");
		expect(run.started).toEqual(["A", "C"]);
		await run.finish("C");
		expect(run.started).toEqual(["A", "C", "J"]);
		await run.finish("J");
		expect((await run.result).allLanesCompleted).toBe(true);
	});

	it("unsettled lane blocks new starts and keeps its reservation", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const plan = buildSubagentOrchestrationPlan({
			runId: "frontier",
			lanes: twoBranches,
			inventory: readOnly,
			spawnThreshold: 16,
			maxParallelLanes: 2,
		});
		const pool = new WorkloadPermitPool({ capacity: 2 });
		let settle!: () => void;
		const started: string[] = [];
		const result = await launchSubagentLanes({
			plan,
			promptRunId: "frontier",
			decision: decisionWith(2),
			permitPool: pool,
			heavyLaneIds: new Set(["A"]),
			launchLane: async ({ laneId }: SubagentLaneContext) => {
				started.push(laneId);
				if (laneId === "A")
					return {
						status: "unsettled" as const,
						settlement: new Promise<void>((r) => {
							settle = r;
						}),
					};
			},
		});
		expect(statusOf(result.outcomes).A).toBe("unsettled");
		expect(statusOf(result.outcomes).B).toBe("blocked-dependency");
		expect(started).not.toContain("B");
		expect(pool.snapshot().activeWeight).toBe(1);
		settle();
		await flush();
		expect(pool.snapshot().activeWeight).toBe(0);
	});

	it("flag off: start order and outcomes snapshot identical to the batch loop", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "0");
		const lanes: SubagentLaneSpec[] = [
			...twoBranches,
			{ id: "E", role: "security", task: "E", dependsOn: ["B", "D"] },
			{ id: "F", role: "security", task: "F" },
		];
		const run = controlled(lanes, { instant: true });
		const result = await run.result;
		expect(run.started).toMatchInlineSnapshot(`
			[
			  "A",
			  "C",
			  "B",
			  "D",
			  "E",
			  "F",
			]
		`);
		expect(result).toMatchInlineSnapshot(`
			{
			  "allLanesCompleted": true,
			  "effectiveLaneWidth": 2,
			  "maxObservedConcurrency": 2,
			  "outcomes": [
			    {
			      "laneId": "A",
			      "status": "completed",
			    },
			    {
			      "laneId": "C",
			      "status": "completed",
			    },
			    {
			      "laneId": "B",
			      "status": "completed",
			    },
			    {
			      "laneId": "D",
			      "status": "completed",
			    },
			    {
			      "laneId": "E",
			      "status": "completed",
			    },
			    {
			      "laneId": "F",
			      "status": "completed",
			    },
			  ],
			}
		`);
	});
});

describe("DG5/DG6 with frontier on, run-log covariate", () => {
	it("DG5: timed-out child still alive (unsettled) keeps permit + child accounting and stops new starts", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const lanes: SubagentLaneSpec[] = [
			{ id: "A", role: "security", task: "A" },
			{ id: "C", role: "security", task: "C" },
			{ id: "B", role: "security", task: "B", dependsOn: ["A"] },
			{ id: "D", role: "security", task: "D", dependsOn: ["C"] },
		];
		const plan = buildSubagentOrchestrationPlan({
			runId: "frontier",
			lanes,
			inventory: readOnly,
			spawnThreshold: 16,
			maxParallelLanes: 2,
		});
		const pool = new WorkloadPermitPool({ capacity: 2 });
		let settle!: () => void;
		let releaseC!: () => void;
		const started: string[] = [];
		const pending = launchSubagentLanes({
			plan,
			promptRunId: "frontier",
			decision: decisionWith(2),
			permitPool: pool,
			heavyLaneIds: new Set(["A", "C"]),
			launchLane: ({ laneId }: SubagentLaneContext) => {
				started.push(laneId);
				if (laneId === "A")
					// Timeout fired but the child cannot be proven dead.
					return Promise.resolve({
						status: "unsettled" as const,
						settlement: new Promise<void>((r) => {
							settle = r;
						}),
					});
				return new Promise<void>((r) => {
					releaseC = r;
				});
			},
		});
		await flush();
		expect(started).toEqual(["A", "C"]);
		expect(pool.snapshot().activeWeight).toBe(2);
		releaseC();
		const result = await pending;
		expect(statusOf(result.outcomes)).toEqual({
			A: "unsettled",
			C: "completed",
			B: "blocked-dependency",
			D: "blocked-dependency",
		});
		expect(started).toEqual(["A", "C"]);
		expect(result.allLanesCompleted).toBe(false);
		// A's reservation is still held after the launcher returned.
		expect(pool.snapshot().activeWeight).toBe(1);
		settle();
		await flush();
		expect(pool.snapshot().activeWeight).toBe(0);
	});

	it("DG5: settlement reject never releases the permit and still blocks new starts", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const plan = buildSubagentOrchestrationPlan({
			runId: "frontier",
			lanes: twoBranches,
			inventory: readOnly,
			spawnThreshold: 16,
			maxParallelLanes: 2,
		});
		const pool = new WorkloadPermitPool({ capacity: 2 });
		let reject!: () => void;
		const started: string[] = [];
		const result = await launchSubagentLanes({
			plan,
			promptRunId: "frontier",
			decision: decisionWith(2),
			permitPool: pool,
			heavyLaneIds: new Set(["A"]),
			launchLane: async ({ laneId }: SubagentLaneContext) => {
				started.push(laneId);
				if (laneId === "A")
					return {
						status: "unsettled" as const,
						settlement: new Promise<void>((_, r) => {
							reject = () => r(new Error("x"));
						}),
					};
			},
		});
		expect(statusOf(result.outcomes).A).toBe("unsettled");
		expect(started).not.toContain("B");
		reject();
		await flush();
		expect(pool.snapshot().activeWeight).toBe(1);
	});

	it("DG6: a late result after abort is not reported as completed and starts nothing", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const plan = buildSubagentOrchestrationPlan({
			runId: "frontier",
			lanes: twoBranches,
			inventory: readOnly,
			spawnThreshold: 16,
			maxParallelLanes: 2,
		});
		const controller = new AbortController();
		const finishers = new Map<string, () => void>();
		const started: string[] = [];
		const pending = launchSubagentLanes({
			plan,
			promptRunId: "frontier",
			decision: decisionWith(2),
			permitPool: new WorkloadPermitPool({ capacity: 2 }),
			signal: controller.signal,
			launchLane: ({ laneId }: SubagentLaneContext) => {
				started.push(laneId);
				return new Promise<void>((r) => finishers.set(laneId, r));
			},
		});
		await flush();
		expect(started).toEqual(["A", "C"]);
		controller.abort();
		// Old-generation results arrive after the abort.
		finishers.get("A")!();
		finishers.get("C")!();
		const result = await pending;
		expect(statusOf(result.outcomes)).toEqual({
			A: "cancelled",
			C: "cancelled",
			B: "skipped-abort",
			D: "skipped-abort",
		});
		expect(started).toEqual(["A", "C"]);
		expect(result.allLanesCompleted).toBe(false);
	});

	it("DG6: an unsettled lane's late settlement does not rewrite outcomes or start lanes", async () => {
		vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
		const plan = buildSubagentOrchestrationPlan({
			runId: "frontier",
			lanes: twoBranches,
			inventory: readOnly,
			spawnThreshold: 16,
			maxParallelLanes: 2,
		});
		let settle!: () => void;
		const started: string[] = [];
		const result = await launchSubagentLanes({
			plan,
			promptRunId: "frontier",
			decision: decisionWith(2),
			permitPool: new WorkloadPermitPool({ capacity: 2 }),
			launchLane: async ({ laneId }: SubagentLaneContext) => {
				started.push(laneId);
				if (laneId === "A")
					return {
						status: "unsettled" as const,
						settlement: new Promise<void>((r) => {
							settle = r;
						}),
					};
			},
		});
		const before = JSON.stringify(result);
		settle();
		await flush();
		expect(JSON.stringify(result)).toBe(before);
		expect(started).toEqual(["A", "C"]);
		expect(statusOf(result.outcomes).B).toBe("blocked-dependency");
	});

	const readLog = (dir: string) =>
		readFileSync(join(dir, `${LANE_FRONTIER_RUN_LOG}.jsonl`), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);

	it("run log counts lanes not started due to failure (counts only)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-frontier-log-"));
		try {
			vi.stubEnv("OMK_RUN_LOG_DIR", dir);
			vi.stubEnv("OMK_LANE_READY_QUEUE", "1");
			vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "0");
			const global = controlled(twoBranches);
			await global.finish("A", "failed");
			await global.finish("C");
			await global.result;
			vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
			const scoped = controlled(twoBranches);
			await scoped.finish("A", "failed");
			await scoped.finish("C");
			await scoped.finish("D");
			await scoped.result;
			const clean = controlled(twoBranches, { instant: true });
			await clean.result;
			const lines = readLog(dir);
			expect(lines.map((l) => [l.notStartedDueToFailure, l.lanes, l.failureScope, l.frontier])).toEqual([
				[2, 4, false, true],
				[1, 4, true, true],
				[0, 4, true, true],
			]);
			for (const line of lines)
				expect(Object.keys(line).sort()).toEqual(
					[
						"elapsedFraction",
						"failureScope",
						"frontier",
						"lanes",
						"notStartedDueToFailure",
						"pid",
						"role",
						"t",
					].sort(),
				);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("run log: batch arm (frontier off, C1 on) counts lanes C1 kept from starting", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-frontier-log-"));
		try {
			vi.stubEnv("OMK_RUN_LOG_DIR", dir);
			vi.stubEnv("OMK_LANE_READY_QUEUE", "0");
			vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
			const failed = controlled(twoBranches);
			await failed.finish("A", "failed");
			await failed.finish("C");
			await failed.finish("D");
			expect(statusOf((await failed.result).outcomes).B).toBe("blocked-dependency");
			await controlled(twoBranches, { instant: true }).result;
			const lines = readLog(dir);
			expect(lines.map((l) => [l.notStartedDueToFailure, l.lanes, l.failureScope, l.frontier])).toEqual([
				[1, 4, true, false],
				[0, 4, true, false],
			]);
			for (const line of lines)
				expect(Object.keys(line).sort()).toEqual(
					[
						"elapsedFraction",
						"failureScope",
						"frontier",
						"lanes",
						"notStartedDueToFailure",
						"pid",
						"role",
						"t",
					].sort(),
				);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("run log: abort- or unsettled-held lanes count 0 in both arms", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-frontier-log-"));
		try {
			vi.stubEnv("OMK_RUN_LOG_DIR", dir);
			vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "1");
			const plan = buildSubagentOrchestrationPlan({
				runId: "frontier",
				lanes: twoBranches,
				inventory: readOnly,
				spawnThreshold: 16,
				maxParallelLanes: 2,
			});
			for (const frontier of ["1", "0"]) {
				vi.stubEnv("OMK_LANE_READY_QUEUE", frontier);
				const controller = new AbortController();
				const finishers: (() => void)[] = [];
				const aborted = launchSubagentLanes({
					plan,
					promptRunId: "frontier",
					decision: decisionWith(2),
					permitPool: new WorkloadPermitPool({ capacity: 2 }),
					signal: controller.signal,
					launchLane: () => new Promise<void>((r) => finishers.push(r)),
				});
				await flush();
				controller.abort();
				for (const finish of finishers) finish();
				await aborted;
				await launchSubagentLanes({
					plan,
					promptRunId: "frontier",
					decision: decisionWith(2),
					permitPool: new WorkloadPermitPool({ capacity: 2 }),
					launchLane: async ({ laneId }: SubagentLaneContext) =>
						laneId === "A"
							? { status: "unsettled" as const, settlement: new Promise<void>(() => {}) }
							: undefined,
				});
			}
			const lines = readLog(dir);
			expect(lines.map((l) => [l.notStartedDueToFailure, l.frontier])).toEqual([
				[0, true],
				[0, true],
				[0, false],
				[0, false],
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("run log: both flags off writes nothing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-frontier-log-"));
		try {
			vi.stubEnv("OMK_RUN_LOG_DIR", dir);
			vi.stubEnv("OMK_LANE_READY_QUEUE", "0");
			vi.stubEnv("OMK_LANE_FAILURE_SCOPE", "0");
			const failed = controlled(twoBranches);
			await failed.finish("A", "failed");
			await failed.finish("C");
			await failed.result;
			await controlled(twoBranches, { instant: true }).result;
			expect(() => readLog(dir)).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("OMK_LANE_READY_QUEUE default", () => {
	it("is on when unset; 0/false/off opt out", () => {
		expect(laneReadyFrontierEnabled({})).toBe(true);
		for (const v of ["0", "false", "OFF"]) expect(laneReadyFrontierEnabled({ OMK_LANE_READY_QUEUE: v })).toBe(false);
	});
});
