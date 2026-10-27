import { describe, expect, it } from "vitest";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";

// OpenCode's live /inference/go/v1/models and models.dev, checked 2026-10-26.
// omen-alpha is listed upstream but has no published tool/limit metadata.
// gemini-4-argon replaced gemini-4-argon-contributor; longcat-2.5-preview-free left the live list.
const IDS = [
	"beam-free",
	"claude-haiku-5-5",
	"deepseek-v4-pro",
	"deepseek-v4.1-flash",
	"gemini-4-argon",
	"glm-5.1",
	"glm-5.2",
	"glm-5.3",
	"glm-5.3-flash",
	"gpt-5.6-luna",
	"gpt-6-luna",
	"grok-4.6",
	"grok-4.7",
	"hy3",
	"hy4-preview",
	"iceman-contributor-free",
	"kimi-k2.6",
	"kimi-k2.7-code",
	"kimi-k3",
	"kimi-k3.1-pro",
	"longcat-2.0",
	"mimo-v2.5",
	"mimo-v2.5-pro",
	"mimo-v2.6-flash",
	"mimo-v2.6-pro",
	"minimax-m2.5",
	"minimax-m2.7",
	"minimax-m3",
	"minimax-m3.1-flash",
	"muse-spark-1.2-contributor",
	"muse-spark-1.3-contributor",
	"qwen3.6-plus",
	"qwen3.7-max",
	"qwen3.7-plus",
	"qwen3.8-flash",
	"qwen3.8-max",
	"space-bunny",
	"step-5-preview",
].sort();

function requireModel(id: string) {
	const model = getModels("opencode-go").find((entry) => entry.id === id);
	if (!model) throw new Error(`Missing OpenCode Go model: ${id}`);
	return model;
}

describe("OpenCode Go catalog", () => {
	it("covers every live model with known tool/limit metadata, including still-served legacy IDs", () => {
		expect(
			getModels("opencode-go")
				.map((model) => model.id)
				.sort(),
		).toEqual(IDS);
	});

	it("does not invent metadata for Omen or retain delisted free/experimental IDs", () => {
		for (const id of [
			"omen-alpha",
			"cat-jam-free",
			"step-5-preview-free",
			"deepseek-v4-flash-vision-exp",
			"gemini-4-argon-contributor",
			"longcat-2.5-preview-free",
		]) {
			expect(
				getModels("opencode-go").find((model) => model.id === id),
				id,
			).toBeUndefined();
		}
	});

	it.each(IDS)("uses the documented API-family endpoint for %s", (id) => {
		const model = requireModel(id);
		const expected = {
			"openai-completions": "https://opencode.ai/inference/go/openai/v1",
			"openai-responses": "https://opencode.ai/inference/go/openai/v1",
			"anthropic-messages": "https://opencode.ai/inference/go/anthropic",
			"google-generative-ai": "https://opencode.ai/inference/go/google/v1beta",
		};
		expect(model.baseUrl).toBe(expected[model.api as keyof typeof expected]);
	});

	it.each([
		["glm-5.2", ["high", "max"]],
		["glm-5.3", ["low", "high", "max"]],
		["glm-5.3-flash", ["low", "high", "max"]],
		["grok-4.7", ["low", "medium", "high", "xhigh"]],
		["grok-4.6", ["low", "medium", "high", "xhigh"]],
		["gpt-5.6-luna", ["off", "low", "medium", "high", "xhigh", "max"]],
		["gpt-6-luna", ["off", "low", "medium", "high", "xhigh", "max"]],
		["kimi-k3", ["max"]],
		["kimi-k3.1-pro", ["low", "high", "max"]],
		["minimax-m3.1-flash", ["low", "medium", "high", "xhigh", "max"]],
		["kimi-k2.7-code", ["high"]],
		["kimi-k2.6", ["off", "high"]],
		["hy3", ["off", "low", "high"]],
		["hy4-preview", ["off", "high"]],
		["beam-free", ["low", "medium", "high", "xhigh", "max"]],
		["space-bunny", ["low", "medium", "high", "xhigh", "max"]],
		["step-5-preview", ["low", "medium", "high"]],
		["gemini-4-argon", ["low", "medium", "high"]],
		["claude-haiku-5-5", ["off", "low", "medium", "high", "xhigh", "max"]],
		["deepseek-v4.1-flash", ["off", "low", "high", "max"]],
		["deepseek-v4-pro", ["off", "high", "max"]],
	] as const)("exposes only route-declared efforts for %s", (id, levels) => {
		expect(getSupportedThinkingLevels(requireModel(id))).toEqual(levels);
	});

	it.each(["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.6-flash", "mimo-v2.6-pro", "longcat-2.0"])(
		"advertises a toggle, not fictional effort tiers for %s",
		(id) => {
			const model = requireModel(id);
			expect(getSupportedThinkingLevels(model)).toEqual(["off", "high"]);
			expect(model.compat).toMatchObject({ thinkingFormat: "deepseek", supportsReasoningEffort: false });
		},
	);

	it.each(["qwen3.7-plus", "qwen3.8-max", "qwen3.8-flash"])(
		"does not claim effort passthrough on the %s budget route",
		(id) => {
			const model = requireModel(id);
			expect(model.api).toBe("anthropic-messages");
			expect(getSupportedThinkingLevels(model)).toEqual(["off", "minimal", "low", "medium", "high"]);
		},
	);
});
