/**
 * `lane-plan.jsonl`: one always-on, observe-only line per launched lane plan.
 * No-op without OMK_RUN_LOG_DIR, exact numeric fields, identical scheduling with or
 * without the run log, and an LRU-capped seq counter.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityInventory, NamedResource } from "../../src/core/loadouts.ts";
import type { ResourceAdmissionDecision } from "../../src/core/resource-admission.ts";
import { launchSubagentLanes, type SubagentLaneContext } from "../../src/core/subagent-lane-launcher.ts";
import {
	LANE_PLAN_SEQ_SESSION_CAP,
	lanePlanSeqSessionCount,
	observeLanePlan,
} from "../../src/core/subagent-lane-plan-observe.ts";
import { buildSubagentOrchestrationPlan, type SubagentLaneSpec } from "../../src/core/subagent-orchestration.ts";
import { WorkloadPermitPool } from "../../src/core/workload-permit-pool.ts";

const resource = (kind: NamedResource["kind"], name: string): NamedResource => ({ kind, name });
const inventory: CapabilityInventory = {
	tools: ["read", "grep", "find", "ls", "report_finding"].map((name) => resource("tool", name)),
	skills: ["coding-standards", "debugging", "testing-guide"].map((name) => resource("skill", name)),
	mcp: [],
	hooks: [],
};
const decision: ResourceAdmissionDecision = {
	schemaVersion: 1,
	decisionId: "res-adm-lane-plan",
	snapshotDigest: "digest",
	pressure: "normal",
	action: "allow",
	maxToolConcurrency: 4,
	maxParallelLanes: 2,
	maxHeavyProcesses: 2,
	reasons: [],
	decidedAt: "2026-10-23T00:00:00.000Z",
};
const twoBranches: SubagentLaneSpec[] = [
	{ id: "A", role: "security", task: "secret task A" },
	{ id: "B", role: "security", task: "B", dependsOn: ["A"] },
	{ id: "C", role: "security", task: "C" },
	{ id: "D", role: "security", task: "D", dependsOn: ["C"] },
];
const plan = () =>
	buildSubagentOrchestrationPlan({
		runId: "lp",
		lanes: twoBranches,
		inventory,
		spawnThreshold: 16,
		maxParallelLanes: 2,
	});

async function run(sessionId: string | null = "sess-1") {
	const started: string[] = [];
	const result = await launchSubagentLanes({
		plan: plan(),
		promptRunId: "lp",
		sessionId,
		decision,
		permitPool: new WorkloadPermitPool({ capacity: 2 }),
		launchLane: async ({ laneId }: SubagentLaneContext) => {
			started.push(laneId);
			if (laneId === "A") return { status: "failed" as const };
		},
	});
	return { outcomes: result.outcomes, complete: result.allLanesCompleted, started: [...started].sort() };
}

let dir: string | undefined;
const freshDir = () => {
	dir = mkdtempSync(join(tmpdir(), "omk-lane-plan-"));
	return dir;
};
const lines = (d: string) =>
	readFileSync(join(d, "lane-plan.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));

afterEach(() => {
	vi.unstubAllEnvs();
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = undefined;
});

describe("lane-plan run log", () => {
	it("plan is [[A,C],[B,D]]", () => {
		expect(plan().batches.map((batch) => [...batch.laneIds])).toEqual([
			["A", "C"],
			["B", "D"],
		]);
	});

	it("is a no-op when OMK_RUN_LOG_DIR is unset", async () => {
		vi.stubEnv("OMK_RUN_LOG_DIR", "");
		const d = freshDir();
		await run();
		expect(() => readFileSync(join(d, "lane-plan.jsonl"))).toThrow();
	});

	it.each([
		["0", "0", false, false],
		["1", "0", true, false],
		["0", "1", false, true],
		["1", "1", true, true],
	])("writes exact fields (scope=%s queue=%s)", async (scope, queue, failureScope, readyQueue) => {
		const d = freshDir();
		vi.stubEnv("OMK_RUN_LOG_DIR", d);
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", scope);
		vi.stubEnv("OMK_LANE_READY_QUEUE", queue);
		vi.stubEnv("OMK_RUN_LOG_ROLE", "");
		const sessionId = `exact-${scope}-${queue}`;
		await run(sessionId);
		const [line, ...rest] = lines(d);
		expect(rest).toEqual([]);
		const { t, elapsedFraction, pid, role, ...fields } = line;
		expect(typeof pid).toBe("number");
		expect(elapsedFraction === null || typeof elapsedFraction === "number").toBe(true);
		expect(fields).toEqual({
			event: "lane-plan",
			seq: 1,
			sessionId,
			parentSessionId: null,
			lanes: 4,
			maxBatchLanes: 2,
			dependencyRoots: 2,
			flags: { failureScope, readyQueue },
		});
		expect(typeof t).toBe("number");
		expect(role).toBe("lead");
		expect(JSON.stringify(line)).not.toMatch(/secret|"A"|security/);
	});

	it("records the parent session in a worker", async () => {
		const d = freshDir();
		vi.stubEnv("OMK_RUN_LOG_DIR", d);
		vi.stubEnv("OMK_RUN_LOG_ROLE", "worker");
		vi.stubEnv("OMK_RUN_LOG_PARENT_SESSION", "lead-1");
		await run("worker-1");
		expect(lines(d)[0].parentSessionId).toBe("lead-1");
	});

	it.each([
		["0", "0"],
		["1", "0"],
		["0", "1"],
		["1", "1"],
	])("scheduling is identical with and without the run log (scope=%s queue=%s)", async (scope, queue) => {
		vi.stubEnv("OMK_LANE_FAILURE_SCOPE", scope);
		vi.stubEnv("OMK_LANE_READY_QUEUE", queue);
		vi.stubEnv("OMK_RUN_LOG_DIR", "");
		const off = await run();
		vi.stubEnv("OMK_RUN_LOG_DIR", freshDir());
		const on = await run();
		expect(on).toEqual(off);
	});

	it("swallows write errors", async () => {
		const blocker = join(freshDir(), "file");
		writeFileSync(blocker, "x");
		vi.stubEnv("OMK_RUN_LOG_DIR", join(blocker, "sub"));
		await expect(run()).resolves.toBeDefined();
	});

	it("seq counts per session and the session map is LRU-capped", () => {
		const d = freshDir();
		const env = { OMK_RUN_LOG_DIR: d };
		const input = (sessionId: string) =>
			({ plan: plan(), promptRunId: "lp", sessionId }) as unknown as Parameters<typeof observeLanePlan>[0];
		observeLanePlan(input("lru-keep"), env);
		for (let i = 0; i < LANE_PLAN_SEQ_SESSION_CAP + 50; i++) {
			observeLanePlan(input(`lru-${i}`), env);
			if (i % 100 === 0) observeLanePlan(input("lru-keep"), env);
		}
		expect(lanePlanSeqSessionCount()).toBe(LANE_PLAN_SEQ_SESSION_CAP);
		observeLanePlan(input("lru-keep"), env);
		observeLanePlan(input("lru-0"), env);
		const all = lines(d);
		expect(all.filter((l) => l.sessionId === "lru-keep").map((l) => l.seq)).toEqual(
			Array.from({ length: all.filter((l) => l.sessionId === "lru-keep").length }, (_, i) => i + 1),
		);
		expect(all.at(-1)).toMatchObject({ sessionId: "lru-0", seq: 1 });
	});
});
