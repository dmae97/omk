import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("SessionManager signature persistence", () => {
	it("clears oversized signatures instead of truncating them", async () => {
		using tempDir = TempDir.createSync("@pi-session-signature-persistence-");
		const session = SessionManager.create(tempDir.path());

		session.appendMessage({ role: "user", content: "continue", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "reasoning", thinkingSignature: "s".repeat(600_000) },
				{ type: "text", text: "done", textSignature: "m".repeat(600_000) },
				{ type: "toolCall", id: "tool_1", name: "read", arguments: {}, thoughtSignature: "t".repeat(600_000) },
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5-mini",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		} satisfies AssistantMessage);
		await session.flush();

		const reloaded = await SessionManager.open(session.getSessionFile()!);
		const assistant = reloaded
			.getEntries()
			.find(entry => entry.type === "message" && entry.message.role === "assistant")?.message as
			| AssistantMessage
			| undefined;

		expect(assistant).toBeDefined();
		expect(assistant?.content[0]).toMatchObject({ type: "thinking", thinking: "reasoning", thinkingSignature: "" });
		expect(assistant?.content[1]).toMatchObject({ type: "text", text: "done", textSignature: "" });
		expect(assistant?.content[2]).toMatchObject({ type: "toolCall", id: "tool_1", thoughtSignature: "" });
	});
});
