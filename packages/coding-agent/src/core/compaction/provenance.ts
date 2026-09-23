/**
 * Preserved provenance for a compaction envelope, built from a captured branch.
 *
 * `PROVENANCE_CUSTOM_TYPES` is the single list of custom entry types the envelope
 * cites. The inert-tail commit rebase derives "context-inert" from the same list,
 * so a type added here is automatically never rebased over.
 */
import type { AgentMessage } from "omk-agent-core";
import type { Message } from "omk-ai";
import { sanitizeBinaryOutput } from "../../utils/shell.ts";
import { redactSensitiveTextForced } from "../redaction.ts";
import type { SessionEntry } from "../session-manager.ts";
import { type CompactionControlState, controlStateProvenance } from "./control-state.ts";
import { type CompactionPreservedProvenanceInput, redactCredentialShapedContent } from "./transaction.ts";

/** Custom entry types whose ids feed `CompactionPreservedProvenance`. */
export const PROVENANCE_CUSTOM_TYPES = Object.freeze({
	lane: "lane",
	acceptancePredicate: "acceptance_predicate",
	evidenceReceipt: "evidence_receipt",
	transcriptRepaired: "transcript_repaired",
	compactionTranscriptRepaired: "compaction_transcript_repaired",
} as const);

export const PROVENANCE_CUSTOM_TYPE_SET: ReadonlySet<string> = new Set(Object.values(PROVENANCE_CUSTOM_TYPES));

export interface ProvenanceCapture {
	readonly report: { readonly activeMessages: readonly AgentMessage[] };
	readonly branchEntries: readonly SessionEntry[];
	readonly controlState: CompactionControlState | null;
}

export function buildPreservedProvenance(
	capture: ProvenanceCapture,
	getUserMessageText: (message: Message) => string,
	worktree: string,
): CompactionPreservedProvenanceInput {
	let latestIntent = "Continue the current session";
	for (let index = capture.report.activeMessages.length - 1; index >= 0; index -= 1) {
		const message = capture.report.activeMessages[index];
		if (message?.role !== "user") continue;
		const candidate = redactCredentialShapedContent(
			sanitizeBinaryOutput(redactSensitiveTextForced(getUserMessageText(message)).trim())
				.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
				.slice(0, 16_384),
		);
		if (candidate.length > 0) latestIntent = candidate;
		break;
	}
	const modelHistory = capture.branchEntries
		.flatMap((entry) => {
			if (entry.type === "model_change") {
				return [{ entryId: entry.id, provider: entry.provider, modelId: entry.modelId }];
			}
			if (entry.type === "message" && entry.message.role === "assistant") {
				return [{ entryId: entry.id, provider: entry.message.provider, modelId: entry.message.model }];
			}
			return [];
		})
		.slice(-256);
	const customEntryIds = (customType: string): string[] =>
		capture.branchEntries
			.filter((entry) => entry.type === "custom" && entry.customType === customType)
			.map((entry) => entry.id);
	const control = controlStateProvenance(capture.controlState);
	return {
		latestIntent,
		openTasks: control.openTasks,
		laneIds: customEntryIds(PROVENANCE_CUSTOM_TYPES.lane),
		acceptancePredicateIds: customEntryIds(PROVENANCE_CUSTOM_TYPES.acceptancePredicate),
		evidenceReceiptIds: customEntryIds(PROVENANCE_CUSTOM_TYPES.evidenceReceipt),
		blockerReasons: control.blockerReasons,
		repairEventIds: [
			...customEntryIds(PROVENANCE_CUSTOM_TYPES.transcriptRepaired),
			...customEntryIds(PROVENANCE_CUSTOM_TYPES.compactionTranscriptRepaired),
		],
		branch: control.branch,
		worktree,
		modelHistory,
		nextAction: redactCredentialShapedContent(latestIntent.slice(0, 4096)) || "Continue the current session",
	};
}
