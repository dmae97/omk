import { describe, expect, it } from "bun:test";
import type { AssistantMessage, ToolCall } from "@oh-my-pi/pi-ai";
import { SessionManager } from "$c/session/session-manager";

function buildAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

describe("SessionManager tool call rewrite", () => {
	it("rewrites assistant toolCall arguments in context", async () => {
		const session = SessionManager.inMemory();
		const toolCallId = "toolu_rewrite_1";

		const toolCall = {
			type: "toolCall",
			id: toolCallId,
			name: "edit",
			arguments: { path: "file.ts", op: "update", diff: "@@\n-old\n+new" },
		} satisfies ToolCall;

		session.appendMessage(buildAssistantMessage([toolCall]));

		const updated = await session.rewriteAssistantToolCallArgs(toolCallId, {
			path: "file.ts",
			op: "update",
			diff: "@@\n-old\n+newer",
		});

		expect(updated).toBe(true);

		const ctx = session.buildSessionContext();
		const assistant = ctx.messages.find((m) => m.role === "assistant") as AssistantMessage;
		const updatedCall = assistant.content.find((b) => b.type === "toolCall") as ToolCall;
		expect(updatedCall.arguments).toEqual({ path: "file.ts", op: "update", diff: "@@\n-old\n+newer" });
	});
});
