import type { ReviewStore } from "./review-store.ts";

/** Only a structured correctness-wall verdict is authoritative; never search review prose. */
export function hasExplicitReviewBlock(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const run = value as Record<string, unknown>;
	const wall = run.correctness_wall;
	return (
		typeof wall === "object" &&
		wall !== null &&
		!Array.isArray(wall) &&
		typeof (wall as Record<string, unknown>).verdict === "string" &&
		((wall as Record<string, unknown>).verdict as string).trim().toUpperCase() === "BLOCKED"
	);
}

/** Remember an observed refusal so a later snapshot cannot enable a fresh paid retry. */
export async function persistReviewBlock(store: ReviewStore, key: string, runId: string): Promise<void> {
	for (let tries = 0; tries < 4; tries++) {
		const record = await store.read(key);
		if (!record || !record.attempts.some((attempt) => attempt.runId === runId))
			throw new Error("Unbound review refusal");
		if (record.blockedRunIds?.includes(runId)) return;
		if (
			await store.compareAndSwap(key, record.revision, {
				...record,
				revision: record.revision + 1,
				blockedRunIds: [...(record.blockedRunIds ?? []), runId],
			})
		)
			return;
	}
	throw new Error("Review refusal could not be persisted; manual reconciliation required");
}

/** Admission and an immediate structured refusal commit atomically; partial persistence cannot enable retry. */
export async function updateReviewAttempt(
	store: ReviewStore,
	key: string,
	requestSha256: string,
	index: number,
	runId?: string,
	blocked = false,
): Promise<void> {
	for (let tries = 0; tries < 4; tries++) {
		const current = await store.read(key);
		if (!current || current.attempts[index]?.requestSha256 !== requestSha256)
			throw new Error("Review reservation changed");
		if (current.attempts[index].state === "submitted") {
			if (runId && current.attempts[index].runId !== runId) throw new Error("Conflicting review run IDs");
			if (!blocked || !runId || current.blockedRunIds?.includes(runId)) return;
		}
		const attempts = current.attempts.map((attempt, i) =>
			i !== index
				? attempt
				: {
						...attempt,
						state: runId ? ("submitted" as const) : ("submission_unknown" as const),
						...(runId ? { runId } : {}),
					},
		);
		const blockedRunIds =
			runId && blocked ? [...new Set([...(current.blockedRunIds ?? []), runId])] : current.blockedRunIds;
		if (
			await store.compareAndSwap(key, current.revision, {
				...current,
				revision: current.revision + 1,
				attempts,
				blockedRunIds,
			})
		)
			return;
	}
	throw new Error("Review journal update conflict; reconciliation required");
}
