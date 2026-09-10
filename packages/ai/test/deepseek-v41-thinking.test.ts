import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCurrentThinkingMetadata } from "../scripts/catalog-thinking.ts";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { Model } from "../src/types.ts";

const id = "deepseek/deepseek-v4.1-flash";
class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek V4.1 Flash thinking", () => {
	it.each(["openrouter", "vercel-ai-gateway"] as const)(
		"registers the current ID with low/high/max on %s",
		(provider) => {
			const model = getModels(provider).find((entry) => entry.id === id);
			expect(model).toBeDefined();
			if (!model) throw new Error("Missing current DeepSeek V4.1 route");
			expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "high", "max"]);
			expect(model.thinkingLevelMap?.max).toBe("max");
			if (provider === "vercel-ai-gateway") expect(model.compat).toMatchObject({ forceAdaptiveThinking: true });
		},
	);

	it("sends max through the OpenRouter reasoning field", async () => {
		const model = getModels("openrouter").find((entry) => entry.id === id);
		if (!model) throw new Error("Missing current DeepSeek V4.1 route");
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
				reasoning: "max",
				maxTokens: 4096,
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();
		expect(fetch).not.toHaveBeenCalled();
		expect(payload).toMatchObject({ model: id, reasoning: { effort: "max" } });
	});

	it("sends max through the Vercel Messages effort field instead of a clamped thinking budget", async () => {
		const model: Model<"anthropic-messages"> = {
			id,
			name: "DeepSeek V4.1 Flash",
			provider: "vercel-ai-gateway",
			api: "anthropic-messages",
			baseUrl: "https://ai-gateway.vercel.sh",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1000000,
			maxTokens: 384000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		applyCurrentThinkingMetadata(model);
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
				reasoning: "max",
				maxTokens: 4096,
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();
		expect(fetch).not.toHaveBeenCalled();
		expect(payload).toMatchObject({
			model: id,
			max_tokens: 4096,
			thinking: { type: "adaptive" },
			output_config: { effort: "max" },
		});
		expect(payload).not.toHaveProperty("thinking.budget_tokens");
	});
});
