import {
	type ExecutionAttempt,
	evaluateTask,
	parseExecutionAttempt,
	parseStrictEvidenceBinding,
	parseTaskSpec,
	type StrictEvidenceBinding,
	type StrictEvidenceCompletion,
	type TaskSpec,
	type WaiverRecord,
} from "omk-protocol";
import type { EvidenceReceipt } from "../types/evidence.ts";
import { evidenceReceiptToObservation } from "./evidence-protocol.ts";
import { validateEvidenceReceipt } from "./evidence-receipt.ts";

export interface StrictEvidenceApprovalScope {
	readonly taskSpec: TaskSpec;
	readonly attempt: ExecutionAttempt;
	readonly binding: StrictEvidenceBinding;
	readonly requiredCheckIds: readonly string[];
}

export interface StrictEvidenceAdmission {
	readonly entries: readonly {
		readonly receipt: EvidenceReceipt;
		readonly completion: StrictEvidenceCompletion;
	}[];
	readonly pendingExecutionIds: readonly string[];
	readonly waivers?: readonly WaiverRecord[];
}

/**
 * Trusted host port, not a worker/JSON approval field. The host must authenticate origins,
 * bind exact receipt cores to executions and this scope, allocate sequences, and return a
 * complete atomic snapshot including all open producers. A checksum alone is insufficient.
 * null means admission unavailable/denied. Exceptions propagate; there is no legacy fallback.
 */
export type StrictEvidenceAdmissionHost = (scope: StrictEvidenceApprovalScope) => StrictEvidenceAdmission | null;

function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/**
 * Opt-in library adapter. Pin BEFORE verification; changing a round or check set requires
 * a new scope and renewed host approval. This is not wired into CLI/TUI or verified-run.
 */
export function createStrictEvidenceApprovalAdapter(
	scope: StrictEvidenceApprovalScope,
	admit: StrictEvidenceAdmissionHost,
) {
	if (typeof admit !== "function") throw new Error("Strict evidence requires a host admission callback");
	const pinned = freeze(structuredClone(scope));
	parseTaskSpec(pinned.taskSpec);
	parseExecutionAttempt(pinned.attempt);
	parseStrictEvidenceBinding(pinned.binding);
	if (
		pinned.requiredCheckIds.length === 0 ||
		new Set(pinned.requiredCheckIds).size !== pinned.requiredCheckIds.length ||
		pinned.requiredCheckIds.some((id) => typeof id !== "string" || id.trim().length === 0)
	) {
		throw new Error("Strict evidence requires a nonempty unique pinned check set");
	}
	if (
		pinned.taskSpec.taskId !== pinned.binding.taskId ||
		pinned.attempt.taskId !== pinned.binding.taskId ||
		pinned.attempt.candidateHash !== pinned.binding.candidateHash
	)
		throw new Error("Strict evidence scope mismatch");
	return Object.freeze({
		evaluate(request: { readonly evaluationId: string; readonly evaluatedAt: string }) {
			const admission = admit(pinned);
			if (admission === null) throw new Error("Strict evidence host admission denied");
			const snapshot = freeze(structuredClone(admission));
			const observations = snapshot.entries.map(({ receipt, completion }) => {
				const validated = validateEvidenceReceipt(receipt);
				const observation = evidenceReceiptToObservation(validated, pinned.attempt.attemptId);
				if (completion.observationId !== observation.observationId)
					throw new Error("Strict receipt identity mismatch");
				if (completion.verdict === "passed" && validated.core.status !== "passed") {
					throw new Error("Strict admission cannot promote a failed receipt");
				}
				const candidate = validated.core.workspaceAfter.manifestSha256;
				if (
					candidate !== completion.binding.candidateHash ||
					validated.core.workspaceBefore.manifestSha256 !== candidate
				) {
					throw new Error("Strict receipt workspace does not match admitted candidate");
				}
				return Object.freeze({ ...observation, facts: Object.freeze({ ...observation.facts, candidate }) });
			});
			return evaluateTask({
				...request,
				taskSpec: pinned.taskSpec,
				attempt: pinned.attempt,
				observations,
				waivers: snapshot.waivers,
				strictEvidence: {
					policy: "omk.strict-evidence.v1",
					binding: pinned.binding,
					requiredCheckIds: pinned.requiredCheckIds,
					pendingExecutionIds: snapshot.pendingExecutionIds,
					results: snapshot.entries.map(({ completion }) => completion),
				},
			});
		},
	});
}
