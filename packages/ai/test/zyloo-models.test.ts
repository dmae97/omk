import { describe, expect, it } from "vitest";
import { findEnvKeys } from "../src/env-api-keys.ts";
import { getModel, getSupportedThinkingLevels } from "../src/models.ts";

describe("Zyloo model registry", () => {
	it("registers Zyloo API key lookup without reading the secret value", () => {
		try {
			process.env.ZYLOO_API_KEY = "test-zyloo-key";
			expect(findEnvKeys("zyloo")).toEqual(["ZYLOO_API_KEY"]);
		} finally {
			delete process.env.ZYLOO_API_KEY;
		}
	});

	it("exposes xhigh and max thinking mappings for source-verified Zyloo models", () => {
		const claude = getModel("zyloo", "claude-opus-4-7");
		const deepseek = getModel("zyloo", "deepseek-v4-pro");

		expect(getSupportedThinkingLevels(claude)).toContain("xhigh");
		expect(claude.thinkingLevelMap?.xhigh).toBe("xhigh");
		expect(getSupportedThinkingLevels(deepseek)).toContain("xhigh");
		expect(deepseek.thinkingLevelMap?.xhigh).toBe("max");
		expect(deepseek.compat?.thinkingFormat).toBe("deepseek");
	});
});
