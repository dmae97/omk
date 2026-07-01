/**
 * Per-kind verifier registry for the Outcome Adjudicator (Part 2 section 4).
 *
 * A flat, explicit registry keyed by unit-of-work `kind` string. No dynamic plugin
 * discovery, no auto-loading - deliberately kept small and auditable per Part 2 section 4.
 */

/**
 * The five-state verdict model for a single `run_id` (Part 2 section 2.4). This is the
 * canonical, ground-truth output of the adjudication layer (Part 2 section 0).
 */
export type VerdictState = "CONFIRMED" | "CONTRADICTED" | "CORROBORATED-FAILURE" | "INDETERMINATE" | "VERIFIER-ERROR";

/**
 * Result of a single structural/content/trace check (Part 2 section 2.3).
 */
export interface CheckResult {
	ok: boolean;
	reason?: string;
}

/**
 * A single per-kind verifier registry entry (Part 2 section 4). Every field beyond `kind`
 * is optional; absence means the corresponding check/behavior is skipped or defaulted, as
 * described in section 4.
 */
export interface VerifierRegistryEntry {
	kind: string;
	/** Default false. When true, an empty artifact list is not penalized (section 3). */
	allow_zero_artifacts?: boolean;
	/** e.g. ["markdown", "diff"] (section 4). */
	expected_artifact_kinds?: string[];
	/** Minimum matching trace spans required. Default 0 (no requirement, section 2.3/4). */
	expected_min_actions?: number;
	/** Default false. When true, retries above 1 are flagged (section 2.3). */
	no_retry_masking?: boolean;
	/**
	 * Default false. When true, a `SUCCESS_REPORTED` run with both artifacts and traces
	 * empty is upgraded from INDETERMINATE to CONTRADICTED (section 3).
	 */
	no_evidence_on_success_is_contradiction?: boolean;
	/** Format/schema check driven by the unit-of-work's content check hook (section 2.3). */
	content_check?: (artifact: unknown) => CheckResult;
	/** Trace-driven check hook (section 2.3). */
	trace_check?: (traces: unknown) => CheckResult;
	/**
	 * Optional corrective payload builder, invoked only when the record-level verdict is
	 * not CONFIRMED (section 4). Absent means no augmented payload is produced for this
	 * kind - callers resubmit the unmodified original payload.
	 */
	build_augmented_payload?: (verdict: VerdictState, artifacts: unknown, traces: unknown) => unknown;
}

/**
 * The conservative, structural-only fallback verifier used for any `kind` without a
 * registered entry (Part 2 section 4). It can never reach CONFIRMED through a laxer path
 * than a registered kind would, and intentionally defines no `content_check`,
 * `trace_check`, or `build_augmented_payload`.
 */
export const DEFAULT_VERIFIER: VerifierRegistryEntry = {
	kind: "DEFAULT",
	allow_zero_artifacts: false,
};

/**
 * Builds a flat, Map-backed lookup table for verifier registry entries (Part 2 section 4).
 * No dynamic plugin discovery - the caller supplies the full, explicit entry list up front.
 * Lookups for a `kind` with no registered entry fall back to {@link DEFAULT_VERIFIER}.
 */
export function createVerifierRegistry(entries: VerifierRegistryEntry[]): { get(kind: string): VerifierRegistryEntry } {
	const byKind = new Map<string, VerifierRegistryEntry>();
	for (const entry of entries) {
		byKind.set(entry.kind, entry);
	}
	return {
		get(kind: string): VerifierRegistryEntry {
			return byKind.get(kind) ?? DEFAULT_VERIFIER;
		},
	};
}
