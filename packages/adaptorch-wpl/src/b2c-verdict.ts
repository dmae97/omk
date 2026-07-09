/**
 * B2C Correctness Wall — user-facing verdict vocabulary (schemaVersion 1).
 */

import type { DeepWallRunnerEvidence, DeepWallStatus } from "./deep-wall.ts";
import type { SignedWallReceipt } from "./receipt-signature.ts";
import type { VerificationDigest } from "./signed-receipt.ts";

export const B2C_VERDICT_SCHEMA_VERSION = 1 as const;

/** End-user verdict (distinct from OA {@link VerdictState}). */
export type UserVerdict = "PASS" | "ADVISORY" | "INCONCLUSIVE" | "BLOCKED";

export type UserRiskLevel = "low" | "medium" | "high" | "critical";

/** Structured next-step for B2C verdict cards. */
export type VerdictNextAction = "Apply" | "Deep Check" | "Regenerate";

export interface VerdictLimits {
	/** When true, automated apply/submit must not proceed without human override. */
	requiresHumanReview: boolean;
	/** Preview-only evaluation; no side effects implied. */
	previewOnly: boolean;
	/** Machine-readable limit code (e.g. batch-1 no docker runner). */
	code?: string;
}

export interface VerdictCard {
	schemaVersion: typeof B2C_VERDICT_SCHEMA_VERSION;
	verdict: UserVerdict;
	risk: UserRiskLevel;
	limits: VerdictLimits;
	/** Checks that passed (human-readable). */
	passed_checks: string[];
	/** Reasons submission or apply is blocked (human-readable). */
	blocked_reasons: string[];
	/** Suggested follow-ups for the user or operator. */
	next_actions: VerdictNextAction[];
	/** Optional operator-facing repair guidance. */
	repairHints?: string[];
	packetId?: string;
	kind: string;
}

export interface VerificationReceipt {
	schemaVersion: typeof B2C_VERDICT_SCHEMA_VERSION;
	evaluatedAt: string;
	kind: string;
	packetId?: string;
	dispatchRecordId?: string;
	runIds: string[];
	previewOnly: boolean;
	/** Machine may apply the proposed change (distinct from shouldSubmit). */
	canApply: boolean;
	/** Packet may be submitted to downstream workflow. */
	shouldSubmit: boolean;
	policyFlags: string[];
	adjudicationVerdict?: string;
	adjudicationReasonCode?: string;
	diffPaths: string[];
	/** Human-readable limits / preview disclaimer. */
	disclaimer?: string;
	/** Patch/evidence fingerprints (no secret payload). */
	verificationDigest?: VerificationDigest;
	/** Correctness wall batch id for this evaluation receipt. */
	wallVersion?: string;
	/** Deep wall phase when {@link EvaluateCorrectnessWallParams.deepWall} was requested. */
	deepWallStatus?: DeepWallStatus;
	/** Structured evidence when deep wall reached `completed` (Wave 4-C3b). */
	deepWallEvidence?: DeepWallRunnerEvidence;
	/** Optional HMAC attestation when signing secret configured (Wave 3). */
	signedReceipt?: SignedWallReceipt;
}
