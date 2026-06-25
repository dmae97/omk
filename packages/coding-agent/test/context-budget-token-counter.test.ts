import { describe, expect, it } from "vitest";
import {
	createOpenAiJsTokenCounter,
	createTokenCounterRegistry,
	estimateTextTokens,
	type OptionalModuleLoader,
	type TokenCounterAdapter,
} from "../src/core/context-budget-token-counter.ts";

describe("context budget token counter", () => {
	it("estimates mixed prose, code, and Korean text deterministically", () => {
		const prose = estimateTextTokens("This is a compact English sentence.", "unknown");
		const code = estimateTextTokens("export function add(a: number, b: number) { return a + b; }", "unknown");
		const korean = estimateTextTokens("한국어 문장과 English words mixed together", "unknown");

		expect(prose.tokens).toBeGreaterThan(0);
		expect(code.tokens).toBeGreaterThan(prose.tokens);
		expect(korean.tokens).toBeGreaterThan(0);
		expect(estimateTextTokens("", "unknown")).toMatchObject({ tokens: 0, method: "estimated" });
		expect(estimateTextTokens("same input", "unknown")).toEqual(estimateTextTokens("same input", "unknown"));
	});

	it("selects the highest priority supported available adapter and falls back on failure", () => {
		const failing: TokenCounterAdapter = {
			id: "failing",
			priority: 20,
			isAvailable: () => true,
			supports: () => true,
			countText: () => {
				throw new Error("boom");
			},
		};
		const winning: TokenCounterAdapter = {
			id: "winning",
			priority: 10,
			isAvailable: () => true,
			supports: () => true,
			countText: (input, modelId) => ({
				tokens: input.length,
				method: "exact",
				confidence: "high",
				adapterId: "winning",
				modelId,
				notes: [],
			}),
		};

		const registry = createTokenCounterRegistry({ adapters: [winning, failing] });
		expect(registry.countText("abc", "gpt-4o")).toMatchObject({ tokens: 3, adapterId: "winning" });
	});

	it("probes js-tiktoken style modules through an optional loader", () => {
		const loader: OptionalModuleLoader = {
			resolve: (specifier) => (specifier === "js-tiktoken" ? "/virtual/js-tiktoken" : undefined),
			load: () => ({
				encodingForModel: () => ({
					encode: (input: string) => input.split(/\s+/u).filter((part) => part.length > 0),
				}),
			}),
		};

		const adapter = createOpenAiJsTokenCounter(loader);
		expect(adapter.isAvailable()).toBe(true);
		expect(adapter.supports("gpt-4o")).toBe(true);
		expect(adapter.supports("claude-sonnet-4-5")).toBe(false);
		expect(adapter.countText("one two three", "gpt-4o")).toMatchObject({
			tokens: 3,
			method: "exact",
			confidence: "high",
		});
	});
});
