import type { DagSchedulePlan, ResolvedClaimEntry } from "./tool-dag-scheduler.ts";

/** Detach every mutable claim array/object at both boundaries of the LRU cache. */
export function copyDagClaimEntries(entries: readonly ResolvedClaimEntry[]): ResolvedClaimEntry[] {
	return entries.map((entry) => ({
		sourceIndex: entry.sourceIndex,
		resolution:
			entry.resolution.kind === "exclusive"
				? { kind: "exclusive" as const }
				: { kind: "claims" as const, claims: entry.resolution.claims.map((claim) => ({ ...claim })) },
		canonicalClaims: entry.canonicalClaims.map((claim) => ({ ...claim })),
	}));
}

export function copyDagSchedulePlan(plan: DagSchedulePlan): DagSchedulePlan {
	return {
		levels: plan.levels.map((level) => level.slice()),
		planKey: plan.planKey,
		entries: copyDagClaimEntries(plan.entries),
	};
}
