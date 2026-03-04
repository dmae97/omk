import { describe, expect, it } from "bun:test";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Context, Model } from "../src/types";

function createAbortedSignal(): AbortSignal {
	const controller = new AbortController();
	controller.abort();
	return controller.signal;
}

function createUsage() {
	return {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

describe("openai-responses replay item ids", () => {
	it("keeps reasoning ids untouched while normalizing function_call ids", async () => {
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const reasoningId = `rs_${"a".repeat(120)}`;
		const { promise, resolve } = Promise.withResolvers<{ input: unknown[] }>();
		const context: Context = {
			messages: [
				{ role: "user", content: "hello", timestamp: Date.now() - 1000 },
				{
					role: "assistant",
					api: "openai-responses",
					provider: "openai",
					model: "gpt-5-mini",
					usage: createUsage(),
					stopReason: "toolUse",
					timestamp: Date.now() - 500,
					content: [
						{
							type: "thinking",
							thinking: "hidden",
							thinkingSignature: JSON.stringify({
								type: "reasoning",
								id: reasoningId,
								summary: [{ type: "summary_text", text: "thinking" }],
							}),
						},
						{
							type: "toolCall",
							id: "call_custom|item_legacy",
							name: "echo",
							arguments: { text: "hi" },
						},
					],
				},
			],
		};

		streamOpenAIResponses(model, context, {
			apiKey: "test-key",
			signal: createAbortedSignal(),
			onPayload: payload => resolve(payload as { input: unknown[] }),
		});

		const payload = await promise;
		const inputItems = payload.input as Array<{ type?: string; id?: string; call_id?: string }>;
		const reasoningItem = inputItems.find(item => item.type === "reasoning");
		const functionCallItem = inputItems.find(item => item.type === "function_call");

		expect(reasoningItem?.id).toBe(reasoningId);
		expect(functionCallItem?.id).toBeDefined();
		expect(functionCallItem?.id?.startsWith("fc")).toBe(true);
		expect(functionCallItem?.id).not.toBe("item_legacy");
		expect(functionCallItem?.call_id).toBe("call_custom");
	});
});
