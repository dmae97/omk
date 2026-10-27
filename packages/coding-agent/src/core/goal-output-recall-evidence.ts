/**
 * Spec 106 D1: lifecycle hooks for goal recall files. Records state; deletes nothing unless the flag is
 * `delete` (spec 118 D2), where a verified passing re-run ACKs and removes eligible files.
 */
import { createHash } from "node:crypto";
import {
	type EvidenceLifecycleReport,
	evidenceLifecycleObserveEnabled,
	registerEvidenceArtifact,
	updateEvidenceArtifactsByOwner,
} from "./evidence-lifecycle.ts";
import { deleteSettledRecall } from "./evidence-lifecycle-delete.ts";
import { evidenceLifecycleReport } from "./evidence-lifecycle-report.ts";

/** The repair turn that reads the file and the re-run check that verifies the fix. */
export const RECALL_CONSUMERS = ["repair-turn", "acceptance-recheck"] as const;

export function registerRecallEvidence(file: string, goalId: string, bytes: number, contentSha256: string): void {
	registerEvidenceArtifact({
		producer: "goal-recall",
		path: file,
		owner: goalId,
		bytes,
		contentSha256,
		requiredConsumers: RECALL_CONSUMERS,
		goalActive: true,
	});
}

/**
 * A settled (non-aborted) re-run of `goalId`'s check consumed its earlier recall files; a pass also ends
 * the goal-active hold. A failing re-run keeps the goal-active hold (the next repair may still need them).
 */
export function observeRecallRecheck(goalId: string, passed: boolean): void {
	updateEvidenceArtifactsByOwner(goalId, {
		consumed: RECALL_CONSUMERS,
		verified: passed,
		...(passed ? { goalActive: false } : {}),
	});
	// Spec 118 D2 (`delete` only): a verified pass is the ACK; eligible recall files go now.
	if (passed) deleteSettledRecall(createHash("sha256").update(goalId).digest("hex"));
}

/** The goal was blocked with rounds exhausted: classify its recall files; holds stay (no state change). */
export function observeRecallBlockedExhausted(goalId: string): void {
	updateEvidenceArtifactsByOwner(goalId, { blockedExhausted: true });
}

/**
 * The `goal_verification` field: this session's counts-only report, absent when the flag is off. The session
 * id is read only when the flag is on, so flag-off callers touch nothing new.
 */
export function evidenceReportField(ctx: { readonly sessionManager: { getSessionId(): string } }): {
	evidenceLifecycle?: EvidenceLifecycleReport;
} {
	if (!evidenceLifecycleObserveEnabled()) return {};
	return { evidenceLifecycle: evidenceLifecycleReport(ctx.sessionManager.getSessionId()) };
}
