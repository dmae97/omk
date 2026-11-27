import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type DurableGoalSnapshot, freshDurableGoalEvidence } from "./durable-goal.ts";
import type { GoalWorkspaceState } from "./goal-verification.ts";

export type GoalRecoveryReason =
	| "goal_terminal"
	| "approval_expired_on_restart"
	| "latest_check_failed"
	| "no_fresh_evidence"
	| "receipt_untrusted_or_missing"
	| "receipt_digest_mismatch"
	| "workspace_incomplete"
	| "workspace_drifted";

export interface TrustedReceiptSnapshot {
	readonly receiptId: string;
	readonly digest: string;
	readonly workspace: GoalWorkspaceState;
}

export interface ContractMatchedReceipt {
	readonly goalKey: string;
	readonly checkId: string;
	readonly contractRevision: number;
	readonly contractDigest: string;
	readonly digest: string;
	readonly workspace: GoalWorkspaceState;
}

export function collectMatchingTrustedReceipts(
	trusted: ReadonlyMap<string, ContractMatchedReceipt>,
	key: string,
	contract: { readonly command: string | undefined; readonly revision: number; readonly digest: string } | undefined,
): readonly TrustedReceiptSnapshot[] {
	if (contract?.command === undefined) return [];
	const out: TrustedReceiptSnapshot[] = [];
	for (const [receiptId, receipt] of trusted) {
		if (
			receipt.goalKey === key &&
			receipt.checkId === key &&
			receipt.contractRevision === contract.revision &&
			receipt.contractDigest === contract.digest
		) {
			out.push({ receiptId, digest: receipt.digest, workspace: receipt.workspace });
		}
	}
	return out;
}

export interface GoalRestartRecoveryInput {
	readonly goal: DurableGoalSnapshot;
	readonly hasActiveApproval: boolean;
	readonly latestCheckPassed: boolean | undefined;
	readonly trustedReceipts: readonly TrustedReceiptSnapshot[];
	readonly currentWorkspace: GoalWorkspaceState;
	readonly receiptMatches: (receiptId: string, digest: string) => boolean;
}

export type GoalRestartRecoveryVerdict =
	| {
			readonly status: "ready_to_complete";
			readonly evidenceId: string;
			readonly evidenceDigest: string;
			readonly workspaceSha256: string;
	  }
	| {
			readonly status: "needs_reverify";
			readonly reasons: readonly GoalRecoveryReason[];
			readonly requiresFreshApproval: boolean;
			readonly freshEvidenceCount: number;
			readonly staleEvidenceCount: number;
	  }
	| {
			readonly status: "blocked_not_resumable";
			readonly reasons: readonly GoalRecoveryReason[];
	  };

/**
 * Evaluate whether a durable goal's verification state survives restart and workspace checks.
 * Fail-closed: approvals never persist across process restart, stale generation evidence never
 * counts as fresh, and any post-check workspace drift invalidates completion.
 */
export function evaluateGoalRestartRecovery(input: GoalRestartRecoveryInput): GoalRestartRecoveryVerdict {
	if (input.goal.status === "completed" || input.goal.status === "cleared") {
		return { status: "blocked_not_resumable", reasons: ["goal_terminal"] };
	}

	const fresh = freshDurableGoalEvidence(input.goal);
	const staleCount = Math.max(0, input.goal.evidence.length - fresh.length);
	const reasons: GoalRecoveryReason[] = [];

	if (!input.hasActiveApproval) {
		reasons.push("approval_expired_on_restart");
	}
	if (input.latestCheckPassed === false) {
		reasons.push("latest_check_failed");
	}
	if (fresh.length === 0) {
		reasons.push("no_fresh_evidence");
	}

	const trustedById = new Map(input.trustedReceipts.map((r) => [r.receiptId, r]));
	const matchingTrusted = [...fresh].reverse().flatMap((evidence) => {
		const trusted = trustedById.get(evidence.id);
		if (!trusted || trusted.digest !== evidence.digest) return [];
		return [{ evidence, trusted }];
	});

	if (fresh.length > 0 && matchingTrusted.length === 0) {
		reasons.push("receipt_untrusted_or_missing");
	}

	if (input.currentWorkspace.completeness !== "complete") {
		reasons.push("workspace_incomplete");
	}

	if (reasons.length === 0) {
		let sawIncompleteReceipt = false;
		let sawDigestMismatch = false;
		let sawWorkspaceDrift = false;

		for (const { evidence, trusted } of matchingTrusted) {
			if (trusted.workspace.completeness !== "complete") {
				sawIncompleteReceipt = true;
				continue;
			}
			if (trusted.workspace.sha256 !== input.currentWorkspace.sha256) {
				sawWorkspaceDrift = true;
				continue;
			}
			if (!input.receiptMatches(evidence.id, evidence.digest)) {
				sawDigestMismatch = true;
				continue;
			}
			return {
				status: "ready_to_complete",
				evidenceId: evidence.id,
				evidenceDigest: evidence.digest,
				workspaceSha256: input.currentWorkspace.sha256,
			};
		}

		if (sawIncompleteReceipt) reasons.push("workspace_incomplete");
		if (sawWorkspaceDrift) reasons.push("workspace_drifted");
		if (sawDigestMismatch) reasons.push("receipt_digest_mismatch");
	}

	return {
		status: "needs_reverify",
		reasons: [...new Set(reasons)],
		requiresFreshApproval: !input.hasActiveApproval,
		freshEvidenceCount: fresh.length,
		staleEvidenceCount: staleCount,
	};
}

export function assertGoalRestartRecoveryReady(verdict: GoalRestartRecoveryVerdict): void {
	if (verdict.status !== "ready_to_complete") {
		throw new Error(`goal verification preflight failed (${verdict.reasons.join(", ")}); reverify with /goal verify`);
	}
}

export function formatGoalRecoveryFailure(
	verdict: Exclude<GoalRestartRecoveryVerdict, { readonly status: "ready_to_complete" }>,
): string {
	return `goal verification preflight failed (${verdict.reasons.join(", ")}); reverify with /goal verify`;
}

export function preflightGoalAcceptance(params: {
	readonly goal: DurableGoalSnapshot;
	readonly key: string;
	readonly contract:
		| {
				readonly command: string | undefined;
				readonly revision: number;
				readonly digest: string;
				readonly latestPassed?: boolean;
		  }
		| undefined;
	readonly trusted: ReadonlyMap<string, ContractMatchedReceipt>;
	readonly currentWorkspace: GoalWorkspaceState;
	readonly receiptMatches: (receiptId: string, digest: string) => boolean;
}): GoalRestartRecoveryVerdict {
	return evaluateGoalRestartRecovery({
		goal: params.goal,
		hasActiveApproval: params.contract?.command !== undefined,
		latestCheckPassed: params.contract?.latestPassed,
		trustedReceipts: collectMatchingTrustedReceipts(params.trusted, params.key, params.contract),
		currentWorkspace: params.currentWorkspace,
		receiptMatches: params.receiptMatches,
	});
}

export function computeAcceptanceGap(params: {
	readonly goal: DurableGoalSnapshot;
	readonly key: string;
	readonly contract:
		| {
				readonly command: string | undefined;
				readonly revision: number;
				readonly digest: string;
				readonly latestPassed?: boolean;
		  }
		| undefined;
	readonly trusted: ReadonlyMap<string, ContractMatchedReceipt>;
	readonly currentWorkspace: GoalWorkspaceState;
	readonly receiptMatches: (receiptId: string, digest: string) => boolean;
}): string | undefined {
	if (params.contract?.command === undefined) return "the approved acceptance check was withdrawn";
	if (params.contract.latestPassed === false) return "the latest acceptance check failed";
	const candidates = freshDurableGoalEvidence(params.goal)
		.flatMap((evidence) => {
			const trusted = params.trusted.get(evidence.id);
			return trusted?.goalKey === params.key &&
				trusted.checkId === params.key &&
				trusted.contractRevision === params.contract?.revision &&
				trusted.contractDigest === params.contract?.digest &&
				trusted.digest === evidence.digest
				? [{ evidence, trusted }]
				: [];
		})
		.reverse();
	if (candidates.length === 0) return "no passing acceptance receipt in this goal generation";
	if (params.currentWorkspace.completeness !== "complete") {
		return `workspace scope is incomplete (${params.currentWorkspace.completeness})`;
	}
	for (const { evidence, trusted } of candidates) {
		if (
			trusted.workspace.completeness === "complete" &&
			trusted.workspace.sha256 === params.currentWorkspace.sha256 &&
			params.receiptMatches(evidence.id, evidence.digest)
		) {
			return undefined;
		}
	}
	if (candidates.some(({ trusted }) => trusted.workspace.completeness !== "complete")) {
		return "workspace scope is incomplete in the acceptance receipt";
	}
	return "the workspace changed after the acceptance check passed";
}

/** True when a prior session wrote verification receipts for this goal instance on disk. */
export function hasPersistedVerificationReceipts(cwd: string, goalKey: string): boolean {
	try {
		return readdirSync(join(cwd, ".omk", "goals", "evidence", goalKey, "receipts")).length > 0;
	} catch {
		return false;
	}
}
export {
	type CoreRuntimeSelection,
	probeRustRuntimeWire,
	type RustCoreParityChecklist,
	type RustWireProbeResult,
	resolveCoreRuntimeSelection,
} from "./rust-core-runtime-bridge.ts";
