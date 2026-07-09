/**
 * Derive user-facing repair hints from wall verdict inputs (batch-1, no runner execution).
 */

import type { AdjudicationReasonCode } from "./adjudicator-registry.ts";
import type { UserVerdict } from "./b2c-verdict.ts";
import type { PolicyFlag } from "./policy-wall.ts";
import { POLICY_FLAG } from "./policy-wall.ts";

export interface RepairHintInput {
	userVerdict: UserVerdict;
	policyFlags: PolicyFlag[];
	adjudicationReasonCode?: AdjudicationReasonCode;
	previewOnly: boolean;
	diffPaths: string[];
}

const REASON_REPAIR: Partial<Record<AdjudicationReasonCode, string>> = {
	SCOPE_VIOLATION: "Narrow the change to approved write paths only, then re-run the wall.",
	SCHEMA_DRIFT: "Align outputs with the expected schema contract before resubmitting.",
	CONTENT_CHECK_FAILED: "Fix failing content checks on artifacts, then re-adjudicate.",
	NO_EVIDENCE_ON_SUCCESS: "Attach terminal run evidence before claiming success.",
	EMPTY_ARTIFACT_CONTENT: "Ensure artifacts contain substantive content, not placeholders.",
	TRACE_CHECK_FAILED: "Resolve trace verification failures on the reported run.",
	TRACE_ERROR_SPAN: "Clear error spans under a success status or mark the run failed.",
	MIN_ACTIONS_UNMET: "Record the minimum required actions for this kind.",
	RUN_FETCH_FAILED: "Retry fetching run evidence when the runner is available.",
	EVIDENCE_EMPTY: "Widen verification scope or wait for terminal run artifacts.",
};

/**
 * Produce ordered, de-duplicated repair hints for the verdict card.
 */
export function deriveRepairHints(input: RepairHintInput): string[] {
	const hints: string[] = [];

	if (input.policyFlags.includes(POLICY_FLAG.CANDIDATE_LEAK_SUSPECT)) {
		hints.push("Remove or relocate paths outside the approved write scope.");
	}
	if (input.policyFlags.includes(POLICY_FLAG.SECRET_SUSPECT)) {
		hints.push("Remove secret-like material from the diff; never commit credentials or private keys.");
	}
	if (input.policyFlags.includes(POLICY_FLAG.NON_NEGOTIABLE_BLOCKING)) {
		hints.push("Resolve non-negotiable policy blocks before apply or submit.");
	}
	if (input.policyFlags.includes(POLICY_FLAG.EVIDENCE_DAG_INCOMPLETE)) {
		hints.push("Complete the evidence DAG with terminal run ids (non-preview evaluation).");
	}
	if (input.previewOnly && input.policyFlags.includes(POLICY_FLAG.LOW_DISCRIMINATION)) {
		hints.push("Run a non-preview Deep Check with runner evidence for higher discrimination.");
	}

	if (input.adjudicationReasonCode !== undefined) {
		const fromReason = REASON_REPAIR[input.adjudicationReasonCode];
		if (fromReason !== undefined) {
			hints.push(fromReason);
		}
	}

	if (input.userVerdict === "INCONCLUSIVE" && input.diffPaths.length === 0) {
		hints.push("Provide a non-empty diff or explicit changed paths.");
	}
	if (input.userVerdict === "BLOCKED" && hints.length === 0) {
		hints.push("Regenerate the change set after addressing blocked reasons.");
	}
	if (input.userVerdict === "ADVISORY") {
		hints.push("Review advisory signals before applying in production.");
	}

	return [...new Set(hints)];
}
