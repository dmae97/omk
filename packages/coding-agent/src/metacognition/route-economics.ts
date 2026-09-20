/**
 * Cost- and latency-aware route selection (Jev audit algorithm A5).
 *
 * Adding a selector call only pays if it *replaces* work. Inserting one in
 * front of an existing free-text step adds a semantic inference instead of
 * removing one, so routes are compared on a single utility:
 *
 *   U_r = q_r − λ_C·(C_r/C_0) − λ_L·(L_r/L_0)
 *
 * Safety and permission are deliberately not terms in that utility. They are a
 * hard filter, because a cheap unsafe route must never win on weights.
 *
 * Latency is measured over the whole step, not the model call: when operator
 * approval dominates, a faster decision step barely moves the total. Amdahl's
 * bound is included so that limit is explicit rather than assumed away.
 */

import { ensure } from "./validation.ts";

export interface RouteCandidate {
	readonly id: string;
	/** Probability this route completes the step correctly. */
	readonly completionProbability: number;
	readonly costUsd: number;
	readonly latencyMs: number;
	/** Policy and permission verdict. A false value is a veto, not a penalty. */
	readonly approved: boolean;
}

export interface RouteUnits {
	readonly costUnit: number;
	readonly latencyUnit: number;
	readonly costWeight: number;
	readonly latencyWeight: number;
}

function assertUnits(units: RouteUnits): void {
	ensure(Number.isFinite(units.costUnit) && units.costUnit > 0, "costUnit must be positive");
	ensure(Number.isFinite(units.latencyUnit) && units.latencyUnit > 0, "latencyUnit must be positive");
	ensure(Number.isFinite(units.costWeight) && units.costWeight >= 0, "costWeight must be nonnegative");
	ensure(Number.isFinite(units.latencyWeight) && units.latencyWeight >= 0, "latencyWeight must be nonnegative");
}

/** Dimensionless utility; cost and latency are normalized before weighting. */
export function routeUtility(route: RouteCandidate, units: RouteUnits): number {
	ensure(
		Number.isFinite(route.completionProbability) &&
			route.completionProbability >= 0 &&
			route.completionProbability <= 1,
		"completionProbability must be in [0,1]",
	);
	ensure(Number.isFinite(route.costUsd) && route.costUsd >= 0, "costUsd must be nonnegative");
	ensure(Number.isFinite(route.latencyMs) && route.latencyMs >= 0, "latencyMs must be nonnegative");
	assertUnits(units);
	return (
		route.completionProbability -
		units.costWeight * (route.costUsd / units.costUnit) -
		units.latencyWeight * (route.latencyMs / units.latencyUnit)
	);
}

/**
 * Highest-utility approved route, or null when nothing is approved.
 *
 * Returning null rather than the best unapproved route keeps "we may not do
 * this" distinct from "this is expensive".
 */
export function selectRoute(routes: readonly RouteCandidate[], units: RouteUnits): RouteCandidate | null {
	ensure(Array.isArray(routes) && routes.length > 0, "routes must be a non-empty array");
	let best: RouteCandidate | undefined;
	let bestUtility = Number.NEGATIVE_INFINITY;
	for (const route of routes) {
		if (!route.approved) continue;
		const utility = routeUtility(route, units);
		const better = utility > bestUtility || (utility === bestUtility && best !== undefined && route.id < best.id);
		if (best === undefined || better) {
			best = route;
			bestUtility = utility;
		}
	}
	return best ?? null;
}

export interface StepPhases {
	readonly queueMs: number;
	readonly observeMs: number;
	readonly packMs: number;
	readonly decideMs: number;
	readonly approvalMs: number;
	readonly executeMs: number;
	readonly verifyMs: number;
	readonly recoveryMs: number;
}

/** Whole-step duration. Model response time is one term among eight. */
export function stepDuration(phases: StepPhases): number {
	let total = 0;
	for (const [label, value] of Object.entries(phases)) {
		ensure(Number.isFinite(value) && value >= 0, `${label} must be a nonnegative finite number`);
		total += value;
	}
	return total;
}

/**
 * Amdahl bound: S = 1 / ((1−f) + f/s).
 *
 * `speedup` may be Infinity to ask what an instantaneous step would buy — the
 * answer is still capped by the fraction it occupies, which is the point.
 */
export function overallSpeedup(improvableFraction: number, speedup: number): number {
	ensure(
		Number.isFinite(improvableFraction) && improvableFraction >= 0 && improvableFraction <= 1,
		"improvableFraction must be in [0,1]",
	);
	ensure(typeof speedup === "number" && !Number.isNaN(speedup) && speedup >= 1, "speedup must be at least 1");
	const remaining = 1 - improvableFraction;
	const improved = speedup === Number.POSITIVE_INFINITY ? 0 : improvableFraction / speedup;
	return 1 / (remaining + improved);
}

export interface FallbackCosts {
	readonly selectorCost: number;
	readonly verificationCost: number;
	readonly fallbackProbability: number;
	readonly fallbackCost: number;
}

/**
 * E[C] = c_J + c_V + p_F·c_L.
 *
 * A cost decomposition, not an independence claim. Compare it against the
 * incumbent path's cost under the same success and safety conditions; if it is
 * larger, the cheap path is not cheap.
 */
export function fallbackExpectedCost(costs: FallbackCosts): number {
	ensure(Number.isFinite(costs.selectorCost) && costs.selectorCost >= 0, "selectorCost must be nonnegative");
	ensure(
		Number.isFinite(costs.verificationCost) && costs.verificationCost >= 0,
		"verificationCost must be nonnegative",
	);
	ensure(Number.isFinite(costs.fallbackCost) && costs.fallbackCost >= 0, "fallbackCost must be nonnegative");
	ensure(
		Number.isFinite(costs.fallbackProbability) && costs.fallbackProbability >= 0 && costs.fallbackProbability <= 1,
		"fallbackProbability must be in [0,1]",
	);
	return costs.selectorCost + costs.verificationCost + costs.fallbackProbability * costs.fallbackCost;
}

export interface ReselectionInput {
	/** Attempts already spent on this observation fingerprint. */
	readonly attemptsForFingerprint: number;
	readonly maxAttempts: number;
	/** True when recovery changed the cause, not merely retried the same question. */
	readonly causeChanged: boolean;
}

export type ReselectionDecision =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly reason: "attempt-budget-exhausted" };

/**
 * Damp selector/model ping-pong on one observation generation.
 *
 * Re-asking the same question about the same state only adds calls. A further
 * attempt is admitted when the budget remains, or when recovery genuinely
 * changed the cause. The budget is a configured value, not a claimed optimum.
 */
export function reselectionAllowed(input: ReselectionInput): ReselectionDecision {
	ensure(
		Number.isSafeInteger(input.attemptsForFingerprint) && input.attemptsForFingerprint >= 0,
		"attemptsForFingerprint must be a nonnegative integer",
	);
	ensure(Number.isSafeInteger(input.maxAttempts) && input.maxAttempts > 0, "maxAttempts must be a positive integer");
	if (input.causeChanged) return { allowed: true };
	if (input.attemptsForFingerprint < input.maxAttempts) return { allowed: true };
	return { allowed: false, reason: "attempt-budget-exhausted" };
}
