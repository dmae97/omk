import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";

class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

const provider = "experientiallabs";
const find = (id: string) => getModels(provider).find((model) => model.id === id);

describe("Experiential Labs catalog", () => {
	it("registers the routable tool-capable text catalog", () => {
		const models = getModels(provider);

		expect(models.length).toBeGreaterThan(200);
		expect(models.every((model) => model.api === "openai-completions")).toBe(true);
		expect(models.every((model) => model.provider === provider)).toBe(true);
		expect(models.every((model) => model.input.includes("text"))).toBe(true);
	});

	it("maps DeepSeek V4.1 Flash 1017 from the gateway's declared reasoning efforts", () => {
		const model = find("deepseek-v4.1-flash-1017");

		expect(model).toMatchObject({
			reasoning: true,
			contextWindow: 1048576,
			maxTokens: 393216,
			input: ["text", "image"],
			cost: { input: 0.3, output: 1.2, cacheRead: 0.006 },
			compat: { supportsReasoningEffort: true, maxTokensField: "max_tokens" },
		});
		expect(getSupportedThinkingLevels(model!)).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
	});

	it("keeps Claude Opus 5.5 thinking on with no off level", () => {
		const model = find("claude-opus-5.5");

		expect(model).toMatchObject({ reasoning: true, maxTokens: 128000 });
		expect(model?.thinkingLevelMap?.off).toBeNull();
		expect(getSupportedThinkingLevels(model!)).toEqual(["low", "medium", "high", "xhigh", "max"]);
	});

	it("does not invent max for the GLM-5.3 uncensored gateway route", () => {
		const model = find("glm-5.3-uncensored");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["low", "high"]);
		expect(model?.thinkingLevelMap?.max).toBeNull();
	});

	it("exposes the gateway's reasoning ladder for GPT-6 Sol", () => {
		const model = find("gpt-6-sol");

		expect(model?.reasoning).toBe(true);
		expect(getSupportedThinkingLevels(model!)).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
		expect(model?.thinkingLevelMap?.max).toBe("max");
	});

	it("keeps GLM-5.2 provider-default because its gateway surface rejects reasoning_effort", () => {
		const model = find("glm-5.2");

		expect(model?.reasoning).toBe(false);
		expect(model?.thinkingLevelMap).toBeUndefined();
		expect(getSupportedThinkingLevels(model!)).toEqual(["off"]);
	});

	it("sends reasoning_effort for a gateway model that declares it", async () => {
		const model = find("deepseek-v4.1-flash-1017");
		let payload: unknown;
		const fetch = vi.fn(() => {
			throw new Error("Unexpected network call");
		});
		vi.stubGlobal("fetch", fetch);

		await streamSimple(
			model!,
			{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
			{
				apiKey: "fixture-key",
				reasoning: "max",
				maxTokens: 4096,
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();

		expect(fetch).not.toHaveBeenCalled();
		expect(payload).toMatchObject({
			model: "deepseek-v4.1-flash-1017",
			reasoning_effort: "max",
			max_tokens: 4096,
		});
	});

	it("omits reasoning_effort for a model without explicit reasoning controls", async () => {
		const model = find("glm-5.2");
		let payload: unknown;
		const fetch = vi.fn(() => {
			throw new Error("Unexpected network call");
		});
		vi.stubGlobal("fetch", fetch);

		await streamSimple(
			model!,
			{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
			{
				apiKey: "fixture-key",
				maxTokens: 4096,
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();

		expect(fetch).not.toHaveBeenCalled();
		expect(payload).toMatchObject({ model: "glm-5.2", max_tokens: 4096 });
		expect(payload).not.toHaveProperty("reasoning_effort");
	});
});
