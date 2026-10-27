import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel, getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { Api, Model, SimpleStreamOptions } from "../src/types.ts";

/**
 * Kimi K3.1 Pro (2026-10-23). Thinking is always on and cannot be disabled; `reasoning_effort`
 * is `low | high | max` (default `max`); `temperature`/`top_p` are fixed and must be omitted.
 * A wrong id silently falls back to K2.8 Preview with thinking off, so the ids are pinned exactly.
 * https://www.kimi.com/code/docs/en/kimi-code/models.html
 * https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart
 * https://platform.kimi.ai/docs/pricing/chat
 */
const CODING_IDS = ["k3.1-pro", "k3.1-pro-highspeed"] as const;
const API_IDS = ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"] as const;
const REASONING: SimpleStreamOptions["reasoning"][] = [undefined, "minimal", "low", "medium", "high", "xhigh"];

class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

async function capture(model: Model<Api>, options: Partial<SimpleStreamOptions>): Promise<Record<string, unknown>> {
	let payload: unknown;
	const fetch = vi.fn(() => {
		throw new Error("Unexpected network call");
	});
	vi.stubGlobal("fetch", fetch);
	await streamSimple(
		model,
		{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
		{
			apiKey: "fixture-key",
			maxTokens: 4096,
			...options,
			onPayload: (body) => {
				payload = body;
				throw new PayloadCaptured();
			},
		},
	).result();
	expect(fetch).not.toHaveBeenCalled();
	return payload as Record<string, unknown>;
}

function require<TApi extends Api>(model: Model<TApi> | undefined, label: string): Model<TApi> {
	if (!model) throw new Error(`Missing ${label}`);
	return model;
}

describe("Kimi K3.1 Pro on Kimi For Coding", () => {
	it.each(CODING_IDS)("registers %s with the pinned id, 1M context and always-on reasoning", (id) => {
		const model = require(getModels("kimi-coding").find((entry) => entry.id === id), `kimi-coding/${id}`);
		expect(model).toMatchObject({
			id,
			api: "anthropic-messages",
			baseUrl: "https://api.kimi.com/coding",
			reasoning: true,
			contextWindow: 1048576,
			// From models.dev `limit.output`; not confirmed in the Kimi For Coding docs.
			maxTokens: 131072,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: { supportsDisabledThinking: false, supportsTemperature: false },
		});
		expect(getSupportedThinkingLevels(model)).not.toContain("off");
	});

	it.each(CODING_IDS.flatMap((id) => REASONING.map((reasoning) => [id, reasoning] as const)))(
		"%s at reasoning=%s never sends a thinking disable or temperature",
		async (id, reasoning) => {
			const model = require(getModel("kimi-coding", id as never), `kimi-coding/${id}`);
			const payload = await capture(model, { reasoning, temperature: 0.2 });
			expect(payload.model).toBe(id);
			expect(payload).not.toHaveProperty("temperature");
			expect(payload).not.toHaveProperty("top_p");
			expect(payload.thinking).not.toEqual(expect.objectContaining({ type: "disabled" }));
			if (reasoning !== undefined) expect(payload.thinking).toMatchObject({ type: "enabled" });
		},
	);
});

describe("Kimi K3.1 Pro on the Kimi API platform", () => {
	it("pins the API ids and the pay-as-you-go prices from the pricing page", () => {
		const pro = require(getModel("moonshotai", "kimi-k3.1-pro" as never), "moonshotai/kimi-k3.1-pro");
		expect(pro).toMatchObject({
			id: "kimi-k3.1-pro",
			api: "openai-completions",
			baseUrl: "https://api.moonshot.ai/v1",
			reasoning: true,
			contextWindow: 1048576,
			// USD per MTok: Input / Output / Cached Input / 5m writes.
			cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2 },
		});
		const fast = require(getModel(
			"moonshotai",
			"kimi-k3.1-pro-highspeed" as never,
		), "moonshotai/kimi-k3.1-pro-highspeed");
		expect(fast.cost).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 4 });
	});

	it.each(API_IDS.flatMap((id) => REASONING.map((reasoning) => [id, reasoning] as const)))(
		"%s at reasoning=%s sends no thinking toggle and no off-effort",
		async (id, reasoning) => {
			const model = require(getModel("moonshotai", id as never), `moonshotai/${id}`);
			const payload = await capture(model, { reasoning });
			expect(payload.model).toBe(id);
			expect(payload).not.toHaveProperty("thinking");
			expect(payload).not.toHaveProperty("enable_thinking");
			// supportsReasoningEffort=false: the API default (`max`) applies; nothing can request "off".
			expect(payload).not.toHaveProperty("reasoning_effort");
		},
	);
});
