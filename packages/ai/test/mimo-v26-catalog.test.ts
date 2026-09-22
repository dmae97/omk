import { describe, expect, it } from "vitest";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import type { Api, KnownProvider, Model } from "../src/types.ts";

/**
 * MiMo V2.6 Pro/Flash coverage across every OMK provider whose upstream serves them.
 *
 * Checked 2026-09-23 against live sources, not the generator's last snapshot:
 * - models.dev keys `xiaomi`, `xiaomi-token-plan-{cn,ams,sgp}`, `openrouter`,
 *   `opencode-go`, `opencode` (Zen lists only the free Flash tier).
 * - OpenRouter `GET /api/v1/models` and Vercel AI Gateway `GET /v1/models`.
 * Hugging Face Inference does not serve V2.6 (its router lists only V2.5/V2.5-Pro),
 * so `huggingface` is deliberately absent.
 *
 * xhigh is not a MiMo tier. Xiaomi's own contract is a toggle
 * (`thinking.type: enabled|disabled`; https://mimo.mi.com/docs/en-US/api/chat/openai-api),
 * and its Responses-compat `reasoning.effort` accepts `none/low/medium/high` where every
 * non-`none` value behaves identically
 * (https://mimo.mi.com/docs/en-US/api/chat/responses — "The reasoning intensity is not
 * differentiated at this stage"). The live Vercel gateway declares only
 * `none/minimal/low/medium/high` for `xiaomi/mimo-v2.6-*`. Top tiers stay hidden unless a
 * route actually declares them, so none of these entries may advertise xhigh/max/ultra.
 */
const MIMO_V26_PRO_AND_FLASH = [
	["xiaomi", "mimo-v2.6-flash", 1_048_576],
	["xiaomi", "mimo-v2.6-pro", 1_048_576],
	["xiaomi-token-plan-cn", "mimo-v2.6-flash", 1_048_576],
	["xiaomi-token-plan-cn", "mimo-v2.6-pro", 1_048_576],
	["xiaomi-token-plan-ams", "mimo-v2.6-flash", 1_048_576],
	["xiaomi-token-plan-ams", "mimo-v2.6-pro", 1_048_576],
	["xiaomi-token-plan-sgp", "mimo-v2.6-flash", 1_048_576],
	["xiaomi-token-plan-sgp", "mimo-v2.6-pro", 1_048_576],
	["openrouter", "xiaomi/mimo-v2.6-flash", 1_048_576],
	["openrouter", "xiaomi/mimo-v2.6-pro", 1_048_576],
	["vercel-ai-gateway", "xiaomi/mimo-v2.6-flash", 1_048_576],
	["vercel-ai-gateway", "xiaomi/mimo-v2.6-pro", 1_048_576],
	["opencode-go", "mimo-v2.6-flash", 1_048_576],
	["opencode-go", "mimo-v2.6-pro", 1_048_576],
	// OpenCode Zen publishes only the free Flash tier, with its own smaller window.
	["opencode", "mimo-v2.6-flash-free", 200_000],
] as const;

/** Pro UltraSpeed exists only where the upstream catalog actually lists it. */
const MIMO_V26_ULTRASPEED = [
	["xiaomi", "mimo-v2.6-pro-ultraspeed"],
	["xiaomi-token-plan-cn", "mimo-v2.6-pro-ultraspeed"],
	["xiaomi-token-plan-ams", "mimo-v2.6-pro-ultraspeed"],
	["xiaomi-token-plan-sgp", "mimo-v2.6-pro-ultraspeed"],
	["openrouter", "xiaomi/mimo-v2.6-pro-ultraspeed"],
	["vercel-ai-gateway", "xiaomi/mimo-v2.6-pro-ultraspeed"],
] as const;

const XIAOMI_TOGGLE_PROVIDERS = [
	"xiaomi",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-sgp",
] as const;

/** `getModel` intersects ids across a provider union into `never`; look up by id instead. */
function requireModel(provider: KnownProvider, id: string): Model<Api> {
	const model = getModels(provider).find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Missing ${provider}/${id}`);
	return model;
}

describe("MiMo V2.6 provider coverage", () => {
	it.each(MIMO_V26_PRO_AND_FLASH)("exposes %s/%s", (provider, id, contextWindow) => {
		const model = requireModel(provider, id);
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(contextWindow);
		expect(model.input).toContain("image");
	});

	it.each(MIMO_V26_ULTRASPEED)("exposes the UltraSpeed tier on %s (%s)", (provider, id) => {
		const model = requireModel(provider, id);
		expect(model.reasoning).toBe(true);
	});

	it.each(XIAOMI_TOGGLE_PROVIDERS)("keeps the Xiaomi toggle contract for mimo-v2.6-pro on %s", (provider) => {
		const model = requireModel(provider, "mimo-v2.6-pro");
		expect(model.api).toBe("openai-completions");
		expect(model.compat).toMatchObject({
			thinkingFormat: "deepseek",
			requiresReasoningContentOnAssistantMessages: true,
		});
	});
});

describe("MiMo V2.6 thinking ladder", () => {
	it.each([...MIMO_V26_PRO_AND_FLASH.map(([provider, id]) => [provider, id] as const), ...MIMO_V26_ULTRASPEED])(
		"does not advertise an undeclared top tier on %s/%s",
		(provider, id) => {
			const levels = getSupportedThinkingLevels(requireModel(provider, id));
			expect(levels, `${provider}/${id}`).not.toContain("xhigh");
			expect(levels).not.toContain("max");
			expect(levels).not.toContain("ultra");
			expect(levels).toContain("off");
			expect(levels).toContain("high");
		},
	);
});
