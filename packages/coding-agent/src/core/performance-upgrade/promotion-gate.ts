import {
	anytimeMeanBound,
	anytimePValue,
	anytimeQuantileBound,
	type BoundFamily,
	checkBoundFamily,
	compensatedMean,
	type QuantileBound,
} from "./anytime-bounds.ts";
import { MeasurementInputError } from "./measurement-trace.ts";

/**
 * B12 promotion decision over paired A/B blocks (OMK_MATH_f46a8f6).
 *
 * Each independent task block runs the baseline (arm 0) and the candidate (arm 1) in a random
 * order O_b with tau fixed before any run. With L = min(T, tau):
 *   X_b = (L_0 - L_1) / tau,  Y_b = success_1 - success_0,  Z_b = falseCompletion_0 - falseCompletion_1,
 * so positive values favour the candidate. A run that never settled counts at tau and stays in
 * the denominator. The decision is
 *   promote  iff semanticGate and l_X > delta_T / tau and l_Y >= -eps_Q and l_Z >= -eps_F,
 *   harm     iff u_X < 0 or u_Y < -eps_Q or u_Z < -eps_F,
 *   noDecision otherwise.
 * `harm` is this module's definition; the bundle leaves harmEstablished undefined. Because l <= u,
 * promote and harm exclude each other. The bounds are anytime-valid only under i.i.d. blocks, a
 * fixed policy and bounded observations; replicates inside a block are not independent samples,
 * so block ids must be unique. Each policy and block field is read once, so a getter cannot change
 * a value after it was validated.
 */
export interface ArmObservation {
	/** Wall-clock turn latency, or null when the run never settled (counted at tau). */
	readonly latencyMs: number | null;
	readonly success: boolean;
	readonly falseCompletion: boolean;
}

export interface PairedBlock {
	readonly blockId: string;
	readonly order: "01" | "10";
	readonly baseline: ArmObservation;
	readonly candidate: ArmObservation;
}

export interface PromotionPolicy {
	/** tau, fixed before the runs. */
	readonly capMs: number;
	/** delta_T >= 0: the smallest latency gain worth promoting. */
	readonly minLatencyGainMs: number;
	/** eps_Q >= 0: tolerated success-rate loss. */
	readonly successMargin: number;
	/** eps_F >= 0: tolerated false-completion increase. */
	readonly falseCompletionMargin: number;
	/** Default 1/20. */
	readonly alpha?: number;
	/**
	 * Default and minimum: the bundle's metrics (X, Y, Z, p95) x candidateCount x arms (2). That is
	 * also the count of statements made per candidate: three intervals, three p-values and two
	 * quantile bands. Add to it if a caller reports more.
	 */
	readonly familySize?: number;
	readonly candidateCount?: number;
}

export interface MetricReport {
	readonly mean: number | undefined;
	readonly lower: number;
	readonly upper: number;
	/** Anytime p-value for H0: E V <= the metric's promotion boundary. */
	readonly pValue: number | undefined;
	/** tau * mean for latency (ms); the mean itself for the rate metrics. */
	readonly effect: number | undefined;
}

export type PromotionDecision = "promote" | "harm" | "noDecision";

export interface PromotionReport {
	readonly n: number;
	readonly familySize: number;
	readonly orderCounts: Readonly<Record<"01" | "10", number>>;
	readonly latency: MetricReport;
	readonly success: MetricReport;
	readonly falseCompletion: MetricReport;
	/** d_z = mean(D) / s_D for D_b = tau X_b; undefined unless n > 1 and s_D > 0. */
	readonly effectSizeDz: number | undefined;
	readonly p95: { readonly baseline: QuantileBound; readonly candidate: QuantileBound };
	readonly decision: PromotionDecision;
}

const METRICS = 4;
const ARMS = 2;

interface CheckedPolicy {
	readonly tau: number;
	readonly minLatencyGainMs: number;
	readonly successMargin: number;
	readonly falseCompletionMargin: number;
	readonly family: BoundFamily;
}

interface CheckedArm {
	readonly latency: number;
	readonly success: number;
	readonly falseCompletion: number;
}

function checkPolicy(policy: PromotionPolicy): CheckedPolicy {
	const { capMs, minLatencyGainMs, successMargin, falseCompletionMargin, alpha, familySize, candidateCount } = policy;
	if (!(capMs > 0 && Number.isFinite(capMs))) throw new MeasurementInputError("invalid_number", "capMs");
	for (const [field, value] of Object.entries({ minLatencyGainMs, successMargin, falseCompletionMargin })) {
		if (!(value >= 0 && Number.isFinite(value))) throw new MeasurementInputError("invalid_number", field);
	}
	// Only an absent option takes its default; null is rejected rather than read as absent.
	const candidates = candidateCount === undefined ? 1 : candidateCount;
	if (!Number.isSafeInteger(candidates) || candidates < 1) {
		throw new MeasurementInputError("invalid_number", "candidateCount");
	}
	const required = METRICS * candidates * ARMS;
	const size = familySize === undefined ? required : familySize;
	if (!Number.isSafeInteger(size)) throw new MeasurementInputError("invalid_number", "familySize");
	if (size < required) throw new MeasurementInputError("family_too_small", "familySize");
	const family = { alpha: alpha === undefined ? 1 / 20 : alpha, familySize: size };
	checkBoundFamily(family);
	return { tau: capMs, minLatencyGainMs, successMargin, falseCompletionMargin, family };
}

function checkArm(arm: ArmObservation, tau: number): CheckedArm {
	const { latencyMs, success, falseCompletion } = arm;
	if (typeof success !== "boolean" || typeof falseCompletion !== "boolean") {
		throw new MeasurementInputError("invalid_flag", "success/falseCompletion");
	}
	if (latencyMs === null) {
		if (success) throw new MeasurementInputError("contradictory_record", "latencyMs");
		return { latency: tau, success: 0, falseCompletion: Number(falseCompletion) };
	}
	if (!(latencyMs >= 0 && Number.isFinite(latencyMs))) throw new MeasurementInputError("invalid_number", "latencyMs");
	return { latency: Math.min(latencyMs, tau), success: Number(success), falseCompletion: Number(falseCompletion) };
}

function metric(values: readonly number[], boundary: number, scale: number, family: BoundFamily): MetricReport {
	const { mean, lower, upper } = anytimeMeanBound(values, family);
	return {
		mean,
		lower,
		upper,
		pValue: anytimePValue(values, boundary, family),
		effect: mean === undefined ? undefined : scale * mean,
	};
}

function standardizedEffect(differences: readonly number[]): number | undefined {
	// Identical differences have s_D = 0 exactly, but their rounded mean can miss them by an ulp
	// (0.3 / 3 !== 0.1), which would turn that zero into d_z near 1e16.
	if (differences.length < 2 || differences.every((d) => d === differences[0])) return undefined;
	const mean = compensatedMean(differences);
	const variance =
		compensatedMean(differences.map((d) => (d - mean) ** 2)) * (differences.length / (differences.length - 1));
	return variance > 0 ? mean / Math.sqrt(variance) : undefined;
}

export function evaluatePromotion(
	blocks: readonly PairedBlock[],
	policy: PromotionPolicy,
	semanticGate: boolean,
): PromotionReport {
	const { tau, minLatencyGainMs, successMargin, falseCompletionMargin, family } = checkPolicy(policy);
	const seen = new Set<string>();
	const orderCounts = { "01": 0, "10": 0 };
	const x: number[] = [];
	const y: number[] = [];
	const z: number[] = [];
	const baselineLatency: number[] = [];
	const candidateLatency: number[] = [];
	for (const block of blocks) {
		const { blockId, order, baseline, candidate } = block;
		if (typeof blockId !== "string") throw new MeasurementInputError("invalid_id", "blockId");
		if (seen.has(blockId)) throw new MeasurementInputError("duplicate_id", "blockId");
		seen.add(blockId);
		if (order !== "01" && order !== "10") throw new MeasurementInputError("invalid_order", "order");
		orderCounts[order]++;
		const arm0 = checkArm(baseline, tau);
		const arm1 = checkArm(candidate, tau);
		baselineLatency.push(arm0.latency);
		candidateLatency.push(arm1.latency);
		x.push((arm0.latency - arm1.latency) / tau);
		y.push(arm1.success - arm0.success);
		z.push(arm0.falseCompletion - arm1.falseCompletion);
	}
	const gainBoundary = minLatencyGainMs / tau;
	const latency = metric(x, gainBoundary, tau, family);
	const success = metric(y, -successMargin, 1, family);
	const falseCompletion = metric(z, -falseCompletionMargin, 1, family);
	const promote =
		semanticGate === true &&
		latency.lower > gainBoundary &&
		success.lower >= -successMargin &&
		falseCompletion.lower >= -falseCompletionMargin;
	const harm = latency.upper < 0 || success.upper < -successMargin || falseCompletion.upper < -falseCompletionMargin;
	let decision: PromotionDecision = "noDecision";
	if (promote) decision = "promote";
	else if (harm) decision = "harm";
	return {
		n: x.length,
		familySize: family.familySize,
		orderCounts,
		latency,
		success,
		falseCompletion,
		effectSizeDz: standardizedEffect(x.map((value) => tau * value)),
		p95: {
			baseline: anytimeQuantileBound(baselineLatency, 0.95, tau, family),
			candidate: anytimeQuantileBound(candidateLatency, 0.95, tau, family),
		},
		decision,
	};
}
