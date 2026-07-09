import type { Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import { isImagineOrGenerationModel, resolveCompactionModel } from "../src/core/compaction/model-policy.ts";

function grokChatModel(id: string, provider = "grok-oauth-proxy"): Model<"openai-completions"> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	};
}

describe("isImagineOrGenerationModel", () => {
	it("returns true for grok-imagine- prefixed ids", () => {
		expect(isImagineOrGenerationModel(grokChatModel("grok-imagine-fast"))).toBe(true);
		expect(isImagineOrGenerationModel(grokChatModel("grok-imagine-image-quality"))).toBe(true);
	});

	it("returns false for chat models", () => {
		expect(isImagineOrGenerationModel(grokChatModel("grok-4.3"))).toBe(false);
		expect(isImagineOrGenerationModel(grokChatModel("claude-opus-4-7", "anthropic"))).toBe(false);
	});
});

describe("resolveCompactionModel", () => {
	it("returns the same model for non-imagine sessions", () => {
		const model = grokChatModel("grok-4.3");
		expect(resolveCompactionModel(model)).toBe(model);
	});

	it("falls back to grok-4.5 on the same provider for imagine models when registry is empty", () => {
		const model = grokChatModel("grok-imagine-pro", "grok-oauth-proxy");
		const resolved = resolveCompactionModel(model);
		expect(resolved.id).toBe("grok-4.5");
		expect(resolved.provider).toBe("grok-oauth-proxy");
		expect(resolved.api).toBe(model.api);
		expect(resolved.baseUrl).toBe(model.baseUrl);
	});

	it("prefers grok-4.5 over grok-4.3 and other chat models on the same provider", () => {
		const imagine = grokChatModel("grok-imagine-image", "grok-oauth-proxy");
		const composer = grokChatModel("grok-composer-2.5-fast", "grok-oauth-proxy");
		const v43 = grokChatModel("grok-4.3", "grok-oauth-proxy");
		const v45 = grokChatModel("grok-4.5", "grok-oauth-proxy");
		const resolved = resolveCompactionModel(imagine, [imagine, composer, v43, v45]);
		expect(resolved.id).toBe("grok-4.5");
	});

	it("prefers grok-4.3 over non-preferred chat models when 4.5 is absent", () => {
		const imagine = grokChatModel("grok-imagine-image", "grok-oauth-proxy");
		const composer = grokChatModel("grok-composer-2.5-fast", "grok-oauth-proxy");
		const v43 = grokChatModel("grok-4.3", "grok-oauth-proxy");
		const resolved = resolveCompactionModel(imagine, [imagine, composer, v43]);
		expect(resolved.id).toBe("grok-4.3");
	});
});
