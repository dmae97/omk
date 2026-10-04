import type { EvidenceCategory, EvidenceReceiptStatus, MergeGateResult, TaskContract } from "../types/evidence.ts";
import { EvidenceGate, TaskContractBuilder } from "./evidence-system.ts";
import type { VerifiedEvidenceExecutionResult, VerifiedEvidenceExecutor } from "./verified-executor.ts";

const PASSED_RECEIPT_STATUS = {
	passed: true,
	failed: false,
	timeout: false,
	aborted: false,
} as const satisfies Record<EvidenceReceiptStatus, boolean>;

export interface StrictReceiptGateInput {
	readonly executor: VerifiedEvidenceExecutor;
	readonly goalId: string;
	readonly claim: string;
	readonly category: EvidenceCategory;
	readonly finalRisk: string;
	readonly execution: VerifiedEvidenceExecutionResult;
}

export interface StrictReceiptGateResult {
	readonly contract: TaskContract;
	readonly gate: MergeGateResult;
	/** The receipt passed and the strict gate is open. */
	readonly passed: boolean;
}

/**
 * Check one receipt through a one-item task contract and the strict evidence gate.
 * The gate options come from the executor that produced the receipt, so recapture
 * and ledger freshness use that executor's own replay ledger.
 */
export function checkReceiptWithStrictGate(input: StrictReceiptGateInput): StrictReceiptGateResult {
	const { execution } = input;
	const receiptPassed = PASSED_RECEIPT_STATUS[execution.receipt.core.status];
	// Persist only the receipt's redacted command representation; the original
	// script may carry inline secrets and must never reach contract or report.
	const persistedCommand = execution.receipt.core.command;
	const verificationCommand =
		persistedCommand.kind === "shell"
			? persistedCommand.script
			: [persistedCommand.executable, ...persistedCommand.argv].join(" ");
	const contract = new TaskContractBuilder(input.goalId)
		.setClaim(input.claim)
		.addRequiredEvidence({
			claim: input.claim,
			category: input.category,
			verificationCommand,
			receiptId: execution.evidenceMetadata.receiptId,
			receiptSchemaVersion: 3,
			receiptCommandSha256: execution.evidenceMetadata.receiptCommandSha256,
			...(execution.evidenceMetadata.receiptLaneId !== undefined
				? { receiptLaneId: execution.evidenceMetadata.receiptLaneId }
				: {}),
		})
		.updateEvidenceStatus(input.claim, receiptPassed ? "satisfied" : "failed")
		.setFinalRisk(input.finalRisk)
		.setVerdict(receiptPassed ? "pass" : "fail")
		.build();
	const gate = new EvidenceGate({ receiptMode: "strict", ...input.executor.createGateOptions() }).check(contract);
	return { contract, gate, passed: receiptPassed && gate.status === "open" };
}
