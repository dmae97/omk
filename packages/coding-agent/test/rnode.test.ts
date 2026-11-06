import { visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, test } from "vitest";
import type { RunGraphSnapshot } from "../src/core/verified-run/workbench-run-graph.ts";
import { buildRNodeViewModel, EMPTY_RNODE_FEED, reduceRunGraph } from "../src/modes/interactive/rnode/rnode-model.ts";
import { renderRNodePanel } from "../src/modes/interactive/rnode/rnode-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type Node = RunGraphSnapshot["nodes"][number];
type Cursor = RunGraphSnapshot["cursor"];

const D = (c: string) => c.repeat(64);

function node(id: string, dependsOn: string[] = [], extra: Partial<Node> = {}): Node {
	return { id, dependsOn, status: "pending", attempt: 1, generation: 1, ready: false, ...extra };
}

function snapshot(
	cursor: Partial<Cursor> = {},
	nodes: Node[] = [node("a")],
	extra: Partial<RunGraphSnapshot> = {},
): RunGraphSnapshot {
	return {
		schemaVersion: "omk.run-graph.v1",
		runtime: "node",
		graphKind: "verified-run",
		executionRequested: false,
		capabilities: { execute: false, amendGraph: false },
		runId: "dag-1",
		cursor: {
			journalDigest: D("a"),
			contractDigest: D("b"),
			candidateDigest: null,
			receiptDigest: null,
			environmentDigest: null,
			revision: 4,
			generation: 1,
			authorityRevision: 0,
			authorityDigest: D("0"),
			...cursor,
		},
		state: {
			execution: "running",
			settlement: "open",
			verification: "not_requested",
			application: "not_requested",
			publication: "none",
		},
		proofVerdict: "unverified",
		nodes,
		edges: nodes.flatMap((n) => n.dependsOn.map((source) => ({ source, target: n.id, kind: "dependency" as const }))),
		...extra,
	};
}

describe("reduceRunGraph cursor rules", () => {
	const base = snapshot();
	const installed = reduceRunGraph(EMPTY_RNODE_FEED, base);

	test("installs the first snapshot and treats a repeat as a duplicate", () => {
		expect(installed).toEqual({ current: base, last: "installed" });
		expect(reduceRunGraph(installed, snapshot())).toEqual({ current: base, last: "duplicate" });
	});

	test("ignores a componentwise older snapshot", () => {
		const next = reduceRunGraph(installed, snapshot({ revision: 3, journalDigest: D("c") }));
		expect(next).toEqual({ current: base, last: "stale" });
	});

	test("installs a newer run revision and an authority-only update with a new verdict", () => {
		const newer = snapshot({ revision: 5, journalDigest: D("c") }, [node("a", [], { status: "running" })]);
		expect(reduceRunGraph(installed, newer)).toEqual({ current: newer, last: "installed" });
		const authority = snapshot({ authorityRevision: 1, authorityDigest: D("d") }, undefined, {
			proofVerdict: "verified",
		});
		expect(reduceRunGraph(installed, authority)).toEqual({ current: authority, last: "installed" });
	});

	test("rejects conflicts, regressions and foreign bindings while keeping the current snapshot", () => {
		const cases: [RunGraphSnapshot, string][] = [
			[snapshot({}, [node("a", [], { status: "failed" })]), "conflict"],
			[snapshot({ authorityDigest: D("e") }), "conflict"],
			[snapshot({}, undefined, { proofVerdict: "verified" }), "conflict"],
			[snapshot({ revision: 5, journalDigest: D("c"), authorityRevision: -1 }), "regression"],
			[snapshot({ revision: 5, journalDigest: D("c"), generation: 0 }), "regression"],
			[snapshot({}, undefined, { runId: "dag-2" }), "binding"],
			[snapshot({ contractDigest: D("f") }), "binding"],
		];
		for (const [frame, reason] of cases) {
			expect(reduceRunGraph(installed, frame)).toEqual({ current: base, last: reason });
		}
	});
});

describe("buildRNodeViewModel", () => {
	test("is undefined without a snapshot", () => {
		expect(buildRNodeViewModel(EMPTY_RNODE_FEED)).toBeUndefined();
	});

	test("layers by longest dependency path without waiting on unrelated nodes", () => {
		const nodes = [node("c", ["a"]), node("a"), node("b"), node("d", ["c", "b"])];
		const view = buildRNodeViewModel(reduceRunGraph(EMPTY_RNODE_FEED, snapshot({}, nodes)));
		expect(view?.layers.map((layer) => [layer.depth, layer.nodes.map((n) => n.id)])).toEqual([
			[0, ["a", "b"]],
			[1, ["c"]],
			[2, ["d"]],
		]);
	});

	test("keeps cycle members and absent dependencies visible even though the wire validator rejects them", () => {
		const nodes = [node("x", ["y"]), node("y", ["x"]), node("z", ["ghost"])];
		const view = buildRNodeViewModel(reduceRunGraph(EMPTY_RNODE_FEED, snapshot({}, nodes)));
		expect(view?.layers.map((layer) => [layer.depth, layer.nodes.map((n) => n.id)])).toEqual([
			[0, ["z"]],
			[null, ["x", "y"]],
		]);
		expect(view?.layers[0]?.nodes[0]?.dependsOn).toEqual(["ghost"]);
	});

	test("maps node status per generation and never derives proof from node success", () => {
		const nodes = [
			node("done", [], { status: "succeeded", generation: 2 }),
			node("old", [], { status: "succeeded", generation: 1 }),
			node("run", [], { status: "running", generation: 2 }),
			node("bad", [], { status: "failed", generation: 2 }),
			node("wait", ["done"], { generation: 2, ready: true }),
			node("gone", [], { status: "missing", generation: null, attempt: 0 }),
		];
		const view = buildRNodeViewModel(reduceRunGraph(EMPTY_RNODE_FEED, snapshot({ generation: 2 }, nodes)));
		const cells = Object.fromEntries(
			(view?.layers ?? []).flatMap((l) => l.nodes.map((n) => [n.id, `${n.state}:${n.label}`])),
		);
		expect(cells).toEqual({
			done: "ok:done",
			old: "stale:prior gen",
			run: "active:running",
			bad: "blocked:failed",
			wait: "unknown:ready",
			gone: "unknown:missing",
		});
		expect(view?.proof).toEqual({ state: "unknown", label: "unverified" });
	});

	test("reports a rejected frame on the feed cell", () => {
		const feed = reduceRunGraph(reduceRunGraph(EMPTY_RNODE_FEED, snapshot()), snapshot({ authorityDigest: D("e") }));
		expect(buildRNodeViewModel(feed)?.feed).toEqual({ state: "blocked", label: "conflict" });
	});
});

describe("renderRNodePanel", () => {
	beforeAll(() => {
		initTheme("omk-control-grid-dark");
	});

	const nodes = [
		node("fetch", [], { status: "succeeded", generation: 1 }),
		node("build", ["fetch"], { status: "running", generation: 1, attempt: 2 }),
		node("test", ["build"]),
	];
	const view = buildRNodeViewModel(reduceRunGraph(EMPTY_RNODE_FEED, snapshot({}, nodes)));

	test("fits the width and shows glyph plus text for every node", () => {
		for (const width of [30, 44, 60]) {
			const lines = renderRNodePanel(view, { width, maxRows: 40 });
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		const text = renderRNodePanel(view, { width: 44, maxRows: 40 }).map(stripAnsi).join("\n");
		expect(text).toContain("R·NODE");
		expect(text).toContain("? unverified");
		expect(text).toContain(" exec: running/open");
		expect(text).toContain(" vrfy: not_requested");
		expect(text).toContain("  app: not_requested");
		expect(text).toContain("  pub: none");
		expect(text).toContain("✓ done");
		expect(text).toContain("● running");
		expect(text).toContain("← build");
	});

	test("drops the axis rows before any node, then counts hidden nodes", () => {
		const full = renderRNodePanel(view, { width: 44, maxRows: 14 }).map(stripAnsi).join("\n");
		expect(full).toContain(" exec:");
		expect(full).toContain("test");

		const short = renderRNodePanel(view, { width: 44, maxRows: 11 }).map(stripAnsi);
		expect(short.length).toBeLessThanOrEqual(11);
		const text = short.join("\n");
		expect(text).not.toContain(" exec:");
		expect(text).toContain("? unverified");
		for (const id of ["fetch", "build", "test"]) expect(text).toContain(id);
		expect(text).not.toContain("more");

		const lines = renderRNodePanel(view, { width: 44, maxRows: 7 }).map(stripAnsi);
		expect(lines).toHaveLength(7);
		expect(lines.at(-2)).toContain("fetch");
		expect(lines.at(-1)).toContain("+2 more");
		const tight = renderRNodePanel(view, { width: 44, maxRows: 6 }).map(stripAnsi);
		expect(tight.at(-1)).toContain("+3 more");
		expect(tight.some((line) => line.includes("L0"))).toBe(false);
	});

	test("keeps the longest axis values whole and ends long dependency lists in an ellipsis at 38 columns", () => {
		const wide = snapshot({}, [node("a"), node("b"), node("join-everything", ["a", "b"])], {
			state: {
				execution: "succeeded",
				settlement: "quarantined",
				verification: "inconclusive",
				application: "candidate_ready",
				publication: "reconciliation_required",
			},
		});
		const lines = renderRNodePanel(buildRNodeViewModel(reduceRunGraph(EMPTY_RNODE_FEED, wide)), {
			width: 38,
			maxRows: 40,
		}).map(stripAnsi);
		const text = lines.join("\n");
		for (const value of ["succeeded/quarantined", "inconclusive", "candidate_ready", "reconciliation_required"]) {
			expect(text).toContain(value);
		}
		const joinRow = lines.find((line) => line.includes("join-everything")) ?? "";
		expect(joinRow).toContain("…");
		expect(joinRow).not.toContain("a, b");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(38);
	});

	test("renders an unknown state without a source and strips control characters from ids", () => {
		expect(renderRNodePanel(undefined, { width: 44, maxRows: 10 }).map(stripAnsi).join("\n")).toContain(
			"? no run graph",
		);
		const hostile = buildRNodeViewModel(reduceRunGraph(EMPTY_RNODE_FEED, snapshot({}, [node("a\u001b[2Jb\nc")])));
		const text = renderRNodePanel(hostile, { width: 44, maxRows: 10 }).join("\n");
		expect(text).not.toContain("\u001b[2J");
		expect(stripAnsi(text)).toContain("ab c");
	});
});
