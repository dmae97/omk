export type PlanProgressStatus = "not_started" | "in_progress" | "steps_checked";

export type VerificationEvidenceState =
	| { readonly state: "unverified"; readonly reason: string }
	| { readonly state: "stale_evidence"; readonly evidenceId: string; readonly reason: string }
	| { readonly state: "failed"; readonly evidenceId: string; readonly exitCode: number | null }
	| {
			readonly state: "verified_complete";
			readonly evidenceId: string;
			readonly evidenceDigest: string;
			readonly workspaceSha256: string;
	  };

export type EffectiveCompletionStatus = "working" | "claimed_unverified" | "verification_failed" | "verified_complete";

/**
 * Canonical completion contract shared across CLI, TUI, and RPC surfaces.
 * Plan progress and model claims are strictly non-authoritative; only a passing
 * verification receipt yields `verified_complete`.
 */
export interface CompletionStatusContract {
	readonly schemaVersion: "omk.completion-status.v1";
	readonly planProgress: {
		readonly completedSteps: number;
		readonly totalSteps: number;
		readonly status: PlanProgressStatus;
	};
	readonly modelClaim: {
		readonly claimedDone: boolean;
		readonly summary?: string;
		readonly authoritative: false;
	};
	readonly verification: VerificationEvidenceState;
	readonly effectiveStatus: EffectiveCompletionStatus;
}

export interface DeriveCompletionStatusInput {
	readonly completedSteps: number;
	readonly totalSteps: number;
	readonly modelClaimedDone: boolean;
	readonly modelSummary?: string;
	readonly verification: VerificationEvidenceState;
}

export function deriveCompletionStatusContract(input: DeriveCompletionStatusInput): CompletionStatusContract {
	const totalSteps = Math.max(0, Math.floor(input.totalSteps));
	const completedSteps = Math.max(0, Math.min(totalSteps, Math.floor(input.completedSteps)));
	const planStatus: PlanProgressStatus =
		totalSteps === 0 || completedSteps === 0
			? "not_started"
			: completedSteps >= totalSteps
				? "steps_checked"
				: "in_progress";

	let effectiveStatus: EffectiveCompletionStatus;
	if (input.verification.state === "verified_complete") {
		effectiveStatus = "verified_complete";
	} else if (input.verification.state === "failed") {
		effectiveStatus = "verification_failed";
	} else if (input.modelClaimedDone) {
		effectiveStatus = "claimed_unverified";
	} else {
		effectiveStatus = "working";
	}

	return {
		schemaVersion: "omk.completion-status.v1",
		planProgress: { completedSteps, totalSteps, status: planStatus },
		modelClaim: {
			claimedDone: input.modelClaimedDone,
			...(input.modelSummary !== undefined ? { summary: input.modelSummary } : {}),
			authoritative: false,
		},
		verification: input.verification,
		effectiveStatus,
	};
}

export function formatCompletionStatusBadge(contract: CompletionStatusContract): string {
	switch (contract.effectiveStatus) {
		case "verified_complete":
			return "✓ verified";
		case "verification_failed":
			return "✗ check failed";
		case "claimed_unverified":
			return "? claimed (unverified)";
		case "working":
			return `… ${contract.planProgress.completedSteps}/${contract.planProgress.totalSteps}`;
	}
}
