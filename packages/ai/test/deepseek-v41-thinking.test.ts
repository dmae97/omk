import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCurrentThinkingMetadata } from "../scripts/catalog-thinking.ts";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { Model } from "../src/types.ts";

// The `-1017` snapshot keeps the same none/low/high/max contract as the base route on every
// provider that fronts it (OpenRouter and Vercel AI Gateway), so both are pinned below.
const routes = [
	{ provider: "openrouter", id: "deepseek/deepseek-v4.1-flash" },
	{ provider: "openrouter", id: "deepseek/deepseek-v4.1-flash-1017" },
	{ provider: "vercel-ai-gateway", id: "deepseek/deepseek-v4.1-flash" },
	{ provider: "vercel-ai-gateway", id: "deepseek/deepseek-v4.1-flash-1017" },
] as const;
class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek V4.1 Flash thinking", () => {
	it.each(routes)("registers $id with low/high/max on $provider", ({ provider, id }) => {
		const model = getModels(provider).find((entry) => entry.id === id);
		expect(model).toBeDefined();
		if (!model) throw new Error("Missing current DeepSeek V4.1 route");
		expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "high", "max"]);
		expect(model.thinkingLevelMap?.max).toBe("max");
		if (provider === "vercel-ai-gateway") expect(model.compat).toMatchObject({ forceAdaptiveThinking: true });
	});

	it("keeps OpenRouter base and 1017 pricing distinct while respecting their current output limits", () => {
		const base = getModels("openrouter").find((entry) => entry.id === "deepseek/deepseek-v4.1-flash");
		const snapshot = getModels("openrouter").find((entry) => entry.id === "deepseek/deepseek-v4.1-flash-1017");
		expect(base).toMatchObject({
			// OpenRouter /api/v1/models lists 393,216 for both routes (checked 2026-10-27).
			maxTokens: 393216,
			cost: { input: 0.0648, output: 0.144, cacheRead: 0.0016 },
		});
		expect(snapshot).toMatchObject({
			maxTokens: 393216,
			cost: { input: 0.15, output: 0.6, cacheRead: 0.003 },
		});
	});

	it("keeps the Vercel base route distinct from the 1017 route", () => {
		const base = getModels("vercel-ai-gateway").find((entry) => entry.id === "deepseek/deepseek-v4.1-flash");
		const snapshot = getModels("vercel-ai-gateway").find((entry) => entry.id === "deepseek/deepseek-v4.1-flash-1017");
		expect(base).toMatchObject({
			maxTokens: 32768,
			cost: { input: 0.3, output: 1.2, cacheRead: 0.007 },
		});
		expect(snapshot).toMatchObject({
			maxTokens: 384000,
			cost: { input: 0.15, output: 0.6, cacheRead: 0.003 },
		});
	});

	it.each(routes.filter((route) => route.provider === "openrouter"))(
		"sends max through the OpenRouter reasoning field for $id",
		async ({ id }) => {
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
		},
	);

	it.each(routes.filter((route) => route.provider === "vercel-ai-gateway"))(
		"sends max through the Vercel Messages effort field instead of a clamped thinking budget for $id",
		async ({ id }) => {
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
				// The 4096 answer cap plus the thinking headroom every capped thinking request gets.
				max_tokens: 4096 + 16_384,
				thinking: { type: "adaptive" },
				output_config: { effort: "max" },
			});
			expect(payload).not.toHaveProperty("thinking.budget_tokens");
		},
	);
});
