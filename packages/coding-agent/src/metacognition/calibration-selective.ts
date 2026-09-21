/**
 * Probability calibration and selective execution (Jev audit algorithm A3).
 *
 * A provider's `confidence` is a statistic over its own option distribution,
 * not a calibrated probability of any event we care about. Before it can gate
 * execution, the predicted event has to be named — "the chosen candidate was
 * appropriate" is a different event from "the driver executed it" and from
 * "the task succeeded" — and the score has to be measured on held-out data.
 *
 * These are the measurement primitives, deliberately small: distribution
 * features, a post-hoc temperature rule, scoring rules, and a selective gate
 * that always reports coverage next to risk. None of them makes a score
 * trustworthy; they make it measurable.
 */

import { ensure } from "./validation.ts";

const SUM_TOLERANCE = 1e-9;
/** Floor for numeric zeros in temperature scaling; recorded so results are reproducible. */
export const TEMPERATURE_EPSILON = 1e-12;
/** Clip for log loss so one confident miss does not return Infinity. */
export const LOG_LOSS_CLIP = 1e-15;

export interface DistributionFeatures {
	readonly maxProbability: number;
	/** p(1) − p(2). Undefined for a single candidate: there is nothing to compare. */
	readonly margin: number | undefined;
	/** Undefined for a single candidate, where entropy carries no information. */
	readonly normalizedEntropy: number | undefined;
	readonly candidateCount: number;
	readonly logCandidateCount: number;
}

function assertDistribution(probabilities: readonly number[]): void {
	ensure(Array.isArray(probabilities) && probabilities.length > 0, "distribution must be non-empty");
	let total = 0;
	for (const p of probabilities) {
		ensure(typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1, "each probability must be in [0,1]");
		total += p;
	}
	ensure(Math.abs(total - 1) <= SUM_TOLERANCE, "distribution must sum to one");
}

/**
 * Summary features of a candidate distribution.
 *
 * A single candidate can show probability 1 while telling you nothing about
 * whether that candidate is correct, so its margin and entropy are undefined
 * rather than maximally confident.
 */
export function distributionFeatures(probabilities: readonly number[]): DistributionFeatures {
	assertDistribution(probabilities);
	const sorted = [...probabilities].sort((a, b) => b - a);
	const count = probabilities.length;
	const maxProbability = sorted[0] ?? 0;
	if (count === 1) {
		return {
			maxProbability,
			margin: undefined,
			normalizedEntropy: undefined,
			candidateCount: 1,
			logCandidateCount: 0,
		};
	}
	// 0·log0 is defined as 0; skipping the term is exactly that definition.
	let entropy = 0;
	for (const p of probabilities) if (p > 0) entropy -= p * Math.log(p);
	return {
		maxProbability,
		margin: maxProbability - (sorted[1] ?? 0),
		normalizedEntropy: entropy / Math.log(count),
		candidateCount: count,
		logCandidateCount: Math.log(count),
	};
}

/**
 * Post-hoc temperature rule: p̃(a) ∝ max(p(a), ε)^(1/T).
 *
 * T is fitted on a calibration split, never on the data being scored. This
 * does not assume the input came from a softmax; whether it helps has to be
 * measured separately.
 */
export function temperatureScale(
	probabilities: readonly number[],
	temperature: number,
	epsilon: number = TEMPERATURE_EPSILON,
): number[] {
	assertDistribution(probabilities);
	ensure(
		typeof temperature === "number" && Number.isFinite(temperature) && temperature > 0,
		"temperature must be positive",
	);
	ensure(typeof epsilon === "number" && epsilon > 0 && epsilon < 1, "epsilon must be in (0,1)");
	// Subtract before dividing. Even the smallest positive T keeps a maximum at
	// exp(0) = 1; other terms may safely underflow to zero, never all terms.
	const logs = probabilities.map((p) => Math.log(Math.max(p, epsilon)));
	let maximum = Number.NEGATIVE_INFINITY;
	for (const value of logs) maximum = Math.max(maximum, value);
	const raised = logs.map((value) => Math.exp((value - maximum) / temperature));
	const total = raised.reduce((sum, value) => sum + value, 0);
	ensure(total > 0 && Number.isFinite(total), "temperature scaling produced a degenerate distribution");
	return raised.map((value) => value / total);
}

function assertBinaryPaired(forecasts: readonly number[], outcomes: readonly number[]): void {
	ensure(Array.isArray(forecasts) && Array.isArray(outcomes), "forecasts and outcomes must be arrays");
	ensure(forecasts.length === outcomes.length, "forecasts and outcomes must align");
	ensure(forecasts.length > 0, "at least one paired observation is required");
	for (const q of forecasts) {
		ensure(typeof q === "number" && Number.isFinite(q) && q >= 0 && q <= 1, "each forecast must be in [0,1]");
	}
	for (const y of outcomes) ensure(y === 0 || y === 1, "each outcome must be 0 or 1");
}

export function brierScore(forecasts: readonly number[], outcomes: readonly number[]): number {
	assertBinaryPaired(forecasts, outcomes);
	let total = 0;
	for (const [i, q] of forecasts.entries()) total += (q - outcomes[i]!) ** 2;
	return total / forecasts.length;
}

export function negativeLogLoss(
	forecasts: readonly number[],
	outcomes: readonly number[],
	clip: number = LOG_LOSS_CLIP,
): number {
	assertBinaryPaired(forecasts, outcomes);
	ensure(typeof clip === "number" && clip > 0 && clip < 0.5, "clip must be in (0,0.5)");
	ensure(1 - clip < 1, "clip is too small to represent at the upper boundary");
	let total = 0;
	for (const [i, raw] of forecasts.entries()) {
		const q = Math.min(1 - clip, Math.max(clip, raw));
		total -= outcomes[i] === 1 ? Math.log(q) : Math.log1p(-q);
	}
	return total / forecasts.length;
}

export interface CalibrationBin {
	readonly lower: number;
	readonly upper: number;
	readonly count: number;
	readonly accuracy: number | undefined;
	readonly confidence: number | undefined;
}

export interface CalibrationReport {
	readonly error: number;
	readonly bins: readonly CalibrationBin[];
	readonly samples: number;
}

/**
 * Expected calibration error with its bin occupancy.
 *
 * ECE is sensitive to binning, so the bins and their counts are returned with
 * it: a near-zero error over three samples is not evidence of calibration.
 */
export function expectedCalibrationError(
	forecasts: readonly number[],
	outcomes: readonly number[],
	binCount: number,
): CalibrationReport {
	assertBinaryPaired(forecasts, outcomes);
	ensure(Number.isSafeInteger(binCount) && binCount > 0, "binCount must be a positive integer");
	const sums = Array.from({ length: binCount }, () => ({ count: 0, outcome: 0, forecast: 0 }));
	for (const [i, q] of forecasts.entries()) {
		const index = Math.min(binCount - 1, Math.floor(q * binCount));
		const bin = sums[index]!;
		bin.count += 1;
		bin.outcome += outcomes[i]!;
		bin.forecast += q;
	}
	const samples = forecasts.length;
	let error = 0;
	const bins = sums.map((bin, index) => {
		const accuracy = bin.count > 0 ? bin.outcome / bin.count : undefined;
		const confidence = bin.count > 0 ? bin.forecast / bin.count : undefined;
		if (accuracy !== undefined && confidence !== undefined) {
			error += (bin.count / samples) * Math.abs(accuracy - confidence);
		}
		return { lower: index / binCount, upper: (index + 1) / binCount, count: bin.count, accuracy, confidence };
	});
	return { error, bins, samples };
}

export interface SelectiveExecutionReport {
	readonly admitted: number;
	readonly coverage: number;
	/** Undefined when nothing was admitted: that is unmeasurable, not risk-free. */
	readonly risk: number | undefined;
}

/**
 * Selective execution gate: a(τ) = 1[q̂ ≥ τ] · 1[G = 1].
 *
 * Risk and coverage are returned together because refusing everything drives
 * measured risk to zero while delivering nothing.
 */
export function selectiveExecution(
	scores: readonly number[],
	appropriate: readonly number[],
	threshold: number,
	policyGates: readonly boolean[],
): SelectiveExecutionReport {
	assertBinaryPaired(scores, appropriate);
	ensure(policyGates.length === scores.length, "policy gates must align with scores");
	ensure(
		typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1,
		"threshold must be in [0,1]",
	);
	let admitted = 0;
	let errors = 0;
	for (const [i, score] of scores.entries()) {
		if (score < threshold || policyGates[i] !== true) continue;
		admitted += 1;
		if (appropriate[i] === 0) errors += 1;
	}
	return {
		admitted,
		coverage: admitted / scores.length,
		risk: admitted > 0 ? errors / admitted : undefined,
	};
}
