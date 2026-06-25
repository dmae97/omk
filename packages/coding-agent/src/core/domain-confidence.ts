import type { DomainProfile, DomainScore, RouteConfidence, RouteResult } from "./domain-types.ts";

/** Score at/above which a domain is treated as a confident match. */
export const STRONG_THRESHOLD = 8;
/** Minimum non-zero score to avoid falling back to "general". */
export const WEAK_THRESHOLD = 4;
/** If the runner-up is within this margin of the leader (and leader < STRONG), flag ambiguous. */
export const AMBIGUITY_MARGIN = 2;

function fallbackProfile(registry: Readonly<Record<string, DomainProfile>>, fallbackDomainId: string): DomainProfile {
	const fallback = registry[fallbackDomainId];
	if (fallback) return fallback;
	const firstProfile = Object.values(registry)[0];
	if (firstProfile) return firstProfile;
	throw new Error("domain registry must contain at least one profile");
}

export function selectRoute(
	scores: readonly DomainScore[],
	registry: Readonly<Record<string, DomainProfile>>,
	fallbackDomainId = "general",
): RouteResult {
	const fallback = fallbackProfile(registry, fallbackDomainId);
	if (scores.length === 0 || scores[0].score < WEAK_THRESHOLD) {
		return {
			primary: fallback,
			scores,
			confidence: "fallback",
			reason:
				scores.length === 0
					? "no domain signals detected"
					: `best signal (${scores[0].label}=${scores[0].score}) below weak threshold (${WEAK_THRESHOLD})`,
			ambiguous: false,
		};
	}

	const leader = scores[0];
	const runner = scores[1];
	const ambiguous =
		runner !== undefined && leader.score < STRONG_THRESHOLD && leader.score - runner.score <= AMBIGUITY_MARGIN;
	const confidence: RouteConfidence = leader.score >= STRONG_THRESHOLD ? "confident" : "tentative";
	const primary = registry[leader.id] ?? fallback;
	const reason = ambiguous
		? `ambiguous: ${leader.label}(${leader.score}) vs ${runner.label}(${runner.score})`
		: `${leader.label} selected (${leader.score})`;

	return { primary, scores, confidence, reason, ambiguous };
}
