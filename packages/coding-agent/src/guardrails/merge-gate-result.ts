import type { MergeGateResult, TaskContract } from "../types/evidence.ts";

/** Combine already-evaluated gates without letting an empty set authorize a merge. */
export function combineMergeGateResults(contract: TaskContract, results: readonly MergeGateResult[]): MergeGateResult {
	if (results.length === 0) throw new TypeError("At least one evidence gate result is required");
	const blocked = results.filter((result) => result.status === "blocked");
	const conditional = results.filter((result) => result.status === "conditional");
	if (blocked.length > 0) {
		return {
			gateId: "fail-closed-merge-gate",
			status: "blocked",
			reason: `Blocked by ${blocked.length} gate(s): ${blocked.map((result) => result.reason).join("; ")}`,
			suggestion: "Resolve all blocking conditions before merge.",
			evidenceChecked: contract.requiredEvidence,
		};
	}
	if (conditional.length > 0) {
		return {
			gateId: "fail-closed-merge-gate",
			status: "conditional",
			reason: `Conditional pass: ${conditional.length} gate(s) have pending conditions.`,
			suggestion: "Complete pending evidence or waive with explicit approval.",
			evidenceChecked: contract.requiredEvidence,
		};
	}
	return {
		gateId: "fail-closed-merge-gate",
		status: "open",
		reason: "All merge gates passed. Evidence verified and contract verdict is acceptable.",
		evidenceChecked: contract.requiredEvidence,
	};
}
