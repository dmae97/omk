import type { Api, Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import { getVisionRouteModel, isVisionRouteModel, VISION_ROUTE_MODEL } from "../src/vision-route.ts";

describe("isVisionRouteModel", () => {
	it("returns true for the vision route model provider and id", () => {
		expect(isVisionRouteModel({ provider: "openai-codex", id: "gpt-5.6-luna" })).toBe(true);
	});

	it("returns false for the same id with another provider", () => {
		expect(isVisionRouteModel({ provider: "openai", id: "gpt-5.6-luna" })).toBe(false);
	});

	it("returns false for the same provider with another id", () => {
		expect(isVisionRouteModel({ provider: "openai-codex", id: "gpt-5-mini" })).toBe(false);
	});

	it.each([
		["undefined", undefined],
		["null", null],
		["empty object", {}],
	])("returns false for %s", (_label, model) => {
		expect(isVisionRouteModel(model)).toBe(false);
	});
});

describe("getVisionRouteModel", () => {
	const source: Model<Api> = {
		id: "custom-source",
		name: "Custom Source Model",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 1.5, output: 2.5, cacheRead: 0.5, cacheWrite: 1.0 },
		contextWindow: 128000,
		maxTokens: 4096,
		headers: { "x-test": "1" },
	};

	it("clears headers to undefined when source has headers", () => {
		const result = getVisionRouteModel(source);
		expect(result.headers).toBeUndefined();
	});

	it("matches VISION_ROUTE_MODEL fields and is recognized by isVisionRouteModel", () => {
		const result = getVisionRouteModel(source);
		expect(result.provider).toBe(VISION_ROUTE_MODEL.provider);
		expect(result.id).toBe(VISION_ROUTE_MODEL.id);
		expect(result.api).toBe(VISION_ROUTE_MODEL.api);
		expect(result.baseUrl).toBe(VISION_ROUTE_MODEL.baseUrl);
		expect(isVisionRouteModel(result)).toBe(true);
	});

	it("sets input to ['text', 'image'] as a distinct array instance", () => {
		const result = getVisionRouteModel(source);
		expect(result.input).toEqual(["text", "image"]);
		expect(result.input).not.toBe(VISION_ROUTE_MODEL.input);
	});

	it("preserves fields not in VISION_ROUTE_MODEL from source", () => {
		const sourceWithExtras: Model<Api> = {
			...source,
			thinkingLevelMap: { high: "budget-high" },
		};
		const result = getVisionRouteModel(sourceWithExtras);
		expect(result.cost).toEqual(source.cost);
		expect(result.thinkingLevelMap).toEqual(sourceWithExtras.thinkingLevelMap);
	});
});
