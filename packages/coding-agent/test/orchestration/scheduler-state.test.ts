import { describe, expect, it } from "vitest";
import type {
	AccessSetEntry,
	DispatchSelectionOptions,
	SchedulerNode,
	SchedulerNodeStatus,
} from "../../src/core/orchestration/scheduler-state.ts";
import {
	accessEntriesConflict,
	canTransitionNodeStatus,
	isNodeDispatchable,
	nodesConflict,
	selectDispatchableNodes,
} from "../../src/core/orchestration/scheduler-state.ts";

/** Build a node with sensible test defaults; overrides win. */
function makeNode(overrides: Partial<SchedulerNode> & Pick<SchedulerNode, "nodeId">): SchedulerNode {
	return {
		status: "queued",
		priority: 0,
		parallelizable: true,
		readSet: [],
		writeSet: [],
		...overrides,
	};
}

/** Write entry: declares symbols when provided. */
function write(path: string, symbols?: string[]): AccessSetEntry {
	return symbols === undefined ? { path } : { path, symbols };
}

/** Read entry: declares symbols when provided. */
function read(path: string, symbols?: string[]): AccessSetEntry {
	return symbols === undefined ? { path } : { path, symbols };
}

describe("canTransitionNodeStatus", () => {
	it("allows the canonical happy path queued -> leased -> running -> verifying -> completed", () => {
		expect(canTransitionNodeStatus("queued", "leased")).toBe(true);
		expect(canTransitionNodeStatus("leased", "running")).toBe(true);
		expect(canTransitionNodeStatus("running", "verifying")).toBe(true);
		expect(canTransitionNodeStatus("verifying", "completed")).toBe(true);
	});

	it("allows the running self heartbeat transition", () => {
		expect(canTransitionNodeStatus("running", "running")).toBe(true);
	});

	it("allows retry and compensation transitions", () => {
		expect(canTransitionNodeStatus("running", "retry_wait")).toBe(true);
		expect(canTransitionNodeStatus("verifying", "retry_wait")).toBe(true);
		expect(canTransitionNodeStatus("retry_wait", "queued")).toBe(true);
		expect(canTransitionNodeStatus("running", "failed")).toBe(true);
		expect(canTransitionNodeStatus("verifying", "failed")).toBe(true);
		expect(canTransitionNodeStatus("running", "compensating")).toBe(true);
		expect(canTransitionNodeStatus("verifying", "compensating")).toBe(true);
		expect(canTransitionNodeStatus("compensating", "rolled_back")).toBe(true);
		expect(canTransitionNodeStatus("compensating", "in_doubt")).toBe(true);
	});

	it("allows lease reclaim queued <-> leased", () => {
		expect(canTransitionNodeStatus("leased", "queued")).toBe(true);
	});

	it("allows block from any non-terminal status", () => {
		const nonTerminal: SchedulerNodeStatus[] = [
			"queued",
			"leased",
			"running",
			"verifying",
			"retry_wait",
			"compensating",
		];
		for (const from of nonTerminal) {
			expect(canTransitionNodeStatus(from, "blocked")).toBe(true);
		}
	});

	it("allows cancel from any non-terminal status", () => {
		const nonTerminal: SchedulerNodeStatus[] = [
			"queued",
			"leased",
			"running",
			"verifying",
			"retry_wait",
			"compensating",
		];
		for (const from of nonTerminal) {
			expect(canTransitionNodeStatus(from, "cancelled")).toBe(true);
		}
	});

	it("rejects queued skipping leased (queued -> running/verifying/completed/rolled_back/in_doubt)", () => {
		expect(canTransitionNodeStatus("queued", "running")).toBe(false);
		expect(canTransitionNodeStatus("queued", "verifying")).toBe(false);
		expect(canTransitionNodeStatus("queued", "completed")).toBe(false);
		expect(canTransitionNodeStatus("queued", "rolled_back")).toBe(false);
		expect(canTransitionNodeStatus("queued", "in_doubt")).toBe(false);
	});

	it("rejects leased skipping running/verifying (leased -> completed/verifying)", () => {
		expect(canTransitionNodeStatus("leased", "completed")).toBe(false);
		expect(canTransitionNodeStatus("leased", "verifying")).toBe(false);
		expect(canTransitionNodeStatus("leased", "failed")).toBe(false);
	});

	it("rejects retry_wait jumping straight to running/verifying (must return to queued first)", () => {
		expect(canTransitionNodeStatus("retry_wait", "running")).toBe(false);
		expect(canTransitionNodeStatus("retry_wait", "verifying")).toBe(false);
		expect(canTransitionNodeStatus("retry_wait", "completed")).toBe(false);
	});

	it("rejects compensating -> running", () => {
		expect(canTransitionNodeStatus("compensating", "running")).toBe(false);
	});

	it("treats every terminal status as a dead end", () => {
		const terminal: SchedulerNodeStatus[] = [
			"completed",
			"failed",
			"blocked",
			"cancelled",
			"rolled_back",
			"in_doubt",
		];
		const targets: SchedulerNodeStatus[] = ["queued", "leased", "running", "verifying", "completed", "retry_wait"];
		for (const from of terminal) {
			for (const to of targets) {
				expect(canTransitionNodeStatus(from, to)).toBe(false);
			}
			// terminal self-transition is also disallowed
			expect(canTransitionNodeStatus(from, from)).toBe(false);
		}
	});
});

describe("accessEntriesConflict", () => {
	it("returns false for different paths", () => {
		expect(accessEntriesConflict(write("/a.ts"), write("/b.ts"))).toBe(false);
		expect(accessEntriesConflict(read("/a.ts"), write("/a.tsx"))).toBe(false);
	});

	it("returns true for same path with no symbols declared (path-level conflict)", () => {
		expect(accessEntriesConflict(write("/a.ts"), write("/a.ts"))).toBe(true);
		expect(accessEntriesConflict(read("/a.ts"), read("/a.ts"))).toBe(true);
		expect(accessEntriesConflict(write("/a.ts"), read("/a.ts"))).toBe(true);
	});

	it("returns true when only one side declares symbols (conservative path-level)", () => {
		expect(accessEntriesConflict(write("/a.ts", ["x"]), read("/a.ts"))).toBe(true);
		expect(accessEntriesConflict(write("/a.ts"), read("/a.ts", ["y"]))).toBe(true);
	});

	it("narrows to shared symbol when both declare symbols", () => {
		// shared symbol -> conflict
		expect(accessEntriesConflict(write("/a.ts", ["x"]), read("/a.ts", ["x"]))).toBe(true);
		expect(accessEntriesConflict(write("/a.ts", ["x", "y"]), read("/a.ts", ["y", "z"]))).toBe(true);
		// disjoint symbols -> no conflict
		expect(accessEntriesConflict(write("/a.ts", ["x"]), read("/a.ts", ["y"]))).toBe(false);
		expect(accessEntriesConflict(write("/a.ts", ["x", "y"]), read("/a.ts", ["a", "b"]))).toBe(false);
	});

	it("treats an empty symbol list as no narrowing (path-level conflict)", () => {
		expect(accessEntriesConflict(write("/a.ts", []), read("/a.ts", ["x"]))).toBe(true);
		expect(accessEntriesConflict(write("/a.ts", []), read("/a.ts", []))).toBe(true);
	});
});

describe("nodesConflict", () => {
	it("flags write/write overlap on the same path", () => {
		const a = makeNode({ nodeId: "a", writeSet: [write("/a.ts")] });
		const b = makeNode({ nodeId: "b", writeSet: [write("/a.ts")] });
		expect(nodesConflict(a, b)).toBe(true);
	});

	it("flags write/read overlap (candidate writes, in-flight reads)", () => {
		const candidate = makeNode({ nodeId: "c", writeSet: [write("/a.ts")] });
		const inFlight = makeNode({ nodeId: "i", readSet: [read("/a.ts")] });
		expect(nodesConflict(candidate, inFlight)).toBe(true);
	});

	it("flags read/write overlap (candidate reads, in-flight writes)", () => {
		const candidate = makeNode({ nodeId: "c", readSet: [read("/a.ts")] });
		const inFlight = makeNode({ nodeId: "i", writeSet: [write("/a.ts")] });
		expect(nodesConflict(candidate, inFlight)).toBe(true);
	});

	it("does NOT flag read/read overlap", () => {
		const candidate = makeNode({ nodeId: "c", readSet: [read("/a.ts")] });
		const inFlight = makeNode({ nodeId: "i", readSet: [read("/a.ts")] });
		expect(nodesConflict(candidate, inFlight)).toBe(false);
	});

	it("returns false when read/write sets target disjoint paths", () => {
		const candidate = makeNode({ nodeId: "c", writeSet: [write("/c.ts")] });
		const inFlight = makeNode({ nodeId: "i", writeSet: [write("/i.ts")], readSet: [read("/d.ts")] });
		expect(nodesConflict(candidate, inFlight)).toBe(false);
	});

	it("narrows to symbol level: disjoint symbols on the same path do not conflict", () => {
		const candidate = makeNode({ nodeId: "c", writeSet: [write("/a.ts", ["alpha"])] });
		const inFlight = makeNode({ nodeId: "i", writeSet: [write("/a.ts", ["beta"])] });
		expect(nodesConflict(candidate, inFlight)).toBe(false);
	});

	it("is symmetric: nodesConflict(a,b) === nodesConflict(b,a)", () => {
		const a = makeNode({ nodeId: "a", readSet: [read("/x.ts")], writeSet: [write("/y.ts")] });
		const b = makeNode({ nodeId: "b", readSet: [read("/y.ts")], writeSet: [write("/z.ts")] });
		expect(nodesConflict(a, b)).toBe(nodesConflict(b, a));
		expect(nodesConflict(a, b)).toBe(true);
	});
});

describe("isNodeDispatchable", () => {
	it("dispatches a queued node regardless of now", () => {
		expect(isNodeDispatchable(makeNode({ nodeId: "n", status: "queued" }), 1000)).toBe(true);
	});

	it("dispatches a retry_wait node once retryWaitUntil <= now", () => {
		expect(isNodeDispatchable(makeNode({ nodeId: "n", status: "retry_wait", retryWaitUntil: 500 }), 500)).toBe(true);
		expect(isNodeDispatchable(makeNode({ nodeId: "n", status: "retry_wait", retryWaitUntil: 500 }), 1000)).toBe(true);
	});

	it("does not dispatch a retry_wait node before its backoff elapses", () => {
		expect(isNodeDispatchable(makeNode({ nodeId: "n", status: "retry_wait", retryWaitUntil: 500 }), 499)).toBe(false);
	});

	it("does not dispatch a retry_wait node with no retryWaitUntil set", () => {
		expect(isNodeDispatchable(makeNode({ nodeId: "n", status: "retry_wait" }), 1000)).toBe(false);
	});

	it("does not dispatch non-dispatchable statuses", () => {
		const blocked: SchedulerNodeStatus[] = [
			"leased",
			"running",
			"verifying",
			"completed",
			"compensating",
			"rolled_back",
			"in_doubt",
			"blocked",
			"cancelled",
			"failed",
		];
		for (const status of blocked) {
			expect(isNodeDispatchable(makeNode({ nodeId: "n", status }), 1000)).toBe(false);
		}
	});
});

describe("selectDispatchableNodes", () => {
	const baseOptions = (): DispatchSelectionOptions => ({ now: 1000, maxLeases: 4 });

	it("returns only dispatchable nodes in priority-then-nodeId order", () => {
		const nodes = [
			makeNode({ nodeId: "z", priority: 5 }),
			makeNode({ nodeId: "a", priority: 5 }),
			makeNode({ nodeId: "m", priority: 1 }),
			makeNode({ nodeId: "k", priority: 1 }),
		];
		const selected = selectDispatchableNodes(nodes, baseOptions());
		expect(selected.map((n) => n.nodeId)).toEqual(["k", "m", "a", "z"]);
	});

	it("is deterministic for repeated calls with shuffled input", () => {
		const nodes = [
			makeNode({ nodeId: "b", priority: 2 }),
			makeNode({ nodeId: "a", priority: 2 }),
			makeNode({ nodeId: "c", priority: 1 }),
		];
		const first = selectDispatchableNodes(nodes, baseOptions());
		const second = selectDispatchableNodes([...nodes].reverse(), baseOptions());
		expect(first.map((n) => n.nodeId)).toEqual(["c", "a", "b"]);
		expect(first).toEqual(second);
	});

	it("excludes candidates that conflict with an in-flight node", () => {
		const inFlight = [makeNode({ nodeId: "run", status: "running", writeSet: [write("/shared.ts")] })];
		const nodes = [
			makeNode({ nodeId: "conflicts", writeSet: [write("/shared.ts")] }),
			makeNode({ nodeId: "clean", writeSet: [write("/other.ts")] }),
		];
		const selected = selectDispatchableNodes(nodes, { now: 1000, maxLeases: 4, inFlight });
		expect(selected.map((n) => n.nodeId)).toEqual(["clean"]);
	});

	it("excludes candidates that conflict with an already-selected node", () => {
		// Two queued nodes write the same path. Lower priority (0) wins; the other is excluded.
		const nodes = [
			makeNode({ nodeId: "late", priority: 5, writeSet: [write("/shared.ts")] }),
			makeNode({ nodeId: "early", priority: 0, writeSet: [write("/shared.ts")] }),
		];
		const selected = selectDispatchableNodes(nodes, baseOptions());
		expect(selected.map((n) => n.nodeId)).toEqual(["early"]);
	});

	it("read/read candidates do not block each other", () => {
		const nodes = [
			makeNode({ nodeId: "r1", readSet: [read("/shared.ts")] }),
			makeNode({ nodeId: "r2", readSet: [read("/shared.ts")] }),
		];
		const selected = selectDispatchableNodes(nodes, baseOptions());
		expect(selected.map((n) => n.nodeId)).toEqual(["r1", "r2"]);
	});

	it("respects maxLeases by subtracting in-flight occupancy", () => {
		// 2 in-flight + maxLeases 4 -> only 2 more may be selected.
		const inFlight = [makeNode({ nodeId: "i1", status: "running" }), makeNode({ nodeId: "i2", status: "running" })];
		const nodes = [
			makeNode({ nodeId: "a", priority: 0 }),
			makeNode({ nodeId: "b", priority: 1 }),
			makeNode({ nodeId: "c", priority: 2 }),
			makeNode({ nodeId: "d", priority: 3 }),
		];
		const selected = selectDispatchableNodes(nodes, { now: 1000, maxLeases: 4, inFlight });
		expect(selected.map((n) => n.nodeId)).toEqual(["a", "b"]);
	});

	it("returns nothing when in-flight already meets maxLeases", () => {
		const inFlight = [makeNode({ nodeId: "i1", status: "running" }), makeNode({ nodeId: "i2", status: "running" })];
		const nodes = [makeNode({ nodeId: "a" })];
		const selected = selectDispatchableNodes(nodes, { now: 1000, maxLeases: 2, inFlight });
		expect(selected).toEqual([]);
	});

	it("respects an optional maxParallel cap on this tick's selection", () => {
		const nodes = [
			makeNode({ nodeId: "a", priority: 0 }),
			makeNode({ nodeId: "b", priority: 1 }),
			makeNode({ nodeId: "c", priority: 2 }),
		];
		const selected = selectDispatchableNodes(nodes, { now: 1000, maxLeases: 10, maxParallel: 2 });
		expect(selected.map((n) => n.nodeId)).toEqual(["a", "b"]);
	});

	it("selects a non-parallelizable node only when nothing is selected or in-flight, then stops", () => {
		// No in-flight: the sole non-parallelizable node is picked, others excluded.
		const nodes = [
			makeNode({ nodeId: "solo", priority: 0, parallelizable: false }),
			makeNode({ nodeId: "other", priority: 1 }),
		];
		const selected = selectDispatchableNodes(nodes, baseOptions());
		expect(selected.map((n) => n.nodeId)).toEqual(["solo"]);
	});

	it("skips a non-parallelizable node when something is already in-flight", () => {
		const inFlight = [makeNode({ nodeId: "i1", status: "running" })];
		// sorted: solo(0) before other(1). solo is non-parallelizable -> skipped; other selected.
		const nodes = [
			makeNode({ nodeId: "other", priority: 1 }),
			makeNode({ nodeId: "solo", priority: 0, parallelizable: false }),
		];
		const selected = selectDispatchableNodes(nodes, { now: 1000, maxLeases: 4, inFlight });
		expect(selected.map((n) => n.nodeId)).toEqual(["other"]);
	});

	it("skips a non-parallelizable node when a higher-priority node was already selected", () => {
		// higher-priority parallelizable selected first, then non-parallelizable must be skipped.
		const nodes = [
			makeNode({ nodeId: "fast", priority: 0 }),
			makeNode({ nodeId: "solo", priority: 1, parallelizable: false }),
		];
		const selected = selectDispatchableNodes(nodes, baseOptions());
		expect(selected.map((n) => n.nodeId)).toEqual(["fast"]);
	});

	it("promotes a retry_wait node whose backoff has elapsed, in priority order", () => {
		const nodes = [
			makeNode({ nodeId: "ready", status: "retry_wait", retryWaitUntil: 500, priority: 0 }),
			makeNode({ nodeId: "waiting", status: "retry_wait", retryWaitUntil: 2000, priority: 0 }),
			makeNode({ nodeId: "queued", status: "queued", priority: 1 }),
		];
		const selected = selectDispatchableNodes(nodes, baseOptions());
		// ready (retry elapsed) and queued are dispatchable; waiting is not yet.
		expect(selected.map((n) => n.nodeId)).toEqual(["ready", "queued"]);
	});

	it("ignores non-dispatchable statuses entirely", () => {
		const nodes = [
			makeNode({ nodeId: "done", status: "completed", priority: 0 }),
			makeNode({ nodeId: "blocked", status: "blocked", priority: 0 }),
			makeNode({ nodeId: "ok", status: "queued", priority: 1 }),
		];
		const selected = selectDispatchableNodes(nodes, baseOptions());
		expect(selected.map((n) => n.nodeId)).toEqual(["ok"]);
	});

	it("returns an empty array for empty input", () => {
		expect(selectDispatchableNodes([], baseOptions())).toEqual([]);
	});
});
