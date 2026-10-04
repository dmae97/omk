import { join } from "node:path";
import { executeVerifiedLocalBash } from "../core/verified-bash-adapter.ts";
import { EvidenceReceiptStore } from "../guardrails/evidence-receipt-store.ts";
import { ReplayLedgerManager, VerifyReporterV2 } from "../guardrails/evidence-system.ts";
import { checkReceiptWithStrictGate } from "../guardrails/receipt-gate.ts";
import { VerifiedEvidenceExecutor } from "../guardrails/verified-executor.ts";
import type { EvidenceReceipt, MergeGateResult, WorkspaceScope } from "../types/evidence.ts";

export interface VerifiedCiCommandRequest {
	readonly evidenceDir: string;
	readonly goalId: string;
	readonly claim: string;
	readonly script: string;
	readonly cwd: string;
	readonly timeoutMs: number | null;
	readonly workspaceScope: WorkspaceScope;
	readonly shellPath?: string;
}

export interface VerifiedCiCommandResult {
	readonly exitCode: 0 | 1;
	readonly gate: MergeGateResult;
	readonly receipt: EvidenceReceipt;
	readonly receiptPath: string;
	readonly reportPath: string;
}

/** Execute one first-party CI verifier through the local receipt-bound bash path. */
export async function runVerifiedCiCommand(request: VerifiedCiCommandRequest): Promise<VerifiedCiCommandResult> {
	const executor = new VerifiedEvidenceExecutor({
		store: new EvidenceReceiptStore(join(request.evidenceDir, "receipts")),
		ledger: new ReplayLedgerManager(request.goalId, join(request.evidenceDir, "ledger", "events.jsonl")),
	});
	const execution = await executeVerifiedLocalBash({
		evidenceExecutor: executor,
		goalId: request.goalId,
		laneId: "ci-runner",
		claim: request.claim,
		script: request.script,
		cwd: request.cwd,
		timeoutMs: request.timeoutMs,
		workspaceScope: request.workspaceScope,
		executor: "ci-runner",
		...(request.shellPath !== undefined ? { shellPath: request.shellPath } : {}),
	});
	// The gate options wire recapture and the workspace-mutation freshness source to
	// this command's own ReplayLedger, so a mutation recorded after the receipt blocks.
	const { contract, gate } = checkReceiptWithStrictGate({
		executor,
		goalId: request.goalId,
		claim: request.claim,
		category: "release",
		finalRisk:
			"Receipt freshness covers the selected workspace scope (git dirty state or artifact set) plus ledger-sequenced workspace mutations.",
		execution,
	});
	const reportPath = new VerifyReporterV2({ outputDir: request.evidenceDir, goalId: request.goalId }).write(
		contract,
		gate,
	);
	return {
		exitCode: gate.status === "open" ? 0 : 1,
		gate,
		receipt: execution.receipt,
		receiptPath: execution.receiptPath,
		reportPath,
	};
}
