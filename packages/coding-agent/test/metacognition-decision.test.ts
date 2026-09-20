/**
 * TypeScript port of docs/OMK_meta_algorithm_checks_2026-09-19.zip
 * (check_examples.py) — the same 13 numerical/input checks the document
 * reports passing, plus the §5.3 prediction-scoring examples.
 */
import { describe, expect, it } from "vitest";
import {
	bayesRisk,
	betaPosteriorMean,
	brier,
	driftStatistic,
	experimentValue,
	surprise,
} from "../src/metacognition/decision.ts";

const PRIOR = [0.5, 0.3, 0.2];
const LOSSES = [
	[0, 10, 10],
	[10, 0, 10],
	[3, 3, 3],
];

describe("finite decision model (check_examples.py parity)", () => {
	it("risk_before", () => {
		expect(bayesRisk(PRIOR, LOSSES)).toBeCloseTo(3.0, 12);
	});
	it("diagnostic_expected_risk", () => {
		const r = experimentValue(
			PRIOR,
			LOSSES,
			[
				[0.95, 0.05],
				[0.05, 0.95],
				[0.2, 0.8],
			],
			0.2,
		);
		expect(r.expectedAfter).toBeCloseTo(1.96, 12);
	});
	it("diagnostic_net_value", () => {
		const r = experimentValue(
			PRIOR,
			LOSSES,
			[
				[0.95, 0.05],
				[0.05, 0.95],
				[0.2, 0.8],
			],
			0.2,
		);
		expect(r.netValue).toBeCloseTo(0.84, 12);
	});
	it("generic_search_net_value is negative — relevant but not decision-changing", () => {
		const r = experimentValue(
			PRIOR,
			LOSSES,
			[
				[0.6, 0.4],
				[0.4, 0.6],
				[0.5, 0.5],
			],
			0.05,
		);
		expect(r.netValue).toBeCloseTo(-0.05, 12);
	});
	it("uninformative observation has zero gross value", () => {
		const r = experimentValue(
			PRIOR,
			LOSSES,
			[
				[0.5, 0.5],
				[0.5, 0.5],
				[0.5, 0.5],
			],
			0.1,
		);
		expect(r.grossValue).toBeCloseTo(0, 12);
	});
	it("perfect information still cannot remove the 'other' state loss", () => {
		const r = experimentValue(
			PRIOR,
			LOSSES,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1],
			],
			0,
		);
		expect(r.expectedAfter).toBeCloseTo(0.6, 12);
	});
	it("brier_confident_failure", () => {
		expect(brier(0.95, 0)).toBeCloseTo(0.9025, 12);
	});
	it("surprise_confident_failure ≈ log(20)", () => {
		expect(surprise(0.95, 0)).toBeCloseTo(Math.log(20), 4);
	});
	it("XOR: one-bit observation net value is negative", () => {
		const r = experimentValue(
			[0.25, 0.25, 0.25, 0.25],
			[
				[0, 1, 1, 0],
				[1, 0, 0, 1],
			],
			[
				[1, 0],
				[1, 0],
				[0, 1],
				[0, 1],
			],
			0.05,
		);
		expect(r.netValue).toBeCloseTo(-0.05, 12);
	});
	it("XOR: two-bit bundle net value is positive — synergy", () => {
		const r = experimentValue(
			[0.25, 0.25, 0.25, 0.25],
			[
				[0, 1, 1, 0],
				[1, 0, 0, 1],
			],
			[
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
				[0, 0, 0, 1],
			],
			0.1,
		);
		expect(r.netValue).toBeCloseTo(0.4, 12);
	});
	it("rejects NaN, negative, out-of-range, and non-normalized probabilities", () => {
		for (const malformed of [
			[Number.NaN, 0],
			[-0.1, 1.1],
			[0.3, 0.3],
		]) {
			expect(() => bayesRisk(malformed, [[0, 1]])).toThrow();
		}
		expect(() => experimentValue(PRIOR, LOSSES, [[0.5, 0.5]], 0.1)).toThrow();
		expect(() => bayesRisk(PRIOR, [])).toThrow();
	});
});

describe("beta posterior and drift statistic", () => {
	it("beta posterior mean matches the closed form", () => {
		expect(betaPosteriorMean(1, 1, 3, 1)).toBeCloseTo(4 / 6, 12);
	});
	it("drift statistic accumulates positive deviation only", () => {
		expect(driftStatistic(0, 1.0, 0.5, 0.2)).toBeCloseTo(0.3, 12);
		expect(driftStatistic(0, 0.1, 0.5, 0.2)).toBe(0);
	});
});
