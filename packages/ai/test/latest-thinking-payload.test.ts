import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";

class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

describe("new thinking wire compatibility", () => {
	it.each([
		["openai", "gpt-6-astra", "max"],
		["openai", "gpt-6-astra", "ultra"],
		["openrouter", "openai/gpt-6-astra", "max"],
		["openrouter", "openai/gpt-6-astra", "ultra"],
	] as const)("sends max effort for Astra %s/%s %s", async (provider, id, reasoning) => {
		const model = getModels(provider).find((entry) => entry.id === id);
		if (!model) throw new Error("Missing Astra model");
		let payload: unknown;
		const fetch = vi.fn(() => {
			throw new Error("Unexpected network access");
		});
		vi.stubGlobal("fetch", fetch);
		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
			{
				apiKey: "fixture-key",
				reasoning,
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();
		expect(fetch).not.toHaveBeenCalled();
		expect(payload).toMatchObject({ reasoning: { effort: "max" } });
	});

	it("disables optional OpenRouter thinking with its boolean toggle, not an unlisted effort", async () => {
		const model = getModels("openrouter").find((entry) => entry.id === "deepseek/deepseek-v4-flash");
		if (!model) throw new Error("Missing OpenRouter model");
		let payload: unknown;
		vi.stubGlobal("fetch", () => {
			throw new Error("Unexpected network access");
		});
		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
			{
				apiKey: "fixture-key",
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();
		expect(payload).toMatchObject({ reasoning: { enabled: false } });
		expect(payload).not.toHaveProperty("reasoning.effort");
	});

	it.each([
		["google", "gemini-3.7-flash"],
		["google", "gemini-3.8-flash"],
		["google-vertex", "gemini-3.7-flash"],
		["google-vertex", "gemini-3.8-flash"],
	] as const)("uses LOW, not rejected MINIMAL, for an off request on %s/%s", async (provider, id) => {
		const model = getModels(provider).find((entry) => entry.id === id);
		if (!model) throw new Error("Missing model fixture");
		let payload: unknown;
		const fetch = vi.fn(() => {
			throw new Error("Unexpected network access");
		});
		vi.stubGlobal("fetch", fetch);
		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
			{
				apiKey: "fixture-key",
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();
		expect(fetch).not.toHaveBeenCalled();
		expect(payload).toMatchObject({ config: { thinkingConfig: { thinkingLevel: "LOW" } } });
	});

	it("sends adaptive max effort for Opus 5 without a legacy thinking budget", async () => {
		const model = getModels("anthropic").find((entry) => entry.id === "claude-opus-5");
		if (!model) throw new Error("Missing Opus fixture");
		let payload: unknown;
		const fetch = vi.fn(() => {
			throw new Error("Unexpected network access");
		});
		vi.stubGlobal("fetch", fetch);
		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
			{
				apiKey: "fixture-key",
				reasoning: "max",
				onPayload: (body) => {
					payload = body;
					throw new PayloadCaptured();
				},
			},
		).result();
		expect(fetch).not.toHaveBeenCalled();
		expect(payload).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "max" } });
		expect(payload).not.toHaveProperty("thinking.budget_tokens");
	});
});
