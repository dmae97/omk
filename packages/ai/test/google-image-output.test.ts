import { describe, expect, it, vi } from "vitest";

vi.mock("@google/genai", () => {
	class GoogleGenAI {
		models = {
			generateContentStream: async function* () {
				yield {
					responseId: "google-image-1",
					candidates: [
						{
							content: {
								parts: [
									{ text: "Here is your image." },
									{ inlineData: { mimeType: "image/png", data: "ZmFrZS1wbmc=" } },
								],
							},
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 5,
						candidatesTokenCount: 7,
						totalTokenCount: 12,
					},
				};
			},
		};
	}

	return {
		GoogleGenAI,
		FinishReason: {
			STOP: "STOP",
			MAX_TOKENS: "MAX_TOKENS",
			BLOCKLIST: "BLOCKLIST",
			PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
			SPII: "SPII",
			SAFETY: "SAFETY",
			IMAGE_SAFETY: "IMAGE_SAFETY",
			IMAGE_PROHIBITED_CONTENT: "IMAGE_PROHIBITED_CONTENT",
			IMAGE_RECITATION: "IMAGE_RECITATION",
			IMAGE_OTHER: "IMAGE_OTHER",
			RECITATION: "RECITATION",
			FINISH_REASON_UNSPECIFIED: "FINISH_REASON_UNSPECIFIED",
			OTHER: "OTHER",
			LANGUAGE: "LANGUAGE",
			MALFORMED_FUNCTION_CALL: "MALFORMED_FUNCTION_CALL",
			UNEXPECTED_TOOL_CALL: "UNEXPECTED_TOOL_CALL",
			NO_IMAGE: "NO_IMAGE",
		},
		FunctionCallingConfigMode: {
			AUTO: "AUTO",
			ANY: "ANY",
			NONE: "NONE",
		},
		ThinkingLevel: {
			THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
			MINIMAL: "MINIMAL",
			LOW: "LOW",
			MEDIUM: "MEDIUM",
			HIGH: "HIGH",
		},
	};
});

import { streamGoogle } from "../src/providers/google.js";
import type { Context, Model } from "../src/types.js";

describe("google image output", () => {
	it("emits assistant image blocks for inlineData parts", async () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-2.5-flash",
			name: "Gemini 2.5 Flash",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 8192,
		};
		const context: Context = {
			messages: [{ role: "user", content: "Generate an image", timestamp: Date.now() }],
		};

		const result = streamGoogle(model, context, { apiKey: "test" });
		const eventTypes: string[] = [];
		for await (const event of result) {
			eventTypes.push(event.type);
		}

		const message = await result.result();
		expect(eventTypes).toEqual(["start", "text_start", "text_delta", "text_end", "image_start", "image_end", "done"]);
		expect(message.responseId).toBe("google-image-1");
		expect(message.content[0]).toMatchObject({ type: "text", text: "Here is your image." });
		expect(message.content[1]).toMatchObject({
			type: "image",
			mimeType: "image/png",
			data: "ZmFrZS1wbmc=",
		});
	});
});
