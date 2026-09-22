import type { AuthorityStatus, RunStatus } from "./run-status.ts";

/** A published ref and a terminated execution owner are independent observations. */
export function withOwnedGitStatus(status: RunStatus, authority: AuthorityStatus): RunStatus {
	const pending = authority.blockingGrants.filter(
		(grant) => grant.sessionId === status.runId && grant.claims.some((claim) => claim.namespace === "git-ref"),
	).length;
	if (pending === 0) return status;
	return Object.freeze({
		...status,
		cleanSuccess: false,
		terminal: false,
		pendingEffects: status.pendingEffects + pending,
		unresolved: Object.freeze([...new Set([...status.unresolved, "pending_effects" as const])]),
	});
}
