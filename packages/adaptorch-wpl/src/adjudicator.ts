/**
 * Outcome Adjudicator (Part 2 sections 2, 3, 5) - a wrapper-side verification layer that
 * turns AdaptOrch's own terminal-status report into a corroborated 5-state verdict, using
 * only `getRun`/`getArtifacts`/`getTraces` introspection.
 *
 * These introspection shapes lack authenticated, scope-bound execution proof. Passing
 * structural hooks or a server/model PASS therefore remains INDETERMINATE. This
 * implementation does not produce CONFIRMED until a positive proof contract exists.
 *
 * Out of scope for this file (not covered by the input contract available here): the
 * scope check and freshness check from Part 2 section 2.3, and the retry-count threshold
 * from section 2.3, since none of `AdjudicationRequest`, `VerifierRegistryEntry`, or the
 * client return shapes carry lane-scope, artifact-timestamp, or run-start-time data to
 * check them against. What is implemented here: the non-empty check (honoring
 * `allow_zero_artifacts`), the section 3 ambiguous-data fork, `content_check`,
 * `trace_check`, an error-span heuristic scan, and the `expected_min_actions` count.
 */

import type { AdaptOrchClient } from "./adaptorch-client.ts";
import { aggregateRunVerdicts } from "./adjudicator-aggregate.ts";
import {
	asList,
	countActionSpans,
	countErrorSpans,
	failedCheckReasonCode,
	hasSubstance,
} from "./adjudicator-evidence.ts";
import type {
	AdjudicationReasonCode,
	CheckResult,
	VerdictState,
	VerifierRegistryEntry,
} from "./adjudicator-registry.ts";
import { reduceReasonCodes } from "./adjudicator-registry.ts";
import { interpretRunSemantics } from "./adjudicator-semantics.ts";

/** Raw payload shape returned by `AdaptOrchClient.getRun`, inferred rather than duplicated. */
type RunPayload = Awaited<ReturnType<AdaptOrchClient["getRun"]>>;
/** Raw payload shape returned by `AdaptOrchClient.getArtifacts`, inferred rather than duplicated. */
type ArtifactsPayload = Awaited<ReturnType<AdaptOrchClient["getArtifacts"]>>;
/** Raw payload shape returned by `AdaptOrchClient.getTraces`, inferred rather than duplicated. */
type TracesPayload = Awaited<ReturnType<AdaptOrchClient["getTraces"]>>;

/**
 * Adjudication input (Part 2 section 2.1), sourced from the Dispatch Record and Work
 * Packet on the core-algorithm side. Both fields are mandatory; `run_ids` must be
 * non-empty (an empty list is treated as a malformed request, section 2.1/2.4).
 */
export interface AdjudicationRequest {
	dispatch_record_id: string;
	kind: string;
	run_ids: string[];
}

/**
 * A single `run_id`'s own verdict, reason, and evidence references (Part 2 section 5).
 * Preserved verbatim inside the record-level {@link AdjudicationResult}; never summarized
 * away, even when the request has only one `run_id`.
 */
export interface PerRunVerdict {
	run_id: string;
	verdict: VerdictState;
	/** Machine-readable classification; disposition logic branches on this, never on `reason`. */
	reason_code: AdjudicationReasonCode;
	/** Human-readable explanation, for logs and review UIs only. */
	reason: string;
	evidence_refs: unknown;
}

/**
 * Record-level adjudication output (Part 2 section 2.5 aggregation; section 5 record
 * shape). `augmented_payload` is present only when the looked-up registry entry defines
 * `build_augmented_payload` and the record-level verdict is not CONFIRMED (section 4).
 */
export interface AdjudicationResult {
	verdict: VerdictState;
	/**
	 * Machine-readable classification, reduced worst-wins from the `per_run` entries that
	 * share the record-level verdict. `projectVerdictToDisposition` branches on this code
	 * exclusively; `reason` is never string-matched.
	 */
	reason_code: AdjudicationReasonCode;
	/** Human-readable explanation, for logs and review UIs only. */
	reason: string;
	per_run: PerRunVerdict[];
	augmented_payload?: unknown;
}

/** Snapshot of the raw payloads a single `run_id`'s verdict was computed from (section 5). */
interface RunEvidence {
	run?: RunPayload;
	artifacts?: ArtifactsPayload;
	traces?: TracesPayload;
}

interface RunOutcome {
	run_id: string;
	verdict: VerdictState;
	reason_code: AdjudicationReasonCode;
	reason: string;
	evidence: RunEvidence;
}

const NON_TERMINAL_STATUSES = new Set([
	"pending",
	"queued",
	"running",
	"in_progress",
	"in-progress",
	"scheduled",
	"dispatched",
	"starting",
	"initializing",
	"cancelling",
	"canceling",
]);
const SUCCESS_STATUSES = new Set(["completed", "success", "succeeded", "done", "ok", "finished"]);
const FAILURE_STATUSES = new Set([
	"failed",
	"failure",
	"error",
	"errored",
	"cancelled",
	"canceled",
	"timeout",
	"timed_out",
	"aborted",
]);

type RunStatusBranch = "non-terminal" | "success" | "failure" | "unparseable";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, keys: string[]): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of keys) {
		const field = value[key];
		if (typeof field === "string") return field;
	}
	return undefined;
}

/**
 * Interprets a `getRun` payload into the branch the OA cares about (Part 2 section 2.2).
 * A payload with no recognizable string status field is treated as unparseable - a
 * checker failure, not a target-task failure (section 2.4, VERIFIER-ERROR).
 */
function interpretRunStatus(run: unknown): RunStatusBranch {
	const status = readStringField(run, ["status", "state"]);
	if (status === undefined) return "unparseable";
	const normalized = status.trim().toLowerCase();
	if (NON_TERMINAL_STATUSES.has(normalized)) return "non-terminal";
	if (SUCCESS_STATUSES.has(normalized)) return "success";
	if (FAILURE_STATUSES.has(normalized)) return "failure";
	return "unparseable";
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Adjudicates a single `run_id` against the resolved registry entry (Part 2 sections
 * 2.2-2.4 and 3). Robust to a misbehaving fetch: any thrown error from the client during
 * this run's own fetch/check sequence becomes that run_id's own VERIFIER-ERROR rather
 * than propagating out of {@link adjudicate}.
 */
async function adjudicateRun(
	runId: string,
	entry: VerifierRegistryEntry,
	client: AdaptOrchClient,
): Promise<RunOutcome> {
	const evidence: RunEvidence = {};
	try {
		const run = await client.getRun(runId);
		evidence.run = run;

		const semantic = interpretRunSemantics(run);
		// A policy/capability refusal must survive incomplete or unknown lifecycle data.
		if (semantic?.reason_code === "SEMANTIC_BLOCKED") {
			return { run_id: runId, verdict: "INDETERMINATE", ...semantic, evidence };
		}
		const branch = interpretRunStatus(run);
		if (branch === "unparseable") {
			return {
				run_id: runId,
				verdict: "VERIFIER-ERROR",
				reason_code: "RUN_STATUS_UNPARSEABLE",
				reason: "run-status-unparseable",
				evidence,
			};
		}
		if (branch === "non-terminal") {
			return {
				run_id: runId,
				verdict: "INDETERMINATE",
				reason_code: "RUN_NOT_TERMINAL",
				reason: "run-not-terminal",
				evidence,
			};
		}

		if (semantic !== undefined) {
			return { run_id: runId, verdict: "INDETERMINATE", ...semantic, evidence };
		}

		const artifacts = await client.getArtifacts(runId);
		evidence.artifacts = artifacts;
		const traces = await client.getTraces(runId);
		evidence.traces = traces;

		const artifactsList = asList(artifacts);
		const tracesList = asList(traces);
		if (artifactsList === undefined || tracesList === undefined) {
			return {
				run_id: runId,
				verdict: "VERIFIER-ERROR",
				reason_code: "EVIDENCE_MALFORMED",
				reason: "artifact-or-trace-collection-malformed",
				evidence,
			};
		}
		const artifactsEmpty = artifactsList.length === 0;
		const tracesEmpty = tracesList.length === 0;
		const isSuccess = branch === "success";

		// Part 2 section 3: absence of contrary evidence is never read as confirming evidence.
		if ((artifactsEmpty && !entry.allow_zero_artifacts) || tracesEmpty) {
			if (isSuccess && artifactsEmpty && tracesEmpty && entry.no_evidence_on_success_is_contradiction) {
				return {
					run_id: runId,
					verdict: "CONTRADICTED",
					reason_code: "NO_EVIDENCE_ON_SUCCESS",
					reason: "no-evidence-on-success-is-contradiction",
					evidence,
				};
			}
			const reasons: string[] = [];
			if (artifactsEmpty && !entry.allow_zero_artifacts) reasons.push("artifacts-empty-unexpected");
			if (tracesEmpty) reasons.push("traces-empty-unexpected");
			return {
				run_id: runId,
				verdict: "INDETERMINATE",
				reason_code: "EVIDENCE_EMPTY",
				reason: reasons.join(","),
				evidence,
			};
		}

		if (!isSuccess) {
			// CORROBORATED-FAILURE: reported failure, and the ambiguous-data fork above
			// already ruled out the case where evidence was too thin to say anything.
			return {
				run_id: runId,
				verdict: "CORROBORATED-FAILURE",
				reason_code: "FAILURE_REPORTED",
				reason: "failure-reported",
				evidence,
			};
		}

		const problems: { code: AdjudicationReasonCode; message: string }[] = [];
		if (artifactsList.some((artifact) => !hasSubstance(artifact))) {
			problems.push({ code: "EMPTY_ARTIFACT_CONTENT", message: "artifact-empty-or-whitespace" });
		}
		if (entry.content_check) {
			for (const artifact of artifactsList) {
				const result: CheckResult = entry.content_check(artifact);
				if (!result.ok) {
					problems.push({
						code: failedCheckReasonCode(result.code, "CONTENT_CHECK_FAILED"),
						message: `content-check-failed${result.reason ? `: ${result.reason}` : ""}`,
					});
				}
			}
		}
		if (entry.trace_check) {
			const result: CheckResult = entry.trace_check(traces);
			if (!result.ok) {
				problems.push({
					code: failedCheckReasonCode(result.code, "TRACE_CHECK_FAILED"),
					message: `trace-check-failed${result.reason ? `: ${result.reason}` : ""}`,
				});
			}
		}
		const errorSpanCount = countErrorSpans(tracesList);
		if (errorSpanCount > 0) {
			problems.push({ code: "TRACE_ERROR_SPAN", message: `error-span-scan: ${errorSpanCount} error span(s) found` });
		}
		if (typeof entry.expected_min_actions === "number" && entry.expected_min_actions > 0) {
			const actionCount = countActionSpans(tracesList);
			if (actionCount < entry.expected_min_actions) {
				problems.push({
					code: "MIN_ACTIONS_UNMET",
					message: `expected-min-actions-not-met: found ${actionCount}, needed ${entry.expected_min_actions}`,
				});
			}
		}

		if (problems.length > 0) {
			return {
				run_id: runId,
				verdict: "CONTRADICTED",
				reason_code: reduceReasonCodes(problems.map((problem) => problem.code)),
				reason: problems.map((problem) => problem.message).join("; "),
				evidence,
			};
		}
		return {
			run_id: runId,
			verdict: "INDETERMINATE",
			reason_code: "VERIFICATION_UNAVAILABLE",
			reason: "structural-checks-passed-but-scoped-execution-verification-unavailable",
			evidence,
		};
	} catch (error) {
		return {
			run_id: runId,
			verdict: "VERIFIER-ERROR",
			reason_code: "RUN_FETCH_FAILED",
			reason: `run-adjudication-failed: ${describeError(error)}`,
			evidence,
		};
	}
}

/**
 * Adjudicates an `AdjudicationRequest` end to end (Part 2 sections 2.1-2.5, 3, 5).
 *
 * 1. Rejects malformed requests (missing `kind` or empty `run_ids`) as a record-level
 *    VERIFIER-ERROR with no per-`run_id` results (section 2.1/2.4).
 * 2. Resolves the per-kind verifier once (section 4) and applies it identically to every
 *    `run_id`, independently (section 2.2-2.4, 3).
 * 3. Reduces the per-`run_id` verdicts to one record-level verdict, worst-wins (section
 *    2.5), and never discards the per-`run_id` detail (section 5).
 * 4. Invokes `build_augmented_payload`, if defined, when the record-level verdict is not
 *    CONFIRMED and no run is explicitly BLOCKED. Other builder failures retain the
 *    legacy thrown-error contract (handled by runAdjudicationWithTimeout).
 */
export async function adjudicate(
	request: AdjudicationRequest,
	client: AdaptOrchClient,
	registry: { get(kind: string): VerifierRegistryEntry },
): Promise<AdjudicationResult> {
	// Capture identities before registry/user callbacks or any awaited transport can
	// mutate the caller's object. Array.from materializes sparse holes as undefined.
	const dispatchRecordId = request?.dispatch_record_id;
	const kind = request?.kind;
	const requestedRunIds = request?.run_ids;
	const runIds = Array.isArray(requestedRunIds) ? Array.from(requestedRunIds) : undefined;
	if (
		typeof dispatchRecordId !== "string" ||
		dispatchRecordId.trim().length === 0 ||
		typeof kind !== "string" ||
		kind.trim().length === 0 ||
		runIds === undefined ||
		runIds.length === 0 ||
		runIds.some((runId) => typeof runId !== "string" || runId.trim().length === 0)
	) {
		return {
			verdict: "VERIFIER-ERROR",
			reason_code: "MALFORMED_REQUEST",
			reason: "malformed-request-identity-or-run-ids",
			per_run: [],
		};
	}

	const entry = registry.get(kind);
	const outcomes: RunOutcome[] = [];
	for (const runId of runIds) {
		outcomes.push(await adjudicateRun(runId, entry, client));
	}

	const perRun: PerRunVerdict[] = outcomes.map((outcome) => ({
		run_id: outcome.run_id,
		verdict: outcome.verdict,
		reason_code: outcome.reason_code,
		reason: outcome.reason,
		evidence_refs: outcome.evidence,
	}));

	const result: AdjudicationResult = { ...aggregateRunVerdicts(perRun), per_run: perRun };
	const verdict = result.verdict;

	// A policy/capability refusal is not a retry path. Do not let an optional
	// corrective hook throw away that decision or perform unnecessary side effects.
	const semanticBlocked = perRun.some((run) => run.reason_code === "SEMANTIC_BLOCKED");
	if (entry.build_augmented_payload && verdict !== "CONFIRMED" && !semanticBlocked) {
		const artifactsByRun = outcomes.map((outcome) => ({
			run_id: outcome.run_id,
			artifacts: outcome.evidence.artifacts,
		}));
		const tracesByRun = outcomes.map((outcome) => ({ run_id: outcome.run_id, traces: outcome.evidence.traces }));
		result.augmented_payload = entry.build_augmented_payload(verdict, artifactsByRun, tracesByRun);
	}

	return result;
}
