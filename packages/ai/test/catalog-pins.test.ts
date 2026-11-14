import { describe, expect, it } from "vitest";
import { applyCatalogPins } from "../scripts/catalog-pins.ts";
import { MODELS } from "../src/models.generated.ts";
import type { Api, Model } from "../src/types.ts";

describe("catalog source precedence", () => {
	it("does not replace current gateway pricing and limits with an older snapshot", () => {
		const model: Model<Api> = {
			...MODELS.openrouter["deepseek/deepseek-v4.1-flash"],
			cost: { input: 0.123, output: 0.456, cacheRead: 0.01, cacheWrite: 0 },
			maxTokens: 262144,
		};
		const actual = applyCatalogPins([model], MODELS).find(
			(item) => item.provider === model.provider && item.id === model.id,
		);
		expect(actual?.cost).toEqual(model.cost);
		expect(actual?.cost.input).toBe(0.123);
		expect(actual?.maxTokens).toBe(262144);
	});
	it.each([
		["openrouter", "inception/mercury-3"],
		["openrouter", "unbiased/pareto-26.10"],
		["vercel-ai-gateway", "inception/mercury-3"],
	])("admits the confirmed %s/%s gateway route", (provider, id) => {
		const model: Model<Api> = { ...MODELS.openrouter["deepseek/deepseek-v4.1-flash"], provider, id };
		expect(applyCatalogPins([model], MODELS).some((item) => item.provider === provider && item.id === id)).toBe(true);
	});
});
