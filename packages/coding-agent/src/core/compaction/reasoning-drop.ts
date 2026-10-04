import type { AgentMessage } from "omk-agent-core";
import type { AssistantMessage, Message } from "omk-ai";
import { type ContextUsageEstimate, estimateContextTokens, estimateTokens } from "./compaction.ts";

type RoleMessage = AgentMessage | Message;

function lastUserIndex(messages: readonly RoleMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
	return -1;
}

function hasReasoning(message: RoleMessage): boolean {
	return message.role === "assistant" && message.content.some((block) => block.type === "thinking");
}

function withoutReasoning<T extends RoleMessage>(message: T): T {
	if (!hasReasoning(message)) return message;
	const assistant = message as AssistantMessage;
	return { ...assistant, content: assistant.content.filter((block) => block.type !== "thinking") } as T;
}

/** Providers drop reasoning from turns a later user message closed; only the turn in progress keeps it. */
export function dropClosedTurnReasoning<T extends RoleMessage>(messages: readonly T[]): T[] {
	const turnStart = lastUserIndex(messages);
	return messages.map((message, index) => (index < turnStart ? withoutReasoning(message) : message));
}

/**
 * Projects a new user turn without the finished turn's reasoning: the provider drops it once the
 * new turn starts, yet the reported usage still counts it. Only the reasoning text kept in the
 * transcript is subtracted — providers may summarize it, so this under-corrects rather than
 * under-estimates. Undefined without a pending user turn or reasoning to drop.
 */
export function estimateNextTurnContextTokens(
	messages: AgentMessage[],
	pendingMessages: AgentMessage[],
	ignoreUsageAtOrBefore?: string,
): ContextUsageEstimate | undefined {
	if (!pendingMessages.some((message) => message.role === "user")) return undefined;
	const turnStart = lastUserIndex(messages);
	if (!messages.slice(turnStart + 1).some(hasReasoning)) return undefined;
	const boundary = ignoreUsageAtOrBefore ? Date.parse(ignoreUsageAtOrBefore) : Number.NaN;
	const all = [...messages, ...pendingMessages];
	const projected = estimateContextTokens(all, Number.isFinite(boundary) ? boundary : undefined);
	const covered = projected.lastUsageIndex ?? -1;
	let dropped = 0;
	for (let i = turnStart + 1; i <= covered; i++) {
		dropped += estimateTokens(all[i]) - estimateTokens(withoutReasoning(all[i]));
	}
	const trailingTokens = all
		.slice(covered + 1)
		.reduce((sum, message) => sum + estimateTokens(withoutReasoning(message)), 0);
	const usageTokens = Math.max(0, projected.usageTokens - dropped);
	return {
		tokens: usageTokens + trailingTokens,
		usageTokens,
		trailingTokens,
		lastUsageIndex: projected.lastUsageIndex,
	};
}
