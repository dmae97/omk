import { selectRoute } from "./domain-confidence.ts";
import { DOMAIN_PROFILES, FALLBACK_DOMAIN_ID } from "./domain-loadouts.ts";
import { COMPILED_DOMAIN_REGISTRY, inspectDomainRegistry } from "./domain-registry.ts";
import { scoreDomains } from "./domain-score.ts";
import type { RouteInput, RouteResult } from "./domain-types.ts";

export { AMBIGUITY_MARGIN, STRONG_THRESHOLD, WEAK_THRESHOLD } from "./domain-confidence.ts";
export type { DomainScore, RouteConfidence, RouteInput, RouteResult, TriggerKind } from "./domain-types.ts";

/**
 * Classify a task into a domain.
 *
 * @example
 * routeDomain({ task: "build a login form with tailwind" }).primary.id === "frontend-ui"
 */
export function routeDomain(input: RouteInput): RouteResult {
	const task = input.task ?? "";
	const tags = input.tags ?? [];
	const paths = input.paths ?? [];
	const text = [...tags, task].join(" ").toLowerCase();
	const scores = scoreDomains(COMPILED_DOMAIN_REGISTRY, text, paths);
	return selectRoute(scores, DOMAIN_PROFILES, FALLBACK_DOMAIN_ID);
}

/** Return the compiled trigger inventory for inspection/testing. */
export function inspectRegistry(): readonly { id: string; triggerCount: number }[] {
	return inspectDomainRegistry();
}
