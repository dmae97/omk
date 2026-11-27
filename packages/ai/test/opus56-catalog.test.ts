import { describe, expect, it } from "vitest";
import { applyCurrentThinkingMetadata } from "../scripts/catalog-thinking.ts";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { getAnthropicCompat, supportsServerSideFallback } from "../src/providers/anthropic-compat.ts";
import { mapThinkingLevelToEffort, supportsAdaptiveThinking } from "../src/providers/bedrock-thinking.ts";
import type { Api, Model } from "../src/types.ts";

function requireAnthropicModel(id: string): Model<"anthropic-messages"> {
	const model = getModels("anthropic").find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Missing anthropic/${id}`);
	return model as Model<"anthropic-messages">;
}

describe("Claude Opus 5.6 catalog and provider contracts", () => {
	it("exposes anthropic/claude-opus-5-6 with 1M context and 128K output", () => {
		const model = requireAnthropicModel("claude-opus-5-6");
		expect(model.api).toBe("anthropic-messages");
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(128_000);
		expect(model.input).toContain("image");
	});

	it("keeps adaptive thinking always on through xhigh and max", () => {
		const model = requireAnthropicModel("claude-opus-5-6");
		const levels = getSupportedThinkingLevels(model);
		expect(levels).not.toContain("off");
		expect(levels).not.toContain("minimal");
		expect(levels).toEqual(expect.arrayContaining(["low", "medium", "high", "xhigh", "max"]));
		expect(model.compat).toMatchObject({
			forceAdaptiveThinking: true,
			supportsDisabledThinking: false,
		});
		expect(getAnthropicCompat(model).supportsDisabledThinking).toBe(false);
		expect(supportsServerSideFallback(model)).toBe(true);
	});

	it("preserves off toggle on base claude-opus-5", () => {
		const opus5 = requireAnthropicModel("claude-opus-5");
		expect(getSupportedThinkingLevels(opus5)).toContain("off");
	});

	it("applies always-on adaptive thinking metadata for hyphenated and dotted Opus 5.6 IDs", () => {
		for (const id of ["claude-opus-5-6", "anthropic/claude-opus-5.6"]) {
			const candidate: Model<Api> = {
				id,
				name: "Claude Opus 5.6",
				api: "anthropic-messages",
				provider: "anthropic",
				baseUrl: "https://api.anthropic.com",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1_000_000,
				maxTokens: 128_000,
			};
			applyCurrentThinkingMetadata(candidate);
			expect(candidate.thinkingLevelMap).toMatchObject({
				off: null,
				minimal: null,
				low: "low",
				medium: "medium",
				high: "high",
				xhigh: "xhigh",
				max: "max",
			});
			expect(candidate.compat).toMatchObject({
				forceAdaptiveThinking: true,
				supportsDisabledThinking: false,
			});
		}
	});

	it("recognizes Opus 5.6 in Bedrock adaptive thinking and xhigh effort mapping", () => {
		expect(supportsAdaptiveThinking("anthropic.claude-opus-5-6")).toBe(true);
		const bedrockModel: Model<"bedrock-converse-stream"> = {
			id: "anthropic.claude-opus-5-6",
			name: "Claude Opus 5.6",
			api: "bedrock-converse-stream",
			provider: "amazon-bedrock",
			baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 128_000,
		};
		expect(mapThinkingLevelToEffort(bedrockModel, "xhigh")).toBe("xhigh");
	});
});
