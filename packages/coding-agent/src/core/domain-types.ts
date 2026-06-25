import type { DomainProfile } from "./domain-loadouts.ts";

export type { DomainProfile, TriggerKind, TriggerSpec } from "./domain-loadouts.ts";

export interface RouteInput {
	/** The raw task/goal text. Lowercased internally; never mutated. */
	readonly task: string;
	/** Optional path hints, e.g. ["src/app/page.tsx", "Dockerfile", "tests/api.test.ts"]. */
	readonly paths?: readonly string[];
	/** Optional upstream-detected tags forwarded verbatim into the task text for matching. */
	readonly tags?: readonly string[];
}

export interface DomainScore {
	readonly id: string;
	readonly label: string;
	readonly score: number;
	/** Human-readable signal descriptions that contributed to the score. */
	readonly matchedSignals: readonly string[];
}

export type RouteConfidence = "confident" | "tentative" | "fallback";

export interface RouteResult {
	/** Chosen domain profile (the fallback profile when confidence === "fallback"). */
	readonly primary: DomainProfile;
	/** All domains scored, best first. */
	readonly scores: readonly DomainScore[];
	readonly confidence: RouteConfidence;
	/** Short, machine-friendly explanation of the decision. */
	readonly reason: string;
	/** True when the top two domains are within AMBIGUITY_MARGIN and neither is strong. */
	readonly ambiguous: boolean;
}
