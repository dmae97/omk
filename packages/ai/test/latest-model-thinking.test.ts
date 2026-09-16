import { describe, expect, it } from "vitest";
import { clampThinkingLevel, getModels, getSupportedThinkingLevels } from "../src/models.ts";

// Model-specific contracts checked against official catalogs/docs on 2026-09-09.
describe("latest model thinking metadata", () => {
	it.each(["deepseek-v4-pro", "deepseek-v4-flash"])(
		"exposes native low and max while preserving the legacy xhigh alias for %s",
		(id) => {
			const model = getModels("deepseek").find((entry) => entry.id === id);
			if (!model) throw new Error("Missing DeepSeek model");
			expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "high", "xhigh", "max"]);
			expect(model.thinkingLevelMap?.max).toBe("max");
			expect(model.thinkingLevelMap?.xhigh).toBe("max");
		},
	);

	it.each([
		["openrouter", "openai/gpt-6-astra"],
		["openrouter", "openai/gpt-6-astra-pro"],
		["openrouter", "openai/gpt-6-astra:batch"],
		["openrouter", "openai/gpt-6-astra-pro:batch"],
		["openai", "gpt-6-astra"],
		["azure-openai-responses", "gpt-6-astra"],
		["opencode", "gpt-6-astra"],
		["github-copilot", "gpt-6-astra"],
	] as const)("exposes the Astra effort ladder on %s/%s", (provider, id) => {
		const model = getModels(provider).find((entry) => entry.id === id);
		expect(model).toBeDefined();
		if (!model) throw new Error("Missing expected catalog model");
		expect(getSupportedThinkingLevels(model)).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
		expect(clampThinkingLevel(model, "ultra")).toBe("ultra");
		expect(model.thinkingLevelMap?.max).toBe("max");
		expect(model.thinkingLevelMap?.ultra).toBe("max");
		if (provider !== "openrouter") expect(model.api).toMatch(/responses$/);
	});

	it("uses adaptive thinking and both top tiers for native Opus 5", () => {
		const model = getModels("anthropic").find((entry) => entry.id === "claude-opus-5");
		expect(model).toBeDefined();
		if (!model) throw new Error("Missing Opus 5");
		expect(model.compat).toMatchObject({ forceAdaptiveThinking: true });
		expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
	});

	it.each([
		["google", "gemini-3.7-flash"],
		["google", "gemini-3.8-flash"],
		["google-vertex", "gemini-3.7-flash"],
		["google-vertex", "gemini-3.8-flash"],
	] as const)("does not offer rejected minimal thinking on %s/%s", (provider, id) => {
		const model = getModels(provider).find((entry) => entry.id === id);
		expect(model).toBeDefined();
		if (!model) throw new Error("Missing Gemini Flash");
		expect(getSupportedThinkingLevels(model)).toEqual(["low", "medium", "high"]);
	});

	it("uses Qwen's declared xhigh instead of downgrading it and inventing max", () => {
		const model = getModels("openrouter").find((entry) => entry.id === "qwen/qwen3.8-max-0902");
		expect(model).toBeDefined();
		if (!model) throw new Error("Missing Qwen snapshot");
		expect(getSupportedThinkingLevels(model)).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
		expect(model.thinkingLevelMap?.xhigh).toBe("xhigh");
	});

	it.each(["nex-agi/nex-n2.5-mini:free", "nex-agi/nex-n2.5-pro:free"])(
		"exposes only declared Nex efforts for %s",
		(id) => {
			const model = getModels("openrouter").find((entry) => entry.id === id);
			expect(model).toBeDefined();
			if (!model) throw new Error("Missing Nex model");
			expect(getSupportedThinkingLevels(model)).toEqual(["off", "medium", "high"]);
		},
	);
});
