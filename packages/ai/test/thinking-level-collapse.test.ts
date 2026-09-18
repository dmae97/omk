import { describe, expect, it } from "vitest";
import { getModel, getSupportedThinkingLevels } from "../src/models.ts";
import type { Model } from "../src/types.ts";

function anthropicModel(overrides: {
	readonly compat?: Model<"anthropic-messages">["compat"];
	readonly thinkingLevelMap?: Model<"anthropic-messages">["thinkingLevelMap"];
}): Model<"anthropic-messages"> {
	return {
		id: "test-anthropic",
		name: "Test Anthropic",
		api: "anthropic-messages",
		provider: "test",
		baseUrl: "https://example.test",
		reasoning: true,
		thinkingLevelMap: { high: "high", xhigh: "xhigh", max: "max", ultra: "ultra" },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 8192,
		...overrides,
	};
}

describe("top-tier thinking levels on collapsing transports", () => {
	it("hides xhigh/max/ultra on the anthropic-messages budget path (they wire as high)", () => {
		// clampReasoning() maps every top-tier level to "high" when
		// compat.forceAdaptiveThinking is absent — the label would lie.
		const model = anthropicModel({});
		expect(getSupportedThinkingLevels(model)).not.toContain("xhigh");
		expect(getSupportedThinkingLevels(model)).not.toContain("max");
		expect(getSupportedThinkingLevels(model)).not.toContain("ultra");
		expect(getSupportedThinkingLevels(model)).toContain("high");
	});

	it("keeps xhigh/max/ultra when anthropic-messages opts into adaptive effort", () => {
		const model = anthropicModel({ compat: { forceAdaptiveThinking: true } });
		expect(getSupportedThinkingLevels(model)).toContain("max");
		expect(getSupportedThinkingLevels(model)).toContain("xhigh");
	});

	it("keeps top-tier levels on effort-forwarding apis (openai-completions)", () => {
		const model: Model<"openai-completions"> = {
			id: "test-completions",
			name: "Test Completions",
			api: "openai-completions",
			provider: "test",
			baseUrl: "https://example.test/v1",
			reasoning: true,
			thinkingLevelMap: { high: "high", xhigh: "max", max: "max" },
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100000,
			maxTokens: 8192,
		};
		expect(getSupportedThinkingLevels(model)).toContain("max");
		expect(getSupportedThinkingLevels(model)).toContain("xhigh");
	});

	it("catalog contract: adaptive claude-opus-4-7 keeps xhigh+max", () => {
		const model = getModel("anthropic", "claude-opus-4-7");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
		expect(getSupportedThinkingLevels(model!)).toContain("max");
	});

	it("catalog contract: built-in non-adaptive anthropic-messages models never advertise top tiers", () => {
		// The generated catalog does not declare xhigh/max/ultra for budget-path
		// anthropic-messages models, so this stays a no-op for built-ins today.
		const model = getModel("anthropic", "claude-sonnet-4-5");
		expect(model).toBeDefined();
		const levels = getSupportedThinkingLevels(model!);
		expect(levels).toContain("high");
		expect(levels).not.toContain("max");
	});
});
