import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";
import { fixture, type ResultDetails } from "./improvement-subagent-fixture.ts";

let env: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
	env = await fixture();
});
afterEach(async () => {
	await env.cleanup();
});
function authority(signal?: AbortSignal) {
	return createSubagentLaneAuthority({
		runId: "fixture",
		decision: null,
		permitPool: new WorkloadPermitPool({ capacity: 4 }),
		inventory: {
			tools: ["read", "write", "edit", "bash"].map((name) => ({ name, kind: "tool" as const })),
			skills: [],
			mcp: [],
			hooks: [],
		},
		signal,
		noteDetachedChild: () => () => {},
	});
}
const node = (id: string, task: string, dependsOn: string[] = []) => ({ id, task, dependsOn, agent: "fixture" });

describe.each([false, true])("graph authority=%s", (governed) => {
	it("preserves attempt-bound preview through the non-Ultra adaptive result merger", async () => {
		const updates: ResultDetails[] = [];
		const result = await env.execute(
			{ graph: [node("A", "progress")] },
			governed ? authority() : undefined,
			(partial) => {
				updates.push(partial.details as ResultDetails);
			},
			"high",
		);
		expect(result.isError).not.toBe(true);
		const early = updates.find((update) => update.results[0]?.progress?.text === "early preview");
		expect(early?.results[0]).toMatchObject({
			nodeId: "A",
			exitCode: -1,
			messages: [],
			attemptId: expect.any(String),
		});
		const final = (result.details as ResultDetails).results[0];
		expect(final.progress).toBeUndefined();
		expect(final.deadline?.outcome).toBe("completed");
	});
	it("forwards node-bound partial progress without marking it completed", async () => {
		const updates: ResultDetails[] = [];
		const result = await env.execute(
			{ graph: [node("A", "progress"), node("B", "dependent {dependencies}", ["A"])] },
			governed ? authority() : undefined,
			(partial) => {
				updates.push(partial.details as ResultDetails);
			},
		);
		expect(result.isError).not.toBe(true);
		const early = updates.find((update) => update.results.some((r) => r.progress?.text === "early preview"));
		expect(early).toBeDefined();
		expect(early?.results[0]).toMatchObject({ nodeId: "A", exitCode: -1, messages: [] });
		expect(early?.graph?.completedNodeIds).toEqual([]);
		const final = result.details as ResultDetails;
		expect(final.graph?.completedNodeIds).toEqual(["A", "B"]);
		expect(final.results.every((r) => r.progress === undefined)).toBe(true);
		expect(final.results[1].output).toContain("### A\nTask: progress");
		expect(final.results[1].output).not.toContain("early preview");
	});

	it.each(["exit7", "signal", "empty"])("blocks dependents on %s without reporting completion", async (task) => {
		const result = await env.execute(
			{ graph: [node("A", task), node("B", "downstream {dependencies}", ["A"])] },
			governed ? authority() : undefined,
		);
		expect(result.isError).toBe(true);
		expect(await env.starts()).not.toContain("downstream");
		const details = result.details as ResultDetails;
		expect(details.graph?.completedNodeIds).toEqual([]);
		expect(details.results.map((r) => r.nodeId)).toEqual(["A", "B"]);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("0/2 completed") });
	});
	it("keeps source IDs and outputs when completion order reverses", async () => {
		const result = await env.execute(
			{ graph: [node("A", "slow-first"), node("B", "fast-second"), node("C", "join {dependencies}", ["A", "B"])] },
			governed ? authority() : undefined,
		);
		expect(result.isError).not.toBe(true);
		const details = result.details as ResultDetails;
		expect(details.results.map((r) => r.nodeId)).toEqual(["A", "B", "C"]);
		expect(details.results[0].output).toContain("slow-first");
		expect(details.results[1].output).toContain("fast-second");
		expect(details.results[2].output).toContain("### A\nTask: slow-first");
	});
});
it("uses lane context cancellation before spawning", async () => {
	const controller = new AbortController();
	controller.abort();
	const result = await env.execute({ graph: [node("A", "never-start")] }, authority(controller.signal));
	expect(result.isError).toBe(true);
	expect(await env.starts()).toBe("");
});
