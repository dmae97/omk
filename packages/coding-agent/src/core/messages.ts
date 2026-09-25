/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AgentMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 */

import type { AgentMessage } from "omk-agent-core";
import type { ImageContent, Message, TextContent, ThinkingContent, ToolCall } from "omk-ai";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

const CONTEXT_ADMISSION_IMAGE_TOKENS = 1_200;

export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const BRANCH_SUMMARY_SUFFIX = `</summary>`;

/**
 * Message type for bash executions via the ! command.
 */
export interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
	timestamp: number;
	/** If true, this message is excluded from LLM context (!! prefix) */
	excludeFromContext?: boolean;
}

/**
 * Message type for extension-injected messages via sendMessage().
 * These are custom messages that extensions can inject into the conversation.
 */
export interface CustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	timestamp: number;
}

export interface BranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	fromId: string;
	timestamp: number;
}

export interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

// Extend CustomAgentMessages via declaration merging
declare module "omk-agent-core" {
	interface CustomAgentMessages {
		bashExecution: BashExecutionMessage;
		custom: CustomMessage;
		branchSummary: BranchSummaryMessage;
		compactionSummary: CompactionSummaryMessage;
	}
}

/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
export function bashExecutionToText(msg: BashExecutionMessage): string {
	let text = `Ran \`${msg.command}\`\n`;
	if (msg.output) {
		text += `\`\`\`\n${msg.output}\n\`\`\``;
	} else {
		text += "(no output)";
	}
	if (msg.cancelled) {
		text += "\n\n(command cancelled)";
	} else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
		text += `\n\nCommand exited with code ${msg.exitCode}`;
	}
	if (msg.truncated && msg.fullOutputPath) {
		text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
	}
	return text;
}

export function createBranchSummaryMessage(summary: string, fromId: string, timestamp: string): BranchSummaryMessage {
	return {
		role: "branchSummary",
		summary,
		fromId,
		timestamp: new Date(timestamp).getTime(),
	};
}

export function createCompactionSummaryMessage(
	summary: string,
	tokensBefore: number,
	timestamp: string,
): CompactionSummaryMessage {
	return {
		role: "compactionSummary",
		summary: summary,
		tokensBefore,
		timestamp: new Date(timestamp).getTime(),
	};
}

/** Convert CustomMessageEntry to AgentMessage format */
export function createCustomMessage(
	customType: string,
	content: string | (TextContent | ImageContent)[],
	display: boolean,
	details: unknown | undefined,
	timestamp: string,
): CustomMessage {
	return {
		role: "custom",
		customType,
		content,
		display,
		details,
		timestamp: new Date(timestamp).getTime(),
	};
}

/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 *
 * This is used by:
 * - Agent's transormToLlm option (for prompt calls and queued messages)
 * - Compaction's generateSummary (for summarization)
 * - Custom extensions and tools
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages
		.map((m): Message | undefined => {
			switch (m.role) {
				case "bashExecution":
					// Skip messages excluded from context (!! prefix)
					if (m.excludeFromContext) {
						return undefined;
					}
					return {
						role: "user",
						content: [{ type: "text", text: bashExecutionToText(m) }],
						timestamp: m.timestamp,
					};
				case "custom": {
					const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
					return {
						role: "user",
						content,
						timestamp: m.timestamp,
					};
				}
				case "branchSummary":
					return {
						role: "user",
						content: [{ type: "text" as const, text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX }],
						timestamp: m.timestamp,
					};
				case "compactionSummary":
					return {
						role: "user",
						content: [
							{ type: "text" as const, text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX },
						],
						timestamp: m.timestamp,
					};
				case "user":
				case "assistant":
				case "toolResult":
					return m;
				default: {
					const exhaustive: never = m;
					void exhaustive;
					return undefined;
				}
			}
		})
		.filter((m) => m !== undefined);
}

/** Canonical provider-facing text for local input-capacity accounting. */
export function canonicalizeMessagesForContextAdmission(messages: readonly Message[]): {
	readonly text: string;
	readonly imageCount: number;
} {
	let imageCount = 0;
	const markImage = (): void => {
		imageCount += 1;
	};
	const canonical = messages.map((message) => {
		switch (message.role) {
			case "user":
				return { role: message.role, content: canonicalContent(message.content, markImage) };
			case "assistant":
				return {
					role: message.role,
					content: message.content.map((part) =>
						part.type === "text"
							? { type: part.type, text: part.text }
							: part.type === "thinking"
								? { type: part.type, thinking: part.thinking }
								: canonicalToolCall(part),
					),
				};
			case "toolResult":
				return {
					role: message.role,
					toolCallId: message.toolCallId,
					toolName: message.toolName,
					isError: message.isError,
					content: canonicalContent(message.content, markImage),
				};
			default:
				throw new TypeError("Unsupported provider message role");
		}
	});
	return { text: stringifyProviderMessages(canonical), imageCount };
}

function stringifyProviderMessages(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		throw new TypeError("Provider messages are not JSON-serializable");
	}
}

function canonicalContent(
	content: string | readonly (TextContent | ImageContent)[],
	markImage: () => void,
): string | readonly unknown[] {
	if (typeof content === "string") return content;
	return content.map((part) => {
		if (part.type === "text") return { type: part.type, text: part.text };
		markImage();
		return { type: part.type, mimeType: part.mimeType, estimatedTokens: CONTEXT_ADMISSION_IMAGE_TOKENS };
	});
}

function canonicalToolCall(toolCall: ToolCall | ThinkingContent): Record<string, unknown> {
	return toolCall.type === "thinking"
		? { type: toolCall.type, thinking: toolCall.thinking }
		: { type: toolCall.type, id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments };
}
