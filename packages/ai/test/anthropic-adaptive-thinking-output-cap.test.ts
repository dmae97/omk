/**
 * Adaptive thinking spends output tokens before the answer, exactly like a thinking
 * budget, and Anthropic counts both against `max_tokens`. A caller cap sizes the
 * answer (compaction summaries ask for 0.8 × reserveTokens = 6553), so the adaptive
 * path must add the same thinking headroom the budget path adds. Without it, a real
 * claude-opus-5-5 compaction summary at effort "max" stopped for "length" after 6553
 * output tokens with no text at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { SimpleStreamOptions, ThinkingLevel } from "../src/types.ts";

class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

async function capturedMaxTokens(modelId: string, options: Partial<SimpleStreamOptions>): Promise<unknown> {
	const model = getModels("anthropic").find((entry) => entry.id === modelId);
	if (!model) throw new Error(`Missing anthropic/${modelId}`);
	let payload: { max_tokens?: unknown } | undefined;
	vi.stubGlobal("fetch", () => {
		throw new Error("Unexpected network access");
	});
	await streamSimple(
		model,
		{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
		{
			apiKey: "fixture-key",
			...options,
			onPayload: (body) => {
				payload = body as { max_tokens?: unknown };
				throw new PayloadCaptured();
			},
		},
	).result();
	return payload?.max_tokens;
}

describe("Anthropic adaptive thinking output cap", () => {
	it.each(["high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[])(
		"reserves thinking headroom above an explicit cap at %s effort",
		async (reasoning) => {
			// 6553 answer tokens + the 16384 thinking budget the budget path uses for high and above.
			expect(await capturedMaxTokens("claude-opus-5-5", { maxTokens: 6553, reasoning })).toBe(6553 + 16_384);
		},
	);

	it("matches the budget-based path for the same cap and level", async () => {
		const adaptive = await capturedMaxTokens("claude-opus-5-5", { maxTokens: 6553, reasoning: "medium" });
		const budgeted = await capturedMaxTokens("claude-haiku-4-5", { maxTokens: 6553, reasoning: "medium" });
		expect(adaptive).toBe(6553 + 8192);
		expect(adaptive).toBe(budgeted);
	});

	it("leaves an uncapped turn at the model maximum", async () => {
		expect(await capturedMaxTokens("claude-opus-5-5", { reasoning: "max" })).toBe(128_000);
	});

	it("leaves an explicit cap untouched when thinking is off", async () => {
		expect(await capturedMaxTokens("claude-opus-5-5", { maxTokens: 6553 })).toBe(6553);
	});
});
