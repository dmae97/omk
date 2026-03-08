import { describe, expect, it } from "bun:test";
import { detectCompat } from "@oh-my-pi/pi-ai/providers/openai-completions";
import type { Model } from "@oh-my-pi/pi-ai/types";

function createQwenModel(modelId: string, provider: string = "ollama"): Model<"openai-completions"> {
	return {
		id: modelId,
		provider,
		api: "openai-completions",
		baseUrl: "http://localhost:11434/v1",
		input: ["text"],
		output: ["text"],
		context: 4096,
		maxTokens: 4096,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as Model<"openai-completions">;
}

describe("detectCompat - qwen model detection", () => {
	describe("isNonStandard detection for qwen models", () => {
		it("detects qwen3.5 models as non-standard (supportsDeveloperRole: false)", () => {
			const model = createQwenModel("qwen3.5:397b-cloud");
			const compat = detectCompat(model);
			expect(compat.supportsDeveloperRole).toBe(false);
		});

		it("detects qwen2.5-coder models as non-standard", () => {
			const model = createQwenModel("qwen2.5-coder:7b");
			const compat = detectCompat(model);
			expect(compat.supportsDeveloperRole).toBe(false);
		});

		it("detects qwen3 models as non-standard", () => {
			const model = createQwenModel("qwen3-235b-a22b");
			const compat = detectCompat(model);
			expect(compat.supportsDeveloperRole).toBe(false);
		});

		it("detects qwen models with different casings", () => {
			const uppercaseModel = createQwenModel("QWEN3.5:7B");
			const compatUpper = detectCompat(uppercaseModel);
			expect(compatUpper.supportsDeveloperRole).toBe(false);

			const mixedCaseModel = createQwenModel("Qwen3-Coder:exacto");
			const compatMixed = detectCompat(mixedCaseModel);
			expect(compatMixed.supportsDeveloperRole).toBe(false);
		});

		it("detects qwen models via openrouter provider", () => {
			const model = createQwenModel("qwen/qwen3-max-thinking", "openrouter");
			model.baseUrl = "https://openrouter.ai/api/v1";
			const compat = detectCompat(model);
			expect(compat.supportsDeveloperRole).toBe(false);
		});
	});

	describe("non-qwen models should not be affected", () => {
		it("does not mark llama models as qwen", () => {
			const model = createQwenModel("llama3.2:3b");
			const compat = detectCompat(model);
			// llama models via ollama should use standard OpenAI behavior
			// supportsDeveloperRole should be true for standard OpenAI-compatible providers
			expect(compat.supportsDeveloperRole).toBe(true);
		});

		it("does not mark glm models as qwen", () => {
			const model = createQwenModel("glm-4.7", "zai");
			model.baseUrl = "https://api.z.ai/v1";
			const compat = detectCompat(model);
			// GLM via Zai has its own detection via isZai
			expect(compat.supportsDeveloperRole).toBe(false); // Zai is also non-standard
		});
	});

	describe("thinkingFormat for qwen models", () => {
		it("sets thinkingFormat to 'qwen' for qwen models", () => {
			const model = createQwenModel("qwen3.5:397b-cloud");
			const compat = detectCompat(model);
			expect(compat.thinkingFormat).toBe("qwen");
		});

		it("sets thinkingFormat to 'qwen' for qwen models via other providers", () => {
			const model = createQwenModel("qwen/qwen2.5-coder-32b", "openrouter");
			model.baseUrl = "https://openrouter.ai/api/v1";
			const compat = detectCompat(model);
			expect(compat.thinkingFormat).toBe("qwen");
		});
	});

	describe("existing non-standard providers remain unaffected", () => {
		it("still marks cerebras as non-standard", () => {
			const model: Model<"openai-completions"> = {
				id: "llama-3.3-70b",
				provider: "cerebras",
				api: "openai-completions",
				baseUrl: "https://api.cerebras.ai/v1",
				input: ["text"],
				output: ["text"],
				context: 8192,
				maxTokens: 8192,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			} as Model<"openai-completions">;
			const compat = detectCompat(model);
			expect(compat.supportsDeveloperRole).toBe(false);
		});

		it("still marks mistral as non-standard", () => {
			const model: Model<"openai-completions"> = {
				id: "mistral-large",
				provider: "mistral",
				api: "openai-completions",
				baseUrl: "https://api.mistral.ai/v1",
				input: ["text"],
				output: ["text"],
				context: 32768,
				maxTokens: 32768,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			} as Model<"openai-completions">;
			const compat = detectCompat(model);
			expect(compat.supportsDeveloperRole).toBe(false);
		});

		it("still marks deepseek as non-standard", () => {
			const model: Model<"openai-completions"> = {
				id: "deepseek-chat",
				provider: "openai-compat",
				api: "openai-completions",
				baseUrl: "https://api.deepseek.com/v1",
				input: ["text"],
				output: ["text"],
				context: 65536,
				maxTokens: 8192,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			} as Model<"openai-completions">;
			const compat = detectCompat(model);
			expect(compat.supportsDeveloperRole).toBe(false);
		});
	});
});
