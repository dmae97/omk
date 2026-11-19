import type { AgentEvent } from "omk-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { buildSubagentOrchestrationPlan, type SubagentLaneSpec } from "../src/core/subagent-orchestration.ts";
import { SubagentRoutingReceipt } from "../src/core/subagent-routing-receipt.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const lanes: SubagentLaneSpec[] = ["a", "b", "c"].map((id) => ({ id, task: `inspect ${id}`, role: "security" }));
const inventory = { tools: [], skills: [], mcp: [], hooks: [] };
const toolName = "adaptorch__adaptorch_route_topology";
function input(items = lanes) {
	return {
		subtasks: items.map((lane) => ({ id: lane.id, description: lane.task, depends_on: lane.dependsOn ?? [] })),
	};
}
function result(order: unknown = [["c", "b", "a"]], topology = "parallel"): unknown {
	return {
		content: [],
		details: { tool: "adaptorch_route_topology", isError: false, structuredContent: { topology, stages: order } },
	};
}
function observe(receipt: SubagentRoutingReceipt, output = result(), args: unknown = input(), trusted = true) {
	receipt.observe({ type: "tool_execution_start", toolName, toolCallId: "route", args }, "run", 0, trusted);
	receipt.observe(
		{ type: "tool_execution_end", toolName, toolCallId: "route", result: output, isError: false },
		"run",
		0,
		trusted,
	);
}
function plan(items = lanes) {
	return buildSubagentOrchestrationPlan({ runId: "run", lanes: items, inventory });
}
beforeEach(() => vi.stubEnv("OMK_SUBAGENT_ADAPTORCH", "enforce"));
afterEach(() => vi.unstubAllEnvs());

describe("observed AdaptOrch routing receipts", () => {
	it("changes actual starts under a narrow parent cap, without creating or dropping lanes", async () => {
		const receipt = new SubagentRoutingReceipt();
		observe(receipt);
		const authority = createSubagentLaneAuthority({
			runId: "run",
			inventory,
			decision: null,
			permitPool: new WorkloadPermitPool({ capacity: 1 }),
			noteDetachedChild: () => () => {},
			applyRoutingReceipt: (built, items) => receipt.apply(built, items, "run", 0),
		});
		const starts: string[] = [];
		const output = await authority.dispatchLanes({
			lanes,
			configuredMaxParallelLanes: 1,
			launchLane: async ({ laneId }) => {
				starts.push(laneId);
			},
		});
		expect(starts).toEqual(["c", "b", "a"]);
		expect(output.outcomes.every((outcome) => outcome.status === "completed")).toBe(true);
		expect(output.maxObservedConcurrency).toBe(1);
	});

	it.each(["shadow", "1", "0", "unknown"])("%s preserves the current plan", (setting) => {
		vi.stubEnv("OMK_SUBAGENT_ADAPTORCH", setting);
		const receipt = new SubagentRoutingReceipt();
		observe(receipt);
		const original = plan();
		expect(receipt.apply(original, lanes, "run", 0)).toBe(original);
	});

	it("consumes one receipt at most once and only for the same prompt and input graph", () => {
		const receipt = new SubagentRoutingReceipt();
		const original = plan();
		observe(receipt);
		expect(receipt.apply(original, lanes, "run", 0).preferredLaneOrder).toEqual(["c", "b", "a"]);
		expect(receipt.apply(original, lanes, "run", 0)).toBe(original);
		observe(receipt);
		expect(receipt.apply(original, lanes, "next-run", 0)).toBe(original);
		observe(receipt);
		expect(receipt.apply(original, lanes, "run", 1)).toBe(original);
		observe(receipt);
		expect(receipt.apply(original, [{ ...lanes[0], task: "changed" }, ...lanes.slice(1)], "run", 0)).toBe(original);
	});

	it.each([
		{ stages: [["a", "a", "c"]] },
		{ stages: [["a", "b"]] },
		{ stages: [["unknown", "b", "c"]] },
		{ stages: [[]] },
		{ stages: "invalid" },
	])("rejects malformed stages %j", ({ stages }) => {
		const receipt = new SubagentRoutingReceipt();
		observe(receipt, result(stages));
		const original = plan();
		expect(receipt.apply(original, lanes, "run", 0)).toBe(original);
	});

	it("rejects untrusted tools, extra replication, malformed edges and oversized task bodies", () => {
		const original = plan();
		for (const [output, args, trusted] of [
			[result(), input(), false],
			[result(undefined, "multi_model_ensemble"), input(), true],
			[result(), { ...input(), dependencies: [{ from: "a", to: "missing" }] }, true],
			[result(), { ...input(), dependencies: [{ from: "missing", to: "a" }] }, true],
			[result(), { ...input(), dependencies: [{ from: "a" }] }, true],
			[result(), { ...input(), dependencies: "a->b" }, true],
			[result(), input([{ ...lanes[0], task: "x".repeat(129 * 1024) }, ...lanes.slice(1)]), true],
		] as const) {
			const receipt = new SubagentRoutingReceipt();
			observe(receipt, output, args, trusted);
			expect(receipt.apply(original, lanes, "run", 0)).toBe(original);
		}
	});

	it("accepts top-level from/to dependencies as the same graph, and rejects mixed edge forms", () => {
		const dependent = lanes.map((lane) => (lane.id === "c" ? { ...lane, dependsOn: ["a"] } : lane));
		const subtasks = lanes.map((lane) => ({ id: lane.id, description: lane.task }));
		const edges = { subtasks, dependencies: [{ from: "a", to: "c", coupling: 0.3 }] };
		const proposal = result([["b", "a"], ["c"]], "hybrid");
		const receipt = new SubagentRoutingReceipt();
		observe(receipt, proposal, edges);
		expect(receipt.apply(plan(dependent), dependent, "run", 0).preferredLaneOrder).toEqual(["b", "a", "c"]);
		// The edge is part of the fingerprint: the same route cannot bind to an edgeless dispatch.
		observe(receipt, proposal, edges);
		const edgeless = plan();
		expect(receipt.apply(edgeless, lanes, "run", 0)).toBe(edgeless);
		// An empty list is the tool's default and adds no edges.
		observe(receipt, result(), { subtasks, dependencies: [] });
		expect(receipt.apply(edgeless, lanes, "run", 0).preferredLaneOrder).toEqual(["c", "b", "a"]);
		observe(receipt, proposal, { ...input(dependent), dependencies: [{ from: "a", to: "c" }] });
		const original = plan(dependent);
		expect(receipt.apply(original, dependent, "run", 0)).toBe(original);
	});

	it("does not weaken effective dependencies or reorder conflicting writers", async () => {
		const dependent = lanes.map((lane) => (lane.id === "c" ? { ...lane, dependsOn: ["a"] } : lane));
		const receipt = new SubagentRoutingReceipt();
		observe(receipt, result(), input(dependent));
		const original = plan(dependent);
		expect(receipt.apply(original, dependent, "run", 0)).toBe(original);
		const writers: SubagentLaneSpec[] = lanes.map((lane) => ({ ...lane, role: "executor", writeScope: ["same.ts"] }));
		observe(receipt, result(), input(writers));
		const starts: string[] = [];
		const authority = createSubagentLaneAuthority({
			runId: "run",
			inventory,
			decision: null,
			permitPool: new WorkloadPermitPool({ capacity: 3 }),
			noteDetachedChild: () => () => {},
			applyRoutingReceipt: (built, items) => receipt.apply(built, items, "run", 0),
		});
		await authority.dispatchLanes({
			lanes: writers,
			launchLane: async ({ laneId }) => {
				starts.push(laneId);
			},
		});
		expect(starts).toEqual(["a", "b", "c"]);
	});

	it("narrows sequential routing but never raises the parent's admission", () => {
		const receipt = new SubagentRoutingReceipt();
		observe(receipt, result([["a"], ["b"], ["c"]], "sequential"));
		expect(receipt.apply(plan(), lanes, "run", 0).route.width).toBe(1);
	});

	it.each(["edit", "write", "bash", "unknown__tool"])(
		"invalidates receipts across %s and rejects routing during its execution",
		(name) => {
			const receipt = new SubagentRoutingReceipt();
			const original = plan();
			observe(receipt);
			receipt.observe(
				{ type: "tool_execution_start", toolName: name, toolCallId: "mutation", args: {} },
				"run",
				0,
				false,
			);
			observe(receipt);
			receipt.observe(
				{ type: "tool_execution_end", toolName: name, toolCallId: "mutation", result: {}, isError: false },
				"run",
				0,
				false,
			);
			expect(receipt.apply(original, lanes, "run", 0)).toBe(original);
			observe(receipt);
			expect(receipt.apply(original, lanes, "run", 0).preferredLaneOrder).toBeDefined();
		},
	);

	it("rejects an earlier in-flight response after a newer route starts", () => {
		const receipt = new SubagentRoutingReceipt();
		const start: AgentEvent = { type: "tool_execution_start", toolName, toolCallId: "old", args: input() };
		receipt.observe(start, "run", 0, true);
		receipt.observe({ ...start, toolCallId: "new" }, "run", 0, true);
		receipt.observe(
			{ type: "tool_execution_end", toolName, toolCallId: "old", result: result(), isError: false },
			"run",
			0,
			true,
		);
		const original = plan();
		expect(receipt.apply(original, lanes, "run", 0)).toBe(original);
	});
});
