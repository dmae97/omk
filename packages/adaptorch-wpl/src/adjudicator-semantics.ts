/**
 * Negative gates for AdaptOrch get_run_summary (not transport completion).
 * Contract: dmae97/adaptorch b14bca93, control_plane/models.py and synthesis.py.
 * The correctness wall's PASS covers observability invariants only. No branch here
 * establishes execution authenticity, review coverage, or semantic correctness.
 */
import type { AdjudicationReasonCode } from "./adjudicator-registry.ts";

type SemanticGate = { reason_code: AdjudicationReasonCode; reason: string };

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function normalized(value: unknown): string | undefined {
	return typeof value === "string" ? value.trim().toUpperCase() : undefined;
}

export function interpretRunSemantics(value: unknown): SemanticGate | undefined {
	const run = record(value);
	if (run === undefined) return undefined; // lifecycle parser reports malformed runs
	const wall = record(run.correctness_wall);
	const wallVerdict = normalized(wall?.verdict);
	if (wallVerdict === "BLOCKED") {
		return { reason_code: "SEMANTIC_BLOCKED", reason: "adaptorch-correctness-wall-blocked" };
	}
	const result = normalized(run.result_status);
	if (result === "DEGRADED" || result === "FAILED") {
		return {
			reason_code: result === "DEGRADED" ? "RESULT_DEGRADED" : "RESULT_FAILED",
			reason: `adaptorch-result-${result.toLowerCase()}`,
		};
	}
	if (wallVerdict === "INCONCLUSIVE" || wallVerdict === "ADVISORY") {
		return { reason_code: "SEMANTIC_INCONCLUSIVE", reason: `adaptorch-wall-${wallVerdict.toLowerCase()}` };
	}
	if ((run.result_status != null && result !== "OK") || (run.correctness_wall != null && wallVerdict !== "PASS")) {
		return { reason_code: "SEMANTIC_STATUS_UNRECOGNIZED", reason: "adaptorch-result-or-wall-status-unrecognized" };
	}
	for (const [key, complete, incomplete] of [
		["evaluation_status", "COMPLETE", ["PENDING", "RUNNING", "ERROR"]],
		["score_validity_status", "VALID", ["UNSCORED", "PARTIAL"]],
	] as const) {
		if (run[key] == null) continue;
		const status = normalized(run[key]);
		if (status === complete) continue;
		return {
			reason_code: incomplete.some((known) => known === status)
				? "EVALUATION_INCOMPLETE"
				: "SEMANTIC_STATUS_UNRECOGNIZED",
			reason: `adaptorch-${key}-not-complete`,
		};
	}
	const diagnostics = record(run.diagnostics);
	const verification = record(diagnostics?.verification);
	// Engine diagnostics nest synthesis diagnostics under verification. Raw synthesis
	// adapters may expose the direct location; a negative signal in either survives.
	const corroboration = [record(verification?.corroboration), record(diagnostics?.corroboration)];
	if (corroboration.some((item) => item?.cross_candidate_evidence === false)) {
		return { reason_code: "CORROBORATION_INSUFFICIENT", reason: "adaptorch-cross-candidate-evidence-unavailable" };
	}
	const selected = record(verification?.selected);
	if (selected?.passed === false) {
		// A false result can mean verifier infrastructure failure, not candidate error.
		return { reason_code: "VERIFICATION_REPORTED_FAILURE", reason: "adaptorch-verification-did-not-pass" };
	}
	return undefined;
}
