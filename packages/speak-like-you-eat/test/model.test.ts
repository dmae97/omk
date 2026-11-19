// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import type { Api, AssistantMessage, Context, Model } from "omk-ai";
import type { ModelRegistry } from "open-multi-agent-kit";
import { describe, expect, it } from "vitest";
import { completeModel, lowestSupportedThinkingLevel, type StreamSimple } from "../src/model.ts";

const unsupported = { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null } as const;
function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		provider: "test",
		id: "model",
		name: "Test model",
		api: "test-api",
		baseUrl: "https://example.test",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1,
		maxTokens: 1,
		...overrides,
	} as Model<Api>;
}
const context: Context = { systemPrompt: "SLYE", messages: [{ role: "user", content: "Target", timestamp: 0 }] };
const response = {
	role: "assistant",
	content: [{ type: "text", text: "Plain" }],
	stopReason: "stop",
} as AssistantMessage;

describe("model completion", () => {
	it("selects the lowest supported thinking level", () => {
		expect(lowestSupportedThinkingLevel(model({ reasoning: false, thinkingLevelMap: unsupported }))).toBe("off");
		expect(lowestSupportedThinkingLevel(model())).toBe("off");
		expect(lowestSupportedThinkingLevel(model({ thinkingLevelMap: { off: null } }))).toBe("minimal");
		expect(lowestSupportedThinkingLevel(model({ thinkingLevelMap: { off: null, minimal: null } }))).toBe("low");
		expect(lowestSupportedThinkingLevel(model({ thinkingLevelMap: unsupported }))).toBeUndefined();
		expect(lowestSupportedThinkingLevel(model({ thinkingLevelMap: { ...unsupported, max: "max" } }))).toBe("max");
	});
	it("resolves auth and sends the target context with lowest reasoning", async () => {
		let received: { model: Model<Api>; context: Context; options: Record<string, unknown> } | undefined;
		const stream = ((selected: Model<Api>, input: Context, options: Record<string, unknown>) => {
			received = { model: selected, context: input, options };
			return { result: async () => response };
		}) as unknown as StreamSimple;
		const registry = {
			getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key", headers: { "x-test": "yes" } }),
		} as unknown as ModelRegistry;
		expect(
			await completeModel(
				registry,
				model({ thinkingLevelMap: { off: null, minimal: null } }),
				context,
				{
					signal: new AbortController().signal,
					cacheRetention: "none",
					sessionId: "session",
				},
				stream,
			),
		).toBe(response);
		expect(received?.options).toMatchObject({
			apiKey: "key",
			headers: { "x-test": "yes" },
			cacheRetention: "none",
			sessionId: "session",
			reasoning: "low",
		});
	});
	it("omits reasoning for non-reasoning models and fails before dispatch without auth", async () => {
		let calls = 0;
		const stream = (() => {
			calls += 1;
			return { result: async () => response };
		}) as unknown as StreamSimple;
		const registry = {
			getApiKeyAndHeaders: async () => ({ ok: false as const, error: "No authentication" }),
		} as unknown as ModelRegistry;
		await expect(
			completeModel(
				registry,
				model({ reasoning: false }),
				context,
				{
					signal: new AbortController().signal,
					cacheRetention: "none",
					sessionId: "session",
				},
				stream,
			),
		).rejects.toThrow("No authentication");
		expect(calls).toBe(0);
	});
});
