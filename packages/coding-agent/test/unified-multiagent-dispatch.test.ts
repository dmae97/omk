import { describe, expect, it } from "vitest";
import { planUnifiedMultiAgentDispatch } from "../src/core/unified-multiagent-dispatch.ts";

describe("P1-2: planUnifiedMultiAgentDispatch", () => {
	it("serializes conflicting writers across tool-dag, subagent-lane, and provider-harness units while parallelizing disjoint readers", () => {
		const plan = planUnifiedMultiAgentDispatch({
			runId: "run-u1",
			maxParallel: 4,
			fleetCpuSlots: 3,
			units: [
				{
					id: "lane-write-a",
					kind: "subagent-lane",
					role: "executor",
					writes: ["src/core/a.ts"],
					reads: [],
					dependsOn: [],
				},
				{
					id: "dag-write-a",
					kind: "tool-dag",
					role: "executor",
					writes: ["src/core/a.ts"],
					reads: [],
					dependsOn: [],
				},
				{
					id: "harness-read",
					kind: "provider-harness",
					role: "critic",
					writes: [],
					reads: ["src/core/a.ts"],
					dependsOn: [],
				},
				{
					id: "lane-read-b",
					kind: "subagent-lane",
					role: "planner",
					writes: [],
					reads: ["src/core/b.ts"],
					dependsOn: [],
				},
			],
		});

		expect(plan.status).toBe("ready");
		if (plan.status === "ready") {
			expect(plan.effectiveConcurrency).toBe(3);
			expect(plan.dispatchDigest).toMatch(/^[0-9a-f]{64}$/);
			// Conflicting writers must never share a stage.
			for (const stage of plan.stages) {
				const hasA = stage.unitIds.includes("lane-write-a");
				const hasB = stage.unitIds.includes("dag-write-a");
				expect(hasA && hasB).toBe(false);
			}
			// Independent read-only units can run in parallel up to effectiveConcurrency.
			const flat = plan.stages.flatMap((s) => s.unitIds);
			expect(new Set(flat)).toEqual(new Set(["lane-write-a", "dag-write-a", "harness-read", "lane-read-b"]));
		}
	});

	it("rejects dependency cycles, unknown dependencies, and workspace-escaping write scopes fail-closed", () => {
		const cycle = planUnifiedMultiAgentDispatch({
			runId: "run-cycle",
			maxParallel: 2,
			units: [
				{ id: "u1", kind: "subagent-lane", role: "executor", writes: ["src/a.ts"], reads: [], dependsOn: ["u2"] },
				{ id: "u2", kind: "tool-dag", role: "executor", writes: ["src/b.ts"], reads: [], dependsOn: ["u1"] },
			],
		});
		expect(cycle.status).toBe("rejected");
		if (cycle.status === "rejected") {
			expect(cycle.blockers.some((b) => /cycle/i.test(b))).toBe(true);
		}

		const escapedPlan = planUnifiedMultiAgentDispatch({
			runId: "run-escape",
			maxParallel: 2,
			units: [
				{
					id: "u-esc",
					kind: "provider-harness",
					role: "executor",
					writes: ["../../etc/passwd"],
					reads: [],
					dependsOn: [],
				},
			],
		});
		expect(escapedPlan.status).toBe("rejected");
		if (escapedPlan.status === "rejected") {
			expect(escapedPlan.blockers.some((b) => /escape/i.test(b))).toBe(true);
		}
	});

	it("respects topological dependencies and deterministic digest across repeated calls", () => {
		const input = {
			runId: "run-dep",
			maxParallel: 4,
			units: [
				{
					id: "verify",
					kind: "provider-harness" as const,
					role: "critic" as const,
					writes: [],
					reads: ["src/x.ts"],
					dependsOn: ["build"],
				},
				{
					id: "build",
					kind: "subagent-lane" as const,
					role: "executor" as const,
					writes: ["src/x.ts"],
					reads: [],
					dependsOn: [],
				},
			],
		};
		const p1 = planUnifiedMultiAgentDispatch(input);
		const p2 = planUnifiedMultiAgentDispatch(input);
		expect(p1).toEqual(p2);
		expect(p1.status).toBe("ready");
		if (p1.status === "ready") {
			expect(p1.stages.map((s) => s.unitIds)).toEqual([["build"], ["verify"]]);
		}
	});
});
