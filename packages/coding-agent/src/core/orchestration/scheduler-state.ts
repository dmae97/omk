/**
 * Pure scheduler state module for the durable DAG orchestrator.
 *
 * This module is intentionally free of I/O: it owns the node state machine,
 * the read/write conflict model, the dispatchability predicate, and the
 * deterministic dispatch selection. Persistence (SQLite WAL), leases, and
 * dependency readiness live in sibling modules; this is the single source of
 * truth for the *rules* those modules enforce.
 *
 * Erasable TypeScript only (no enum/namespace/parameter properties). All time
 * values are epoch milliseconds so tests can use deterministic fake clocks.
 */

/** Lifecycle status of a DAG node (see foundation.md section 2.1). */
export type SchedulerNodeStatus =
	| "queued"
	| "leased"
	| "running"
	| "verifying"
	| "completed"
	| "retry_wait"
	| "compensating"
	| "rolled_back"
	| "in_doubt"
	| "blocked"
	| "cancelled"
	| "failed";

/** A single resource touched by a node's read_set or write_set. */
export interface AccessSetEntry {
	/** Filesystem path. Equality is exact string match (no prefix containment here). */
	path: string;
	/** Optional symbol list for symbol-level conflict narrowing. */
	symbols?: readonly string[];
}

/** A DAG node, narrowed to the fields the pure scheduler rules consume. */
export interface SchedulerNode {
	nodeId: string;
	status: SchedulerNodeStatus;
	/** Lower number dispatches sooner. */
	priority: number;
	/** false => must run alone (no siblings selected or in-flight alongside it). */
	parallelizable: boolean;
	readSet: readonly AccessSetEntry[];
	writeSet: readonly AccessSetEntry[];
	/** Epoch ms backoff deadline; consulted only when status === "retry_wait". */
	retryWaitUntil?: number;
	/** Upstream node ids. Not consulted by these pure functions (dependency readiness is external). */
	dependsOn?: readonly string[];
}

/** Options driving a single dispatch selection pass. */
export interface DispatchSelectionOptions {
	/** Epoch ms "now"; used for retry_wait backoff comparison. */
	now: number;
	/** Total in-flight lease ceiling. Selection stops once in-flight + selected reaches this. */
	maxLeases: number;
	/** Optional per-tick cap on how many nodes may be selected. */
	maxParallel?: number;
	/** Nodes already leased/running/verifying, counted toward maxLeases and conflict checks. */
	inFlight?: readonly SchedulerNode[];
}

/**
 * Legal direct transitions, derived from foundation.md section 2.2.
 *
 * Terminal statuses (completed, failed, blocked, cancelled, rolled_back,
 * in_doubt) map to the empty set: once terminal, a node never moves again.
 * block/cancel are legal from every non-terminal status ("any -> block",
 * "any except terminal -> cancel"). running -> running encodes the heartbeat
 * self-update.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<SchedulerNodeStatus, ReadonlySet<SchedulerNodeStatus>>> = {
	queued: new Set<SchedulerNodeStatus>(["leased", "blocked", "cancelled"]),
	leased: new Set<SchedulerNodeStatus>(["queued", "running", "blocked", "cancelled"]),
	running: new Set<SchedulerNodeStatus>([
		"running",
		"verifying",
		"retry_wait",
		"failed",
		"compensating",
		"blocked",
		"cancelled",
	]),
	verifying: new Set<SchedulerNodeStatus>([
		"completed",
		"retry_wait",
		"failed",
		"compensating",
		"blocked",
		"cancelled",
	]),
	completed: new Set<SchedulerNodeStatus>(),
	retry_wait: new Set<SchedulerNodeStatus>(["queued", "blocked", "cancelled"]),
	compensating: new Set<SchedulerNodeStatus>(["rolled_back", "in_doubt", "blocked", "cancelled"]),
	rolled_back: new Set<SchedulerNodeStatus>(),
	in_doubt: new Set<SchedulerNodeStatus>(),
	blocked: new Set<SchedulerNodeStatus>(),
	cancelled: new Set<SchedulerNodeStatus>(),
	failed: new Set<SchedulerNodeStatus>(),
};

/** True iff moving a node from `from` to `to` is a legal direct transition. */
export function canTransitionNodeStatus(from: SchedulerNodeStatus, to: SchedulerNodeStatus): boolean {
	return ALLOWED_TRANSITIONS[from].has(to);
}

/** True iff the entry narrows on at least one symbol (empty list counts as no narrowing). */
function declaresSymbols(entry: AccessSetEntry): boolean {
	return Array.isArray(entry.symbols) && entry.symbols.length > 0;
}

/** True iff two non-empty symbol lists share at least one symbol. */
function sharesSymbol(a: readonly string[], b: readonly string[]): boolean {
	const seen = new Set(a);
	for (const symbol of b) {
		if (seen.has(symbol)) {
			return true;
		}
	}
	return false;
}

/**
 * Two access entries conflict iff they reference the same path. When BOTH
 * entries declare (non-empty) symbols, the conflict narrows to a shared symbol;
 * otherwise the conflict is path-level (conservative).
 */
export function accessEntriesConflict(a: AccessSetEntry, b: AccessSetEntry): boolean {
	if (a.path !== b.path) {
		return false;
	}
	if (declaresSymbols(a) && declaresSymbols(b)) {
		return sharesSymbol(a.symbols as readonly string[], b.symbols as readonly string[]);
	}
	return true;
}

/** True iff any entry in `left` conflicts with any entry in `right`. */
function setsOverlap(left: readonly AccessSetEntry[], right: readonly AccessSetEntry[]): boolean {
	for (const l of left) {
		for (const r of right) {
			if (accessEntriesConflict(l, r)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * A candidate node conflicts with an in-flight node on write/write,
 * write/read, or read/write overlap. read/read never conflicts.
 */
export function nodesConflict(candidate: SchedulerNode, inFlight: SchedulerNode): boolean {
	// write/write
	if (setsOverlap(candidate.writeSet, inFlight.writeSet)) {
		return true;
	}
	// write/read: candidate writes what in-flight reads
	if (setsOverlap(candidate.writeSet, inFlight.readSet)) {
		return true;
	}
	// read/write: candidate reads what in-flight writes
	if (setsOverlap(candidate.readSet, inFlight.writeSet)) {
		return true;
	}
	return false;
}

/**
 * A node is dispatchable iff it is `queued`, or `retry_wait` whose backoff
 * deadline has elapsed (retryWaitUntil <= now). Dependencies and leases are
 * checked elsewhere; this predicate only answers the time/status question.
 */
export function isNodeDispatchable(node: SchedulerNode, now: number): boolean {
	if (node.status === "queued") {
		return true;
	}
	if (node.status === "retry_wait") {
		return node.retryWaitUntil !== undefined && node.retryWaitUntil <= now;
	}
	return false;
}

/** Deterministic ordering: priority ascending, then nodeId ascending. */
function compareDispatchOrder(a: SchedulerNode, b: SchedulerNode): number {
	if (a.priority !== b.priority) {
		return a.priority - b.priority;
	}
	if (a.nodeId < b.nodeId) {
		return -1;
	}
	if (a.nodeId > b.nodeId) {
		return 1;
	}
	return 0;
}

/**
 * Select dispatchable nodes for a single tick, deterministically.
 *
 * Ordering: priority ascending, then nodeId ascending. A candidate is excluded
 * if it conflicts (write/write, write/read, read/write) with any in-flight node
 * or any node already selected this tick. `parallelizable: false` nodes may be
 * selected only when nothing is selected and nothing is in-flight, and once one
 * is selected the tick stops (serialized lane). Selection stops once
 * in-flight + selected reaches `maxLeases`, or `maxParallel` is hit.
 */
export function selectDispatchableNodes(
	nodes: readonly SchedulerNode[],
	options: DispatchSelectionOptions,
): SchedulerNode[] {
	const inFlight = options.inFlight ?? [];
	const maxParallel = options.maxParallel ?? Number.POSITIVE_INFINITY;

	// Remaining lease headroom after accounting for in-flight occupancy.
	const remaining = Math.max(0, options.maxLeases - inFlight.length);
	if (remaining === 0) {
		return [];
	}

	const candidates = nodes.filter((node) => isNodeDispatchable(node, options.now));
	const ordered = [...candidates].sort(compareDispatchOrder);

	const selected: SchedulerNode[] = [];
	for (const candidate of ordered) {
		if (selected.length >= remaining || selected.length >= maxParallel) {
			break;
		}
		// Serialized lane: a non-parallelizable node needs the lane to itself.
		if (!candidate.parallelizable) {
			if (selected.length > 0 || inFlight.length > 0) {
				continue;
			}
		}
		// Exclude candidates that conflict with anything already in flight or chosen.
		const conflictsWithBusy =
			inFlight.some((busy) => nodesConflict(candidate, busy)) ||
			selected.some((chosen) => nodesConflict(candidate, chosen));
		if (conflictsWithBusy) {
			continue;
		}
		selected.push(candidate);
		// A non-parallelizable node claims the whole lane for this tick.
		if (!candidate.parallelizable) {
			break;
		}
	}

	return selected;
}
