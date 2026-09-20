/**
 * What to do when compaction summarization cannot run.
 *
 * The resilience ladder, in order:
 *   1. the resolved compaction model (caller's `summarize`),
 *   2. the live session model — a pinned `compaction.model` can be quota-dead
 *      while the model the user is actively talking to still serves traffic,
 *   3. a deterministic trim that needs no model at all.
 *
 * Step 3 exists because the alternative is stranding the run: once context is
 * over the window, a failed compaction means no later turn can succeed until
 * the billing cycle resets.
 *
 * Kept out of `compaction.ts` so the ladder is unit-testable without an
 * AgentSession, and so neither module carries the other's growth.
 */

import type { Model } from "omk-ai";
import { isQuotaExhaustionMessage } from "../provider-resilience.ts";
import { redactSensitiveTextForced } from "../redaction.ts";
import type { CompactionDetails, CompactionPreparation, CompactionResult } from "./compaction.ts";
import { applyCompactionKnowledgeTriage } from "./knowledge-triage.ts";
import { redactCredentialShapedContent } from "./transaction.ts";
import { computeFileLists, formatFileOperations } from "./utils.ts";

/** Upper bound on the reason text persisted into the compaction entry. */
const DETERMINISTIC_REASON_MAX_CHARS = 512;
/** Upper bound on the prior summary carried forward verbatim. */
const CARRIED_SUMMARY_MAX_CHARS = 16_384;

const DETERMINISTIC_EMERGENCY_HEADING = "## Deterministic emergency compaction";

/**
 * Detail shape unique to the no-model path. Kept here rather than on
 * `CompactionDetails` so a reader of a normal entry never has to wonder why a
 * `deterministicEmergency` flag exists on it.
 */
export interface DeterministicCompactionDetails extends CompactionDetails {
	readonly deterministicEmergency: true;
	/** Sanitized, bounded reason the model path was unavailable. */
	readonly deterministicReason: string;
}

function boundedSanitizedText(value: string, maxChars: number): string {
	const sanitized = redactCredentialShapedContent(redactSensitiveTextForced(value))
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
		.trim();
	return sanitized.length <= maxChars ? sanitized : `${sanitized.slice(0, maxChars - 1)}\u2026`;
}

/**
 * Compact without a model.
 *
 * Keeps exactly what `prepareCompaction()` already derived deterministically —
 * the prior summary, source-bound user rules, and file operations — plus the
 * recent window the cut point preserved. It never claims to be a model summary:
 * the heading and `details.deterministicEmergency` mark it as a trim, because
 * the dropped turns were discarded without semantic summarization.
 *
 * Takes no model, key, or stream function: the signature itself proves no
 * provider call can occur on this path.
 */
export function compactDeterministic(preparation: CompactionPreparation, reason: string): CompactionResult {
	const {
		firstKeptEntryId,
		messagesToSummarize,
		turnPrefixMessages,
		tokensBefore,
		previousSummary,
		previousRuleHistory,
		currentRuleEntries,
		fileOps,
	} = preparation;

	if (!firstKeptEntryId) {
		throw new Error("First kept entry has no UUID - session may need migration");
	}

	const safeReason = boundedSanitizedText(reason, DETERMINISTIC_REASON_MAX_CHARS);
	const carried =
		previousSummary === undefined ? "" : boundedSanitizedText(previousSummary, CARRIED_SUMMARY_MAX_CHARS);

	const sections = [
		DETERMINISTIC_EMERGENCY_HEADING,
		"Model summarization was unavailable, so the context was trimmed deterministically " +
			"rather than leaving the session unable to continue. This is not a model-generated " +
			"summary: older turns were dropped without semantic summarization, and only the " +
			"structured state below plus the retained recent window survive.",
		`Cause: ${safeReason.length > 0 ? safeReason : "unspecified summarization failure"}`,
	];
	if (carried.length > 0) {
		sections.push(`### Carried forward from the previous compaction\n\n${carried}`);
	}

	const triage = applyCompactionKnowledgeTriage({
		generatedSummary: sections.join("\n\n"),
		currentMessages: [...messagesToSummarize, ...turnPrefixMessages],
		currentEntries: currentRuleEntries,
		previousRules: previousRuleHistory?.rules,
		previousSummary,
		previousEntries: previousRuleHistory?.entries,
	});

	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	const summary = triage.summary + formatFileOperations(readFiles, modifiedFiles);

	return {
		summary,
		firstKeptEntryId,
		tokensBefore,
		details: {
			readFiles,
			modifiedFiles,
			preservedRules: [...triage.preservedRules],
			deterministicEmergency: true,
			deterministicReason: safeReason,
		} satisfies DeterministicCompactionDetails,
	};
}

export interface SummarizationFallbackInput {
	readonly preparation: CompactionPreparation;
	readonly primaryModel: Model<any>;
	/** The model the session is actually running, when known. */
	readonly sessionModel: Model<any> | undefined;
	/**
	 * Summarize on one model, resolving that model's own credentials. The
	 * generic failover list reuses the failed model's key across candidates, so
	 * a cross-provider rescue must resolve auth per call instead.
	 */
	readonly summarize: (model: Model<any>) => Promise<CompactionResult>;
	readonly isAborted: () => boolean;
}

function sameModel(a: Model<any>, b: Model<any>): boolean {
	return a.provider === b.provider && a.id === b.id;
}

/**
 * Run the summarization ladder. Aborts and non-quota failures propagate
 * unchanged — a transient 503 must retry its model, not silently degrade.
 */
export async function summarizeWithFallback(input: SummarizationFallbackInput): Promise<CompactionResult> {
	try {
		return await input.summarize(input.primaryModel);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (input.isAborted()) throw error;
		if (!isQuotaExhaustionMessage(message)) throw error;

		const session = input.sessionModel;
		if (session !== undefined && !sameModel(session, input.primaryModel)) {
			try {
				return await input.summarize(session);
			} catch (rescueError) {
				if (input.isAborted()) throw rescueError;
				// Session model could not help either; fall through to the trim.
			}
		}
		return compactDeterministic(input.preparation, message);
	}
}
