import type { Api, AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "../types";

/**
 * Normalize tool call ID for cross-provider compatibility.
 * OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
 * Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
 */
function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

/** Fast deterministic hash to shorten long strings */
function shortHash(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function normalizeResponsesToolCallId(id: string): string {
	const [callId, itemId] = id.split("|");
	if (callId && itemId) {
		return id;
	}
	const hash = shortHash(id);
	return `call_${hash}|item_${hash}`;
}

export function transformMessages<TApi extends Api>(messages: Message[], model: Model<TApi>): Message[] {
	// Build a map of original tool call IDs to normalized IDs for github-copilot cross-API switches
	const toolCallIdMap = new Map<string, string>();
	const skippedToolCallIds = new Set<string>();
	const needsResponsesToolCallIds = model.api === "openai-responses" || model.api === "openai-codex-responses";

	// First pass: transform messages (thinking blocks, tool call ID normalization)
	const transformed = messages.flatMap<Message>((msg): Message[] => {
		// User messages pass through unchanged
		if (msg.role === "user") {
			return [msg];
		}

		// Handle toolResult messages - normalize toolCallId if we have a mapping
		if (msg.role === "toolResult") {
			if (skippedToolCallIds.has(msg.toolCallId)) {
				return [];
			}
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) {
				return [{ ...msg, toolCallId: normalizedId }];
			}
			if (needsResponsesToolCallIds) {
				return [{ ...msg, toolCallId: normalizeResponsesToolCallId(msg.toolCallId) }];
			}
			return [msg];
		}

		// Assistant messages need transformation check
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			const isSameProviderApi = assistantMsg.provider === model.provider && assistantMsg.api === model.api;
			const isErroredAssistant = assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted";
			if (!isSameProviderApi && isErroredAssistant) {
				for (const block of assistantMsg.content) {
					if (block.type === "toolCall") {
						skippedToolCallIds.add(block.id);
					}
				}
				return [];
			}

			// If message is from the same provider and API, keep as is
			if (isSameProviderApi) {
				if (
					(assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") &&
					assistantMsg.content.length === 0
				) {
					return [];
				}
				return [msg];
			}

			// Check if we need to normalize tool call IDs
			// Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars)
			// OpenAI Responses API generates IDs with `|` and 450+ chars
			// GitHub Copilot routes to Anthropic for Claude models
			const targetRequiresStrictIds = model.api === "anthropic-messages" || model.provider === "github-copilot";
			const crossProviderSwitch = assistantMsg.provider !== model.provider;
			const copilotCrossApiSwitch =
				assistantMsg.provider === "github-copilot" &&
				model.provider === "github-copilot" &&
				assistantMsg.api !== model.api;
			const needsToolCallIdNormalization = targetRequiresStrictIds && (crossProviderSwitch || copilotCrossApiSwitch);

			// Transform message from different provider/model
			const transformedContent = assistantMsg.content.flatMap((block) => {
				if (block.type === "thinking") {
					// Skip empty thinking blocks, convert others to plain text
					if (!block.thinking || block.thinking.trim() === "") return [];
					return {
						type: "text" as const,
						text: block.thinking,
					};
				}
				// Normalize tool call IDs when target API requires strict format
				if (block.type === "toolCall") {
					const toolCall = block as ToolCall;
					if (needsResponsesToolCallIds) {
						const normalizedId = normalizeResponsesToolCallId(toolCall.id);
						if (normalizedId !== toolCall.id) {
							toolCallIdMap.set(toolCall.id, normalizedId);
							return { ...toolCall, id: normalizedId };
						}
					} else if (needsToolCallIdNormalization) {
						const normalizedId = normalizeToolCallId(toolCall.id);
						if (normalizedId !== toolCall.id) {
							toolCallIdMap.set(toolCall.id, normalizedId);
							return { ...toolCall, id: normalizedId };
						}
					}
				}
				// All other blocks pass through unchanged
				return block;
			});

			if (assistantMsg.stopReason === "error" && transformedContent.length === 0) {
				return [];
			}

			// Return transformed assistant message
			return [
				{
					...assistantMsg,
					content: transformedContent,
				},
			];
		}
		return [msg];
	});

	// Second pass: insert synthetic empty tool results for orphaned tool calls
	// This preserves thinking signatures and satisfies API requirements
	const result: Message[] = [];
	let pendingToolCalls: ToolCall[] = [];
	let existingToolResultIds = new Set<string>();

	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];

		if (msg.role === "assistant") {
			// If we have pending orphaned tool calls from a previous assistant, insert synthetic results now
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}

			const assistantMsg = msg as AssistantMessage;
			const isErroredAssistant = assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted";
			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall") as ToolCall[];

			result.push(msg);

			// For errored/aborted messages with tool calls, insert synthetic results immediately
			// to maintain tool_use/tool_result pairing required by the API
			// BUT only if there aren't already tool results for these calls later in the array
			if (isErroredAssistant && toolCalls.length > 0) {
				// Look ahead to find existing tool results
				const existingResultIds = new Set<string>();
				for (let j = i + 1; j < transformed.length; j++) {
					if (transformed[j].role === "toolResult") {
						existingResultIds.add((transformed[j] as ToolResultMessage).toolCallId);
					}
				}
				// Only add synthetic results for tool calls that don't have results
				for (const tc of toolCalls) {
					if (!existingResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "Tool execution was aborted" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
			} else if (!isErroredAssistant && toolCalls.length > 0) {
				// Track tool calls to check for orphaned calls later
				pendingToolCalls = toolCalls;
				existingToolResultIds = new Set();
			}
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "user") {
			// User message interrupts tool flow - insert synthetic results for orphaned calls
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}
			result.push(msg);
		} else {
			result.push(msg);
		}
	}

	// Handle orphaned tool calls at the end of the message array
	// This can happen if the last message is an assistant with tool calls that never got results
	if (pendingToolCalls.length > 0) {
		for (const tc of pendingToolCalls) {
			if (!existingToolResultIds.has(tc.id)) {
				result.push({
					role: "toolResult",
					toolCallId: tc.id,
					toolName: tc.name,
					content: [{ type: "text", text: "No result provided" }],
					isError: true,
					timestamp: Date.now(),
				} as ToolResultMessage);
			}
		}
	}

	return result;
}
