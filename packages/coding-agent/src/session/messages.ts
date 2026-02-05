/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AgentMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 */
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, Message, TextContent, ToolResultMessage } from "@oh-my-pi/pi-ai";
import { renderPromptTemplate } from "../config/prompt-templates";
import branchSummaryContextPrompt from "../prompts/compaction/branch-summary-context.md" with { type: "text" };
import compactionSummaryContextPrompt from "../prompts/compaction/compaction-summary-context.md" with { type: "text" };
import type { OutputMeta } from "../tools/output-meta";
import { formatOutputNotice } from "../tools/output-meta";

const COMPACTION_SUMMARY_TEMPLATE = compactionSummaryContextPrompt;
const BRANCH_SUMMARY_TEMPLATE = branchSummaryContextPrompt;

export const SKILL_PROMPT_MESSAGE_TYPE = "skill-prompt";

export interface SkillPromptDetails {
	name: string;
	path: string;
	args?: string;
	lineCount: number;
}

function getPrunedToolResultContent(message: ToolResultMessage): (TextContent | ImageContent)[] {
	if (message.prunedAt === undefined) {
		return message.content;
	}
	const textBlocks = message.content.filter((content): content is TextContent => content.type === "text");
	const text = textBlocks.map(block => block.text).join("") || "[Output truncated]";
	return [{ type: "text", text }];
}

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
	meta?: OutputMeta;
	timestamp: number;
	/** If true, this message is excluded from LLM context (!! prefix) */
	excludeFromContext?: boolean;
}

/**
 * Message type for user-initiated Python executions via the $ command.
 * Shares the same kernel session as the agent's Python tool.
 */
export interface PythonExecutionMessage {
	role: "pythonExecution";
	code: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	meta?: OutputMeta;
	timestamp: number;
	/** If true, this message is excluded from LLM context ($$ prefix) */
	excludeFromContext?: boolean;
}

/**
 * Message type for extension-injected messages via sendMessage().
 */
export interface CustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	timestamp: number;
}

/**
 * Legacy hook message type (pre-extensions). Kept for session migration.
 */
export interface HookMessage<T = unknown> {
	role: "hookMessage";
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
	shortSummary?: string;
	tokensBefore: number;
	timestamp: number;
}

/**
 * Message type for auto-read file mentions via @filepath syntax.
 */
export interface FileMentionMessage {
	role: "fileMention";
	files: Array<{
		path: string;
		content: string;
		lineCount?: number;
		image?: ImageContent;
	}>;
	timestamp: number;
}

// Extend CustomAgentMessages via declaration merging
// Legacy hookMessage is kept for migration; new code should use custom.
declare module "@oh-my-pi/pi-agent-core" {
	interface CustomAgentMessages {
		bashExecution: BashExecutionMessage;
		pythonExecution: PythonExecutionMessage;
		custom: CustomMessage;
		hookMessage: HookMessage;
		branchSummary: BranchSummaryMessage;
		compactionSummary: CompactionSummaryMessage;
		fileMention: FileMentionMessage;
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
	text += formatOutputNotice(msg.meta);
	return text;
}

/**
 * Convert a PythonExecutionMessage to user message text for LLM context.
 */
export function pythonExecutionToText(msg: PythonExecutionMessage): string {
	let text = `Ran Python:\n\`\`\`python\n${msg.code}\n\`\`\`\n`;
	if (msg.output) {
		text += `Output:\n\`\`\`\n${msg.output}\n\`\`\``;
	} else {
		text += "(no output)";
	}
	if (msg.cancelled) {
		text += "\n\n(execution cancelled)";
	} else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
		text += `\n\nExecution failed with code ${msg.exitCode}`;
	}
	text += formatOutputNotice(msg.meta);
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
	shortSummary?: string,
): CompactionSummaryMessage {
	return {
		role: "compactionSummary",
		summary,
		shortSummary,
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
					if (m.excludeFromContext) {
						return undefined;
					}
					return {
						role: "user",
						content: [{ type: "text", text: bashExecutionToText(m) }],
						timestamp: m.timestamp,
					};
				case "pythonExecution":
					if (m.excludeFromContext) {
						return undefined;
					}
					return {
						role: "user",
						content: [{ type: "text", text: pythonExecutionToText(m) }],
						timestamp: m.timestamp,
					};
				case "custom":
				case "hookMessage": {
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
						content: [
							{
								type: "text" as const,
								text: renderPromptTemplate(BRANCH_SUMMARY_TEMPLATE, { summary: m.summary }),
							},
						],
						timestamp: m.timestamp,
					};
				case "compactionSummary":
					return {
						role: "user",
						content: [
							{
								type: "text" as const,
								text: renderPromptTemplate(COMPACTION_SUMMARY_TEMPLATE, { summary: m.summary }),
							},
						],
						timestamp: m.timestamp,
					};
				case "fileMention": {
					const fileContents = m.files
						.map(file => {
							const inner = file.content ? `\n${file.content}\n` : "\n";
							return `<file path="${file.path}">${inner}</file>`;
						})
						.join("\n\n");
					const content: (TextContent | ImageContent)[] = [
						{ type: "text" as const, text: `<system-reminder>\n${fileContents}\n</system-reminder>` },
					];
					for (const file of m.files) {
						if (file.image) {
							content.push(file.image);
						}
					}
					return {
						role: "user",
						content,
						timestamp: m.timestamp,
					};
				}
				case "user":
				case "assistant":
					return m;
				case "toolResult":
					return {
						...m,
						content: getPrunedToolResultContent(m as ToolResultMessage),
					};
				default:
					// biome-ignore lint/correctness/noSwitchDeclarations: fine
					const _exhaustiveCheck: never = m;
					return undefined;
			}
		})
		.filter(m => m !== undefined);
}
