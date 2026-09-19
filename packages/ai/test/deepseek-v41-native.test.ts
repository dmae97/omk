import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";

class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

// OpenCode Zen and Go front the same chat/completions gateway for this model
// (https://opencode.ai/docs/zen/ and https://opencode.ai/docs/go/), so both carry
// the native V4.1 contract: thinking toggle, low/high/max effort, max_tokens cap.
const routes = [
	{ provider: "deepseek", modelId: "deepseek-flash" },
	{ provider: "opencode", modelId: "deepseek-v4.1-flash" },
	{ provider: "opencode-go", modelId: "deepseek-v4.1-flash" },
] as const;

describe("DeepSeek V4.1 Flash native model routes", () => {
	it.each(routes)(
		"registers the canonical multimodal model and exact effort ladder on $provider",
		({ provider, modelId }) => {
			const model = getModels(provider).find((entry) => entry.id === modelId);
			expect(model).toBeDefined();
			if (!model) throw new Error("Missing canonical DeepSeek Flash route");
			expect(model).toMatchObject({
				name: "DeepSeek V4.1 Flash",
				api: "openai-completions",
				input: ["text", "image"],
				contextWindow: 1000000,
				maxTokens: 384000,
				compat: { thinkingFormat: "deepseek", requiresReasoningContentOnAssistantMessages: true },
			});
			expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "high", "max"]);
		},
	);

	for (const { provider, modelId } of routes) {
		it.each(["low", "high", "max", undefined] as const)(
			`sends %s through ${provider} without a network call`,
			async (reasoning) => {
				const model = getModels(provider).find((entry) => entry.id === modelId);
				if (!model) throw new Error("Missing canonical DeepSeek Flash route");
				let payload: unknown;
				const fetch = vi.fn(() => {
					throw new Error("Unexpected network call");
				});
				vi.stubGlobal("fetch", fetch);
				await streamSimple(
					model,
					{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
					{
						apiKey: "fixture-key",
						reasoning,
						maxTokens: 4096,
						onPayload: (body) => {
							payload = body;
							throw new PayloadCaptured();
						},
					},
				).result();
				expect(fetch).not.toHaveBeenCalled();
				expect(payload).toMatchObject({
					model: modelId,
					max_tokens: 4096,
					thinking: { type: reasoning ? "enabled" : "disabled" },
				});
				if (reasoning) expect(payload).toHaveProperty("reasoning_effort", reasoning);
				else expect(payload).not.toHaveProperty("reasoning_effort");
			},
		);
	}

	it("retains the old native Flash ID as a documented V4.1 compatibility alias", () => {
		const alias = getModels("deepseek").find((entry) => entry.id === "deepseek-v4-flash");
		expect(alias).toMatchObject({
			name: "DeepSeek V4.1 Flash (legacy alias)",
			input: ["text", "image"],
			cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
		});
	});
});
