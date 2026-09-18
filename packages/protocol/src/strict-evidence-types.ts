/** Explicit host-admitted snapshot; none of these serializable fields authenticate a worker. */
export interface StrictEvidenceBinding {
	readonly taskId: string;
	readonly candidateHash: string;
	readonly contractDigest: string;
	readonly environmentDigest: string;
	readonly checkCodeDigest: string;
	readonly dependencyDigest: string;
	readonly generation: number;
	readonly verificationRound: number;
}

export interface StrictEvidenceCompletion {
	readonly observationId: string;
	readonly checkId: string;
	readonly binding: StrictEvidenceBinding;
	/** Sequence allocated by the accepting host, never worker wall time. */
	readonly sequence: number;
	readonly executionId: string;
	readonly previousExecutionId: string | null;
	readonly verdict: "passed" | "failed";
}

export interface StrictEvidenceSnapshot {
	readonly policy: "omk.strict-evidence.v1";
	readonly binding: StrictEvidenceBinding;
	readonly requiredCheckIds: readonly string[];
	/** Includes open producers and unknown/unsettled executions, even after a completed pass. */
	readonly pendingExecutionIds: readonly string[];
	readonly results: readonly StrictEvidenceCompletion[];
}

export interface StrictEvidenceReport {
	readonly policy: "omk.strict-evidence.v1";
	readonly status: "passed" | "violated" | "pending" | "inconclusive";
	readonly observationIds: readonly string[];
	readonly missingCheckIds: readonly string[];
	readonly acceptance: "passed_by_checks" | "accepted_with_waiver" | "denied";
}
