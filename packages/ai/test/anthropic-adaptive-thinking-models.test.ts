import { describe, expect, it } from "vitest";
import { getModels, getProviders } from "../src/models.ts";
import type { Api, Model } from "../src/types.ts";

const EXPECTED_CURRENT_ADAPTIVE_THINKING_MODELS = [
	"anthropic/claude-opus-4-8",
	"anthropic/claude-opus-5",
	"opencode/claude-opus-4-8",
	"vercel-ai-gateway/anthropic/claude-opus-4.8",
	// Claude Sonnet 5 ships with adaptive thinking forced on (see packages/ai/CHANGELOG.md [Unreleased]).
	"anthropic/claude-sonnet-5",
	// The Fable family has no budget-based mode at all: `budget_tokens` is a 400.
	"anthropic/claude-fable-5",
	"anthropic/claude-fable-5-1",
	"opencode/claude-fable-5",
	"vercel-ai-gateway/anthropic/claude-fable-5.1",
	// Gateway Messages uses the adaptive envelope to carry a named DeepSeek effort, not a token budget.
	"vercel-ai-gateway/deepseek/deepseek-v4.1-flash",
];

function getAllModels(): Model<Api>[] {
	return getProviders().flatMap((provider) => getModels(provider) as Model<Api>[]);
}

describe("Anthropic adaptive thinking model metadata", () => {
	it("marks built-in Anthropic Messages models that use adaptive thinking", () => {
		const flaggedModels = getAllModels()
			.filter((model): model is Model<"anthropic-messages"> => model.api === "anthropic-messages")
			.filter((model) => model.compat?.forceAdaptiveThinking === true)
			.map((model) => `${model.provider}/${model.id}`)
			.sort();

		expect(flaggedModels).toEqual(expect.arrayContaining([...EXPECTED_CURRENT_ADAPTIVE_THINKING_MODELS].sort()));
		expect(flaggedModels).toEqual(
			flaggedModels.filter(
				(modelId) =>
					/(opus[-.]4[-.][678]|opus[-.]5|sonnet[-.]4[-.]6|sonnet[-.]5|fable)/.test(modelId) ||
					modelId === "vercel-ai-gateway/deepseek/deepseek-v4.1-flash",
			),
		);
	});
});
