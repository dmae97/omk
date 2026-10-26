/**
 * Where a compaction sits on its branch, in entry order and in time. Structural types only: this
 * module must not import session-manager.ts, which imports it.
 */

/**
 * Largest backward wall-clock step a compaction timestamp absorbs. Hypervisor resyncs (observed on
 * WSL2: ~6.8s) can stamp a compaction earlier than the messages it covers; a message further ahead
 * than this is treated as a bad clock, not a step, and does not pull the compaction into the future.
 */
const MAX_COMPACTION_CLOCK_STEP_MS = 60_000;

interface BranchEntryLike {
	readonly type: string;
	readonly message?: { readonly timestamp?: number };
}

export function getLatestCompactionEntry<E extends { readonly type: string }>(
	entries: readonly E[],
): Extract<E, { type: "compaction" }> | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") {
			return entries[i] as Extract<E, { type: "compaction" }>;
		}
	}
	return null;
}

/**
 * Timestamp for a compaction appended after `branch`. Usage at or before the latest compaction is
 * ignored as stale, and threshold checks skip messages at or before it, so a compaction must not be
 * stamped earlier than any message on its branch even when the wall clock stepped backward since
 * that message was written.
 */
export function compactionTimestamp(nowMs: number, branch: readonly BranchEntryLike[]): string {
	let latest = Number.NEGATIVE_INFINITY;
	for (const entry of branch) {
		const at = entry.type === "message" ? entry.message?.timestamp : undefined;
		if (at !== undefined && Number.isFinite(at)) latest = Math.max(latest, at);
	}
	// wall-clock: compares with persisted message timestamps, which are wall-clock epochs by design.
	const stepped = latest >= nowMs && latest - nowMs < MAX_COMPACTION_CLOCK_STEP_MS;
	return new Date(stepped ? latest + 1 : nowMs).toISOString();
}
