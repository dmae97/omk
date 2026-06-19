import { describe, expect, it } from "vitest";
import { checkProperty, listShrink, makeRng, shrinkFailure } from "./property.ts";

describe("makeRng", () => {
	it("is deterministic for a given seed", () => {
		const a = makeRng(1234);
		const b = makeRng(1234);
		const seqA = Array.from({ length: 8 }, () => a.nextFloat());
		const seqB = Array.from({ length: 8 }, () => b.nextFloat());
		expect(seqA).toEqual(seqB);
	});

	it("produces different streams for different seeds", () => {
		const a = Array.from({ length: 8 }, makeRng(1).nextFloat);
		const b = Array.from({ length: 8 }, makeRng(2).nextFloat);
		expect(a).not.toEqual(b);
	});

	it("keeps nextInt within range and pick inside the array", () => {
		const rng = makeRng(99);
		for (let i = 0; i < 100; i++) {
			const n = rng.nextInt(5);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThan(5);
		}
		const items = ["a", "b", "c"] as const;
		for (let i = 0; i < 50; i++) {
			expect(items).toContain(rng.pick(items));
		}
	});
});

describe("shrinkFailure (delta debugging)", () => {
	// The property "an array must not contain 7" fails for any list with a 7;
	// the minimal failing subsequence is exactly [7].
	const predicate = (arr: readonly number[]): void => {
		if (arr.includes(7)) throw new Error("array contains 7");
	};

	it("reduces a failing list to the single offending element", () => {
		const initial = [1, 7, 3, 7, 5];
		let initialError: Error | undefined;
		try {
			predicate(initial);
		} catch (error) {
			initialError = error instanceof Error ? error : new Error(String(error));
		}
		expect(initialError).toBeDefined();

		const outcome = shrinkFailure(initial, initialError as Error, predicate, listShrink);
		expect(outcome.value).toEqual([7]);
		expect(outcome.error.message).toBe("array contains 7");
	});

	it("stops at a minimal multi-element cause when no single element fails", () => {
		// Fails only when both 2 and 3 are present (adjacent or not).
		const pairPredicate = (arr: readonly number[]): void => {
			if (arr.includes(2) && arr.includes(3)) throw new Error("has 2 and 3");
		};
		const initial = [1, 2, 9, 3, 4];
		const outcome = shrinkFailure(initial, new Error("has 2 and 3"), pairPredicate, listShrink);
		expect(new Set(outcome.value)).toEqual(new Set([2, 3]));
		expect(outcome.value.length).toBe(2);
	});
});

describe("checkProperty", () => {
	it("passes for a property that always holds", () => {
		expect(() =>
			checkProperty<number[]>({
				seeds: [1, 2, 3],
				numRuns: 20,
				generate: (rng) => Array.from({ length: rng.nextInt(6) }, () => rng.nextInt(100)),
				predicate: (arr) => {
					for (const n of arr) expect(n).toBeLessThan(100);
				},
				shrink: listShrink,
			}),
		).not.toThrow();
	});

	it("throws with seed and a minimal counterexample for a violated property", () => {
		let thrown: Error | undefined;
		try {
			checkProperty<number[]>({
				seeds: [42],
				numRuns: 200,
				// Generate lists that will eventually include the value 7.
				generate: (rng) => Array.from({ length: 1 + rng.nextInt(6) }, () => rng.nextInt(10)),
				predicate: (arr) => {
					if (arr.includes(7)) throw new Error("array contains 7");
				},
				shrink: listShrink,
				format: (arr) => `[${arr.join(",")}]`,
			});
		} catch (error) {
			thrown = error instanceof Error ? error : new Error(String(error));
		}
		expect(thrown).toBeDefined();
		expect(thrown?.message).toContain("seed=42");
		expect(thrown?.message).toContain("Minimal counterexample: [7]");
		expect(thrown?.message).toContain("array contains 7");
	});
});
