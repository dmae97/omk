/**
 * Finite-sample risk bounds for automation gating (Jev audit algorithm A4).
 *
 * A point estimate must never widen automation scope. Two failures in a
 * hundred is not "a 2% error rate" — its one-sided 95% Clopper–Pearson upper
 * bound is about 6.2%, and that bound is what a gate reads.
 *
 * Scope: this bounds the failure probability of samples drawn under the stated
 * conditions. It is not a safety guarantee for the next action, and it assumes
 * a fixed policy, a consistent failure event, and adequately independent
 * samples. Three hundred repeated clicks inside one task are not three hundred
 * independent trials; cluster by task or environment instance before using it.
 */

import { ensure } from "./validation.ts";

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
	0.999_999_999_999_809_93, 676.520_368_121_885_1, -1259.139_216_722_402_8, 771.323_428_777_653_13,
	-176.615_029_162_140_59, 12.507_343_278_686_905, -0.138_571_095_265_720_12, 9.984_369_578_019_571_6e-6,
	1.505_632_735_149_311_6e-7,
] as const;

function logGamma(x: number): number {
	if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
	const z = x - 1;
	let a = LANCZOS_COEFFICIENTS[0];
	const t = z + LANCZOS_G + 0.5;
	for (const [index, coefficient] of LANCZOS_COEFFICIENTS.entries()) {
		if (index > 0) a += coefficient / (z + index);
	}
	return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued-fraction expansion for the incomplete beta (Lentz's method). */
function betaContinuedFraction(a: number, b: number, x: number): number {
	const maxIterations = 300;
	const epsilon = 3e-16;
	const tiny = 1e-300;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - (qab * x) / qap;
	if (Math.abs(d) < tiny) d = tiny;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= maxIterations; m += 1) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		h *= d * c;
		aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		const delta = d * c;
		h *= delta;
		if (Math.abs(delta - 1) < epsilon) break;
	}
	return h;
}

/** Regularized incomplete beta I_x(a,b). */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
	return x < (a + 1) / (a + b + 2)
		? (front * betaContinuedFraction(a, b, x)) / a
		: 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Inverse of {@link regularizedIncompleteBeta} by bisection; I_x is monotone in x. */
function betaQuantile(p: number, a: number, b: number): number {
	let low = 0;
	let high = 1;
	for (let i = 0; i < 200 && high - low > 1e-15; i += 1) {
		const mid = (low + high) / 2;
		if (regularizedIncompleteBeta(a, b, mid) < p) low = mid;
		else high = mid;
	}
	return (low + high) / 2;
}

function assertAlpha(alpha: number): void {
	ensure(
		typeof alpha === "number" && Number.isFinite(alpha) && alpha > 0 && alpha < 1,
		"alpha must be a probability strictly between 0 and 1",
	);
}

/**
 * One-sided Clopper–Pearson upper bound on the failure probability.
 *
 * `U(k,n) = Beta⁻¹(1−α; k+1, n−k)` for `0 ≤ k < n`, and `1` when every trial
 * failed. Zero trials is not zero risk: it is absent evidence, so it throws.
 */
export function clopperPearsonUpperBound(failures: number, trials: number, alpha: number): number {
	ensure(Number.isSafeInteger(trials) && trials > 0, "insufficient evidence: trials must be a positive integer");
	ensure(
		Number.isSafeInteger(failures) && failures >= 0 && failures <= trials,
		"failures must be an integer in [0, trials]",
	);
	assertAlpha(alpha);
	if (failures === trials) return 1;
	return betaQuantile(1 - alpha, failures + 1, trials - failures);
}

/** Closed form of {@link clopperPearsonUpperBound} when no trial failed. */
export function zeroFailureUpperBound(trials: number, alpha: number): number {
	ensure(Number.isSafeInteger(trials) && trials > 0, "insufficient evidence: trials must be a positive integer");
	assertAlpha(alpha);
	return -Math.expm1(Math.log(alpha) / trials);
}

/**
 * Smallest failure-free sample size whose upper bound meets `targetEpsilon`.
 *
 * `n ≥ ⌈log α / log(1−ε)⌉`, then nudged against the bound itself so a
 * floating-point boundary cannot return a sample size that misses the target.
 */
export function minimumZeroFailureSamples(targetEpsilon: number, alpha: number): number {
	ensure(
		typeof targetEpsilon === "number" && Number.isFinite(targetEpsilon) && targetEpsilon > 0 && targetEpsilon < 1,
		"targetEpsilon must be strictly between 0 and 1",
	);
	assertAlpha(alpha);
	let n = Math.max(1, Math.ceil(Math.log(alpha) / Math.log1p(-targetEpsilon)));
	while (zeroFailureUpperBound(n, alpha) > targetEpsilon) n += 1;
	while (n > 1 && zeroFailureUpperBound(n - 1, alpha) <= targetEpsilon) n -= 1;
	return n;
}

/**
 * Bonferroni split for `thresholds × groups` comparisons on one validation set.
 *
 * Searching many thresholds and reporting the best keeps none of a single
 * interval's nominal guarantee; this is the conservative correction, and it
 * raises the required sample size on purpose.
 */
export function bonferroniAlpha(alpha: number, thresholds: number, groups: number): number {
	assertAlpha(alpha);
	ensure(Number.isSafeInteger(thresholds) && thresholds > 0, "thresholds must be a positive integer");
	ensure(Number.isSafeInteger(groups) && groups > 0, "groups must be a positive integer");
	return alpha / (thresholds * groups);
}

/**
 * Union bound over per-step failure risks.
 *
 * Holds without any independence assumption, which is the point: step risks in
 * one task are usually correlated, so multiplying them would understate the
 * whole-task risk.
 */
export function unionBoundRisk(stepRisks: readonly number[]): number {
	ensure(Array.isArray(stepRisks) && stepRisks.length > 0, "stepRisks must be a non-empty array");
	let total = 0;
	for (const risk of stepRisks) {
		ensure(
			typeof risk === "number" && Number.isFinite(risk) && risk >= 0 && risk <= 1,
			"each step risk must be a probability in [0, 1]",
		);
		total += risk;
	}
	return Math.min(1, total);
}
