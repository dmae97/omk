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
 * The closed, machine-readable vocabulary of adjudication reasons. Every
 * `PerRunVerdict`/`AdjudicationResult` carries exactly one of these codes alongside its
 * free-text `reason`; disposition logic (Part 3 §1, `loop.ts`) branches on the code only,
 * never on the reason text, which exists purely for humans and logs.
 *
 * Ordered by severity, worst first: {@link reduceReasonCodes} resolves a set of codes to
 * the earliest entry in this array, so escalation-class codes always win over
 * reroute-class codes, which win over plain-retry codes.
 */
export const ADJUDICATION_REASON_CODES = [
	/** A safety boundary was crossed (e.g. writes outside the lane's scope). Never auto-retried. */
	"SCOPE_VIOLATION",
	/** Output shape/schema does not match the packet's contract (explicit hook classification). */
	"SCHEMA_DRIFT",
	/** A registered `content_check` hook rejected an artifact (default code for failed content checks). */
	"CONTENT_CHECK_FAILED",
	/** Reported success but artifacts and traces are both empty, for a kind where that is contradictory. */
	"NO_EVIDENCE_ON_SUCCESS",
	/** An artifact exists but is empty or whitespace-only. */
	"EMPTY_ARTIFACT_CONTENT",
	/** A registered `trace_check` hook rejected the trace set (default code for failed trace checks). */
	"TRACE_CHECK_FAILED",
	/** The error-span scan found ERROR-severity spans under a reported success. */
	"TRACE_ERROR_SPAN",
	/** Fewer action spans than the registry entry's `expected_min_actions`. */
	"MIN_ACTIONS_UNMET",
	/** `getRun` payload carried no recognizable status field (checker failure, not task failure). */
	"RUN_STATUS_UNPARSEABLE",
	/** The evidence fetch/check sequence itself threw for this run. */
	"RUN_FETCH_FAILED",
	/** The `AdjudicationRequest` itself was malformed (missing kind / empty run_ids). */
	"MALFORMED_REQUEST",
	/** The run has not reached a terminal status yet. */
	"RUN_NOT_TERMINAL",
	/** Artifacts and/or traces were unexpectedly empty — too thin to judge either way. */
	"EVIDENCE_EMPTY",
	/** The run reported failure and the evidence does not contradict that report. */
	"FAILURE_REPORTED",
	/** Every check passed. */
	"ALL_CHECKS_PASSED",
] as const;

export type AdjudicationReasonCode = (typeof ADJUDICATION_REASON_CODES)[number];

/**
 * Worst-wins reduction over reason codes, using {@link ADJUDICATION_REASON_CODES} order
 * (earlier = more severe). Used both for a single run's collected problems and for the
 * record-level aggregation across `per_run` verdicts. Returns `ALL_CHECKS_PASSED` (the
 * neutral, least-severe element) for an empty input; callers only invoke it with at least
 * one code in practice.
 */
export function reduceReasonCodes(codes: readonly AdjudicationReasonCode[]): AdjudicationReasonCode {
	for (const code of ADJUDICATION_REASON_CODES) {
		if (codes.includes(code)) return code;
	}
	return "ALL_CHECKS_PASSED";
}

/**
 * Result of a single structural/content/trace check (Part 2 section 2.3).
 */
export interface CheckResult {
	ok: boolean;
	reason?: string;
	/**
	 * Optional machine-readable classification for a failed check. `SCOPE_VIOLATION` and
	 * `SCHEMA_DRIFT` are the codes the disposition layer treats specially (escalate /
	 * reroute-on-recurrence respectively); when absent, a failed check defaults to
	 * `CONTENT_CHECK_FAILED` (content checks) or `TRACE_CHECK_FAILED` (trace checks).
	 * Ignored when `ok` is true.
	 */
	code?: AdjudicationReasonCode;
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
