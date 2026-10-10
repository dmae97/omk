import { describe, expect, it } from "vitest";
import { parseChunkUsage } from "../src/providers/openai-completions-usage.ts";
import type { Model } from "../src/types.ts";

function model(provider: string, baseUrl: string): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "test-model",
		api: "openai-completions",
		provider,
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 256_000,
		maxTokens: 32_000,
	} as unknown as Model<"openai-completions">;
}

// Shape of xAI's documented example response usage (completion 168, reasoning 304, total 498).
const xaiUsage = {
	prompt_tokens: 26,
	completion_tokens: 168,
	total_tokens: 498,
	completion_tokens_details: { reasoning_tokens: 304 },
};

describe("parseChunkUsage", () => {
	it("adds xAI reasoning tokens to output and costs them at the output rate", () => {
		const usage = parseChunkUsage(xaiUsage, model("xai", "https://api.x.ai/v1"));
		expect(usage.output).toBe(472);
		expect(usage.totalTokens).toBe(498);
		expect(usage.cost.output).toBeCloseTo((10 / 1_000_000) * 472, 12);
		expect(usage.cost.total).toBeCloseTo(usage.cost.input + usage.cost.output, 12);
		expect(usage.cost.billed).toBeUndefined();
	});

	it("treats any provider on api.x.ai (e.g. Grok OAuth) as xAI", () => {
		const usage = parseChunkUsage(xaiUsage, model("grok-oauth", "https://api.x.ai/v1"));
		expect(usage.output).toBe(472);
	});

	it("surfaces xAI cost_in_usd_ticks as the billed USD amount", () => {
		const usage = parseChunkUsage(
			{ ...xaiUsage, cost_in_usd_ticks: 37_756_000 },
			model("xai", "https://api.x.ai/v1"),
		);
		expect(usage.cost.billed).toBeCloseTo(0.0037756, 12);
	});

	it("does not double-count OpenAI reasoning, which is already inside completion_tokens", () => {
		const usage = parseChunkUsage(
			{ ...xaiUsage, cost_in_usd_ticks: 37_756_000 },
			model("openai", "https://api.openai.com/v1"),
		);
		expect(usage.output).toBe(168);
		expect(usage.totalTokens).toBe(194);
		expect(usage.cost.billed).toBeUndefined();
	});

	it("keeps cache-read accounting for xAI", () => {
		const usage = parseChunkUsage(
			{ ...xaiUsage, prompt_tokens: 1_000, total_tokens: 1_472, prompt_tokens_details: { cached_tokens: 800 } },
			model("xai", "https://api.x.ai/v1"),
		);
		expect(usage.input).toBe(200);
		expect(usage.cacheRead).toBe(800);
		expect(usage.output).toBe(472);
	});

	it("does not double-count when an xAI model nests reasoning inside completion_tokens", () => {
		const nested = {
			prompt_tokens: 26,
			completion_tokens: 472,
			total_tokens: 498,
			completion_tokens_details: { reasoning_tokens: 304 },
		};
		const usage = parseChunkUsage(nested, model("xai", "https://api.x.ai/v1"));
		expect(usage.output).toBe(472);
		expect(usage.totalTokens).toBe(498);
	});

	it("adds xAI reasoning when total_tokens is absent, per the documented xAI split", () => {
		const { total_tokens: _omit, ...noTotal } = xaiUsage;
		const usage = parseChunkUsage(noTotal, model("xai", "https://api.x.ai/v1"));
		expect(usage.output).toBe(472);
	});
});
