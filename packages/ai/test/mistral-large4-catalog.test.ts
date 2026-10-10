import { describe, expect, it } from "vitest";
import { applyCurrentThinkingMetadata } from "../scripts/catalog-thinking.ts";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { Context, Model } from "../src/types.ts";

const context: Context = { messages: [{ role: "user", content: "payload-only", timestamp: 0 }] };
const direct: Model<"mistral-conversations"> = {
	id: "mistral-large-4",
	name: "Mistral Large 4",
	provider: "mistral",
	api: "mistral-conversations",
	baseUrl: "https://api.mistral.ai",
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 1048576,
	maxTokens: 262144,
	cost: { input: 0.68, output: 2.09, cacheRead: 0.07, cacheWrite: 0 },
};

function capture(model: Model<"mistral-conversations">, reasoning?: "medium" | "high") {
	let payload: unknown;
	const stream = streamSimple({ ...model, baseUrl: "http://127.0.0.1:9" }, context, {
		apiKey: "test-only",
		reasoning,
		onPayload: (value) => {
			payload = value;
			throw new Error("payload-only: stop before network");
		},
	});
	return stream.result().then(() => payload);
}

describe("Mistral Large 4 documented routes", () => {
	it.each(["mistral", "opencode"] as const)("includes %s Large 4 with its route-specific limits", (provider) => {
		const model = getModels(provider).find((entry) => entry.id === "mistral-large-4");
		expect(model).toMatchObject({
			provider,
			api: provider === "mistral" ? "mistral-conversations" : "openai-completions",
			baseUrl: provider === "mistral" ? "https://api.mistral.ai" : "https://opencode.ai/zen/v1",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: provider === "mistral" ? 1048576 : 524288,
			maxTokens: 262144,
			cost: { input: 0.68, output: 2.09, cacheRead: 0.07, cacheWrite: 0 },
		});
		if (!model) throw new Error("Missing Large 4 route");
		expect(getSupportedThinkingLevels(model)).toEqual(["off", "high"]);
	});

	it.each([undefined, "medium", "high"] as const)(
		"forwards only the documented Zen effort for %s",
		async (reasoning) => {
			const model: Model<"openai-completions"> = {
				...direct,
				provider: "opencode",
				api: "openai-completions",
				baseUrl: "https://opencode.ai/zen/v1",
			};
			applyCurrentThinkingMetadata(model);
			let payload: unknown;
			await streamSimple({ ...model, baseUrl: "http://127.0.0.1:9" }, context, {
				apiKey: "test-only",
				reasoning,
				onPayload: (value) => {
					payload = value;
					throw new Error("payload-only: stop before network");
				},
			}).result();
			expect(payload).toHaveProperty("reasoning_effort", reasoning ? "high" : "none");
			expect(payload).not.toHaveProperty("prompt_mode");
		},
	);
	it.each(["mistral-large-4", "mistral-large-4-0"])(
		"uses reasoning_effort instead of prompt_mode for %s",
		async (id) => {
			const payload = await capture({ ...direct, id }, "high");
			expect(payload).toMatchObject({ model: id, reasoningEffort: "high" });
			expect(payload).not.toHaveProperty("promptMode");
		},
	);

	it("preserves the direct API default when thinking is off", async () => {
		const payload = await capture(direct);
		expect(payload).not.toHaveProperty("promptMode");
		expect(payload).not.toHaveProperty("reasoningEffort");
	});

	it.each(["mistral", "opencode"] as const)("exposes only the documented none/high efforts for %s", (provider) => {
		const model: Model<"mistral-conversations"> | Model<"openai-completions"> =
			provider === "mistral"
				? { ...direct }
				: { ...direct, provider, api: "openai-completions", baseUrl: "https://opencode.ai/zen/v1" };
		applyCurrentThinkingMetadata(model);
		expect(model.thinkingLevelMap).toMatchObject({
			off: "none",
			high: "high",
			minimal: null,
			medium: null,
			xhigh: null,
			max: null,
			ultra: null,
		});
		expect(getSupportedThinkingLevels(model)).toEqual(["off", "high"]);
	});

	it("keeps unrelated Mistral models on their existing thinking contract", () => {
		const model = { ...direct, id: "magistral-medium-latest" };
		applyCurrentThinkingMetadata(model);
		expect(model.thinkingLevelMap).toBeUndefined();
	});

	it("retains Big Pickle as a text-only zero-priced Zen route without inventing effort tiers", () => {
		const model = getModels("opencode").find((entry) => entry.id === "big-pickle");
		expect(model).toMatchObject({
			api: "openai-completions",
			baseUrl: "https://opencode.ai/zen/v1",
			input: ["text"],
			contextWindow: 200000,
			maxTokens: 32000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
		expect(model?.thinkingLevelMap).toBeUndefined();
	});

	it("does not publish new native Claude 5.5 routes before their payload contracts are implemented", () => {
		for (const provider of [
			"anthropic",
			"amazon-bedrock",
			"opencode",
			"opencode-go",
			"github-copilot",
			"vercel-ai-gateway",
			"cloudflare-ai-gateway",
		] as const) {
			for (const model of getModels(provider)) {
				if (model.api !== "anthropic-messages" && model.api !== "bedrock-converse-stream") continue;
				expect(model.id, provider).not.toMatch(/(?:^|[/.])claude-(?:sonnet|haiku)-5[.-]5(?=[.@:-]|$)/);
			}
		}
	});
});
