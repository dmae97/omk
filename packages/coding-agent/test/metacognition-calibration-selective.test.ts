/**
 * Probability calibration and selective execution — Jev audit algorithm A3.
 *
 * The audit's point is that a raw `confidence` number is not a calibrated
 * probability of anything until you say which event it predicts and measure it
 * on held-out data. These helpers keep the two separable: distribution
 * features on one side, measured calibration quality on the other, and a
 * selective-execution gate that reports coverage alongside risk.
 */

import { describe, expect, it } from "vitest";
import {
	brierScore,
	distributionFeatures,
	expectedCalibrationError,
	negativeLogLoss,
	selectiveExecution,
	temperatureScale,
} from "../src/metacognition/calibration-selective.ts";

describe("distribution features", () => {
	it("extracts margin and normalized entropy from a peaked distribution", () => {
		const f = distributionFeatures([0.7, 0.2, 0.1]);
		expect(f.maxProbability).toBeCloseTo(0.7, 12);
		expect(f.margin).toBeCloseTo(0.5, 12);
		expect(f.candidateCount).toBe(3);
		expect(f.normalizedEntropy).toBeGreaterThan(0);
		expect(f.normalizedEntropy).toBeLessThan(1);
	});

	it("reports maximal normalized entropy for a uniform distribution", () => {
		expect(distributionFeatures([0.25, 0.25, 0.25, 0.25]).normalizedEntropy).toBeCloseTo(1, 12);
	});

	it("defines 0·log0 as 0 instead of producing NaN", () => {
		const f = distributionFeatures([1, 0, 0]);
		expect(f.normalizedEntropy).toBeCloseTo(0, 12);
		expect(Number.isNaN(f.normalizedEntropy)).toBe(false);
	});

	it("marks a single candidate as unmeasurable rather than certain", () => {
		const f = distributionFeatures([1]);
		expect(f.candidateCount).toBe(1);
		expect(f.normalizedEntropy).toBeUndefined();
		expect(f.margin).toBeUndefined();
	});

	it("rejects a distribution that does not sum to one", () => {
		expect(() => distributionFeatures([0.5, 0.2])).toThrow();
		expect(() => distributionFeatures([])).toThrow();
	});
});

describe("temperature scaling", () => {
	it("is identity at T = 1", () => {
		const p = [0.7, 0.2, 0.1];
		for (const [i, v] of temperatureScale(p, 1).entries()) expect(v).toBeCloseTo(p[i]!, 12);
	});

	it("softens toward uniform as temperature rises", () => {
		const hot = temperatureScale([0.7, 0.2, 0.1], 5);
		expect(Math.max(...hot)).toBeLessThan(0.7);
		expect(hot.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
	});

	it("sharpens toward the argmax as temperature falls", () => {
		const cold = temperatureScale([0.7, 0.2, 0.1], 0.2);
		expect(Math.max(...cold)).toBeGreaterThan(0.7);
	});

	it("keeps a zero probability finite via the recorded epsilon", () => {
		const scaled = temperatureScale([1, 0], 0.5);
		expect(scaled.every((v) => Number.isFinite(v))).toBe(true);
		expect(scaled.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
	});

	it("rejects a non-positive temperature", () => {
		expect(() => temperatureScale([0.5, 0.5], 0)).toThrow();
		expect(() => temperatureScale([0.5, 0.5], -1)).toThrow();
	});
});

describe("calibration quality", () => {
	it("computes Brier score and NLL", () => {
		expect(brierScore([0.9, 0.2], [1, 0])).toBeCloseTo((0.01 + 0.04) / 2, 12);
		expect(negativeLogLoss([0.5, 0.5], [1, 0])).toBeCloseTo(Math.LN2, 12);
	});

	it("clips probabilities so a confident miss stays finite", () => {
		expect(Number.isFinite(negativeLogLoss([0, 1], [1, 0]))).toBe(true);
	});

	it("scores a perfectly wrong forecast worse than a hedged one", () => {
		expect(brierScore([0.99], [0])).toBeGreaterThan(brierScore([0.5], [0]));
	});

	it("reports ECE with its bin occupancy so an empty bin cannot look calibrated", () => {
		const result = expectedCalibrationError([0.05, 0.15, 0.95], [0, 0, 1], 10);
		expect(result.error).toBeGreaterThanOrEqual(0);
		expect(result.bins.filter((b) => b.count > 0)).toHaveLength(3);
		expect(result.bins.reduce((sum, b) => sum + b.count, 0)).toBe(3);
	});

	it("rejects mismatched forecast and outcome lengths", () => {
		expect(() => brierScore([0.5], [1, 0])).toThrow();
		expect(() => negativeLogLoss([0.5], [])).toThrow();
	});

	it("rejects a non-binary outcome", () => {
		expect(() => brierScore([0.5], [0.5])).toThrow();
	});
});

describe("selective execution", () => {
	const scores = [0.95, 0.9, 0.4, 0.2];
	const appropriate = [1, 0, 1, 0];

	it("reports coverage and risk together", () => {
		const result = selectiveExecution(scores, appropriate, 0.5, [true, true, true, true]);
		expect(result.coverage).toBeCloseTo(0.5, 12);
		expect(result.risk).toBeCloseTo(0.5, 12);
		expect(result.admitted).toBe(2);
	});

	it("treats an empty admitted set as unmeasurable, not risk-free", () => {
		const result = selectiveExecution(scores, appropriate, 0.99, [true, true, true, true]);
		expect(result.admitted).toBe(0);
		expect(result.coverage).toBe(0);
		expect(result.risk).toBeUndefined();
	});

	it("lets a mandatory policy gate veto a high score", () => {
		const result = selectiveExecution(scores, appropriate, 0.5, [false, true, true, true]);
		expect(result.admitted).toBe(1);
		expect(result.risk).toBeCloseTo(1, 12);
	});

	it("trades coverage for risk monotonically as the threshold rises", () => {
		const gates = [true, true, true, true];
		const low = selectiveExecution(scores, appropriate, 0.1, gates);
		const high = selectiveExecution(scores, appropriate, 0.5, gates);
		expect(high.coverage).toBeLessThanOrEqual(low.coverage);
	});

	it("rejects a threshold outside [0,1]", () => {
		expect(() => selectiveExecution(scores, appropriate, 1.5, [true, true, true, true])).toThrow();
	});
});
