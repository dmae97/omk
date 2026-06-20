import { describe, expect, it } from "vitest";
import {
	type ConflictArtifactInput,
	canPromoteMerge,
	createConflictArtifact,
	type MergePromotionDecision,
	type MergeQueueEntry,
	selectNextMergeEntry,
	shouldReclaimWorktree,
	type WorktreeReclaimAction,
} from "../../src/core/orchestration/merge-queue.ts";

function entry(overrides: Partial<MergeQueueEntry> = {}): MergeQueueEntry {
	return {
		queueId: "q-1",
		runId: "run-1",
		nodeId: "node-1",
		branchName: "omk/run-run-1/node-node-1",
		targetBranch: "main",
		status: "pending",
		priority: 0,
		dagDepth: 0,
		leaseFinishedAt: "2026-06-21T00:00:00.000Z",
		createdAt: "2026-06-21T00:00:00.000Z",
		...overrides,
	};
}

describe("selectNextMergeEntry", () => {
	it("orders eligible pending+completed entries by priority asc", () => {
		const entries = [
			entry({ queueId: "q-hi", nodeId: "n-hi", priority: 5 }),
			entry({ queueId: "q-lo", nodeId: "n-lo", priority: 1 }),
		];
		const completed = new Set(["n-hi", "n-lo"]);
		expect(selectNextMergeEntry(entries, completed)?.queueId).toBe("q-lo");
	});

	it("tie-breaks priority with dagDepth asc", () => {
		const entries = [
			entry({ queueId: "q-deep", nodeId: "n-deep", priority: 1, dagDepth: 3 }),
			entry({ queueId: "q-shallow", nodeId: "n-shallow", priority: 1, dagDepth: 1 }),
		];
		const completed = new Set(["n-deep", "n-shallow"]);
		expect(selectNextMergeEntry(entries, completed)?.queueId).toBe("q-shallow");
	});

	it("tie-breaks dagDepth with leaseFinishedAt asc (earlier first)", () => {
		const entries = [
			entry({
				queueId: "q-late",
				nodeId: "n-late",
				priority: 1,
				dagDepth: 1,
				leaseFinishedAt: "2026-06-21T05:00:00.000Z",
			}),
			entry({
				queueId: "q-early",
				nodeId: "n-early",
				priority: 1,
				dagDepth: 1,
				leaseFinishedAt: "2026-06-21T01:00:00.000Z",
			}),
		];
		const completed = new Set(["n-late", "n-early"]);
		expect(selectNextMergeEntry(entries, completed)?.queueId).toBe("q-early");
	});

	it("sorts null leaseFinishedAt after real timestamps", () => {
		const entries = [
			entry({
				queueId: "q-null",
				nodeId: "n-null",
				priority: 1,
				dagDepth: 1,
				leaseFinishedAt: null,
			}),
			entry({
				queueId: "q-real",
				nodeId: "n-real",
				priority: 1,
				dagDepth: 1,
				leaseFinishedAt: "2026-06-21T01:00:00.000Z",
			}),
		];
		const completed = new Set(["n-null", "n-real"]);
		expect(selectNextMergeEntry(entries, completed)?.queueId).toBe("q-real");
	});

	it("final tie-break is queueId asc for full determinism", () => {
		const entries = [
			entry({ queueId: "q-zeta", nodeId: "n-zeta" }),
			entry({ queueId: "q-alpha", nodeId: "n-alpha" }),
		];
		const completed = new Set(["n-zeta", "n-alpha"]);
		expect(selectNextMergeEntry(entries, completed)?.queueId).toBe("q-alpha");
	});

	it("excludes entries whose node is not in the completed set (verify gate)", () => {
		const entries = [
			entry({ queueId: "q-unverified", nodeId: "n-unverified" }),
			entry({ queueId: "q-verified", nodeId: "n-verified", priority: 9 }),
		];
		// only n-verified is completed
		const completed = new Set(["n-verified"]);
		expect(selectNextMergeEntry(entries, completed)?.queueId).toBe("q-verified");
	});

	it("excludes entries that are not pending", () => {
		const entries = [
			entry({ queueId: "q-merging", nodeId: "n-merging", status: "merging" }),
			entry({ queueId: "q-merged", nodeId: "n-merged", status: "merged" }),
			entry({ queueId: "q-conflict", nodeId: "n-conflict", status: "conflict" }),
			entry({ queueId: "q-blocked", nodeId: "n-blocked", status: "blocked" }),
			entry({ queueId: "q-pending", nodeId: "n-pending", priority: 9 }),
		];
		const completed = new Set(["n-merging", "n-merged", "n-conflict", "n-blocked", "n-pending"]);
		expect(selectNextMergeEntry(entries, completed)?.queueId).toBe("q-pending");
	});

	it("returns undefined when no entry is eligible", () => {
		expect(
			selectNextMergeEntry([entry({ queueId: "q-1", nodeId: "n-1", status: "pending" })], new Set<string>()),
		).toBeUndefined();
	});

	it("returns undefined when the list is empty", () => {
		expect(selectNextMergeEntry([], new Set(["n-1"]))).toBeUndefined();
	});

	it("returns exactly one entry from many eligible", () => {
		const entries = [
			entry({ queueId: "q-3", nodeId: "n-3", priority: 3 }),
			entry({ queueId: "q-1", nodeId: "n-1", priority: 1 }),
			entry({ queueId: "q-2", nodeId: "n-2", priority: 2 }),
		];
		const completed = new Set(["n-1", "n-2", "n-3"]);
		const next = selectNextMergeEntry(entries, completed);
		expect(next).toBeDefined();
		expect(next?.queueId).toBe("q-1");
	});

	it("does not mutate the input array order", () => {
		const entries = [
			entry({ queueId: "q-b", nodeId: "n-b", priority: 5 }),
			entry({ queueId: "q-a", nodeId: "n-a", priority: 1 }),
		];
		const snapshot = entries.map((e) => e.queueId);
		selectNextMergeEntry(entries, new Set(["n-a", "n-b"]));
		expect(entries.map((e) => e.queueId)).toEqual(snapshot);
	});
});

describe("canPromoteMerge", () => {
	function decision(overrides: Partial<MergePromotionDecision> = {}): MergePromotionDecision {
		return {
			queueStatus: "merging",
			verificationPassed: true,
			targetUnchanged: true,
			conflict: false,
			...overrides,
		};
	}

	it("is true when all promotion conditions hold", () => {
		expect(canPromoteMerge(decision())).toBe(true);
	});

	it("is false when queue is not merging", () => {
		expect(canPromoteMerge(decision({ queueStatus: "pending" }))).toBe(false);
		expect(canPromoteMerge(decision({ queueStatus: "conflict" }))).toBe(false);
		expect(canPromoteMerge(decision({ queueStatus: "merged" }))).toBe(false);
		expect(canPromoteMerge(decision({ queueStatus: "blocked" }))).toBe(false);
	});

	it("is false when verification did not pass", () => {
		expect(canPromoteMerge(decision({ verificationPassed: false }))).toBe(false);
	});

	it("is false when the target branch moved", () => {
		expect(canPromoteMerge(decision({ targetUnchanged: false }))).toBe(false);
	});

	it("is false when there is a conflict", () => {
		expect(canPromoteMerge(decision({ conflict: true }))).toBe(false);
	});

	it("is false when any combination of conditions fails", () => {
		expect(canPromoteMerge(decision({ verificationPassed: false, targetUnchanged: false, conflict: true }))).toBe(
			false,
		);
	});
});

describe("createConflictArtifact", () => {
	function input(overrides: Partial<ConflictArtifactInput> = {}): ConflictArtifactInput {
		return {
			runId: "run-1",
			nodeId: "node-1",
			branch: "omk/run-run-1/node-node-1",
			targetBranch: "main",
			conflictedFiles: [],
			mergeBase: "abc123",
			createdAt: "2026-06-21T00:00:00.000Z",
			...overrides,
		};
	}

	it("produces an artifact with type merge-conflict and all fields", () => {
		const artifact = createConflictArtifact(
			input({ conflictedFiles: [{ path: "src/a.ts", ours: "o1", theirs: "t1" }] }),
		);
		expect(artifact).toEqual({
			type: "merge-conflict",
			runId: "run-1",
			nodeId: "node-1",
			branch: "omk/run-run-1/node-node-1",
			targetBranch: "main",
			conflictedFiles: [{ path: "src/a.ts", ours: "o1", theirs: "t1" }],
			mergeBase: "abc123",
			createdAt: "2026-06-21T00:00:00.000Z",
		});
	});

	it("sorts conflictedFiles by path ascending", () => {
		const artifact = createConflictArtifact(
			input({
				conflictedFiles: [
					{ path: "src/z.ts", ours: "oz", theirs: "tz" },
					{ path: "src/a.ts", ours: "oa", theirs: "ta" },
					{ path: "src/m.ts", ours: "om", theirs: "tm" },
				],
			}),
		);
		expect(artifact.conflictedFiles.map((f) => f.path)).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
	});

	it("keeps ours/theirs values attached to their path after sorting", () => {
		const artifact = createConflictArtifact(
			input({
				conflictedFiles: [
					{ path: "src/z.ts", ours: "oz", theirs: "tz" },
					{ path: "src/a.ts", ours: "oa", theirs: "ta" },
				],
			}),
		);
		expect(artifact.conflictedFiles).toEqual([
			{ path: "src/a.ts", ours: "oa", theirs: "ta" },
			{ path: "src/z.ts", ours: "oz", theirs: "tz" },
		]);
	});

	it("does not mutate the input conflictedFiles array", () => {
		const files = [
			{ path: "src/z.ts", ours: "oz", theirs: "tz" },
			{ path: "src/a.ts", ours: "oa", theirs: "ta" },
		];
		const snapshot = files.map((f) => f.path);
		createConflictArtifact(input({ conflictedFiles: files }));
		expect(files.map((f) => f.path)).toEqual(snapshot);
	});

	it("handles an empty conflictedFiles list", () => {
		const artifact = createConflictArtifact(input());
		expect(artifact.conflictedFiles).toEqual([]);
		expect(artifact.type).toBe("merge-conflict");
	});

	it("is deterministic: same input yields same output", () => {
		const files = [
			{ path: "src/z.ts", ours: "oz", theirs: "tz" },
			{ path: "src/a.ts", ours: "oa", theirs: "ta" },
		];
		expect(createConflictArtifact(input({ conflictedFiles: files }))).toEqual(
			createConflictArtifact(input({ conflictedFiles: files })),
		);
	});
});

describe("shouldReclaimWorktree", () => {
	it("removes a terminal node's worktree under .omk/worktrees", () => {
		expect(shouldReclaimWorktree(true, false, true)).toBe<WorktreeReclaimAction>("remove");
	});

	it("never removes outside .omk/worktrees even when terminal", () => {
		expect(shouldReclaimWorktree(true, false, false)).toBe<WorktreeReclaimAction>("ignore");
	});

	it("preserves an orphan worktree (expired lease, non-terminal) under prefix for reclaim", () => {
		expect(shouldReclaimWorktree(false, true, true)).toBe<WorktreeReclaimAction>("preserve");
	});

	it("ignores an active, healthy worktree (non-terminal, lease fresh)", () => {
		expect(shouldReclaimWorktree(false, false, true)).toBe<WorktreeReclaimAction>("ignore");
	});

	it("ignores an orphan worktree outside .omk/worktrees", () => {
		expect(shouldReclaimWorktree(false, true, false)).toBe<WorktreeReclaimAction>("ignore");
	});

	it("treats terminal as dominant: terminal+expired+under-prefix still removes", () => {
		expect(shouldReclaimWorktree(true, true, true)).toBe<WorktreeReclaimAction>("remove");
	});

	it("never returns remove for any path outside .omk/worktrees", () => {
		const outcomes: WorktreeReclaimAction[] = [
			shouldReclaimWorktree(true, true, false),
			shouldReclaimWorktree(true, false, false),
			shouldReclaimWorktree(false, true, false),
			shouldReclaimWorktree(false, false, false),
		];
		expect(outcomes.every((o) => o !== "remove")).toBe(true);
	});
});
