/**
 * Finite-sample risk bounds — Jev audit algorithm A4.
 *
 * The rule this encodes: a point estimate never widens automation scope. Two
 * failures in a hundred is not "a 2% error rate"; its one-sided 95% upper bound
 * is about 6.2%, and that bound is what an automation gate must read.
 *
 * Expected values are the author's §10.2 table, cross-checked there against
 * SciPy's beta quantile and the binomial CDF inverse relation.
 */

import { describe, expect, it } from "vitest";
import {
	bonferroniAlpha,
	clopperPearsonUpperBound,
	minimumZeroFailureSamples,
	unionBoundRisk,
	zeroFailureUpperBound,
} from "../src/metacognition/risk.ts";

describe("Clopper-Pearson upper bound", () => {
	it("matches the author's worked examples", () => {
		expect(clopperPearsonUpperBound(0, 300, 0.05)).toBeCloseTo(0.009936, 6);
		expect(clopperPearsonUpperBound(2, 100, 0.05)).toBeCloseTo(0.061619, 6);
	});

	it("refuses to call a small-sample point estimate an error rate", () => {
		// 2/100 looks like 2%; the bound an automation gate must use is ~6.2%.
		const pointEstimate = 2 / 100;
		expect(clopperPearsonUpperBound(2, 100, 0.05)).toBeGreaterThan(pointEstimate * 3);
	});

	it("agrees with the closed form when there are no failures", () => {
		for (const n of [1, 10, 300, 2995]) {
			expect(clopperPearsonUpperBound(0, n, 0.05)).toBeCloseTo(zeroFailureUpperBound(n, 0.05), 9);
		}
	});

	it("returns 1 when every trial failed", () => {
		expect(clopperPearsonUpperBound(5, 5, 0.05)).toBe(1);
	});

	it("tightens monotonically as evidence accumulates", () => {
		const bounds = [10, 100, 1000, 10_000].map((n) => clopperPearsonUpperBound(0, n, 0.05));
		for (let i = 1; i < bounds.length; i += 1) {
			expect(bounds[i]!).toBeLessThan(bounds[i - 1]!);
		}
	});

	it("loosens as the confidence level rises", () => {
		expect(clopperPearsonUpperBound(1, 100, 0.01)).toBeGreaterThan(clopperPearsonUpperBound(1, 100, 0.1));
	});

	it("treats zero trials as insufficient evidence, not as zero risk", () => {
		expect(() => clopperPearsonUpperBound(0, 0, 0.05)).toThrow(/insufficient|trials/i);
	});

	it("rejects malformed inputs instead of coercing", () => {
		expect(() => clopperPearsonUpperBound(-1, 10, 0.05)).toThrow();
		expect(() => clopperPearsonUpperBound(11, 10, 0.05)).toThrow();
		expect(() => clopperPearsonUpperBound(1, 10, 0)).toThrow();
		expect(() => clopperPearsonUpperBound(1, 10, 1)).toThrow();
		expect(() => clopperPearsonUpperBound(1.5, 10, 0.05)).toThrow();
	});
});

describe("zero-failure sample sizing", () => {
	it("reproduces the author's required-sample table", () => {
		expect(minimumZeroFailureSamples(0.01, 0.05)).toBe(299);
		expect(minimumZeroFailureSamples(0.001, 0.05)).toBe(2995);
		expect(minimumZeroFailureSamples(0.0001, 0.05)).toBe(29_956);
	});

	it("produces a sample size that actually meets the target", () => {
		for (const epsilon of [0.01, 0.001, 0.0001]) {
			const n = minimumZeroFailureSamples(epsilon, 0.05);
			expect(zeroFailureUpperBound(n, 0.05)).toBeLessThanOrEqual(epsilon);
			expect(zeroFailureUpperBound(n - 1, 0.05)).toBeGreaterThan(epsilon);
		}
	});

	it("rejects targets outside (0,1)", () => {
		expect(() => minimumZeroFailureSamples(0, 0.05)).toThrow();
		expect(() => minimumZeroFailureSamples(1, 0.05)).toThrow();
	});
});

describe("multiplicity and step composition", () => {
	it("splits alpha across searched thresholds and groups", () => {
		expect(bonferroniAlpha(0.05, 10, 2)).toBeCloseTo(0.0025, 12);
		expect(bonferroniAlpha(0.05, 1, 1)).toBeCloseTo(0.05, 12);
	});

	it("makes a searched threshold demand more evidence than a fixed one", () => {
		const fixed = minimumZeroFailureSamples(0.01, 0.05);
		const searched = minimumZeroFailureSamples(0.01, bonferroniAlpha(0.05, 20, 1));
		expect(searched).toBeGreaterThan(fixed);
	});

	it("bounds whole-task risk by the sum of step risks without assuming independence", () => {
		expect(unionBoundRisk([0.01, 0.02, 0.03])).toBeCloseTo(0.06, 12);
	});

	it("caps the union bound at one rather than reporting an impossible probability", () => {
		expect(unionBoundRisk([0.6, 0.7])).toBe(1);
	});

	it("rejects a non-probability step risk", () => {
		expect(() => unionBoundRisk([0.5, 1.2])).toThrow();
	});
});
