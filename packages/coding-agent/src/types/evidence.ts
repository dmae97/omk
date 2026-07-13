/**
 * Evidence and verification types for OMK v0.80.3+
 *
 * Defines contracts for agent completion evidence, replay persistence,
 * merge gating, and artifact validation.
 */

// ============================================================================
// Evidence Contract
// ============================================================================

export type EvidenceCategory =
	| "feature"
	| "bugfix"
	| "refactor"
	| "research"
	| "release"
	| "security"
	| "docs"
	| "orchestration";

export type EvidenceStatus = "pending" | "gathering" | "satisfied" | "failed" | "waived";

export interface EvidenceItem {
	/** What this evidence proves. */
	claim: string;
	/** Category of the task. */
	category: EvidenceCategory;
	/** Path to artifact or command that produced it. */
	artifactPath?: string;
	/** Command that can reproduce the evidence. */
	verificationCommand?: string;
	/** SHA-256 of the artifact for integrity. */
	hash?: string;
	/** When the evidence was gathered. */
	timestamp: string;
	/** Whether the evidence is available. */
	status: EvidenceStatus;
	/** Reason if evidence is missing or waived. */
	gapReason?: string;
}

export interface TaskContract {
	/** Unique task / goal identifier. */
	goalId: string;
	/** One-sentence completion claim. */
	completionClaim: string;
	/** Required evidence items. */
	requiredEvidence: EvidenceItem[];
	/** Remaining risk note. */
	finalRisk: string;
	/** Verdict: can the task be considered done? */
	verdict: "pass" | "fail" | "conditional";
	/** ISO-8601 timestamp of contract creation. */
	createdAt: string;
	/** ISO-8601 timestamp of last update. */
	updatedAt: string;
}

// ============================================================================
// Replay Ledger
// ============================================================================

export type ReplayEventType =
	| "session_start"
	| "tool_call"
	| "tool_result"
	| "message"
	| "guardrail_decision"
	| "lane_grant"
	| "merge_attempt"
	| "merge_blocked"
	| "evidence_gathered"
	| "contract_created"
	| "contract_updated"
	| "checkpoint"
	| "error";

export interface ReplayEvent {
	/** Monotonic sequence number within a session. */
	seq: number;
	/** Event type. */
	type: ReplayEventType;
	/** ISO-8601 timestamp. */
	timestamp: string;
	/** Goal or session identifier. */
	goalId: string;
	/** Optional lane identifier. */
	laneId?: string;
	/** Event-specific payload. */
	payload: unknown;
	/** SHA-256 of the serialized payload for integrity. */
	payloadHash: string;
	/** eventHash of the previous event in the chain ("genesis" for the first event). */
	prevHash: string;
	/** SHA-256 over [seq, type, timestamp, goalId, laneId, payloadHash, prevHash]. */
	eventHash: string;
}

export interface ReplayLedger {
	/** Session / goal this ledger belongs to. */
	goalId: string;
	/** Ordered event log. */
	events: ReplayEvent[];
	/** Path where the ledger is persisted. */
	ledgerPath: string;
	/** Last persisted sequence number. */
	lastPersistedSeq: number;
}

// ============================================================================
// Merge Gates
// ============================================================================

export type MergeGateStatus = "open" | "blocked" | "conditional";

export interface MergeGateResult {
	/** Gate identifier. */
	gateId: string;
	/** Current status. */
	status: MergeGateStatus;
	/** Human-readable reason. */
	reason: string;
	/** Suggested remediation. */
	suggestion?: string;
	/** Evidence that was checked. */
	evidenceChecked: EvidenceItem[];
}

export interface EvidenceGateCheck {
	/** Which evidence item was checked. */
	evidenceClaim: string;
	/** Whether it is satisfied. */
	satisfied: boolean;
	/** Reason if not satisfied. */
	reason?: string;
}

// ============================================================================
// Verify Reporter v2
// ============================================================================

export interface OmkVerifyResultV2 {
	goalId: string;
	status: "completed" | "failed" | "blocked" | "partial";
	summary: string;
	changedFiles: string[];
	evidence: EvidenceItem[];
	risks: string[];
	nextAction: string;
	/** Associated task contract. */
	contract?: TaskContract;
	/** Replay ledger path. */
	replayLedgerPath?: string;
	/** Merge gate results. */
	mergeGates: MergeGateResult[];
}

export interface CiReportV2 {
	goalId: string;
	status: string;
	summary: string;
	changedFilesCount: number;
	evidenceCount: number;
	risks: string[];
	markdown: string;
	contractVerdict?: string;
	mergeGateStatus?: string;
}
