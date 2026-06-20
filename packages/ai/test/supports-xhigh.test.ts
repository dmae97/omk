import { describe, expect, it } from "vitest";
import { getModel, getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { adjustMaxTokensForThinking } from "../src/providers/simple-options.ts";

describe("getSupportedThinkingLevels", () => {
	it("includes xhigh for Anthropic Opus 4.6 on anthropic-messages API", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
	});

	it("includes xhigh for Anthropic Opus 4.8 on anthropic-messages API", () => {
		const model = getModel("anthropic", "claude-opus-4-8");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
	});

	it("includes xhigh for Anthropic Opus 4.8 on anthropic-messages API", () => {
		const model = getModel("anthropic", "claude-opus-4-8");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
	});

	it("includes xhigh for non-Opus Anthropic reasoning models (policy: every reasoning-capable model exposes max)", () => {
		const model = getModel("anthropic", "claude-sonnet-4-5");
		expect(model).toBeDefined();
		expect(model!.reasoning).toBe(true);
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
	});

	it("includes xhigh for zai/GLM 5.x reasoning models that have no thinkingLevelMap", () => {
		// glm-5.1 / glm-5.2 across zai, openrouter, opencode-go, zai-coding-cn
		// mirrors all have reasoning=true with thinkingLevelMap undefined. Under
		// the new policy every one of them must surface xhigh in the selector.
		const models = [
			getModel("zai", "glm-5.2"),
			getModel("zai-coding-cn", "glm-5.2"),
			getModel("openrouter", "z-ai/glm-5.2"),
			getModel("opencode-go", "glm-5.2"),
		];
		let checked = 0;
		for (const model of models) {
			if (!model) continue;
			expect(model.reasoning).toBe(true);
			expect(getSupportedThinkingLevels(model)).toContain("xhigh");
			checked++;
		}
		expect(checked).toBeGreaterThan(0);
	});

	it("registers Kimi For Coding Anthropic-compatible models", () => {
		const modelIds = getModels("kimi-coding")
			.map((model) => model.id)
			.sort();
		expect(modelIds).toEqual(expect.arrayContaining(["k2p7", "kimi-for-coding", "kimi-k2-thinking"]));

		const model = getModel("kimi-coding", "kimi-for-coding");
		expect(model).toMatchObject({
			api: "anthropic-messages",
			provider: "kimi-coding",
			baseUrl: "https://api.kimi.com/coding",
			reasoning: true,
			contextWindow: 262144,
			maxTokens: 32768,
		});
		expect(model.headers?.["User-Agent"]).toBe("KimiCLI/1.5");
	});

	it("keeps xhigh safe when provider-specific xhigh mapping is undefined", () => {
		const model = getModel("zai", "glm-5.2");
		expect(model.thinkingLevelMap?.xhigh).toBeUndefined();
		expect(getSupportedThinkingLevels(model)).toContain("xhigh");
		expect(adjustMaxTokensForThinking(undefined, 32768, "xhigh")).toEqual({
			maxTokens: 32768,
			thinkingBudget: 16384,
		});
	});

	it("excludes xhigh only when a model explicitly opts out via thinkingLevelMap.xhigh = null", () => {
		// Synthetic shape that mirrors the explicit-null opt-out path; the policy
		// change must still honour this when an author chose to suppress max.
		const optedOut = {
			provider: "synthetic",
			id: "synthetic-no-max",
			reasoning: true,
			thinkingLevelMap: { xhigh: null },
		} as unknown as Parameters<typeof getSupportedThinkingLevels>[0];
		expect(getSupportedThinkingLevels(optedOut)).not.toContain("xhigh");
	});

	it.each(["gpt-5.4", "gpt-5.5"] as const)("includes xhigh for %s models", (modelId) => {
		const model = getModel("openai-codex", modelId);
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
	});

	it("includes only medium/high/xhigh for OpenAI GPT-5.5 Pro", () => {
		const model = getModel("openai", "gpt-5.5-pro");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["medium", "high", "xhigh"]);
	});

	it("includes only medium/high/xhigh for OpenRouter GPT-5.5 Pro", () => {
		const model = getModel("openrouter", "openai/gpt-5.5-pro");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["medium", "high", "xhigh"]);
	});

	it("includes only high/xhigh plus off for DeepSeek V4 Flash on the DeepSeek provider", () => {
		const model = getModel("deepseek", "deepseek-v4-flash");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["off", "high", "xhigh"]);
	});

	it("includes only high/xhigh plus off for DeepSeek V4 Flash on opencode-go", () => {
		const model = getModel("opencode-go", "deepseek-v4-flash");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["off", "high", "xhigh"]);
	});

	it("includes off/high/xhigh for OpenCode Go Kimi K2.6 (policy: xhigh appears even when not explicitly mapped)", () => {
		const model = getModel("opencode-go", "kimi-k2.6");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["off", "high", "xhigh"]);
	});

	it("includes high/xhigh for OpenCode Grok Build (policy: xhigh appears even when not explicitly mapped)", () => {
		const model = getModel("opencode", "grok-build-0.1");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["high", "xhigh"]);
	});

	it("includes only high/xhigh plus off for DeepSeek V4 Flash on OpenRouter", () => {
		const model = getModel("openrouter", "deepseek/deepseek-v4-flash");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["off", "high", "xhigh"]);
	});

	it("includes xhigh for OpenRouter Opus 4.6 (openai-completions API)", () => {
		const model = getModel("openrouter", "anthropic/claude-opus-4.6");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
	});
});
