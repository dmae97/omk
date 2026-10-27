/**
 * Compaction observation (spec 116 step 1, run log only, no flag): `<OMK_RUN_LOG_DIR>/compaction.jsonl`.
 * One line per committed compaction with counts and a summary hash, so the spec 116 gate can
 * count tasks per candidate. Never changes the compaction result, session file or model input.
 * Lines hold numbers, booleans and a sha256 only (no summary text, no message content).
 */
import { createHash } from "node:crypto";
import type { AgentMessage } from "omk-agent-core";
import { appendRunLog, RUN_LOG_DIR_ENV } from "../run-log.ts";
import type { SessionEntry, SessionManager } from "../session-manager.ts";
import { editParentSessionId } from "../tools/edit-match-observe.ts";
import { type CompactionPreparation, type CompactionResult, estimateTokens } from "./compaction.ts";

export const COMPACTION_RUN_LOG = "compaction";
/** Spec 116 C1: tool results older than the newest N would be masked. */
export const STALE_TOOL_RESULT_KEEP = 5;
/** Max sessions whose seq counter is kept; least recently used is evicted beyond this. */
export const COMPACTION_SEQ_SESSION_CAP = 1000;

const seqBySession = new Map<string | null, number>();

function nextSeq(sessionId: string | null): number {
	const seq = (seqBySession.get(sessionId) ?? 0) + 1;
	seqBySession.delete(sessionId);
	seqBySession.set(sessionId, seq);
	while (seqBySession.size > COMPACTION_SEQ_SESSION_CAP) {
		const oldest = seqBySession.keys().next().value as string | null;
		seqBySession.delete(oldest);
	}
	return seq;
}

/** Test hook: number of sessions currently tracked. */
export function compactionSeqSessionCount(): number {
	return seqBySession.size;
}

function contentBytes(content: unknown): number {
	if (typeof content === "string") return Buffer.byteLength(content, "utf8");
	if (!Array.isArray(content)) return 0;
	let bytes = 0;
	for (const block of content) {
		const text = (block as { text?: unknown })?.text;
		if (typeof text === "string") bytes += Buffer.byteLength(text, "utf8");
	}
	return bytes;
}

const isToolResult = (m: AgentMessage): boolean => (m as { role?: string }).role === "toolResult";
const isUser = (m: AgentMessage): boolean => (m as { role?: string }).role === "user";

function entryMessages(entries: readonly SessionEntry[]): AgentMessage[] {
	const out: AgentMessage[] = [];
	for (const entry of entries) {
		const message = (entry as { type?: string; message?: AgentMessage }).message;
		if (entry.type === "message" && message) out.push(message);
	}
	return out;
}

const flagOn = (env: NodeJS.ProcessEnv, name: string): boolean => env[name]?.trim() === "1";

export interface CompactionObservation {
	readonly reason: "manual" | "threshold" | "overflow";
	readonly sessionId: string | null;
	readonly fromExtension: boolean;
	/** Branch entries at the trigger (before commit). */
	readonly pathEntries: readonly SessionEntry[];
	readonly preparation: CompactionPreparation;
	readonly result: CompactionResult;
	/** Context messages rebuilt after the commit. */
	readonly messagesAfter: readonly AgentMessage[];
}

/** Append one line for a committed compaction. No-op when the run log is off; never throws. */
export function logCompaction(obs: CompactionObservation, env: NodeJS.ProcessEnv = process.env): void {
	if (!env[RUN_LOG_DIR_ENV]?.trim()) return;
	try {
		const { preparation, result, pathEntries } = obs;
		const dropped = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
		const droppedTools = dropped.filter(isToolResult);
		const keptIndex = pathEntries.findIndex((e) => e.id === result.firstKeptEntryId);
		const keptEntries = keptIndex < 0 ? null : pathEntries.length - keptIndex;
		const contextTools = entryMessages(pathEntries).filter(isToolResult);
		const stale = contextTools.slice(0, Math.max(0, contextTools.length - STALE_TOOL_RESULT_KEEP));
		let tokensAfter = 0;
		for (const m of obs.messagesAfter) tokensAfter += estimateTokens(m);
		const summary = typeof result.summary === "string" ? result.summary : "";
		appendRunLog(
			COMPACTION_RUN_LOG,
			{
				event: "compaction",
				seq: nextSeq(obs.sessionId),
				ts: new Date().toISOString(),
				sessionId: obs.sessionId,
				parentSessionId: editParentSessionId(env),
				reason: obs.reason,
				fromExtension: obs.fromExtension,
				tokensBefore: Number.isFinite(result.tokensBefore) ? result.tokensBefore : null,
				tokensAfter,
				summaryTokens: Math.ceil(summary.length / 4),
				keptEntries,
				droppedEntries: dropped.length,
				droppedToolResults: droppedTools.length,
				droppedToolResultBytes: droppedTools.reduce(
					(n, m) => n + contentBytes((m as { content?: unknown }).content),
					0,
				),
				staleToolResultBytesAtTrigger: stale.reduce(
					(n, m) => n + contentBytes((m as { content?: unknown }).content),
					0,
				),
				userMessagesBeforeCut: dropped.filter(isUser).length,
				isSplitTurn: preparation.isSplitTurn === true,
				summarySha256: createHash("sha256").update(summary).digest("hex"),
				flags: {
					c1: flagOn(env, "OMK_COMPACT_MASK_STALE_TOOL_OUTPUT"),
					c2: flagOn(env, "OMK_COMPACT_STATE_SECTIONS"),
					c3: flagOn(env, "OMK_COMPACT_KEEP_USER_MESSAGES"),
				},
			},
			{ env },
		);
	} catch {
		// Observation must never change the compaction outcome.
	}
}

/**
 * AgentSession call site: one line after a committed compaction. Reads the session id and the
 * rebuilt context only when the run log is on. Never throws.
 */
export function observeCompaction(
	sessionManager: Pick<SessionManager, "getSessionId" | "buildSessionContext">,
	reason: CompactionObservation["reason"],
	fromExtension: boolean,
	pathEntries: readonly SessionEntry[],
	preparation: CompactionPreparation,
	result: CompactionResult,
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (!env[RUN_LOG_DIR_ENV]?.trim()) return;
	try {
		const sessionId = sessionManager.getSessionId() ?? null;
		const messagesAfter = sessionManager.buildSessionContext().messages;
		logCompaction({ reason, sessionId, fromExtension, pathEntries, preparation, result, messagesAfter }, env);
	} catch {
		// Observation must never change the compaction outcome.
	}
}
