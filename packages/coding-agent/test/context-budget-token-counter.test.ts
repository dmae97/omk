import { describe, expect, it } from "vitest";
import {
	createOpenAiJsTokenCounter,
	createOpenAiWasmTokenCounter,
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

	it("estimates Korean text within ±20% of expected BPE token counts", () => {
		// Expected tokens are based on GPT-4o o200k_base empirical measurements.
		// Fallback estimator is tuned to slightly underestimate (conservative budget).
		const samples: Array<{ text: string; expected: number }> = [
			{ text: "안녕하세요", expected: 7 },
			{ text: "이 프로그램은 매우 복잡합니다", expected: 15 },
			{ text: "대한민국의 수도는 서울입니다", expected: 13 },
			{ text: "오늘 날씨가 정말 좋네요 점심 먹었어요?", expected: 18 },
		];
		for (const { text, expected } of samples) {
			const result = estimateTextTokens(text, "unknown");
			const errorPct = Math.abs((result.tokens - expected) / expected) * 100;
			expect(errorPct).toBeLessThanOrEqual(20);
		}
	});

	it("estimates English prose within ±20% of expected BPE token counts", () => {
		// Note: very short inputs (< 3 words) have higher estimation error due to BPE merge behavior.
		// The formula targets ±15-20% on sentences of 10+ words; short fragments can deviate more.
		const samples: Array<{ text: string; expected: number }> = [
			{ text: "The quick brown fox jumps over the lazy dog", expected: 10 },
			{ text: "function add(a, b) { return a + b; }", expected: 12 },
			{ text: "This is a longer English sentence with several words to improve estimation accuracy.", expected: 18 },
		];
		for (const { text, expected } of samples) {
			const result = estimateTextTokens(text, "unknown");
			const errorPct = Math.abs((result.tokens - expected) / expected) * 100;
			expect(errorPct).toBeLessThanOrEqual(20);
		}
	});

	it("produces detailed notes with composition breakdown and non-ascii ratio", () => {
		const result = estimateTextTokens("한국어 텍스트 abc", "gpt-4o");
		expect(result.notes).toEqual(
			expect.arrayContaining([
				expect.stringContaining("prose-like"),
				expect.stringContaining("not-json-like"),
				expect.stringContaining("non-ascii:"),
				expect.stringContaining("composition("),
			]),
		);
		// Hangul and ascii should both appear in composition
		const compNote = result.notes.find((n) => n.startsWith("composition("));
		expect(compNote).toContain("hangul:");
		expect(compNote).toContain("ascii:");
	});

	it("grades confidence based on non-ascii character ratio", () => {
		const english = estimateTextTokens("The quick brown fox jumps over the lazy dog", "unknown");
		expect(english.confidence).toBe("high");

		// 8 hangul out of 22 chars = 36% → between 15-40% → medium
		const mixed = estimateTextTokens("오늘 날씨가 really nice 오늘은", "unknown");
		expect(mixed.confidence).toBe("medium");

		// All Korean → non-ascii ratio = 100% → low
		const allKorean = estimateTextTokens("오늘 날씨가 정말 좋습니다", "unknown");
		expect(allKorean.confidence).toBe("low");
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

	it("uses a snake_case model encoder and releases its owned WASM instance", () => {
		let freed = 0;
		const loader: OptionalModuleLoader = {
			resolve: (name) => (name === "tiktoken" ? "/virtual/tiktoken" : undefined),
			load: () => ({
				encoding_for_model: () => ({
					encode: () => new Uint32Array([1, 2]),
					free: () => {
						freed++;
					},
				}),
			}),
		};
		expect(createOpenAiWasmTokenCounter(loader).countText("fixture", "gpt-4o").tokens).toBe(2);
		expect(freed).toBe(1);
	});

	it("rejects a non-finite plugin count instead of poisoning a budget", () => {
		const invalid: TokenCounterAdapter = {
			id: "invalid",
			priority: 50,
			isAvailable: () => true,
			supports: () => true,
			countText: (_text, modelId) => ({
				tokens: Number.NaN,
				method: "exact",
				confidence: "high",
				adapterId: "invalid",
				modelId,
				notes: [],
			}),
		};
		const actual = createTokenCounterRegistry({ adapters: [invalid] }).countText("text", "gpt-4o");
		expect(actual.adapterId).toBe("fallback-estimator");
		expect(Number.isSafeInteger(actual.tokens)).toBe(true);
	});

	it("does not expose plugin exception text in fallback diagnostics", () => {
		const failed: TokenCounterAdapter = {
			id: "failed",
			priority: 10,
			isAvailable: () => true,
			supports: () => true,
			countText: () => {
				throw new Error("fixture-secret-from-plugin");
			},
		};
		const result = createTokenCounterRegistry({ adapters: [failed] }).countText("text", "gpt-4o");
		expect(result.adapterId).toBe("fallback-estimator");
		expect(result.notes.join(" ")).not.toContain("fixture-secret-from-plugin");
	});

	it("uses code-unit order for equal-priority adapter identifiers", () => {
		const counter = (id: string): TokenCounterAdapter => ({
			id,
			priority: 10,
			isAvailable: () => true,
			supports: () => true,
			countText: (_text, modelId) => ({
				tokens: 2,
				method: "exact",
				confidence: "high",
				adapterId: id,
				modelId,
				notes: [],
			}),
		});
		const actual = createTokenCounterRegistry({ adapters: [counter("ä"), counter("z")] }).countText("text", "gpt-4o");
		expect(actual.adapterId).toBe("z");
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
