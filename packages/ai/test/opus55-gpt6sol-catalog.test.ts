import { describe, expect, it } from "vitest";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import type { Api, KnownProvider, Model } from "../src/types.ts";

/**
 * Claude Opus 5.5 and GPT-6 Sol are admitted only where a live catalog lists them.
 *
 * Checked 2026-09-23:
 * - Anthropic documents `claude-opus-5-5`: 1M context, 128K output, adaptive thinking
 *   always on, effort `low/medium/high/xhigh/max`, default `medium`.
 *   https://platform.claude.com/docs/en/models/opus-5-5/overview
 * - models.dev lists that id on `anthropic` and `amazon-bedrock`, plus gateway
 *   spellings on OpenRouter and Vercel. Vertex's Claude entry uses a different API
 *   than OMK's Gemini-only `google-vertex` provider, so it is not admitted there.
 * - models.dev listed `gpt-6-sol` (and `gpt-6-luna`) on `openai`, `azure`, and
 *   `opencode` Responses routes as of the 2026-09-23 recheck, each declaring
 *   effort none/low/medium/high/xhigh/max. The catalog admits them there.
 */
function requireModel(provider: KnownProvider, id: string): Model<Api> {
	const model = getModels(provider).find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Missing ${provider}/${id}`);
	return model;
}

const OPUS_55 = [
	["anthropic", "claude-opus-5-5", "anthropic-messages"],
	["amazon-bedrock", "anthropic.claude-opus-5-5", "bedrock-converse-stream"],
	["openrouter", "anthropic/claude-opus-5.5", "openai-completions"],
	["vercel-ai-gateway", "anthropic/claude-opus-5.5", "anthropic-messages"],
] as const;

const GPT6_SOL = [
	["openrouter", "openai/gpt-6-sol", 1_050_000],
	["openrouter", "openai/gpt-6-sol-pro", 1_050_000],
	["vercel-ai-gateway", "openai/gpt-6-sol", 1_050_000],
	["openai", "gpt-6-sol", 1_050_000],
	["azure-openai-responses", "gpt-6-sol", 1_050_000],
	["opencode", "gpt-6-sol", 1_050_000],
] as const;

describe("Claude Opus 5.5 catalog", () => {
	it.each(OPUS_55)("exposes %s/%s", (provider, id, api) => {
		const model = requireModel(provider, id);
		expect(model.api).toBe(api);
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(128_000);
		expect(model.input).toContain("image");
	});

	it.each(OPUS_55)("keeps thinking always on through xhigh and max on %s/%s", (provider, id) => {
		const model = requireModel(provider, id);
		const levels = getSupportedThinkingLevels(model);
		expect(levels).not.toContain("off");
		expect(levels).toEqual(expect.arrayContaining(["low", "medium", "high", "xhigh", "max"]));
		expect(model.thinkingLevelMap).toMatchObject({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
	});

	it("keeps the base claude-opus-5 off toggle exposed", () => {
		// Regression guard for the OPUS_55_ID exclusion: the 5.5 always-on ladder
		// must not swallow the older Opus 5 entry, which still supports `off`.
		const opus5 = requireModel("anthropic", "claude-opus-5");
		expect(getSupportedThinkingLevels(opus5)).toContain("off");
	});

	it("uses adaptive effort on the Anthropic Messages transport", () => {
		for (const [provider, id] of [
			["anthropic", "claude-opus-5-5"],
			["vercel-ai-gateway", "anthropic/claude-opus-5.5"],
		] as const) {
			expect(requireModel(provider, id).compat).toMatchObject({ forceAdaptiveThinking: true });
		}
	});
});

describe("GPT-6 Sol catalog", () => {
	it.each(GPT6_SOL)("exposes the declared route %s/%s", (provider, id, contextWindow) => {
		const model = requireModel(provider, id);
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(contextWindow);
		expect(model.maxTokens).toBe(128_000);
	});

	it("follows OpenRouter's declared none-through-max ladder", () => {
		for (const id of ["openai/gpt-6-sol", "openai/gpt-6-sol-pro"] as const) {
			const model = requireModel("openrouter", id);
			expect(model.api).toBe("openai-completions");
			expect(getSupportedThinkingLevels(model)).toEqual(
				expect.arrayContaining(["off", "low", "medium", "high", "xhigh", "max"]),
			);
			expect(model.thinkingLevelMap).toMatchObject({
				off: "none",
				minimal: null,
				xhigh: "xhigh",
				max: "max",
			});
		}
	});

	it("does not promote Vercel's high ceiling to xhigh", () => {
		const levels = getSupportedThinkingLevels(requireModel("vercel-ai-gateway", "openai/gpt-6-sol"));
		expect(levels).toContain("high");
		expect(levels).not.toContain("xhigh");
		expect(levels).not.toContain("max");
	});

	it("exposes the declared none-through-max ladder on the OpenAI/Azure/OpenCode Responses routes", () => {
		for (const provider of ["openai", "azure-openai-responses", "opencode"] as const) {
			const model = requireModel(provider, "gpt-6-sol");
			expect(model.api).toMatch(/responses$/);
			expect(model.thinkingLevelMap).toMatchObject({
				off: "none",
				minimal: null,
				low: "low",
				medium: "medium",
				high: "high",
				xhigh: "xhigh",
				max: "max",
			});
		}
	});

	it("does not fabricate gpt-6-sol-fast routes on the OpenAI provider", () => {
		expect(getModels("openai").some((model) => model.id.includes("gpt-6-sol-fast"))).toBe(false);
	});
});
