import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	alphaAt,
	anytimeMeanBound,
	anytimePValue,
	anytimeQuantileBound,
	compensatedMean,
	compensatedSum,
	hoeffdingRadius,
	zeroFailureUpperBound,
} from "../src/core/performance-upgrade/anytime-bounds.ts";
import { MeasurementInputError } from "../src/core/performance-upgrade/measurement-trace.ts";

// OMK_MATH_f46a8f6 B12 anytime-valid bounds. Literal expectations were produced by AdaptOrch's
// research kernel (runtime_experiment_gates.hoeffding_radius / hoeffding_interval at
// alpha_{j,n} = alpha / (J n (n + 1))) and an independent stdlib Python reference, not by this module.

const B12 = { alpha: 1 / 20, familySize: 8 } as const;

describe("alphaAt and hoeffdingRadius", () => {
	it("spends alpha / (J n (n + 1)) at sample size n", () => {
		expect(alphaAt(B12, 1)).toBeCloseTo(0.003125, 18);
		expect(alphaAt(B12, 30)).toBeCloseTo(0.05 / (8 * 30 * 31), 18);
	});

	it.each([
		[1, 3.594848585505019],
		[30, 0.9166426269068759],
		[100, 0.5475145970405377],
		[1000, 0.1979132691564218],
	])("matches the AdaptOrch radius at n = %i", (n, expected) => {
		expect(hoeffdingRadius(B12, n)).toBeCloseTo(expected, 12);
	});

	it("stays finite and matches AdaptOrch at alpha = 1e-300", () => {
		expect(hoeffdingRadius({ alpha: 1e-300, familySize: 8 }, 10)).toBeCloseTo(11.817348238807604, 12);
	});

	it.each([
		[{ alpha: 0, familySize: 1 }, 1],
		[{ alpha: 1, familySize: 1 }, 1],
		[{ alpha: 0.05, familySize: 0 }, 1],
		[{ alpha: 0.05, familySize: 1.5 }, 1],
		[B12, 0],
		[B12, 2.5],
	])("rejects family %o at n = %s", (family, n) => {
		expect(() => hoeffdingRadius(family, n)).toThrow(MeasurementInputError);
	});
});

describe("anytimeMeanBound", () => {
	it("is [-1, 1] with no mean at n = 0", () => {
		expect(anytimeMeanBound([], B12)).toEqual({ n: 0, mean: undefined, lower: -1, upper: 1 });
	});

	it("validates alpha and J even without observations", () => {
		expect(() => anytimeMeanBound([], { alpha: 0, familySize: 1 })).toThrow(MeasurementInputError);
		expect(() => anytimePValue([], 0, { alpha: 1, familySize: 1 })).toThrow(MeasurementInputError);
		expect(() => anytimeQuantileBound([], 0.5, 10, { alpha: 0.05, familySize: 0 })).toThrow(MeasurementInputError);
		expect(() => zeroFailureUpperBound({ alpha: 2, familySize: 1 }, 0)).toThrow(MeasurementInputError);
	});

	it("matches AdaptOrch hoeffding_interval", () => {
		const bound = anytimeMeanBound(Array(100).fill(0.9), { alpha: 0.5, familySize: 1 });
		expect(bound.mean).toBeCloseTo(0.9, 15);
		expect(bound.lower).toBeCloseTo(0.4394224264263567, 12);
		expect(bound.upper).toBe(1);
	});

	it("rejects observations outside [-1, 1] and non-numbers", () => {
		expect(() => anytimeMeanBound([0.5, 1.5], B12)).toThrow(MeasurementInputError);
		expect(() => anytimeMeanBound([Number.NaN], B12)).toThrow(MeasurementInputError);
		expect(() => anytimeMeanBound(["0.5", "0.5"] as unknown as number[], B12)).toThrow(MeasurementInputError);
		expect(() => anytimeMeanBound([null] as unknown as number[], B12)).toThrow(MeasurementInputError);
	});

	it("refuses an empty compensated mean instead of returning NaN", () => {
		expect(() => compensatedMean([])).toThrow(expect.objectContaining({ code: "empty_sample" }));
	});

	it("keeps -1 <= lower <= mean <= upper <= 1", () => {
		fc.assert(
			fc.property(
				fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 200 }),
				(values) => {
					const { mean, lower, upper } = anytimeMeanBound(values, B12);
					expect(mean).toBeDefined();
					expect(-1 <= lower && lower <= (mean ?? 0) + 1e-15).toBe(true);
					expect((mean ?? 0) - 1e-15 <= upper && upper <= 1).toBe(true);
				},
			),
			{ numRuns: 500, seed: 2718 },
		);
	});

	it("covers the true mean at every n in seeded simulations", () => {
		// Bernoulli(+-1) steps with mean 0.2; the sequence must hold simultaneously for n <= 300.
		// Each replicate misses with probability at most alpha = 0.05, hence the allowance of 5 in
		// 100. The seed is fixed, so the count is deterministic; it is 0 because the bound is
		// conservative.
		let state = 20260928;
		const next = () => {
			state = (48271 * state) % 2147483647;
			return state / 2147483647;
		};
		let misses = 0;
		for (let replicate = 0; replicate < 100; replicate++) {
			const values: number[] = [];
			for (let n = 1; n <= 300; n++) {
				values.push(next() < 0.6 ? 1 : -1);
				const { lower, upper } = anytimeMeanBound(values, { alpha: 0.05, familySize: 1 });
				if (0.2 < lower || 0.2 > upper) {
					misses++;
					break;
				}
			}
		}
		expect(misses).toBeLessThanOrEqual(5);
	});
});

describe("anytimePValue", () => {
	const mean03 = Array.from({ length: 400 }, (_, index) => (index % 2 === 0 ? 0.2 : 0.4));

	it("is J n (n + 1) exp(-n/2 (mean - delta)_+^2), capped at 1", () => {
		expect(anytimePValue(mean03, 0, B12)).toBeCloseTo(0.019543110008415247, 14);
		expect(anytimePValue(mean03, 0.1, B12)).toBe(1);
		expect(anytimePValue(mean03, 0.5, B12)).toBe(1);
	});

	it("is undefined without observations", () => {
		expect(anytimePValue([], 0, B12)).toBeUndefined();
	});

	it("rejects a non-finite delta", () => {
		expect(() => anytimePValue(mean03, Number.NaN, B12)).toThrow(MeasurementInputError);
		expect(() => anytimePValue(mean03, Number.NEGATIVE_INFINITY, B12)).toThrow(MeasurementInputError);
	});

	it("does not depend on alpha, which the formula does not contain", () => {
		// Going through log(1 / alpha_{j,n}) + log(alpha) made p drift with alpha by up to ~2e-14.
		const reference = anytimePValue(mean03, 0, { alpha: 0.5, familySize: 8 });
		expect(reference).toBeGreaterThan(0);
		expect(reference).toBeLessThan(1);
		for (const alpha of [0.05, 1e-12, 1e-300]) {
			expect(anytimePValue(mean03, 0, { alpha, familySize: 8 })).toBe(reference);
		}
	});
});

describe("zeroFailureUpperBound", () => {
	it("solves (1 - p)^n = alpha_{j,n}", () => {
		expect(zeroFailureUpperBound(B12, 30)).toBeCloseTo(0.32767400650080936, 14);
		const p = zeroFailureUpperBound(B12, 30);
		expect((1 - p) ** 30).toBeCloseTo(alphaAt(B12, 30), 15);
	});

	it("is the vacuous bound 1 without trials", () => {
		expect(zeroFailureUpperBound(B12, 0)).toBe(1);
	});
});

describe("anytimeQuantileBound", () => {
	const latencies = Array.from({ length: 1000 }, (_, index) => index + 1);

	it("brackets the empirical quantile with the DKW band", () => {
		expect(anytimeQuantileBound(latencies, 0.5, 5000, B12)).toEqual({
			n: 1000,
			estimate: 500,
			lower: 402,
			upper: 599,
			upperIsCap: false,
		});
	});

	it("finds the smallest k with k / n >= p despite rounding in p * n", () => {
		// 0.07 * 100 rounds up to 7.000000000000001, whose ceiling overshoots to k = 8.
		const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
		expect(anytimeQuantileBound(hundred, 0.07, 1000, B12).estimate).toBe(7);
		// 0.33333333333333337 * 3 rounds down to 1 although 1/3 < p, so k must move up to 2.
		expect(anytimeQuantileBound([10, 20, 30], 0.33333333333333337, 1000, B12).estimate).toBe(20);
	});

	it("caps at tau and reports an unknown tail when the band reaches it", () => {
		const bound = anytimeQuantileBound([10, 20, Number.POSITIVE_INFINITY], 0.95, 100, B12);
		expect(bound).toEqual({ n: 3, estimate: 100, lower: 0, upper: 100, upperIsCap: true });
	});

	it("is [0, tau] with no estimate at n = 0", () => {
		expect(anytimeQuantileBound([], 0.95, 100, B12)).toEqual({
			n: 0,
			estimate: undefined,
			lower: 0,
			upper: 100,
			upperIsCap: true,
		});
	});

	it.each([
		[[1, -2], 0.5, 10],
		[[1, Number.NaN], 0.5, 10],
		[[null, null, 100] as unknown as number[], 0.5, 1000],
		[[1, 2], "0.5" as unknown as number, 10],
		[[1, 2], 0, 10],
		[[1, 2], 1, 10],
		[[1, 2], 0.5, 0],
	])("rejects latencies %o at p = %s with tau = %s", (values, p, tau) => {
		expect(() => anytimeQuantileBound(values, p, tau, B12)).toThrow(MeasurementInputError);
	});
});

describe("compensatedSum", () => {
	const ones = Array.from({ length: 10 }, () => 1);

	it("sums an empty array to 0, where the mean refuses it", () => {
		expect(compensatedSum([])).toBe(0);
	});

	it("keeps the low-order terms a plain running sum drops", () => {
		const values = [1e16, ...ones];
		// Premise: next to 1e16 (spacing 2) a plain sum loses every 1, so this test can fail.
		expect(values.reduce((sum, value) => sum + value, 0)).toBe(1e16);
		expect(compensatedSum(values)).toBe(10000000000000010);
	});

	it("compensates when an addend is larger than the running sum (Neumaier, not Kahan)", () => {
		// The exact sum is 2. Kahan's correction assumes |sum| >= |addend| and returns 0 here.
		expect(compensatedSum([1, 1e100, 1, -1e100])).toBe(2);
	});

	it("leaves compensatedMean dividing the compensated sum, not a plain one", () => {
		// (1e16 + 10) / 11; a plain sum would give 1e16 / 11.
		expect(compensatedMean([1e16, ...ones])).toBe(10000000000000010 / 11);
	});
});
