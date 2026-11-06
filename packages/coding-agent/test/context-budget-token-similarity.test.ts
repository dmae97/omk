import { describe, expect, it } from "vitest";
import {
	BIGRAM_DICE_THRESHOLD,
	fuzzyTokenWeight,
	SUBWORD_MIN_LENGTH,
	tokenSimilarity,
} from "../src/core/context-budget-token-similarity.ts";

describe("context-budget-token-similarity", () => {
	describe("constants", () => {
		it("exports expected threshold constants", () => {
			expect(SUBWORD_MIN_LENGTH).toBe(4);
			expect(BIGRAM_DICE_THRESHOLD).toBe(0.5);
		});
	});

	describe("tokenSimilarity", () => {
		it("returns 0 when item token is shorter than SUBWORD_MIN_LENGTH (4)", () => {
			expect(tokenSimilarity("optimize", "opt")).toBe(0);
			expect(tokenSimilarity("optimize", "op")).toBe(0);
			expect(tokenSimilarity("optimize", "")).toBe(0);
		});

		it("returns 1 when query is contained in item token", () => {
			expect(tokenSimilarity("optim", "optimization")).toBe(1);
			expect(tokenSimilarity("배선들", "배선들을")).toBe(1);
		});

		it("returns 1 on reverse containment (item token contained in query token)", () => {
			expect(tokenSimilarity("optimization", "optim")).toBe(1);
			expect(tokenSimilarity("optimizations", "optimization")).toBe(1);
			expect(tokenSimilarity("배선들의모임", "배선들의")).toBe(1);
		});

		it("returns 1 for exact token match", () => {
			expect(tokenSimilarity("optimize", "optimize")).toBe(1);
		});

		it("returns 0 for unrelated tokens", () => {
			expect(tokenSimilarity("abcd", "wxyz")).toBe(0);
		});

		it("returns 0 via length-ratio guard when longer > 3 * shorter without containment", () => {
			expect(tokenSimilarity("abcd", "zzzzzzzzzzzzz")).toBe(0);
			expect(tokenSimilarity("zzzzzzzzzzzzz", "abcd")).toBe(0);
		});

		it("computes character-bigram Dice coefficient when clearing BIGRAM_DICE_THRESHOLD (0.5)", () => {
			const optSim = tokenSimilarity("optimize", "optimisation");
			expect(optSim).toBeGreaterThanOrEqual(BIGRAM_DICE_THRESHOLD);
			expect(optSim).toBeCloseTo(5 / 9, 3); // 10 / 18 ≈ 0.556

			const colorSim = tokenSimilarity("color", "colour");
			expect(colorSim).toBeGreaterThanOrEqual(BIGRAM_DICE_THRESHOLD);
			expect(colorSim).toBeCloseTo(2 / 3, 3); // 6 / 9 ≈ 0.667
		});

		it("returns 0 when bigram Dice coefficient falls below threshold", () => {
			expect(tokenSimilarity("abcdef", "abghij")).toBe(0);
		});

		it("returns 0 when either token has length < 2 during bigram evaluation", () => {
			// Query shorter than 2 but item length >= 4 without containment
			expect(tokenSimilarity("a", "wxyz")).toBe(0);
		});
	});

	describe("fuzzyTokenWeight", () => {
		it("returns 0 when query token is shorter than SUBWORD_MIN_LENGTH (4) even if contained in item", () => {
			expect(fuzzyTokenWeight("ocr", new Set(["ocrtool"]), undefined)).toBe(0);
			expect(fuzzyTokenWeight("db", new Set(["database"]), undefined)).toBe(0);
		});

		it("returns 1 for containment match when itemTokenWeights is undefined", () => {
			expect(fuzzyTokenWeight("optim", new Set(["optimization"]), undefined)).toBe(1);
		});

		it("scales item token weight by similarity with custom weight map", () => {
			const weights = new Map([["optimization", 3]]);
			expect(fuzzyTokenWeight("optim", new Set(["optimization"]), weights)).toBe(3);
		});

		it("selects the highest weight * similarity among competing items", () => {
			// "zzzz" has weight 9 but similarity 0; "optimization" has weight 1 and similarity 1
			const itemSet = new Set(["zzzz", "optimization"]);
			const weights = new Map([
				["zzzz", 9],
				["optimization", 1],
			]);
			expect(fuzzyTokenWeight("optim", itemSet, weights)).toBe(1);

			// Dual positive matches: "colour" (weight 3 * similarity 2/3 = 2) vs "coloring" (weight 1 * similarity 1 = 1)
			// Tested in both insertion orders to ensure max is chosen regardless of iteration order
			const dualWeights = new Map([
				["colour", 3],
				["coloring", 1],
			]);
			const orderA = new Set(["colour", "coloring"]);
			const orderB = new Set(["coloring", "colour"]);

			expect(fuzzyTokenWeight("color", orderA, dualWeights)).toBeCloseTo(2, 3);
			expect(fuzzyTokenWeight("color", orderB, dualWeights)).toBeCloseTo(2, 3);
		});

		it("multiplies non-containment Dice similarity by item weight", () => {
			const itemSet = new Set(["optimisation"]);
			const weights = new Map([["optimisation", 9]]);
			const result = fuzzyTokenWeight("optimize", itemSet, weights);
			expect(result).toBeCloseTo(9 * (5 / 9), 3); // 9 * (5/9) = 5
		});

		it("returns 0 when no items match with positive similarity", () => {
			const itemSet = new Set(["wxyz", "pqrs"]);
			expect(fuzzyTokenWeight("abcd", itemSet, undefined)).toBe(0);
		});

		it("returns 0 for an empty item token set", () => {
			expect(fuzzyTokenWeight("optim", new Set(), undefined)).toBe(0);
		});
	});
});
