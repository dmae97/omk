import { describe, expect, it } from "vitest";
import { catalogPricePerMillion } from "../scripts/catalog-pricing.ts";
import { openRouterThinkingMap } from "../scripts/catalog-thinking.ts";
import { getDisabledThinkingConfig } from "../src/providers/google-thinking-disable.ts";

describe("catalog pricing and thinking metadata", () => {
	it("preserves valid pricing and treats the dynamic-price sentinel as unpriced", () => {
		expect(catalogPricePerMillion("0.000001")).toBe(1);
		expect(catalogPricePerMillion("0")).toBe(0);
		expect(catalogPricePerMillion("-1")).toBe(0);
	});
	it.each(["NaN", "Infinity", "-2", "1e309", "12usd"])("rejects an invalid price %s", (raw) => {
		expect(() => catalogPricePerMillion(raw)).toThrow(TypeError);
	});

	it.each([
		["gemini-2.5-flash", { thinkingBudget: 0 }],
		["gemini-3.5-flash", { thinkingLevel: "MINIMAL" }],
		["gemini-3.6-flash", { thinkingLevel: "MINIMAL" }],
		["gemini-3.1-pro-preview", { thinkingLevel: "LOW" }],
		["gemma-4-31b-it", { thinkingLevel: "MINIMAL" }],
	] as const)("preserves older Google off behavior for %s", (id, expected) => {
		expect(getDisabledThinkingConfig({ id })).toEqual(expected);
	});

	it("maps none to off and hides unsupported levels", () => {
		expect(openRouterThinkingMap({ mandatory: false, supported_efforts: ["none", "medium", "high"] })).toEqual({
			off: "none",
			minimal: null,
			low: null,
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
			ultra: null,
		});
	});
	it("keeps the optional thinking toggle separate from its effort vocabulary", () => {
		expect(openRouterThinkingMap({ mandatory: false, supported_efforts: ["high", "xhigh"] })).toMatchObject({
			off: "none",
			high: "high",
			xhigh: "xhigh",
		});
	});
	it("lets mandatory override even a contradictory none effort", () => {
		expect(openRouterThinkingMap({ mandatory: true, supported_efforts: ["none", "low", "max"] })).toMatchObject({
			off: null,
			low: "low",
			max: "max",
		});
	});
	it("keeps unknown effort support unspecified rather than inventing a ladder", () => {
		expect(openRouterThinkingMap(undefined)).toBeUndefined();
		expect(openRouterThinkingMap({ mandatory: false })).toBeUndefined();
		expect(openRouterThinkingMap({ mandatory: true })).toEqual({ off: null });
	});
	it.each([
		"broken",
		{ mandatory: "true" },
		{ supported_efforts: [] },
		{ supported_efforts: "high" },
		{ supported_efforts: [3] },
		{ supported_efforts: ["unknown-tier"] },
	])("rejects malformed or unrepresentable metadata %#", (metadata) => {
		expect(() => openRouterThinkingMap(metadata)).toThrow(TypeError);
	});
});
