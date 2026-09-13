/**
 * Domain profile types shared by the registry (`domain-loadouts.ts`) and the
 * provider-harness profiles (`domain-loadouts-provider-harness.ts`).
 * I/O-free; erasable TypeScript only.
 */

import type { LoadoutProfile } from "./loadouts.ts";

/** Signal kinds the router evaluates. */
export type TriggerKind = "keyword" | "regex" | "extension" | "path";

/**
 * One routing signal for a domain.
 *
 * - `keyword`: case-insensitive, word-boundary substring of the task text.
 *   Multi-word phrases are matched literally. Matched occurrences are counted
 *   (capped) so repeated mentions raise confidence.
 * - `regex`: matched against the lowercased task text via RegExp. Use for
 *   intent clusters that keywords cannot express compactly (e.g. `cve-\d`).
 * - `extension`: matched against the suffix of any provided path hint.
 * - `path`: glob fragment matched against any provided path hint.
 */
export interface TriggerSpec {
	readonly kind: TriggerKind;
	readonly pattern: string;
	readonly weight: number;
}

/** Domain routing + identity metadata layered on top of a LoadoutProfile. */
export interface DomainProfile extends LoadoutProfile {
	/** Stable domain id, e.g. "frontend-ui". Used as the registry key. */
	readonly id: string;
	/** Human label, e.g. "Frontend & UI". */
	readonly label: string;
	/** Deterministic routing signals consumed by `domain-router.ts`. */
	readonly triggers: readonly TriggerSpec[];
	/**
	 * Detailed English routing prompt. When the router selects this domain, the
	 * orchestrator prepends this to the lane's task prompt so the model knows
	 * exactly which capabilities to lean on and how to sequence the work.
	 */
	readonly routingPrompt: string;
}
