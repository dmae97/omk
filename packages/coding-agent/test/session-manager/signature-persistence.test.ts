import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { SessionManager, type SessionMessageEntry } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getBlobsDir, TempDir } from "@oh-my-pi/pi-utils";

function isAssistantSessionEntry(entry: unknown): entry is SessionMessageEntry & { message: AssistantMessage } {
	return (
		typeof entry === "object" &&
		entry !== null &&
		"type" in entry &&
		entry.type === "message" &&
		"message" in entry &&
		typeof entry.message === "object" &&
		entry.message !== null &&
		"role" in entry.message &&
		entry.message.role === "assistant"
	);
}

function getAssistantMessage(session: SessionManager): AssistantMessage {
	const assistantEntry = session.getEntries().find(isAssistantSessionEntry);
	if (!assistantEntry) throw new Error("Expected assistant message");
	return assistantEntry.message;
}

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
		const assistant = getAssistantMessage(reloaded);

		expect(assistant.content[0]).toMatchObject({ type: "thinking", thinking: "reasoning", thinkingSignature: "" });
		expect(assistant.content[1]).toMatchObject({ type: "text", text: "done", textSignature: "" });
		expect(assistant.content[2]).toMatchObject({ type: "toolCall", id: "tool_1", thoughtSignature: "" });
	});

	it("externalizes provider image data URLs and restores them across reload", async () => {
		using tempDir = TempDir.createSync("@pi-session-provider-image-persistence-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const largeImageUrl = `data:image/png;base64,${"a".repeat(600_000)}`;

		session.appendMessage({ role: "user", content: "continue", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt-5.4",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			providerPayload: {
				type: "openaiResponsesHistory",
				provider: "openai-codex",
				items: [
					{
						type: "message",
						role: "user",
						content: [
							{ type: "input_text", text: "look at this" },
							{ type: "input_image", detail: "auto", image_url: largeImageUrl },
						],
					},
				],
			},
			timestamp: 2,
		} satisfies AssistantMessage);
		await session.flush();

		const expectedBlobHash = new Bun.CryptoHasher("sha256").update(Buffer.from(largeImageUrl, "utf8")).digest("hex");
		const persistedBlob = await fs.readFile(path.join(getBlobsDir(), expectedBlobHash), "utf8");
		expect(persistedBlob).toBe(largeImageUrl);

		const reloaded = await SessionManager.open(session.getSessionFile()!);
		const assistant = getAssistantMessage(reloaded);

		expect(assistant.providerPayload).toEqual({
			type: "openaiResponsesHistory",
			provider: "openai-codex",
			items: [
				{
					type: "message",
					role: "user",
					content: [
						{ type: "input_text", text: "look at this" },
						{ type: "input_image", detail: "auto", image_url: largeImageUrl },
					],
				},
			],
		});
	});
});
