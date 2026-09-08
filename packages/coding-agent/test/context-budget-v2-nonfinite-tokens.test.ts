import { describe, expect, it } from "vitest";
import { fullTextTokens } from "../src/core/context-budget-headroom-types.ts";
import { createOpenAiJsTokenCounter, createTokenCounterRegistry } from "../src/core/context-budget-token-counter.ts";
import { compareOptionalForSelection, type PlannedItemV2 } from "../src/core/context-budget-v2-scoring.ts";
import { createPlannedItems } from "../src/core/context-budget-v2-selection.ts";

/**
 * A non-finite token count used to travel all the way from an optional
 * tokenizer into the selection comparator, where `NaN - NaN` made
 * `Array.prototype.sort` implementation-defined. That is a silent wrong
 * answer: the budget drops the wrong context and nothing reports a failure.
 *
 * These lock the three places that let it through.
 */

function planned(overrides: Partial<PlannedItemV2> & { id: string }): PlannedItemV2 {
	const { id, ...rest } = overrides;
	return {
		item: { id, tier: "history", priority: "medium", text: "x" },
		fullTokens: 10,
		admissibleTokens: 10,
		contentHash: id,
		baseScore: 50,
		redundancyPenalty: 0,
		effectiveScore: 50,
		isHard: false,
		...rest,
	} as PlannedItemV2;
}

describe("non-finite token counts cannot corrupt selection", () => {
	describe("token counter boundary", () => {
		// A tokenizer module whose encode() returns a shape with no numeric length.
		const brokenLoader = {
			resolve: (specifier: string) => (specifier === "gpt-tokenizer" ? specifier : undefined),
			load: () => ({ encode: () => ({}) }),
		};

		it("rejects a non-finite count instead of returning it", () => {
			const counter = createOpenAiJsTokenCounter(brokenLoader as never);
			expect(() => counter.countText("hello", "gpt-4o")).toThrow(/non-finite token count/);
		});

		it("degrades to the heuristic estimator and records why", () => {
			const registry = createTokenCounterRegistry({ adapters: [createOpenAiJsTokenCounter(brokenLoader as never)] });
			const result = registry.countText("hello world", "gpt-4o");

			expect(Number.isFinite(result.tokens)).toBe(true);
			expect(result.tokens).toBeGreaterThan(0);
			// The failure has to stay visible; a silent fallback is how this got shipped.
			expect(result.notes.some((note) => note.includes("failed") && note.includes("non-finite"))).toBe(true);
		});

		it("still uses a healthy tokenizer normally", () => {
			const goodLoader = {
				resolve: (specifier: string) => (specifier === "gpt-tokenizer" ? specifier : undefined),
				load: () => ({ encode: (input: string) => new Array(input.length) }),
			};
			const counter = createOpenAiJsTokenCounter(goodLoader as never);
			expect(counter.countText("abcde", "gpt-4o").tokens).toBe(5);
		});
	});

	describe("caller-supplied estimate", () => {
		it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
			"falls back to the heuristic for tokenEstimate=%p",
			(tokenEstimate) => {
				const tokens = fullTextTokens({
					id: "a",
					tier: "history",
					priority: "medium",
					text: "some text here",
					tokenEstimate,
				} as never);
				expect(Number.isFinite(tokens)).toBe(true);
				expect(tokens).toBeGreaterThan(0);
			},
		);

		it("still honours a finite estimate", () => {
			const tokens = fullTextTokens({
				id: "a",
				tier: "history",
				priority: "medium",
				text: "some text here",
				tokenEstimate: 7,
			} as never);
			expect(tokens).toBe(7);
		});

		it("keeps planned items finite even when the counter is broken", () => {
			const brokenCounter = { countText: () => ({ tokens: Number.NaN }) };
			const items = [
				{ id: "a", tier: "history", priority: "medium", text: "alpha" },
				{ id: "b", tier: "history", priority: "medium", text: "beta" },
			];
			const result = createPlannedItems(items as never, brokenCounter as never, "gpt-4o");

			for (const entry of result) {
				expect(Number.isNaN(entry.effectiveScore), `${entry.item.id} score`).toBe(false);
				expect(Number.isNaN(entry.fullTokens), `${entry.item.id} tokens`).toBe(false);
			}
		});
	});

	describe("comparator stays a total order", () => {
		const scores = [Number.POSITIVE_INFINITY, 1000, 80, 0.5, 0, -40, Number.NEGATIVE_INFINITY, Number.NaN];
		const costs = [1, 50, 100_000, 0, Number.NaN];
		const pool = scores.flatMap((effectiveScore, scoreIndex) =>
			costs.map((cost, costIndex) =>
				planned({
					id: `i${scoreIndex}-${costIndex}`,
					effectiveScore,
					baseScore: effectiveScore,
					admissibleTokens: cost,
					fullTokens: cost,
				}),
			),
		);

		it("never returns NaN", () => {
			const offenders = pool.flatMap((a) =>
				pool
					.filter((b) => Number.isNaN(compareOptionalForSelection(a, b)))
					.map((b) => `${a.item.id} vs ${b.item.id}`),
			);
			expect(offenders.slice(0, 5), `${offenders.length} NaN comparisons`).toEqual([]);
		});

		it("is antisymmetric", () => {
			const offenders = pool.flatMap((a) =>
				pool
					.filter(
						(b) => Math.sign(compareOptionalForSelection(a, b)) !== -Math.sign(compareOptionalForSelection(b, a)),
					)
					.map((b) => `${a.item.id} vs ${b.item.id}`),
			);
			expect(offenders.slice(0, 5), `${offenders.length} antisymmetry violations`).toEqual([]);
		});

		it("is transitive", () => {
			const offenders: string[] = [];
			for (const a of pool) {
				for (const b of pool) {
					if (compareOptionalForSelection(a, b) >= 0) continue;
					for (const c of pool) {
						if (compareOptionalForSelection(b, c) >= 0) continue;
						if (compareOptionalForSelection(a, c) >= 0) {
							offenders.push(`${a.item.id} < ${b.item.id} < ${c.item.id}`);
						}
					}
				}
			}
			expect(offenders.slice(0, 5), `${offenders.length} transitivity violations`).toEqual([]);
		});

		it("sorts an unscoreable item last rather than reordering healthy ones", () => {
			const dense = planned({ id: "dense", effectiveScore: 90, admissibleTokens: 10, fullTokens: 10 });
			const sparse = planned({ id: "sparse", effectiveScore: 90, admissibleTokens: 900, fullTokens: 900 });
			const broken = planned({ id: "broken", effectiveScore: Number.NaN, admissibleTokens: 10, fullTokens: 10 });

			const order = [sparse, broken, dense].sort(compareOptionalForSelection).map((entry) => entry.item.id);
			expect(order).toEqual(["dense", "sparse", "broken"]);
		});
	});
});
