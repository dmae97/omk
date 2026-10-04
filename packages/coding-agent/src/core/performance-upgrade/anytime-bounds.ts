import { MeasurementInputError } from "./measurement-trace.ts";

/**
 * B12 anytime-valid bounds (OMK_MATH_f46a8f6) for i.i.d. observations bounded in [-1, 1].
 *
 * The error budget alpha is split over J simultaneous statements and every sample size n as
 * alpha_{j,n} = alpha / (J n (n + 1)); the sum over j and n is alpha, so every interval and test
 * below holds for all n at once and survives optional stopping. Checking only at checkpoints
 * keeps that guarantee, and re-evaluating after every one of N samples costs O(N^2 log N) in
 * total. The price is width: at alpha = 1/20 and J = 8 the radius is 0.917 at n = 30 and 0.198
 * at n = 1000.
 *
 * Logarithms are taken of each factor so tiny alpha_{j,n} never underflows, and means use a
 * compensated (Neumaier) sum.
 */
export interface BoundFamily {
	readonly alpha: number;
	/** J: how many bounds share alpha. */
	readonly familySize: number;
}

export interface MeanBound {
	readonly n: number;
	readonly mean: number | undefined;
	readonly lower: number;
	readonly upper: number;
}

export interface QuantileBound {
	readonly n: number;
	readonly estimate: number | undefined;
	readonly lower: number;
	readonly upper: number;
	/** The upper bound reached tau: the quantile of the uncapped latency is unknown. */
	readonly upperIsCap: boolean;
}

/** Throws unless 0 < alpha < 1 and J is a positive safe integer. */
export function checkBoundFamily({ alpha, familySize }: BoundFamily): void {
	if (typeof alpha !== "number" || !(alpha > 0 && alpha < 1)) {
		throw new MeasurementInputError("invalid_number", "alpha");
	}
	if (!Number.isSafeInteger(familySize) || familySize < 1) {
		throw new MeasurementInputError("invalid_number", "familySize");
	}
}

/** log(J n (n + 1)) for n >= 1: the union-bound factor, without alpha. */
function logUnionFactor(family: BoundFamily, n: number): number {
	checkBoundFamily(family);
	if (!Number.isSafeInteger(n) || n < 1) throw new MeasurementInputError("invalid_number", "n");
	return Math.log(family.familySize) + Math.log(n) + Math.log(n + 1);
}

/** log(1 / alpha_{j,n}) = log(J n (n + 1)) - log(alpha). */
function logInverseLevel(family: BoundFamily, n: number): number {
	return logUnionFactor(family, n) - Math.log(family.alpha);
}

export function alphaAt(family: BoundFamily, n: number): number {
	return Math.exp(-logInverseLevel(family, n));
}

/** r_{j,n} = sqrt((2 / n) log(2 / alpha_{j,n})), the Hoeffding radius for range 2. */
export function hoeffdingRadius(family: BoundFamily, n: number): number {
	return Math.sqrt((2 / n) * (Math.LN2 + logInverseLevel(family, n)));
}

/** Neumaier-compensated sum; an empty array sums to 0. An overflow yields NaN or ±Infinity; check isFinite. */
export function compensatedSum(values: readonly number[]): number {
	let sum = 0;
	let compensation = 0;
	for (const value of values) {
		const next = sum + value;
		compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
		sum = next;
	}
	return sum + compensation;
}

/** Neumaier-compensated mean of a non-empty array. */
export function compensatedMean(values: readonly number[]): number {
	if (values.length === 0) throw new MeasurementInputError("empty_sample", "values");
	return compensatedSum(values) / values.length;
}

/** Every observation must be a number in [-1, 1]. */
function checkObservations(values: readonly number[]): void {
	for (const value of values) {
		if (typeof value !== "number" || !(value >= -1 && value <= 1)) {
			throw new MeasurementInputError("invalid_number", "observation");
		}
	}
}

/** [max(-1, mean - r), min(1, mean + r)]; n = 0 gives [-1, 1] and no mean. */
export function anytimeMeanBound(values: readonly number[], family: BoundFamily): MeanBound {
	checkBoundFamily(family);
	checkObservations(values);
	const n = values.length;
	if (n === 0) return { n, mean: undefined, lower: -1, upper: 1 };
	const mean = compensatedMean(values);
	const radius = hoeffdingRadius(family, n);
	return { n, mean, lower: Math.max(-1, mean - radius), upper: Math.min(1, mean + radius) };
}

/**
 * One-sided test of H0: E V <= delta, p = min{1, J n (n + 1) exp[-(n / 2)(mean - delta)_+^2]}.
 * It is not the dual of the two-sided interval (its threshold is narrower); promotion uses the
 * interval. Undefined (bottom) at n = 0.
 */
export function anytimePValue(values: readonly number[], delta: number, family: BoundFamily): number | undefined {
	checkBoundFamily(family);
	checkObservations(values);
	if (!Number.isFinite(delta)) throw new MeasurementInputError("invalid_number", "delta");
	const n = values.length;
	if (n === 0) return undefined;
	const excess = Math.max(0, compensatedMean(values) - delta);
	return Math.min(1, Math.exp(logUnionFactor(family, n) - (n / 2) * excess * excess));
}

/**
 * Upper bound on a failure probability after n failure-free i.i.d. Bernoulli trials:
 * 1 - alpha_{j,n}^{1/n}. Zero observed failures is not a zero failure rate. n = 0 gives 1.
 */
export function zeroFailureUpperBound(family: BoundFamily, n: number): number {
	if (n === 0) {
		checkBoundFamily(family);
		return 1;
	}
	return -Math.expm1(-logInverseLevel(family, n) / n);
}

/** inf{t : F_hat(t) >= u} over sorted values, 0 < u <= 1. */
function empiricalQuantile(sorted: readonly number[], u: number): number {
	const n = sorted.length;
	let k = Math.min(n, Math.max(1, Math.ceil(u * n)));
	while (k > 1 && (k - 1) / n >= u) k--;
	while (k < n && k / n < u) k++;
	return sorted[k - 1];
}

/**
 * DKW band for the p-quantile of L = min(T, tau): with eps = sqrt(log(2 / alpha_{j,n}) / (2n)),
 * Q(p) lies in [Q_hat(p - eps), Q_hat(p + eps)], where the lower end is 0 below u = 0 and the
 * upper end is tau from u = 1. Latencies may be +Infinity (never settled); they count as tau.
 */
export function anytimeQuantileBound(
	latencies: readonly number[],
	p: number,
	tau: number,
	family: BoundFamily,
): QuantileBound {
	checkBoundFamily(family);
	if (typeof p !== "number" || !(p > 0 && p < 1)) throw new MeasurementInputError("invalid_number", "p");
	if (!(tau > 0 && Number.isFinite(tau))) throw new MeasurementInputError("invalid_number", "tau");
	for (const latency of latencies) {
		if (typeof latency !== "number" || !(latency >= 0)) throw new MeasurementInputError("invalid_number", "latency");
	}
	const n = latencies.length;
	if (n === 0) return { n, estimate: undefined, lower: 0, upper: tau, upperIsCap: true };
	const sorted = latencies.map((latency) => Math.min(latency, tau)).sort((a, b) => a - b);
	const eps = Math.sqrt((Math.LN2 + logInverseLevel(family, n)) / (2 * n));
	const lower = p - eps <= 0 ? 0 : empiricalQuantile(sorted, p - eps);
	const upper = p + eps >= 1 ? tau : empiricalQuantile(sorted, p + eps);
	return { n, estimate: empiricalQuantile(sorted, p), lower, upper, upperIsCap: upper >= tau };
}
