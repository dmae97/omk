import { describe, expect, it } from "bun:test";
import { convertAnthropicMessages } from "@oh-my-pi/pi-ai/providers/anthropic";
import type { AssistantMessage, Model, UserMessage } from "@oh-my-pi/pi-ai/types";

/**
 * Regression: some Anthropic-routed models reject "assistant prefill" requests
 * (messages ending with an assistant turn). We should automatically append a
 * synthetic user message to keep the request valid.
 */
describe("Anthropic assistant-prefill fallback", () => {
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

	it("appends a user Continue. message when the last turn is assistant", () => {
		const user: UserMessage = {
			role: "user",
			content: "Output JSON",
			timestamp: Date.now(),
		};
		const assistantPrefill: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "{" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		const params = convertAnthropicMessages([user, assistantPrefill], model, false);
		expect(params.at(-1)?.role).toBe("user");
		expect(params.at(-1)?.content).toBe("Continue.");
	});

	it("does not append Continue. when the last turn is already user", () => {
		const params = convertAnthropicMessages(
			[
				{ role: "user", content: "hi", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "hello" }],
					api: "anthropic-messages",
					provider: "anthropic",
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "what now?", timestamp: Date.now() },
			],
			model,
			false,
		);
		expect(params.at(-1)?.role).toBe("user");
		expect(params.at(-1)?.content).toBe("what now?");
	});
});
