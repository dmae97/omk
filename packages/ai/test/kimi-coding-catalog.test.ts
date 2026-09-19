import { describe, expect, it } from "vitest";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";

/**
 * models.dev renamed its `kimi-for-coding` provider key to `kimi-code-plan-global`
 * (api.kimi.ai) and `kimi-code-plan-cn` (api.kimi.com) on 2026-09-19. The generator
 * read only the old key, so a live refresh silently dropped the whole `kimi-coding`
 * provider from the catalog. Both new keys publish the same four models.
 */
const expectedIds = ["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"];

describe("kimi-coding catalog", () => {
	it("keeps the Kimi For Coding provider after the models.dev key rename", () => {
		const models = getModels("kimi-coding");
		expect(models.map((model) => model.id).sort()).toEqual(expectedIds);
	});

	it("keeps the Anthropic-compatible coding endpoint and CLI header on every entry", () => {
		for (const model of getModels("kimi-coding")) {
			expect(model, model.id).toMatchObject({
				api: "anthropic-messages",
				provider: "kimi-coding",
				baseUrl: "https://api.kimi.com/coding",
				headers: { "User-Agent": "KimiCLI/1.5" },
				reasoning: true,
			});
		}
	});

	it("registers Kimi K3 as the 1M-context multimodal flagship on the plan's thinking ladder", () => {
		const k3 = getModels("kimi-coding").find((model) => model.id === "k3");
		expect(k3).toBeDefined();
		if (!k3) throw new Error("Missing kimi-coding/k3");
		expect(k3).toMatchObject({
			name: "Kimi K3",
			input: ["text", "image"],
			contextWindow: 1048576,
			maxTokens: 131072,
			thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: "xhigh" },
		});
		// The Messages budget path collapses xhigh into high, so the picker exposes only high.
		expect(getSupportedThinkingLevels(k3)).toEqual(["high"]);
	});
});
