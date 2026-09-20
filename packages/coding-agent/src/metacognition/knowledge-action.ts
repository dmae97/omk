/**
 * Bounded next-action selector for knowledge gaps.
 *
 * Split from knowledge.ts to keep each module under the repository's
 * 250-line module-size ratchet. Same behavior as the reference port.
 */

import type { Claim, KnowledgeReport } from "./knowledge.ts";
import { ensure, integer, member, text, unique } from "./validation.ts";

export type SearchChannel = "local" | "official" | "web";
export interface SearchAttempt {
	readonly claimId: string;
	readonly binding: string;
	readonly channel: SearchChannel;
	readonly result: "empty" | "failed" | "candidates" | "in-flight";
}
export interface ActionPolicy {
	readonly availableChannels: readonly SearchChannel[];
	readonly remoteQueryApprovedClaimIds: readonly string[];
	readonly remainingRequests: number;
	readonly remainingMs: number;
}
export type KnowledgeAction =
	| { readonly kind: "proceed"; readonly meaning: "evidence-predicates-satisfied-not-general-correctness" }
	| { readonly kind: "search"; readonly claimId: string; readonly channel: SearchChannel; readonly query: string }
	| { readonly kind: "run-check"; readonly claimId: string; readonly checkId: string }
	| {
			readonly kind:
				| "inspect-local"
				| "repair"
				| "review-candidates"
				| "await-owned-work"
				| "ask-user"
				| "form-obligations";
			readonly claimId: string;
	  }
	| { readonly kind: "blocked"; readonly claimId: string; readonly reason: string };

/** One bounded next action, not an autonomous recursion that can spend unbounded API calls. */
export function nextKnowledgeAction(
	report: KnowledgeReport,
	claims: readonly Claim[],
	attempts: readonly SearchAttempt[],
	policy: ActionPolicy,
): KnowledgeAction {
	integer(policy.remainingRequests, "remainingRequests");
	integer(policy.remainingMs, "remainingMs");
	unique(policy.availableChannels, "availableChannels", 3);
	for (const channel of policy.availableChannels) member(channel, ["local", "official", "web"], "search channel");
	unique(policy.remoteQueryApprovedClaimIds, "remote approvals", 128);
	ensure(attempts.length <= 4096, "too many search attempts");
	for (const attempt of attempts) {
		text(attempt.claimId, "attempt claim");
		text(attempt.binding, "attempt binding");
		member(attempt.channel, ["local", "official", "web"], "attempt channel");
		member(attempt.result, ["empty", "failed", "candidates", "in-flight"], "attempt result");
	}
	const gap = report.gaps.find((g) => g.required);
	if (!gap) return { kind: "proceed", meaning: "evidence-predicates-satisfied-not-general-correctness" };
	const claimId = gap.claimId;
	if (gap.reason === "unassessed-step") return { kind: "form-obligations", claimId };
	if (gap.reason === "missing-user-decision") return { kind: "ask-user", claimId };
	if (gap.reason === "unknown-version") return { kind: "inspect-local", claimId };
	if (gap.reason === "failed-check") return { kind: "repair", claimId };
	if (gap.reason === "pending-check") return { kind: "await-owned-work", claimId };
	if (gap.reason === "missing-check") {
		ensure(gap.checkId !== null, "missing checkId");
		return { kind: "run-check", claimId, checkId: gap.checkId };
	}
	const claim = claims.find((c) => c.id === claimId && c.binding === gap.binding);
	ensure(claim !== undefined, "report has stale or unknown claim");
	const history = attempts.filter((a) => a.claimId === claimId && a.binding === gap.binding);
	if (history.some((a) => a.result === "in-flight")) return { kind: "await-owned-work", claimId };
	if (history.some((a) => a.result === "candidates")) return { kind: "review-candidates", claimId };
	if (policy.remainingRequests === 0 || policy.remainingMs === 0) {
		return { kind: "blocked", claimId, reason: "acquisition-budget-exhausted" };
	}
	for (const channel of ["local", "official", "web"] as const) {
		if (!policy.availableChannels.includes(channel) || history.some((a) => a.channel === channel)) continue;
		if (channel !== "local" && (!policy.remoteQueryApprovedClaimIds.includes(claimId) || claim.publicQuery === null))
			continue;
		return { kind: "search", claimId, channel, query: channel === "local" ? claim.statement : claim.publicQuery! };
	}
	return { kind: "blocked", claimId, reason: "no-approved-untried-source" };
}
