/**
 * Observation validity and state packing (Jev audit algorithm A2, finding F10).
 *
 * F10: the value the existing code calls `freshness` is really a change
 * indicator. Those are different facts — a screen observed one millisecond ago
 * that has not changed scores zero on one and one on the other — so this module
 * reports them separately and never derives one from the other.
 *
 * For anything risky the decay score is not the gate at all. An explicit
 * maximum observation age and equality of the document and action generations
 * decide validity; the decay value is a continuous signal for ranking, not a
 * learned safety probability.
 *
 * "Check then click" is not a database transaction: the page keeps running.
 * Re-checking the target narrows the race window, and the postcondition is what
 * actually establishes the result.
 */

import { ensure } from "./validation.ts";

/** f = exp(−Δt/τ). A ranking signal, not a probability of safety. */
export function timeDecayFreshness(elapsedMs: number, decayConstantMs: number): number {
	ensure(
		typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0,
		"elapsedMs must be a nonnegative finite number",
	);
	ensure(
		typeof decayConstantMs === "number" && Number.isFinite(decayConstantMs) && decayConstantMs > 0,
		"decayConstantMs must be positive",
	);
	return Math.exp(-elapsedMs / decayConstantMs);
}

/** n = 1[h(x_t) ≠ h(x_{t−1})]. Orthogonal to age. */
export function changeIndicator(previousStateHash: string | undefined, currentStateHash: string | undefined): 0 | 1 {
	if (previousStateHash === undefined || currentStateHash === undefined) return 0;
	return previousStateHash === currentStateHash ? 0 : 1;
}

export interface ObservationValidityInput {
	readonly observedAtMs: number;
	readonly dispatchAtMs: number;
	readonly decayConstantMs: number;
	/** Hard bound for this risk tier; outranks any decay score. */
	readonly maxObservationAgeMs: number;
	/** Navigation, frame swap, tab swap, permission-session change. */
	readonly observedDocumentGeneration: number;
	readonly currentDocumentGeneration: number;
	/** Chosen element's attachment, role, name, arguments, enabled state. */
	readonly observedActionGeneration: number;
	readonly currentActionGeneration: number;
	readonly previousStateHash?: string;
	readonly currentStateHash?: string;
}

export type ObservationValidityVerdict =
	| { readonly valid: true; readonly freshness: number; readonly changed: 0 | 1; readonly ageMs: number }
	| {
			readonly valid: false;
			readonly reason: "document-generation-changed" | "action-generation-changed" | "max-age-exceeded";
	  };

/**
 * Decide whether an observation may still back a dispatch.
 *
 * Generation mismatches are reported before age: if the page navigated, saying
 * "observation too old" sends the operator to tune a timeout instead of looking
 * at the navigation that actually invalidated the target.
 */
export function evaluateObservationValidity(input: ObservationValidityInput): ObservationValidityVerdict {
	for (const [label, value] of [
		["observedAtMs", input.observedAtMs],
		["dispatchAtMs", input.dispatchAtMs],
		["maxObservationAgeMs", input.maxObservationAgeMs],
	] as const) {
		ensure(typeof value === "number" && Number.isFinite(value) && value >= 0, `${label} must be nonnegative`);
	}
	const ageMs = input.dispatchAtMs - input.observedAtMs;
	ensure(ageMs >= 0, "dispatchAtMs must not precede observedAtMs on a monotonic clock");

	if (input.observedDocumentGeneration !== input.currentDocumentGeneration) {
		return { valid: false, reason: "document-generation-changed" };
	}
	if (input.observedActionGeneration !== input.currentActionGeneration) {
		return { valid: false, reason: "action-generation-changed" };
	}
	if (ageMs > input.maxObservationAgeMs) return { valid: false, reason: "max-age-exceeded" };

	return {
		valid: true,
		freshness: timeDecayFreshness(ageMs, input.decayConstantMs),
		changed: changeIndicator(input.previousStateHash, input.currentStateHash),
		ageMs,
	};
}

export interface StateItem {
	readonly id: string;
	readonly tokenCost: number;
	readonly utility: number;
	readonly required: boolean;
}

export type StatePackingResult =
	| {
			readonly status: "packed";
			readonly selected: readonly string[];
			readonly tokensUsed: number;
			readonly utility: number;
	  }
	| {
			readonly status: "incomplete-state";
			readonly missingRequired: readonly string[];
			readonly requiredTokens: number;
			readonly budget: number;
	  };

/**
 * Pack observation state under a token budget.
 *
 * Required evidence is pinned first. When it alone exceeds the budget the
 * result is `incomplete-state`, never a quietly truncated view: the caller has
 * to narrow the observation rather than act on a state that lost its evidence.
 *
 * Optional items are then taken by utility density. That is the fixed-rule
 * starting point the design asks for, not an optimal knapsack solution, and it
 * is not claimed to be one.
 */
export function packState(items: readonly StateItem[], budget: number): StatePackingResult {
	ensure(Array.isArray(items), "items must be an array");
	ensure(Number.isFinite(budget) && budget >= 0, "budget must be nonnegative");
	for (const item of items) {
		ensure(typeof item.id === "string" && item.id.length > 0, "each item needs a non-empty id");
		ensure(Number.isFinite(item.tokenCost) && item.tokenCost >= 0, "tokenCost must be nonnegative");
		ensure(Number.isFinite(item.utility) && item.utility >= 0, "utility must be nonnegative");
	}

	const required: StateItem[] = [];
	const optional: Array<{ item: StateItem; density: number }> = [];
	for (const item of items) {
		if (item.required) required.push(item);
		else optional.push({ item, density: item.tokenCost === 0 ? Infinity : item.utility / item.tokenCost });
	}
	const requiredTokens = required.reduce((sum, item) => sum + item.tokenCost, 0);
	if (requiredTokens > budget) {
		return {
			status: "incomplete-state",
			missingRequired: required.map((item) => item.id),
			requiredTokens,
			budget,
		};
	}

	const selected = required.map((item) => item.id);
	let tokensUsed = requiredTokens;
	let utility = required.reduce((sum, item) => sum + item.utility, 0);

	// Density order, with id as a tiebreak so equal densities pack deterministically.
	const byId = (a: StateItem, b: StateItem): number => {
		if (a.id < b.id) return -1;
		return a.id > b.id ? 1 : 0;
	};
	optional.sort((a, b) => b.density - a.density || byId(a.item, b.item));

	for (const { item } of optional) {
		if (tokensUsed + item.tokenCost > budget) continue;
		selected.push(item.id);
		tokensUsed += item.tokenCost;
		utility += item.utility;
	}

	return { status: "packed", selected, tokensUsed, utility };
}
