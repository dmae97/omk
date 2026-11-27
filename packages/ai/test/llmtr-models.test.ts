import { describe, expect, it } from "vitest";
import { findEnvKeys } from "../src/env-api-keys.ts";
import { getModel } from "../src/models.ts";

describe("LLMTR model registry", () => {
	it("registers LLMTR API key lookup without reading the secret value", () => {
		try {
			process.env.LLMTR_API_KEY = "test-llmtr-key";
			expect(findEnvKeys("llmtr")).toEqual(["LLMTR_API_KEY"]);
		} finally {
			delete process.env.LLMTR_API_KEY;
		}
	});

	it("exposes the starter catalog over the OpenAI-compatible LLMTR endpoint", () => {
		const model = getModel("llmtr", "llmtr/qwen3-8-27b");

		expect(model.provider).toBe("llmtr");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("https://llmtr.com/v1");
		expect(model.reasoning).toBe(true);
		expect(model.input).toEqual(["text"]);
		expect(model.contextWindow).toBe(262144);
		expect(model.maxTokens).toBe(262144);
	});
});
