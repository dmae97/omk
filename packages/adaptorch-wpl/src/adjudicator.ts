/**
 * Outcome Adjudicator (Part 2 sections 2, 3, 5) - a wrapper-side verification layer that
 * turns AdaptOrch's own terminal-status report into a corroborated 5-state verdict, using
 * only `getRun`/`getArtifacts`/`getTraces` introspection.
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
import type { CheckResult, VerdictState, VerifierRegistryEntry } from "./adjudicator-registry.ts";

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
	return typeof value === "object" && value !== null;
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
	const normalized = status.toLowerCase();
	if (NON_TERMINAL_STATUSES.has(normalized)) return "non-terminal";
	if (SUCCESS_STATUSES.has(normalized)) return "success";
	if (FAILURE_STATUSES.has(normalized)) return "failure";
	return "unparseable";
}

/**
 * Coerces an unknown `getArtifacts`/`getTraces` payload into a flat list without assuming
 * a specific shape (the concrete return type belongs to the concurrently-authored
 * `adaptorch-client.ts`). Falls back to common pagination-style container keys, then to
 * treating a single non-null value as a one-item list.
 */
function asList(value: unknown): unknown[] {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) return value;
	if (isRecord(value)) {
		for (const key of ["items", "artifacts", "traces", "spans", "entries", "data", "results"]) {
			const field = value[key];
			if (Array.isArray(field)) return field;
		}
	}
	return [value];
}

/** True unless the item is a recognizably empty/whitespace-only value (Part 2 section 2.3). */
function hasSubstance(item: unknown): boolean {
	if (typeof item === "string") return item.trim().length > 0;
	if (isRecord(item)) {
		const size = item.size ?? item.byteLength ?? item.length;
		if (typeof size === "number") return size > 0;
		const text = readStringField(item, ["content", "text", "body"]);
		if (text !== undefined) return text.trim().length > 0;
	}
	return true;
}

/** Heuristic ERROR-severity span scan (Part 2 section 2.3), tolerant of unknown span shapes. */
function countErrorSpans(traces: unknown[]): number {
	let count = 0;
	for (const span of traces) {
		if (!isRecord(span)) continue;
		const level = readStringField(span, ["level", "severity", "status"]);
		if (level !== undefined && level.toLowerCase() === "error") {
			count += 1;
			continue;
		}
		if (span.error === true || span.isError === true) count += 1;
	}
	return count;
}

/**
 * Heuristic count of "action" spans for the `expected_min_actions` check (Part 2 sections
 * 2.3/4). Recognizes a handful of common marker fields; if none of the spans carry any of
 * them, falls back to the total span count so the check degrades to a coarse presence
 * signal instead of always failing.
 */
function countActionSpans(traces: unknown[]): number {
	let recognized = 0;
	let matched = 0;
	for (const span of traces) {
		if (!isRecord(span)) continue;
		const marker = readStringField(span, ["action", "tool_call", "toolCall", "kind", "type"]);
		if (marker !== undefined) {
			recognized += 1;
			if (/action|tool|write|edit|call/i.test(marker)) matched += 1;
		}
	}
	return recognized > 0 ? matched : traces.length;
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

		const branch = interpretRunStatus(run);
		if (branch === "unparseable") {
			return { run_id: runId, verdict: "VERIFIER-ERROR", reason: "run-status-unparseable", evidence };
		}
		if (branch === "non-terminal") {
			return { run_id: runId, verdict: "INDETERMINATE", reason: "run-not-terminal", evidence };
		}

		const artifacts = await client.getArtifacts(runId);
		evidence.artifacts = artifacts;
		const traces = await client.getTraces(runId);
		evidence.traces = traces;

		const artifactsList = asList(artifacts);
		const tracesList = asList(traces);
		const artifactsEmpty = artifactsList.length === 0;
		const tracesEmpty = tracesList.length === 0;
		const isSuccess = branch === "success";

		// Part 2 section 3: absence of contrary evidence is never read as confirming evidence.
		if ((artifactsEmpty && !entry.allow_zero_artifacts) || tracesEmpty) {
			if (isSuccess && artifactsEmpty && tracesEmpty && entry.no_evidence_on_success_is_contradiction) {
				return {
					run_id: runId,
					verdict: "CONTRADICTED",
					reason: "no-evidence-on-success-is-contradiction",
					evidence,
				};
			}
			const reasons: string[] = [];
			if (artifactsEmpty && !entry.allow_zero_artifacts) reasons.push("artifacts-empty-unexpected");
			if (tracesEmpty) reasons.push("traces-empty-unexpected");
			return { run_id: runId, verdict: "INDETERMINATE", reason: reasons.join(","), evidence };
		}

		if (!isSuccess) {
			// CORROBORATED-FAILURE: reported failure, and the ambiguous-data fork above
			// already ruled out the case where evidence was too thin to say anything.
			return { run_id: runId, verdict: "CORROBORATED-FAILURE", reason: "failure-reported", evidence };
		}

		const problems: string[] = [];
		if (artifactsList.some((artifact) => !hasSubstance(artifact))) {
			problems.push("artifact-empty-or-whitespace");
		}
		if (entry.content_check) {
			for (const artifact of artifactsList) {
				const result: CheckResult = entry.content_check(artifact);
				if (!result.ok) problems.push(`content-check-failed${result.reason ? `: ${result.reason}` : ""}`);
			}
		}
		if (entry.trace_check) {
			const result: CheckResult = entry.trace_check(traces);
			if (!result.ok) problems.push(`trace-check-failed${result.reason ? `: ${result.reason}` : ""}`);
		}
		const errorSpanCount = countErrorSpans(tracesList);
		if (errorSpanCount > 0) {
			problems.push(`error-span-scan: ${errorSpanCount} error span(s) found`);
		}
		if (typeof entry.expected_min_actions === "number" && entry.expected_min_actions > 0) {
			const actionCount = countActionSpans(tracesList);
			if (actionCount < entry.expected_min_actions) {
				problems.push(`expected-min-actions-not-met: found ${actionCount}, needed ${entry.expected_min_actions}`);
			}
		}

		if (problems.length > 0) {
			return { run_id: runId, verdict: "CONTRADICTED", reason: problems.join("; "), evidence };
		}
		return { run_id: runId, verdict: "CONFIRMED", reason: "all-checks-passed", evidence };
	} catch (error) {
		return {
			run_id: runId,
			verdict: "VERIFIER-ERROR",
			reason: `run-adjudication-failed: ${describeError(error)}`,
			evidence,
		};
	}
}

/** Worst-wins record-level reduction over per-`run_id` verdicts (Part 2 section 2.5). */
function reduceVerdicts(perRun: PerRunVerdict[]): VerdictState {
	const priority: VerdictState[] = [
		"VERIFIER-ERROR",
		"CONTRADICTED",
		"CORROBORATED-FAILURE",
		"INDETERMINATE",
		"CONFIRMED",
	];
	for (const state of priority) {
		if (perRun.some((r) => r.verdict === state)) return state;
	}
	return "CONFIRMED";
}

function buildRecordReason(verdict: VerdictState, perRun: PerRunVerdict[]): string {
	if (perRun.length === 1) return perRun[0].reason;
	const contributing = perRun.filter((r) => r.verdict === verdict).map((r) => `${r.run_id}: ${r.reason}`);
	return `${verdict} via ${contributing.join("; ")}`;
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
 *    CONFIRMED (section 4).
 */
export async function adjudicate(
	request: AdjudicationRequest,
	client: AdaptOrchClient,
	registry: { get(kind: string): VerifierRegistryEntry },
): Promise<AdjudicationResult> {
	if (!request.kind || request.run_ids.length === 0) {
		return {
			verdict: "VERIFIER-ERROR",
			reason: !request.kind ? "malformed-request-missing-kind" : "malformed-request-empty-run-ids",
			per_run: [],
		};
	}

	const entry = registry.get(request.kind);
	const outcomes: RunOutcome[] = [];
	for (const runId of request.run_ids) {
		outcomes.push(await adjudicateRun(runId, entry, client));
	}

	const perRun: PerRunVerdict[] = outcomes.map((outcome) => ({
		run_id: outcome.run_id,
		verdict: outcome.verdict,
		reason: outcome.reason,
		evidence_refs: outcome.evidence,
	}));

	const verdict = reduceVerdicts(perRun);
	const result: AdjudicationResult = {
		verdict,
		reason: buildRecordReason(verdict, perRun),
		per_run: perRun,
	};

	if (entry.build_augmented_payload && verdict !== "CONFIRMED") {
		const artifactsByRun = outcomes.map((outcome) => ({
			run_id: outcome.run_id,
			artifacts: outcome.evidence.artifacts,
		}));
		const tracesByRun = outcomes.map((outcome) => ({ run_id: outcome.run_id, traces: outcome.evidence.traces }));
		result.augmented_payload = entry.build_augmented_payload(verdict, artifactsByRun, tracesByRun);
	}

	return result;
}
