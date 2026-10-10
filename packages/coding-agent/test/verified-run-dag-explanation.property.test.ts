import fc from "fast-check";
import { parseRunContract } from "omk-protocol";
import { describe, expect, it } from "vitest";
import { explainDagTasks } from "../src/core/verified-run/dag-explanation.ts";
import type { RunProjection } from "../src/core/verified-run/run-types.ts";

const shape = fc.array(fc.array(fc.nat(15), { maxLength: 16 }), { minLength: 1, maxLength: 16 });
const statuses = ["pending", "running", "succeeded", "failed"] as const;
const generate = fc.tuple(shape, fc.array(fc.nat(7), { minLength: 16, maxLength: 16 }));

function fixture(rows: number[][], values: number[]) {
	const tasks = rows.map((row, index) => ({
		id: `task-${index}`,
		dependsOn: [...new Set(row.filter((parent) => parent < index))].sort((a, b) => a - b).map((id) => `task-${id}`),
		writablePaths: [`out-${index}`],
		attempts: [["/bin/true"]],
	}));
	const contract = parseRunContract({
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-dag-v1",
		runId: "graph",
		goal: "Bounded dependency explanation",
		workspace: { root: "/tmp/graph-input", baseDigest: "a".repeat(64) },
		writablePaths: tasks.flatMap((task) => task.writablePaths),
		writer: { kind: "command-dag", tasks },
		checks: [{ claimId: "output", argv: ["/bin/true"], stdout: "" }],
		budget: { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	});
	const states: RunProjection["tasks"] = tasks.map((task, index) => {
		const common = { taskId: task.id, attempt: 1, generation: values[index] < 4 ? 2 : 1 };
		switch (statuses[values[index] % 4]) {
			case "pending":
				return { ...common, status: "pending", inputDigest: null, outputDigest: null, failure: null };
			case "running":
				return {
					...common,
					status: "running",
					execution: { kind: "ready" },
					inputDigest: "a".repeat(64),
					outputDigest: null,
					failure: null,
				};
			case "succeeded":
				return {
					...common,
					status: "succeeded",
					inputDigest: "a".repeat(64),
					outputDigest: "b".repeat(64),
					failure: null,
				};
			case "failed":
				return {
					...common,
					status: "failed",
					inputDigest: "a".repeat(64),
					outputDigest: null,
					failure: "execution_failed",
				};
		}
		throw new Error("Invalid generated task status");
	});
	return { contract, tasks, states };
}

const stateFor = (tasks: RunProjection["tasks"]): Pick<RunProjection, "tasks" | "generation"> => ({
	tasks,
	generation: 2,
});

describe("DAG blocker collision properties", () => {
	it("preserves exact transitive blockers, direct readiness and state under 500 graph/status collisions", () => {
		fc.assert(
			fc.property(generate, ([rows, values]) => {
				const { contract, tasks, states } = fixture(rows, values);
				const state = stateFor(states);
				const before = JSON.stringify(state);
				const report = explainDagTasks(contract, state);
				const shuffled = explainDagTasks(contract, { ...state, tasks: [...states].reverse() });
				expect(report).toEqual(shuffled);
				for (const task of report) {
					const index = tasks.findIndex((item) => item.id === task.taskId);
					const ancestors = new Set<string>();
					const pending = [...tasks[index].dependsOn];
					while (pending.length) {
						const id = pending.pop();
						if (id === undefined || ancestors.has(id)) continue;
						ancestors.add(id);
						pending.push(...tasks[tasks.findIndex((item) => item.id === id)].dependsOn);
					}
					const expected = [...ancestors]
						.filter((id) => {
							const parent = states.find((item) => item.taskId === id);
							return parent?.status !== "succeeded" || parent.generation !== state.generation;
						})
						.sort();
					expect(task.blockedBy.map((blocker) => blocker.taskId).sort()).toEqual(expected);
					expect(task.ready).toBe(
						states[index].status === "pending" &&
							states[index].generation === 2 &&
							tasks[index].dependsOn.every((id) => {
								const parent = states.find((item) => item.taskId === id);
								return parent?.status === "succeeded" && parent.generation === 2;
							}),
					);
					for (const blocker of task.blockedBy) {
						const parent = states.find((item) => item.taskId === blocker.taskId);
						if (parent?.generation !== 2) expect(blocker.reason).toBe("stale_generation");
					}
				}
				expect(JSON.stringify(state)).toBe(before);
			}),
			{ seed: 0x20261009, numRuns: 500 },
		);
	});
});
