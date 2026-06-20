/**
 * Deterministic merge-queue pure algorithms for the OMK durable DAG scheduler.
 *
 * This module contains ONLY pure data transformations. It performs NO real git
 * execution and NO I/O. The durable SQLite scheduler (see foundation.md
 * `merge_queue` table) and the git worktree integration lane (see
 * worktree-merge.md) consume these helpers to decide ordering, promotion
 * gating, conflict recording, and orphan-worktree reclaim policy.
 *
 * Design contract (worktree-merge.md §3.1, §3.3, §4.2, §5):
 * - Merge is strictly serial: exactly one entry advances per selection.
 * - Selection order key is fully deterministic:
 *     priority ASC, dagDepth ASC, leaseFinishedAt ASC, queueId ASC.
 * - Verify gate: a merge_queue entry can only advance from `pending` once its
 *   owning node reached the completed state AND its VerificationContract passed.
 *   This module trusts `completedNodeIds` (the scheduler supplies the verified
 *   completed set); pure logic only enforces the membership check.
 * - Promotion gate: the canonical branch is promoted only when the entry is in
 *   `merging`, verification passed, the target branch is unchanged, and no
 *   conflict was detected.
 * - Worktree reclaim never removes outside `.omk/worktrees/`.
 */

export type MergeQueueStatus = "pending" | "merging" | "merged" | "conflict" | "blocked";

/**
 * A single merge_queue row plus the ordering metadata derived from the owning
 * node and its lease. `leaseFinishedAt` mirrors the owning node's `finished_at`
 * (the moment its lease ended); it is `null` when the node has not finished.
 */
export interface MergeQueueEntry {
	queueId: string;
	runId: string;
	nodeId: string;
	branchName: string;
	targetBranch: string;
	status: MergeQueueStatus;
	priority: number;
	dagDepth: number;
	leaseFinishedAt: string | null;
	createdAt: string;
}

/**
 * Inputs to the canonical-branch promotion gate. The scheduler fills these from
 * the merge worktree preparation + re-verification step (worktree-merge.md §5).
 */
export interface MergePromotionDecision {
	queueStatus: MergeQueueStatus;
	verificationPassed: boolean;
	targetUnchanged: boolean;
	conflict: boolean;
}

/** One side of a path-level merge conflict (ours / theirs blob SHAs). */
export interface ConflictFile {
	path: string;
	ours: string;
	theirs: string;
}

/** Deterministic conflict artifact persisted to the artifacts table. */
export interface ConflictArtifact {
	type: "merge-conflict";
	runId: string;
	nodeId: string;
	branch: string;
	targetBranch: string;
	conflictedFiles: ConflictFile[];
	mergeBase: string;
	createdAt: string;
}

/** Caller-supplied raw conflict data; files may arrive in any order. */
export interface ConflictArtifactInput {
	runId: string;
	nodeId: string;
	branch: string;
	targetBranch: string;
	conflictedFiles: ConflictFile[];
	mergeBase: string;
	createdAt: string;
}

/** Worktree reclaim decision returned by {@link shouldReclaimWorktree}. */
export type WorktreeReclaimAction = "preserve" | "remove" | "ignore";

/**
 * Choose exactly one pending merge_queue entry to advance next.
 *
 * Selection rules:
 *  1. Only `pending` entries are eligible.
 *  2. Verify gate: the owning node must be in `completedNodeIds` (the scheduler
 *     only adds nodes that reached `completed` AND passed VerificationContract).
 *  3. Among eligible entries, order by priority ASC, dagDepth ASC,
 *     leaseFinishedAt ASC (nulls last), queueId ASC. queueId is the unique
 *     final tie-break, so the result is fully deterministic.
 *
 * Returns `undefined` when no entry is eligible.
 */
export function selectNextMergeEntry(
	entries: readonly MergeQueueEntry[],
	completedNodeIds: ReadonlySet<string>,
): MergeQueueEntry | undefined {
	const eligible = entries.filter((entry) => entry.status === "pending" && completedNodeIds.has(entry.nodeId));
	if (eligible.length === 0) {
		return undefined;
	}
	if (eligible.length === 1) {
		return eligible[0];
	}
	const ordered = [...eligible].sort(compareMergeEntryOrder);
	return ordered[0];
}

/**
 * Promotion gate for the canonical (target) branch.
 *
 * Returns true only when every promotion precondition holds:
 * queue is `merging`, verification passed, the target branch is unchanged,
 * and no conflict was detected. Any failure leaves the target untouched.
 */
export function canPromoteMerge(decision: MergePromotionDecision): boolean {
	return (
		decision.queueStatus === "merging" &&
		decision.verificationPassed === true &&
		decision.targetUnchanged === true &&
		decision.conflict === false
	);
}

/**
 * Build a deterministic conflict artifact. `conflictedFiles` are copied and
 * sorted by path (then ours, then theirs for total determinism); the input
 * array is never mutated.
 */
export function createConflictArtifact(input: ConflictArtifactInput): ConflictArtifact {
	const conflictedFiles = [...input.conflictedFiles].sort(compareConflictFile);
	return {
		type: "merge-conflict",
		runId: input.runId,
		nodeId: input.nodeId,
		branch: input.branch,
		targetBranch: input.targetBranch,
		conflictedFiles,
		mergeBase: input.mergeBase,
		createdAt: input.createdAt,
	};
}

/**
 * Decide the reclaim fate of a worktree during startup recovery
 * (worktree-merge.md §2.3).
 *
 * - Outside `.omk/worktrees/`: always `ignore` (never remove user/foreign
 *   worktrees).
 * - Terminal node (completed/merged/failed/rolled_back/cancelled) under prefix:
 *   `remove` — the worktree is leftover and safe to clean up.
 * - Expired lease with a non-terminal node under prefix: `preserve` — orphan
 *   recovery keeps the worktree and requeues the node.
 * - Otherwise (active, healthy): `ignore`.
 */
export function shouldReclaimWorktree(
	nodeTerminal: boolean,
	leaseExpired: boolean,
	pathUnderOmkWorktrees: boolean,
): WorktreeReclaimAction {
	if (!pathUnderOmkWorktrees) {
		return "ignore";
	}
	if (nodeTerminal) {
		return "remove";
	}
	if (leaseExpired) {
		return "preserve";
	}
	return "ignore";
}

function compareMergeEntryOrder(a: MergeQueueEntry, b: MergeQueueEntry): number {
	if (a.priority !== b.priority) {
		return a.priority - b.priority;
	}
	if (a.dagDepth !== b.dagDepth) {
		return a.dagDepth - b.dagDepth;
	}
	const byTime = compareNullableTimestamp(a.leaseFinishedAt, b.leaseFinishedAt);
	if (byTime !== 0) {
		return byTime;
	}
	return compareString(a.queueId, b.queueId);
}

function compareConflictFile(a: ConflictFile, b: ConflictFile): number {
	const byPath = compareString(a.path, b.path);
	if (byPath !== 0) {
		return byPath;
	}
	const byOurs = compareString(a.ours, b.ours);
	if (byOurs !== 0) {
		return byOurs;
	}
	return compareString(a.theirs, b.theirs);
}

function compareNullableTimestamp(a: string | null, b: string | null): number {
	// ISO-8601 strings sort lexicographically in chronological order; null
	// (node never finished) sorts after any real timestamp.
	if (a === null && b === null) {
		return 0;
	}
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	return compareString(a, b);
}

function compareString(a: string, b: string): number {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
}
