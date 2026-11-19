import { describe, expect, it } from "vitest";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import type { Api, KnownProvider, Model } from "../src/types.ts";

/**
 * Gemini 4 Argon (released 2026-10-13).
 *
 * Checked 2026-10-14:
 * - Google's thinking doc lists `gemini-4-argon` as On (medium) with low/medium/high.
 *   https://ai.google.dev/gemini-api/docs/thinking
 * - OpenRouter /api/v1/models lists `google/gemini-4-argon` and `:batch` (created
 *   2026-10-13), context 1,048,576, mandatory reasoning with high/medium/low.
 * - models.dev declares the same three efforts on google, google-vertex, and opencode.
 */

function requireModel(provider: KnownProvider, id: string): Model<Api> {
	const model = getModels(provider).find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Missing ${provider}/${id}`);
	return model;
}

const NATIVE_LEVELS = ["low", "medium", "high"] as const;

describe("gemini-4-argon catalog", () => {
	it("lists the native Google route with documented limits and list price", () => {
		expect(requireModel("google", "gemini-4-argon")).toMatchObject({
			api: "google-generative-ai",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1_048_576,
			maxTokens: 32_768,
			cost: { input: 2, output: 10, cacheRead: 0.1 },
		});
	});

	it("lists the Vertex route with its own output cap", () => {
		expect(requireModel("google-vertex", "gemini-4-argon")).toMatchObject({
			api: "google-vertex",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1_048_576,
			maxTokens: 65_536,
			cost: { input: 2, output: 10, cacheRead: 0.1 },
		});
	});

	it.each([
		["google", "gemini-4-argon"],
		["google-vertex", "gemini-4-argon"],
		["opencode", "gemini-4-argon"],
	] as const)("exposes low/medium/high and no off for %s/%s", (provider, id) => {
		const model = requireModel(provider, id);
		expect(model.thinkingLevelMap).toEqual({ off: null, minimal: null, low: "LOW", medium: "MEDIUM", high: "HIGH" });
		expect(getSupportedThinkingLevels(model)).toEqual([...NATIVE_LEVELS]);
	});

	it("carries the OpenRouter route with the route-declared mandatory levels", () => {
		const live = requireModel("openrouter", "google/gemini-4-argon");
		expect(live).toMatchObject({
			contextWindow: 1_048_576,
			// OpenRouter /models route limit, checked 2026-10-29; native limits stay separate.
			maxTokens: 943_718,
			cost: { input: 2, output: 10, cacheWrite: 0.1875 },
			thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high" },
		});
		expect(live.cost.cacheRead).toBeCloseTo(0.1, 10);
		expect(getSupportedThinkingLevels(live)).toEqual([...NATIVE_LEVELS]);
	});

	it("keeps the OpenRouter batch variant's declared output cap and price", () => {
		const batch = requireModel("openrouter", "google/gemini-4-argon:batch");
		expect(batch).toMatchObject({
			contextWindow: 1_048_576,
			maxTokens: 943_718,
			cost: { input: 1, output: 5 },
			thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high" },
		});
		expect(getSupportedThinkingLevels(batch)).toEqual([...NATIVE_LEVELS]);
	});
});
