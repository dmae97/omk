import { isDeepStrictEqual } from "node:util";
import type { RunGraphSnapshot } from "../../../core/verified-run/workbench-run-graph.ts";
import type { AuthorityCell } from "../control-plane-view-model.ts";

/**
 * Outcome of offering one full snapshot. `binding`, `conflict` and `regression` reject the frame and keep the
 * current one; `unreadable` means the read itself failed, so the kept snapshot may be out of date.
 */
export type RNodeUpdate = "installed" | "duplicate" | "stale" | "binding" | "conflict" | "regression" | "unreadable";

export interface RNodeFeedState {
	readonly current: RunGraphSnapshot | undefined;
	readonly last: RNodeUpdate | undefined;
}

export const EMPTY_RNODE_FEED: RNodeFeedState = { current: undefined, last: undefined };

type GraphNode = RunGraphSnapshot["nodes"][number];

export interface RNodeCell extends AuthorityCell {
	readonly id: string;
	readonly attempt: number;
	readonly dependsOn: readonly string[];
}

/** `depth` is the longest dependency path from a root; `null` holds nodes on or behind a cycle. */
export interface RNodeLayer {
	readonly depth: number | null;
	readonly nodes: readonly RNodeCell[];
}

export interface RNodeViewModel {
	readonly runId: string;
	readonly revision: number;
	readonly generation: number;
	readonly feed: AuthorityCell;
	readonly proof: AuthorityCell;
	/** execution, settlement, verification, application, publication: verbatim and independent. */
	readonly axes: readonly string[];
	readonly layers: readonly RNodeLayer[];
}

/** Cursor rules from docs/run-graph.md; any other consumer of `omk.run-graph.v1` must apply the same ones. */
function classify(current: RunGraphSnapshot, next: RunGraphSnapshot): RNodeUpdate {
	const old = current.cursor;
	const now = next.cursor;
	if (current.runId !== next.runId || old.contractDigest !== now.contractDigest) return "binding";
	const runContentChanged =
		now.generation !== old.generation ||
		now.journalDigest !== old.journalDigest ||
		now.candidateDigest !== old.candidateDigest ||
		now.receiptDigest !== old.receiptDigest ||
		now.environmentDigest !== old.environmentDigest ||
		!isDeepStrictEqual(next.state, current.state) ||
		!isDeepStrictEqual(next.nodes, current.nodes) ||
		!isDeepStrictEqual(next.edges, current.edges);
	if (
		(now.authorityRevision === old.authorityRevision && now.authorityDigest !== old.authorityDigest) ||
		(now.revision === old.revision && runContentChanged)
	) {
		return "conflict";
	}
	const older = now.revision < old.revision || now.authorityRevision < old.authorityRevision;
	if (older && now.revision <= old.revision && now.authorityRevision <= old.authorityRevision) return "stale";
	if (older) return "regression";
	if (now.revision === old.revision && now.authorityRevision === old.authorityRevision) {
		return isDeepStrictEqual(next, current) ? "duplicate" : "conflict";
	}
	return now.generation < old.generation ? "regression" : "installed";
}

/** Pure and idempotent: offering the installed frame again leaves `current` unchanged. */
export function reduceRunGraph(state: RNodeFeedState, next: RunGraphSnapshot): RNodeFeedState {
	const update = state.current === undefined ? "installed" : classify(state.current, next);
	return { current: update === "installed" ? next : state.current, last: update };
}

export function markUnreadable(state: RNodeFeedState): RNodeFeedState {
	return { current: state.current, last: "unreadable" };
}

const PROOF_CELLS: Readonly<Record<RunGraphSnapshot["proofVerdict"], AuthorityCell>> = {
	verified: { state: "ok", label: "verified" },
	violated: { state: "blocked", label: "violated" },
	inconclusive: { state: "inconclusive", label: "inconclusive" },
	unverified: { state: "unknown", label: "unverified" },
};

export function feedCell(last: RNodeUpdate | undefined): AuthorityCell {
	if (last === "binding" || last === "conflict" || last === "regression") return { state: "blocked", label: last };
	if (last === "unreadable") return { state: "stale", label: "unreadable" };
	if (last === undefined) return { state: "unknown", label: "not read" };
	return { state: "ok", label: "live" };
}

/** A success from an older generation does not satisfy the current one (see dag-explanation.ts). */
function nodeCell(node: GraphNode, generation: number): AuthorityCell {
	switch (node.status) {
		case "succeeded":
			return node.generation === generation
				? { state: "ok", label: "done" }
				: { state: "stale", label: "prior gen" };
		case "running":
			return { state: "active", label: "running" };
		case "failed":
			return { state: "blocked", label: "failed" };
		case "pending":
			return { state: "unknown", label: node.ready ? "ready" : "pending" };
		default:
			return { state: "unknown", label: "missing" };
	}
}

/** Kahn layering over in-graph dependencies; snapshot order is kept inside a layer. */
function layerDepths(nodes: readonly GraphNode[]): Map<string, number> {
	const ids = new Set(nodes.map((n) => n.id));
	const deps = new Map(nodes.map((n) => [n.id, [...new Set(n.dependsOn.filter((d) => ids.has(d)))]]));
	const dependents = new Map<string, string[]>();
	const waiting = new Map<string, number>();
	for (const [id, list] of deps) {
		waiting.set(id, list.length);
		for (const dep of list) dependents.set(dep, [...(dependents.get(dep) ?? []), id]);
	}
	const depth = new Map<string, number>();
	const queue = nodes.filter((n) => waiting.get(n.id) === 0).map((n) => n.id);
	for (const id of queue) {
		depth.set(id, Math.max(-1, ...(deps.get(id) ?? []).map((d) => depth.get(d) ?? -1)) + 1);
		for (const next of dependents.get(id) ?? []) {
			const left = (waiting.get(next) ?? 0) - 1;
			waiting.set(next, left);
			if (left === 0) queue.push(next);
		}
	}
	return depth;
}

export function buildRNodeViewModel(state: RNodeFeedState): RNodeViewModel | undefined {
	const snapshot = state.current;
	if (snapshot === undefined) return undefined;
	const { generation } = snapshot.cursor;
	const depths = layerDepths(snapshot.nodes);
	const groups = new Map<number | null, RNodeCell[]>();
	for (const node of snapshot.nodes) {
		const key = depths.get(node.id) ?? null;
		const cell = { ...nodeCell(node, generation), id: node.id, attempt: node.attempt, dependsOn: node.dependsOn };
		groups.set(key, [...(groups.get(key) ?? []), cell]);
	}
	const layers = [...groups]
		.map(([depth, cells]) => ({ depth, nodes: cells }))
		.sort((a, b) => (a.depth ?? Number.POSITIVE_INFINITY) - (b.depth ?? Number.POSITIVE_INFINITY));
	const { execution, settlement, verification, application, publication } = snapshot.state;
	return {
		runId: snapshot.runId,
		revision: snapshot.cursor.revision,
		generation,
		feed: feedCell(state.last),
		proof: PROOF_CELLS[snapshot.proofVerdict] ?? { state: "unknown", label: "unknown" },
		axes: [execution, settlement, verification, application, publication],
		layers,
	};
}
