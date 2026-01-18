import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages";
import type { AssistantMessage, Model, ToolResultMessage } from "../src/types";

/**
 * Regression test for: "each tool_use must have a single result. Found multiple tool_result blocks with id"
 *
 * When an assistant message has stopReason "error" or "aborted" with tool calls,
 * and the agent-loop has already added tool results for those calls,
 * transformMessages should NOT add duplicate synthetic tool results.
 */
describe("Duplicate Tool Results Regression", () => {
	const model: Model<"anthropic-messages"> = {
		api: "anthropic-messages",
		provider: "anthropic",
		id: "claude-3-5-sonnet-20241022",
		name: "Claude 3.5 Sonnet",
		baseUrl: "https://api.anthropic.com",
		input: ["text"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		maxTokens: 8192,
		contextWindow: 200000,
		reasoning: true,
	};

	it("should not duplicate tool results for errored messages when results already exist", () => {
		const toolCallId = "toolu_019xqMTvqWZiTDy8XxmjxrTo";

		// Simulate the message array that would be sent to the API:
		// 1. User message
		// 2. Assistant message with tool call (errored/aborted)
		// 3. Tool result (already added by agent-loop's createAbortedToolResult)
		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: toolCallId,
					name: "read",
					arguments: { path: "/some/file.ts" },
				},
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-3-5-sonnet-20241022",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error", // Key: message is errored
			errorMessage: "Request was aborted",
			timestamp: Date.now(),
		};

		const existingToolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCallId,
			toolName: "read",
			content: [{ type: "text", text: "Tool execution was aborted." }],
			isError: true,
			timestamp: Date.now(),
		};

		const messages = [
			{
				role: "user" as const,
				content: "Read the file",
				timestamp: Date.now(),
			},
			assistantMessage,
			existingToolResult, // Already added by agent-loop
		];

		// Transform messages
		const transformed = transformMessages(messages, model);

		// Count tool results with the same ID
		const toolResults = transformed.filter(
			(m) => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === toolCallId,
		);

		// Should have exactly ONE tool result, not two
		expect(toolResults.length).toBe(1);
	});

	it("should not duplicate tool results for aborted messages when results already exist", () => {
		const toolCallId = "toolu_aborted_test_123";

		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: toolCallId,
					name: "bash",
					arguments: { command: "echo hello" },
				},
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-3-5-sonnet-20241022",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "aborted", // Key: message is aborted
			errorMessage: "Request was aborted",
			timestamp: Date.now(),
		};

		const existingToolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCallId,
			toolName: "bash",
			content: [{ type: "text", text: "Tool execution was aborted." }],
			isError: true,
			timestamp: Date.now(),
		};

		const messages = [
			{
				role: "user" as const,
				content: "Run the command",
				timestamp: Date.now(),
			},
			assistantMessage,
			existingToolResult,
		];

		const transformed = transformMessages(messages, model);

		const toolResults = transformed.filter(
			(m) => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === toolCallId,
		);

		expect(toolResults.length).toBe(1);
	});

	it("should add synthetic tool results when none exist for errored messages", () => {
		const toolCallId = "toolu_no_result_123";

		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: toolCallId,
					name: "edit",
					arguments: { path: "/some/file.ts", oldText: "foo", newText: "bar" },
				},
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-3-5-sonnet-20241022",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error",
			errorMessage: "Request was aborted",
			timestamp: Date.now(),
		};

		// No tool result exists
		const messages = [
			{
				role: "user" as const,
				content: "Edit the file",
				timestamp: Date.now(),
			},
			assistantMessage,
			// No tool result - transformMessages should add one
		];

		const transformed = transformMessages(messages, model);

		const toolResults = transformed.filter(
			(m) => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === toolCallId,
		);

		// Should have exactly ONE synthetic tool result added
		expect(toolResults.length).toBe(1);
	});

	it("should handle multiple tool calls in errored message with partial results", () => {
		const toolCallId1 = "toolu_multi_1";
		const toolCallId2 = "toolu_multi_2";
		const toolCallId3 = "toolu_multi_3";

		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "toolCall", id: toolCallId1, name: "read", arguments: { path: "/file1.ts" } },
				{ type: "toolCall", id: toolCallId2, name: "read", arguments: { path: "/file2.ts" } },
				{ type: "toolCall", id: toolCallId3, name: "read", arguments: { path: "/file3.ts" } },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-3-5-sonnet-20241022",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error",
			errorMessage: "Request was aborted",
			timestamp: Date.now(),
		};

		// Only first tool has a result
		const existingToolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCallId1,
			toolName: "read",
			content: [{ type: "text", text: "file1 content" }],
			isError: false,
			timestamp: Date.now(),
		};

		const messages = [
			{ role: "user" as const, content: "Read three files", timestamp: Date.now() },
			assistantMessage,
			existingToolResult,
		];

		const transformed = transformMessages(messages, model);

		// Should have exactly 3 tool results total
		const allToolResults = transformed.filter((m) => m.role === "toolResult");
		expect(allToolResults.length).toBe(3);

		// Each tool call should have exactly one result
		const result1 = allToolResults.filter((m) => (m as ToolResultMessage).toolCallId === toolCallId1);
		const result2 = allToolResults.filter((m) => (m as ToolResultMessage).toolCallId === toolCallId2);
		const result3 = allToolResults.filter((m) => (m as ToolResultMessage).toolCallId === toolCallId3);

		expect(result1.length).toBe(1);
		expect(result2.length).toBe(1);
		expect(result3.length).toBe(1);
	});
});
