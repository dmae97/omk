import { describe, expect, it } from "vitest";
import { MODELS } from "../src/models.generated.ts";
import { clampThinkingLevel, getModel, getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { stream } from "../src/stream.ts";
import type { Api, Context, Model, ThinkingLevel } from "../src/types.ts";

/**
 * Muse Spark's documented effort vocabulary is minimal/low/medium/high/xhigh.
 * `"none"` is rejected with HTTP 400 and there is no `"max"` literal — xhigh *is*
 * "maximum reasoning depth". OMK still exposes a `max` level; it must serialize to xhigh.
 * https://dev.meta.ai/docs/reasoning
 */
const API_EFFORT_VALUES = new Set(["minimal", "low", "medium", "high", "xhigh"]);

/** The gateways that hand Muse Spark an effort string. vercel-ai-gateway does not (see below). */
const EFFORT_CARRYING_APIS = new Set<Api>(["openai-responses", "openai-completions"]);

function museSparkModels(): { provider: string; model: Model<Api> }[] {
	const found: { provider: string; model: Model<Api> }[] = [];
	for (const [provider, models] of Object.entries(MODELS)) {
		for (const model of Object.values(models)) {
			if (/muse-spark/i.test(model.id)) found.push({ provider, model: model as Model<Api> });
		}
	}
	return found;
}

const context: Context = {
	systemPrompt: "You are a helpful assistant.",
	messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
};

/**
 * Captures the request body the provider would send. `onPayload` runs after params are built
 * and before the network call, so throwing here keeps the test offline — only a non-empty
 * apiKey is required to get that far.
 */
async function capturePayload(model: Model<Api>, reasoningEffort?: ThinkingLevel): Promise<any> {
	let captured: any = null;
	const s = stream(model, context, {
		apiKey: "test-key",
		...(reasoningEffort ? { reasoningEffort } : {}),
		onPayload: (payload: unknown) => {
			captured = payload;
			throw new Error("payload captured");
		},
	} as any);
	for await (const _ of s) {
		// drain; the throw above ends the stream with an error event
	}
	expect(captured, "onPayload never fired").not.toBeNull();
	return captured;
}

describe("Muse Spark thinking levels", () => {
	describe("meta provider catalog", () => {
		it("exposes the documented standard and contributor tier models", () => {
			const ids = getModels("meta")
				.map((m) => m.id)
				.sort();
			expect(ids).toEqual([
				"muse-spark-1.1",
				"muse-spark-1.2",
				"muse-spark-1.2-contributor",
				"muse-spark-1.3",
				"muse-spark-1.3-contributor",
			]);
		});

		it("routes Meta Model API over the documented OpenAI-compatible base URL", () => {
			const model = getModel("meta", "muse-spark-1.3");
			expect(model).toBeDefined();
			expect(model!.api).toBe("openai-responses");
			expect(model!.baseUrl).toBe("https://api.meta.ai/v1");
			expect(model!.contextWindow).toBe(1_048_576);
		});
	});

	describe("level exposure", () => {
		it.each([
			["meta", "muse-spark-1.3"],
			["meta", "muse-spark-1.3-contributor"],
			["openrouter", "meta/muse-spark-1.3"],
			["opencode", "muse-spark-1.3-contributor-free"],
			["opencode-go", "muse-spark-1.3-contributor"],
		] as const)("exposes thinking up to max on %s (%s)", (provider, id) => {
			const model = getModels(provider).find((candidate) => candidate.id === id);
			expect(model).toBeDefined();

			const levels = getSupportedThinkingLevels(model!);
			expect(levels).toContain("xhigh");
			expect(levels).toContain("max");
			expect(clampThinkingLevel(model!, "max")).toBe("max");
			// `ultra` is above Muse Spark's ceiling and clamps down to max rather than throwing.
			expect(clampThinkingLevel(model!, "ultra")).toBe("max");
		});

		it("keeps thinking permanently on, because Muse Spark rejects effort none", () => {
			const model = getModel("meta", "muse-spark-1.3");
			expect(model!.thinkingLevelMap?.off).toBeNull();
			expect(getSupportedThinkingLevels(model!)).not.toContain("off");
		});

		it("maps every exposed level onto a value the API actually accepts", () => {
			const model = getModel("meta", "muse-spark-1.3");
			for (const level of getSupportedThinkingLevels(model!)) {
				const mapped = model!.thinkingLevelMap?.[level];
				expect(API_EFFORT_VALUES, `level ${level} maps to ${mapped}`).toContain(mapped);
			}
			// The point of the mapping: `max` is an OMK label, never a wire value.
			expect(model!.thinkingLevelMap?.max).toBe("xhigh");
			expect(model!.thinkingLevelMap?.xhigh).toBe("xhigh");
		});
	});

	describe("registry coverage", () => {
		it("maps max on every Muse Spark model served over an effort-carrying API", () => {
			const unmapped = museSparkModels()
				.filter(({ model }) => EFFORT_CARRYING_APIS.has(model.api))
				.filter(({ model }) => model.thinkingLevelMap?.max !== "xhigh")
				.map(({ provider, model }) => `${provider}/${model.id}`);
			expect(unmapped).toEqual([]);
		});

		it("covers all five gateways that serve Muse Spark over an effort-carrying API", () => {
			const providers = new Set(
				museSparkModels()
					.filter(({ model }) => EFFORT_CARRYING_APIS.has(model.api))
					.map(({ provider }) => provider),
			);
			expect([...providers].sort()).toEqual(["meta", "opencode", "opencode-go", "openrouter"]);
		});

		it("leaves the anthropic-messages variants unmapped, since that path ignores the map", () => {
			// vercel-ai-gateway fronts Muse Spark with anthropic-messages, which has no
			// forceAdaptiveThinking and so takes the token-budget path. That path runs the level
			// through clampReasoning(), collapsing xhigh/max to high — mapping there would
			// advertise tiers the transport cannot express.
			const budgetPath = museSparkModels().filter(({ model }) => !EFFORT_CARRYING_APIS.has(model.api));
			expect(budgetPath.length).toBeGreaterThan(0);
			for (const { provider, model } of budgetPath) {
				expect(model.api, `${provider}/${model.id}`).toBe("anthropic-messages");
				expect(getSupportedThinkingLevels(model), `${provider}/${model.id}`).not.toContain("max");
			}
		});
	});

	describe("request payload", () => {
		it("sends effort xhigh for the max level on the Responses API", async () => {
			const payload = await capturePayload(getModel("meta", "muse-spark-1.3")!, "max");
			expect(payload.model).toBe("muse-spark-1.3");
			expect(payload.reasoning.effort).toBe("xhigh");
		});

		it("sends effort xhigh for the xhigh level on the Responses API", async () => {
			const payload = await capturePayload(getModel("meta", "muse-spark-1.3")!, "xhigh");
			expect(payload.reasoning.effort).toBe("xhigh");
		});

		it("never sends effort none when no level is requested", async () => {
			const payload = await capturePayload(getModel("meta", "muse-spark-1.3")!);
			expect(payload.reasoning).toBeUndefined();
		});

		it("sends effort xhigh for the max level through OpenRouter", async () => {
			const model = getModels("openrouter").find((m) => m.id === "meta/muse-spark-1.3");
			const payload = await capturePayload(model!, "max");
			expect(payload.reasoning.effort).toBe("xhigh");
		});

		it("omits the reasoning block entirely on OpenRouter when no level is requested", async () => {
			const model = getModels("openrouter").find((m) => m.id === "meta/muse-spark-1.3");
			const payload = await capturePayload(model!);
			expect(payload.reasoning).toBeUndefined();
		});
	});
});
