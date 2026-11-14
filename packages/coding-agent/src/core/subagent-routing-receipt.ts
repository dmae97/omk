/** Consume an actual AdaptOrch MCP result; never call, copy, or impersonate its private engine. */
import { createHash } from "node:crypto";
import type { AgentEvent } from "omk-agent-core";
import { appendRunLog } from "./run-log.ts";
import type { SubagentLaneSpec } from "./subagent-lane-contract.ts";
import type { SubagentOrchestrationPlan } from "./subagent-orchestration.ts";

const MAX_LANES = 64;
const MAX_INPUT_BYTES = 128 * 1024;
const TOPOLOGIES = new Set(["parallel", "sequential", "hierarchical", "hybrid"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
type Mode = "off" | "shadow" | "enforce";
type GraphNode = { id: string; task: string; dependsOn: readonly string[] };
type Pending = { callId: string; owner: string; version: number; fingerprint: string; ids: readonly string[] };
type Receipt = Pending & { order: readonly string[]; sequential: boolean };

function mode(): Mode {
	const value = process.env.OMK_SUBAGENT_ADAPTORCH?.trim().toLowerCase();
	return value === "enforce" ? "enforce" : value === "shadow" || value === "1" ? "shadow" : "off";
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphFingerprint(nodes: readonly GraphNode[]): string | undefined {
	if (nodes.length === 0 || nodes.length > MAX_LANES) return undefined;
	const ids = new Set<string>();
	let bytes = 0;
	for (const node of nodes) {
		if (!node.id || node.id.length > 128 || ids.has(node.id) || node.dependsOn.length > MAX_LANES) return undefined;
		ids.add(node.id);
		bytes += Buffer.byteLength(node.task, "utf8") + Buffer.byteLength(node.id, "utf8");
		for (const dep of node.dependsOn) {
			if (!dep || dep.length > 128) return undefined;
			bytes += Buffer.byteLength(dep, "utf8");
		}
		if (bytes > MAX_INPUT_BYTES) return undefined;
	}
	if (nodes.some((node) => node.dependsOn.some((dep) => !ids.has(dep) || dep === node.id))) return undefined;
	const canonical = nodes.map((node) => [node.id, node.task, [...new Set(node.dependsOn)].sort()] as const);
	canonical.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function routeInput(args: unknown): GraphNode[] | undefined {
	if (!record(args) || !Array.isArray(args.subtasks) || args.subtasks.length > MAX_LANES) return undefined;
	const edges: unknown = args.dependencies ?? [];
	if (!Array.isArray(edges) || edges.length > MAX_LANES * MAX_LANES) return undefined;
	const nodes: GraphNode[] = [];
	const dependsOnById = new Map<string, string[]>();
	for (const node of args.subtasks) {
		if (!record(node) || typeof node.id !== "string" || typeof node.description !== "string") return undefined;
		const deps: unknown = node.depends_on ?? [];
		if (!Array.isArray(deps) || deps.length > MAX_LANES || !deps.every((dep) => typeof dep === "string"))
			return undefined;
		// One graph, one edge representation: mixing depends_on with dependencies is ambiguous.
		if (edges.length > 0 && deps.length > 0) return undefined;
		const dependsOn: string[] = [...deps];
		dependsOnById.set(node.id, dependsOn);
		nodes.push({ id: node.id, task: node.description, dependsOn });
	}
	// { from, to }: `to` depends on `from`. Unknown sources and duplicate node IDs fail the fingerprint.
	for (const edge of edges) {
		if (!record(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") return undefined;
		const dependsOn = dependsOnById.get(edge.to);
		if (!dependsOn) return undefined;
		dependsOn.push(edge.from);
	}
	return nodes;
}

function routeOutput(result: unknown): Record<string, unknown> | undefined {
	if (!record(result) || !record(result.details) || result.details.isError === true) return undefined;
	if (result.details.tool !== "adaptorch_route_topology") return undefined;
	if (record(result.details.structuredContent)) return result.details.structuredContent;
	if (!Array.isArray(result.content) || result.content.length !== 1) return undefined;
	const block: unknown = result.content[0];
	if (!record(block) || block.type !== "text" || typeof block.text !== "string" || block.text.length > MAX_INPUT_BYTES)
		return undefined;
	try {
		const value: unknown = JSON.parse(block.text);
		return record(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/** At most one in-flight fingerprint and one compact receipt; no task bodies or provider calls retained. */
export class SubagentRoutingReceipt {
	private pending: Pending | undefined;
	private receipt: Receipt | undefined;
	private readonly mutations = new Set<string>();
	private saturated = false;

	observe(event: AgentEvent, owner: string | undefined, version: number, isMcpTool: boolean): void {
		if (mode() === "off" || event.type === "agent_start" || event.type === "agent_end") {
			this.pending = undefined;
			this.receipt = undefined;
			this.mutations.clear();
			this.saturated = false;
			return;
		}
		if (!owner || !("toolName" in event)) return;
		const routing = isMcpTool && event.toolName.endsWith("__adaptorch_route_topology");
		if (!routing && !READ_TOOLS.has(event.toolName) && event.toolName !== "subagent") {
			this.pending = undefined;
			this.receipt = undefined;
			if (event.type === "tool_execution_start") {
				if (this.mutations.size >= MAX_LANES || event.toolCallId.length > 256) this.saturated = true;
				else this.mutations.add(event.toolCallId);
			} else if (event.type === "tool_execution_end") this.mutations.delete(event.toolCallId);
			return;
		}
		if (!routing || this.saturated || this.mutations.size > 0) return;
		if (event.type === "tool_execution_start") {
			this.pending = undefined;
			this.receipt = undefined;
			const nodes = routeInput(event.args);
			const fingerprint = nodes && graphFingerprint(nodes);
			if (nodes && fingerprint && event.toolCallId.length <= 256) {
				this.pending = { callId: event.toolCallId, owner, version, fingerprint, ids: nodes.map((node) => node.id) };
			}
			return;
		}
		if (event.type !== "tool_execution_end" || event.toolCallId !== this.pending?.callId) return;
		const pending = this.pending;
		this.pending = undefined;
		if (event.isError || pending.owner !== owner || pending.version !== version) return;
		const output = routeOutput(event.result);
		if (
			!output ||
			typeof output.topology !== "string" ||
			!TOPOLOGIES.has(output.topology) ||
			!Array.isArray(output.stages)
		)
			return;
		if (output.stages.length === 0 || output.stages.length > MAX_LANES) return;
		const order: string[] = [];
		for (const stage of output.stages) {
			if (!Array.isArray(stage) || stage.length === 0 || stage.length > MAX_LANES) return;
			for (const id of stage) {
				if (typeof id !== "string" || !pending.ids.includes(id) || order.includes(id)) return;
				order.push(id);
			}
		}
		if (order.length !== pending.ids.length) return;
		this.receipt = { ...pending, order: Object.freeze(order), sequential: output.topology === "sequential" };
	}

	apply(
		plan: SubagentOrchestrationPlan,
		lanes: readonly SubagentLaneSpec[],
		owner: string | undefined,
		version: number,
	): SubagentOrchestrationPlan {
		const receipt = this.receipt;
		this.receipt = undefined; // A result is single-use, including a rejected or shadow decision.
		const selected = mode();
		if (
			selected === "off" ||
			!receipt ||
			this.saturated ||
			this.mutations.size > 0 ||
			receipt.owner !== owner ||
			receipt.version !== version ||
			plan.blockers.length > 0
		)
			return plan;
		const fingerprint = graphFingerprint(
			lanes.map((lane) => ({ id: lane.id, task: lane.task, dependsOn: lane.dependsOn ?? [] })),
		);
		if (fingerprint !== receipt.fingerprint) return plan;
		const order = receipt.order;
		if (
			plan.laneGrants.some((grant) =>
				(grant.dependsOn ?? []).some((dep) => order.indexOf(dep) >= order.indexOf(grant.laneId)),
			)
		)
			return plan;
		const baseline = plan.batches.flatMap((batch) => batch.laneIds);
		const proposalChanged =
			baseline.some((id, index) => id !== order[index]) || (receipt.sequential && plan.route.width > 1);
		appendRunLog("subagent-routing", {
			mode: selected,
			lanes: lanes.length,
			proposalChanged,
			sequential: receipt.sequential,
			extraCalls: 0,
		});
		if (selected !== "enforce") return plan;
		return {
			...plan,
			preferredLaneOrder: order,
			route: receipt.sequential ? { ...plan.route, width: Math.min(1, plan.route.width) } : plan.route,
		};
	}
}
