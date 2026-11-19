// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import type { AgentEndEvent, SessionEntry, SessionMessageEntry } from "open-multi-agent-kit";

const MINIMUM_PROSE_CHARACTERS = 200;
export type RewriteRequest = { target: string };
export type PreparedRewriteRequest = { entryId: string; request: RewriteRequest };
type AgentMessage = AgentEndEvent["messages"][number];
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

export function prepareRewriteRequest(
	messages: readonly AgentMessage[],
	branch: readonly SessionEntry[],
): PreparedRewriteRequest | undefined {
	const target = findEligibleTarget(messages);
	if (target === undefined) return undefined;
	const targetEntry = findTargetEntry(branch, target);
	return targetEntry === undefined ? undefined : prepareRequest(targetEntry, target);
}

export function prepareManualRewriteRequest(branch: readonly SessionEntry[]): PreparedRewriteRequest | undefined {
	const targetEntry = findLatestConversationalEntry(branch);
	if (targetEntry === undefined) return undefined;
	const target = targetEntry.message;
	if (target.role !== "assistant" || target.stopReason !== "stop" || hasToolCall(target)) return undefined;
	const targetText = joinTextBlocks(target.content);
	if (stripFencedCodeBlocks(targetText).trim() === "") return undefined;
	return prepareRequest(targetEntry, target);
}

export function stripFencedCodeBlocks(text: string): string {
	const proseLines: string[] = [];
	let openFence: { marker: "`" | "~"; length: number } | undefined;
	for (const line of text.split("\n")) {
		if (openFence !== undefined) {
			if (isClosingFence(line, openFence)) openFence = undefined;
			continue;
		}
		const fence = findOpeningFence(line);
		if (fence !== undefined) {
			openFence = fence;
			continue;
		}
		proseLines.push(line);
	}
	return proseLines.join("\n");
}

function findEligibleTarget(messages: readonly AgentMessage[]): AssistantMessage | undefined {
	const target = findFinalAssistantMessage(messages);
	if (target === undefined || target.stopReason !== "stop" || hasToolCall(target)) return undefined;
	const textBlocks = extractTextBlocks(target.content);
	if (!textBlocks.some((text) => text.trim() !== "")) return undefined;
	const targetText = textBlocks.join("\n\n");
	return stripFencedCodeBlocks(targetText).replaceAll(/\s/g, "").length >= MINIMUM_PROSE_CHARACTERS
		? target
		: undefined;
}
function findFinalAssistantMessage(messages: readonly AgentMessage[]): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "assistant") return message;
	}
	return undefined;
}
function findTargetEntry(branch: readonly SessionEntry[], target: AssistantMessage): SessionMessageEntry | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		if (entry.message === target || messagesMatch(entry.message, target)) return entry;
	}
	return undefined;
}
function findLatestConversationalEntry(branch: readonly SessionEntry[]): SessionMessageEntry | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"))
			return entry;
	}
	return undefined;
}
function prepareRequest(targetEntry: SessionMessageEntry, target: AssistantMessage): PreparedRewriteRequest {
	return { entryId: targetEntry.id, request: { target: joinTextBlocks(target.content) } };
}
function messagesMatch(left: AssistantMessage, right: AssistantMessage): boolean {
	return (
		left.stopReason === right.stopReason &&
		left.timestamp === right.timestamp &&
		joinTextBlocks(left.content) === joinTextBlocks(right.content) &&
		hasToolCall(left) === hasToolCall(right)
	);
}
function joinTextBlocks(content: unknown): string {
	return extractTextBlocks(content).join("\n\n");
}
function extractTextBlocks(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	const textBlocks: string[] = [];
	for (const block of content) if (isTextBlock(block)) textBlocks.push(block.text);
	return textBlocks;
}
function hasToolCall(message: AssistantMessage): boolean {
	return message.content.some((block) => isToolCallBlock(block));
}
function isTextBlock(block: unknown): block is { type: "text"; text: string } {
	return (
		typeof block === "object" &&
		block !== null &&
		"type" in block &&
		block.type === "text" &&
		"text" in block &&
		typeof block.text === "string"
	);
}
function isToolCallBlock(block: unknown): block is { type: "toolCall" } {
	return typeof block === "object" && block !== null && "type" in block && block.type === "toolCall";
}
function findOpeningFence(line: string): { marker: "`" | "~"; length: number } | undefined {
	const match = /^\s*(`{3,}|~{3,})/.exec(line);
	if (match?.[1] === undefined) return undefined;
	return { marker: match[1][0] as "`" | "~", length: match[1].length };
}
function isClosingFence(line: string, openFence: { marker: "`" | "~"; length: number }): boolean {
	const trimmed = line.trim();
	return trimmed.length >= openFence.length && [...trimmed].every((character) => character === openFence.marker);
}
