/**
 * Finite decision-model arithmetic for metacognitive control.
 *
 * TypeScript port of docs/OMK_meta_algorithm_checks_2026-09-19.zip
 * (check_examples.py) — the numerical checks referenced by
 * OMK_metacognitive_control_algorithms_2026-09-19.md §5.3, §6.2.
 *
 * These are illustrative finite-model computations, NOT measured OMK risk
 * estimates. Callers must supply real, defensible probabilities; this module
 * only guarantees the arithmetic is correct and rejects malformed inputs.
 */
import { ensure, finite, probability, probabilityVector } from "./validation.ts";

/**
 * Minimum expected loss over a finite set of terminal decisions.
 * losses[d][h] is the loss of decision d when hypothesis h is true.
 */
export function bayesRisk(prior: readonly number[], losses: readonly (readonly number[])[]): number {
	probabilityVector(prior, "prior");
	ensure(losses.length > 0, "at least one terminal decision is required");
	let best = Number.POSITIVE_INFINITY;
	for (const row of losses) {
		ensure(row.length === prior.length, "loss row must match hypotheses");
		let risk = 0;
		for (let h = 0; h < prior.length; h++) {
			finite(row[h]!, "loss");
			risk += prior[h]! * row[h]!;
		}
		if (risk < best) best = risk;
	}
	return best;
}

export interface ExperimentBranch {
	readonly outcome: number;
	readonly probability: number;
	readonly posterior: readonly number[];
	readonly risk: number;
}
export interface ExperimentValue {
	readonly before: number;
	readonly expectedAfter: number;
	readonly grossValue: number;
	readonly cost: number;
	readonly netValue: number;
	readonly branches: readonly ExperimentBranch[];
}

/**
 * One-step value of information: Bayes risk before minus expected Bayes risk
 * after observing the experiment outcome, minus the experiment cost.
 * likelihoodByHypothesis[h][o] = P(outcome o | hypothesis h).
 * Zero-probability outcomes are skipped; the caller must treat an actually
 * observed impossible outcome as a model mismatch, never renormalize it away.
 */
export function experimentValue(
	prior: readonly number[],
	losses: readonly (readonly number[])[],
	likelihoodByHypothesis: readonly (readonly number[])[],
	cost: number,
): ExperimentValue {
	probabilityVector(prior, "prior");
	finite(cost, "cost");
	const rows = likelihoodByHypothesis.map((row) => {
		probabilityVector(row, "likelihood");
		return row;
	});
	ensure(rows.length === prior.length, "likelihood matrix must match hypotheses");
	ensure(new Set(rows.map((r) => r.length)).size === 1, "likelihood matrix shape mismatch");
	const outcomeCount = rows[0]!.length;
	const before = bayesRisk(prior, losses);
	const branches: ExperimentBranch[] = [];
	let expectedAfter = 0;
	for (let outcome = 0; outcome < outcomeCount; outcome++) {
		const masses = prior.map((p, h) => p * rows[h]![outcome]!);
		const marginal = masses.reduce((a, b) => a + b, 0);
		if (marginal === 0) continue;
		const posterior = masses.map((m) => m / marginal);
		const after = bayesRisk(posterior, losses);
		expectedAfter += marginal * after;
		branches.push({ outcome, probability: marginal, posterior, risk: after });
	}
	return {
		before,
		expectedAfter,
		grossValue: before - expectedAfter,
		cost,
		netValue: before - expectedAfter - cost,
		branches,
	};
}

/** Brier score for one binary event. */
export function brier(predicted: number, outcome: 0 | 1): number {
	probability(predicted, "predicted");
	const p = outcome === 1 ? predicted : 1 - predicted;
	return (1 - p) ** 2;
}

/** Negative log-likelihood surprise for one binary event (epsilon-clamped). */
export function surprise(predicted: number, outcome: 0 | 1, epsilon = 1e-12): number {
	probability(predicted, "predicted");
	finite(epsilon, "epsilon", 1);
	ensure(epsilon > 0, "epsilon must be positive");
	const p = outcome === 1 ? predicted : 1 - predicted;
	return -Math.log(Math.max(epsilon, p));
}

/**
 * Beta posterior mean for an independent binary task outcome under a fixed
 * policy in a homogeneous condition bucket. The prior (alpha, beta) must be
 * declared by the host; this is not a learned-calibration claim.
 */
export function betaPosteriorMean(alpha: number, beta: number, successes: number, failures: number): number {
	finite(alpha, "alpha", 1e9);
	finite(beta, "beta", 1e9);
	ensure(alpha > 0 && beta > 0, "beta prior parameters must be positive");
	finite(successes, "successes", 1e12);
	finite(failures, "failures", 1e12);
	return (alpha + successes) / (alpha + beta + successes + failures);
}

/**
 * CUSUM-style drift accumulator over per-observation losses in one condition
 * bucket. Returns the new accumulator value; the caller compares it against
 * a host-declared threshold h_g. Not a guaranteed false-alarm rate.
 */
export function driftStatistic(previous: number, loss: number, referenceMean: number, slack: number): number {
	finite(previous, "previous");
	finite(loss, "loss");
	finite(referenceMean, "referenceMean");
	finite(slack, "slack");
	return Math.max(0, previous + loss - referenceMean - slack);
}
