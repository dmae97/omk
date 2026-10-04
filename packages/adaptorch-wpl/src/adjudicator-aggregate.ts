/**
 * Internal introspection reduction. Empty or malformed outcomes are checker errors.
 * CONFIRMED is inadmissible here until an authenticated execution-proof contract exists;
 * independent caller-owned proof projection remains a separate API.
 */
import type { AdjudicationReasonCode, VerdictState } from "./adjudicator-registry.ts";
import { ADJUDICATION_REASON_CODES, reduceReasonCodes } from "./adjudicator-registry.ts";

interface RunVerdictSummary {
	run_id: string;
	verdict: VerdictState;
	reason_code: AdjudicationReasonCode;
	reason: string;
}

export function aggregateRunVerdicts(perRun: readonly RunVerdictSummary[]): {
	verdict: VerdictState;
	reason_code: AdjudicationReasonCode;
	reason: string;
} {
	const priority: readonly VerdictState[] = [
		"VERIFIER-ERROR",
		"CONTRADICTED",
		"CORROBORATED-FAILURE",
		"INDETERMINATE",
	];
	const outcomes = Array.from(perRun);
	const verdict = priority.find((state) => outcomes.some((run) => run?.verdict === state));
	if (
		verdict === undefined ||
		outcomes.some(
			(run) =>
				!run ||
				!priority.includes(run.verdict) ||
				!ADJUDICATION_REASON_CODES.includes(run.reason_code) ||
				(run.verdict === "CONFIRMED") !== (run.reason_code === "ALL_CHECKS_PASSED"),
		)
	) {
		return {
			verdict: "VERIFIER-ERROR",
			reason_code: "MALFORMED_REQUEST",
			reason: "adjudication-produced-no-recognized-run-outcomes",
		};
	}
	const contributing = outcomes.filter((run) => run.verdict === verdict);
	return {
		verdict,
		reason_code: reduceReasonCodes(contributing.map((run) => run.reason_code)),
		reason:
			outcomes.length === 1
				? outcomes[0].reason
				: `${verdict} via ${contributing.map((run) => `${run.run_id}: ${run.reason}`).join("; ")}`,
	};
}
