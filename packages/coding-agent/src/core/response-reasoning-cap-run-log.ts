/**
 * `reasoning-cap.jsonl` lines for the per-response reasoning cap (spec 033 → spec 042).
 *
 * Bench runs use `--no-session --mode json`, so the cap's message diagnostics never reach a
 * session file. These lines carry the same numbers to `<OMK_RUN_LOG_DIR>/reasoning-cap.jsonl`.
 *
 * INVARIANT: every `retry` line gets exactly one terminal line with the same `attempt`:
 * `retry_end`, or `overrun_after_retry` instead of it when the retry also passes a cap.
 * {@link ReasoningCapRunLog.end} enforces "at most one"; the wrapper's error path calls it so
 * a retry that throws or is aborted still gets its `retry_end`.
 *
 * PRIVACY (spec 042): numbers, the cap reason, effort names and the `stopReason` enum only.
 * Never thinking/answer text, prompts or error messages.
 */
import type { StopReason, Usage } from "omk-ai";
import { appendRunLog, type RunLogRecord } from "./run-log.ts";

export const REASONING_CAP_RUN_LOG = "reasoning-cap";

/** The cap fields shared with the `response_reasoning_cap_*` diagnostics. */
export interface ReasoningCapDetails {
	readonly reason: string;
	readonly fromEffort: string | undefined;
	readonly toEffort: string | undefined;
	readonly reasoningTokens: number;
	readonly elapsedMs: number;
	readonly capTokens: number;
	readonly capMs: number;
}

export type ReasoningCapRunLogSink = (record: RunLogRecord) => void;

const defaultSink: ReasoningCapRunLogSink = (record) => {
	appendRunLog(REASONING_CAP_RUN_LOG, record);
};

/** Pairs lines within one process; lines from different processes pair on (`pid`, `attempt`). */
let lastAttemptId = 0;

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function usageTokens(usage: Usage | undefined): RunLogRecord {
	return {
		input: count(usage?.input),
		cacheRead: count(usage?.cacheRead),
		cacheWrite: count(usage?.cacheWrite),
		output: count(usage?.output),
		totalTokens: count(usage?.totalTokens),
	};
}

function capFields(details: ReasoningCapDetails): RunLogRecord {
	return {
		reason: details.reason,
		fromEffort: details.fromEffort ?? null,
		toEffort: details.toEffort ?? null,
		reasoningTokens: count(details.reasoningTokens),
		elapsedMs: count(details.elapsedMs),
		capTokens: count(details.capTokens),
		capMs: count(details.capMs),
	};
}

export interface ReasoningCapRunLog {
	readonly attempt: number;
	/** Write the terminal line for this retry. Only the first call writes; later calls are no-ops. */
	end(usage: Usage | undefined, stopReason: StopReason, overrun?: ReasoningCapDetails): void;
}

/**
 * Write the `retry` line for a cut first attempt and return the handle that writes its one
 * terminal line. Best effort: a failing sink never throws into the stream path.
 */
export function logReasoningCapRetry(
	details: ReasoningCapDetails,
	abortedUsage: Usage | undefined,
	sink: ReasoningCapRunLogSink = defaultSink,
): ReasoningCapRunLog {
	lastAttemptId += 1;
	const attempt = lastAttemptId;
	const write = (record: RunLogRecord) => {
		try {
			sink(record);
		} catch {
			// best effort (spec 042): logging never changes the stream
		}
	};
	write({ event: "retry", attempt, ...capFields(details), ...usageTokens(abortedUsage) });
	let ended = false;
	return {
		attempt,
		end(usage, stopReason, overrun) {
			if (ended) return;
			ended = true;
			const tokens = { ...usageTokens(usage), stopReason };
			write(
				overrun
					? { event: "overrun_after_retry", attempt, ...capFields(overrun), ...tokens }
					: { event: "retry_end", attempt, ...tokens },
			);
		},
	};
}
