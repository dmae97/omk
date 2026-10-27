/**
 * Bash output observation (run log only, no flag): `<OMK_RUN_LOG_DIR>/bash-output.jsonl`.
 * One line per bash call with truncation numbers, so an A/B can count tasks that hit
 * `truncated:true` (spec 113). Never changes the tool result or model input.
 * Lines hold booleans and numbers only (no command text, no output body).
 */
import { appendRunLog, RUN_LOG_DIR_ENV } from "../run-log.ts";
import { editParentSessionId, editSessionId } from "./edit-match-observe.ts";

export const BASH_OUTPUT_RUN_LOG = "bash-output";

interface TruncationLike {
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputBytes: number;
}

type BashCtx = { sessionManager?: { getSessionId?: () => string } };

/** Max sessions whose seq counter is kept; least recently used is evicted beyond this. */
export const BASH_SEQ_SESSION_CAP = 1000;

/** Per-session seq counters, LRU-capped so a long-running process does not grow without bound. */
const seqBySession = new Map<string | null, number>();

function nextSeq(sessionId: string | null): number {
	const seq = (seqBySession.get(sessionId) ?? 0) + 1;
	// Re-insert so this session becomes most recently used.
	seqBySession.delete(sessionId);
	seqBySession.set(sessionId, seq);
	while (seqBySession.size > BASH_SEQ_SESSION_CAP) {
		const oldest = seqBySession.keys().next().value as string | null;
		seqBySession.delete(oldest);
	}
	return seq;
}

/** Test hook: number of sessions currently tracked. */
export function bashSeqSessionCount(): number {
	return seqBySession.size;
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Append one line for a finished bash call. No-op when the run log is off; never throws. */
export function logBashOutput(
	truncation: TruncationLike | undefined,
	ctx?: BashCtx,
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (!env[RUN_LOG_DIR_ENV]?.trim()) return;
	try {
		const sessionId = editSessionId(ctx);
		appendRunLog(
			BASH_OUTPUT_RUN_LOG,
			{
				event: "bash_output",
				seq: nextSeq(sessionId),
				ts: new Date().toISOString(),
				sessionId,
				parentSessionId: editParentSessionId(env),
				truncated: truncation?.truncated === true,
				totalLines: num(truncation?.totalLines),
				totalBytes: num(truncation?.totalBytes),
				outputBytes: num(truncation?.outputBytes),
			},
			{ env },
		);
	} catch {
		// Observation must never change the tool outcome.
	}
}
