import type { AgentMessage } from "omk-agent-core";
import type { AssistantMessage, Message } from "omk-ai";
import type { CompactionUsageBoundary } from "../compaction-entry-time.ts";
import { type ContextUsageEstimate, estimateProjectedContextTokens, estimateTokens } from "./compaction.ts";

type RoleMessage = AgentMessage | Message;

function lastUserIndex(messages: readonly RoleMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
	return -1;
}

function hasReasoning(message: RoleMessage): boolean {
	return message.role === "assistant" && message.content.some((block) => block.type === "thinking");
}

/**
 * Spec 062: the stripped copy is reused while the source keeps the same own fields and content blocks, so the
 * admission JSON cache (keyed by message object) still hits for closed turns that carried reasoning.
 */
const strippedCopies = new WeakMap<object, { readonly snapshot: readonly unknown[]; readonly copy: RoleMessage }>();

function shallowSnapshot(message: AssistantMessage): unknown[] {
	const snapshot: unknown[] = [];
	for (const key of Object.keys(message)) snapshot.push(key, (message as unknown as Record<string, unknown>)[key]);
	snapshot.push(message.content.length, ...message.content);
	return snapshot;
}

function sameSnapshot(left: readonly unknown[], right: readonly unknown[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
	return true;
}

function withoutReasoning<T extends RoleMessage>(message: T): T {
	if (!hasReasoning(message)) return message;
	const assistant = message as AssistantMessage;
	const snapshot = shallowSnapshot(assistant);
	const cached = strippedCopies.get(assistant);
	if (cached && sameSnapshot(cached.snapshot, snapshot)) return cached.copy as T;
	const copy = { ...assistant, content: assistant.content.filter((block) => block.type !== "thinking") } as T;
	strippedCopies.set(assistant, { snapshot, copy });
	return copy;
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
	usageBoundary?: string | CompactionUsageBoundary,
): ContextUsageEstimate | undefined {
	if (!pendingMessages.some((message) => message.role === "user")) return undefined;
	const turnStart = lastUserIndex(messages);
	if (!messages.slice(turnStart + 1).some(hasReasoning)) return undefined;
	const all = [...messages, ...pendingMessages];
	const projected = estimateProjectedContextTokens(messages, pendingMessages, usageBoundary);
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
