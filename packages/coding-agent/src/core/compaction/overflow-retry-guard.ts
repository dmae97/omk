import type { AgentMessage } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import { estimateTokens } from "./compaction.ts";

/**
 * Why replaying an overflowed request cannot succeed, or undefined when it can.
 *
 * Overflow recovery compacts and then resends the same request, so it only
 * helps if the compacted context actually fits. Compaction cuts at turn
 * boundaries and never inside a turn's tool results, so a single oversized turn
 * survives every pass — and the recovery loop retried regardless, spending a
 * provider round-trip per attempt before reporting advice that never said what
 * was too big.
 *
 * The measurement sums the messages themselves rather than reading the last
 * assistant's reported usage. After compaction that usage describes a context
 * that no longer exists, and trusting it would block a retry that would have
 * succeeded. Summing content can only under-report, so this blocks solely when
 * the surviving text genuinely cannot fit — a false "keep going" costs one
 * request, a false block costs the whole recovery.
 */
export function overflowRetryBlocked(messages: readonly AgentMessage[], contextWindow: number): string | undefined {
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;

	const retryMessages = withoutTrailingOverflowError(messages);
	let tokens = 0;
	for (const message of retryMessages) tokens += estimateTokens(message);
	if (tokens < contextWindow) return undefined;

	return (
		`Compaction could not fit the context: still ~${tokens.toLocaleString()} tokens against a ` +
		`${contextWindow.toLocaleString()}-token window. The newest turn alone exceeds the window, so retrying ` +
		`cannot help — shorten the latest input or switch to a larger-context model.`
	);
}

/** The retry drops the assistant error that reported the overflow, so it is not part of the next request. */
function withoutTrailingOverflowError(messages: readonly AgentMessage[]): readonly AgentMessage[] {
	const last = messages[messages.length - 1];
	const isOverflowError = last?.role === "assistant" && (last as AssistantMessage).stopReason === "error";
	return isOverflowError ? messages.slice(0, -1) : messages;
}
