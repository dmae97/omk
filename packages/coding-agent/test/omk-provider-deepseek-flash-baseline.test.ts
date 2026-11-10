import { clampThinkingLevel, getModel, getSupportedThinkingLevels, streamSimple, type ThinkingLevel } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THINKING_LEVEL } from "../src/core/defaults.ts";

/**
 * Baseline that `OMK/reasoner` must later match (see omk-provider-flag-on.todo.test.ts): what the existing
 * `deepseek/deepseek-flash` route puts on the wire for each thinking level, including the level a user gets when
 * they never set one. Payloads are captured through `onPayload`; no network is touched.
 */
class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

const flash = getModel("deepseek", "deepseek-flash");

async function payloadFor(options: { reasoning?: ThinkingLevel }) {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Unexpected network call");
		}),
	);
	let payload: Record<string, unknown> | undefined;
	await streamSimple(
		flash,
		{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
		{
			apiKey: "fixture-key",
			maxTokens: 4096,
			...options,
			onPayload: (body) => {
				payload = body as Record<string, unknown>;
				throw new PayloadCaptured();
			},
		},
	).result();
	return payload;
}

describe("deepseek/deepseek-flash thinking baseline", () => {
	it("offers off/low/high/max only (medium, minimal, xhigh are null in its level map)", () => {
		expect(getSupportedThinkingLevels(flash)).toEqual(["off", "low", "high", "max"]);
	});

	it("the level used when the user sets none is `medium` (defaults.ts), which this model clamps UP to `high`", () => {
		expect(DEFAULT_THINKING_LEVEL).toBe("medium");
		expect(clampThinkingLevel(flash, DEFAULT_THINKING_LEVEL)).toBe("high");
	});

	it("default level => thinking enabled + reasoning_effort high + max_tokens", async () => {
		const payload = await payloadFor({
			reasoning: DEFAULT_THINKING_LEVEL === "off" ? undefined : DEFAULT_THINKING_LEVEL,
		});
		expect(payload).toMatchObject({
			model: "deepseek-flash",
			max_tokens: 4096,
			thinking: { type: "enabled" },
			reasoning_effort: "high",
		});
		expect(payload).not.toHaveProperty("max_completion_tokens");
	});

	it.each([
		["low", { type: "enabled" }, "low"],
		["high", { type: "enabled" }, "high"],
		["xhigh", { type: "enabled" }, "max"],
		["max", { type: "enabled" }, "max"],
		[undefined, { type: "disabled" }, undefined],
	] as const)("level %s => thinking %j, reasoning_effort %s", async (reasoning, thinking, effort) => {
		const payload = await payloadFor({ reasoning });
		expect(payload).toMatchObject({ thinking, max_tokens: 4096 });
		if (effort) expect(payload).toHaveProperty("reasoning_effort", effort);
		else expect(payload).not.toHaveProperty("reasoning_effort");
	});

	it("declared inputs today: flash text+image, pro text only (OMK models will be text-only)", () => {
		expect(flash.input).toEqual(["text", "image"]);
		expect(getModel("deepseek", "deepseek-v4-pro").input).toEqual(["text"]);
	});
});
