/**
 * Cost- and latency-aware route selection — Jev audit algorithm A5.
 *
 * The audit's framing: a new selector call has to *replace* work, not be
 * inserted alongside it. So routing is scored on completion probability minus
 * normalized money and latency, safety stays a hard constraint outside the
 * utility, and the speedup a faster decision step can buy is bounded by how
 * much of the step time that decision actually occupies.
 */

import { describe, expect, it } from "vitest";
import {
	fallbackExpectedCost,
	overallSpeedup,
	type RouteCandidate,
	reselectionAllowed,
	routeUtility,
	selectRoute,
	stepDuration,
} from "../src/metacognition/route-economics.ts";

const UNITS = { costUnit: 0.01, latencyUnit: 1_000, costWeight: 0.3, latencyWeight: 0.2 };

function route(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
	return {
		id: "candidate-selector",
		completionProbability: 0.9,
		costUsd: 0.01,
		latencyMs: 1_000,
		approved: true,
		...overrides,
	};
}

describe("route utility", () => {
	it("scores completion minus normalized cost and latency", () => {
		expect(routeUtility(route(), UNITS)).toBeCloseTo(0.9 - 0.3 - 0.2, 12);
	});

	it("prefers the cheaper route when completion is equal", () => {
		const cheap = routeUtility(route({ costUsd: 0.001 }), UNITS);
		expect(cheap).toBeGreaterThan(routeUtility(route(), UNITS));
	});

	it("can rank a cheap unreliable route first, which is why approval is a filter and not a penalty", () => {
		// 0.95 - 0.3*(0.02/0.01) - 0.2 = 0.15 versus 0.5 - 0.3*(0.0001/0.01) - 0.2 = 0.297.
		// Under a cost-heavy weighting the cheap, unreliable route wins on utility.
		const reliable = routeUtility(route({ completionProbability: 0.95, costUsd: 0.02 }), UNITS);
		const risky = routeUtility(route({ completionProbability: 0.5, costUsd: 0.0001 }), UNITS);
		expect(risky).toBeGreaterThan(reliable);

		// The mitigation is the hard filter, not a weight tweak.
		const selected = selectRoute(
			[
				route({ id: "risky", completionProbability: 0.5, costUsd: 0.0001, approved: false }),
				route({ id: "reliable", completionProbability: 0.95, costUsd: 0.02 }),
			],
			UNITS,
		);
		expect(selected?.id).toBe("reliable");
	});

	it("lets a completion-dominant weighting prefer reliability, showing weights are policy", () => {
		const completionFirst = { ...UNITS, costWeight: 0.01, latencyWeight: 0.01 };
		const reliable = routeUtility(route({ completionProbability: 0.95, costUsd: 0.02 }), completionFirst);
		const risky = routeUtility(route({ completionProbability: 0.5, costUsd: 0.0001 }), completionFirst);
		expect(reliable).toBeGreaterThan(risky);
	});

	it("rejects a completion probability outside [0,1]", () => {
		expect(() => routeUtility(route({ completionProbability: 1.2 }), UNITS)).toThrow();
	});

	it("rejects non-positive normalization units", () => {
		expect(() => routeUtility(route(), { ...UNITS, costUnit: 0 })).toThrow();
	});
});

describe("route selection keeps safety outside the utility", () => {
	it("never selects an unapproved route, however good its utility", () => {
		const selected = selectRoute(
			[route({ id: "unapproved", completionProbability: 1, costUsd: 0, latencyMs: 0, approved: false }), route()],
			UNITS,
		);
		expect(selected?.id).toBe("candidate-selector");
	});

	it("returns null when nothing is approved instead of falling back silently", () => {
		expect(selectRoute([route({ approved: false })], UNITS)).toBeNull();
	});

	it("breaks ties deterministically by id", () => {
		const a = route({ id: "aaa" });
		const b = route({ id: "bbb" });
		expect(selectRoute([b, a], UNITS)?.id).toBe("aaa");
	});

	it("rejects an empty candidate set", () => {
		expect(() => selectRoute([], UNITS)).toThrow();
	});
});

describe("whole-step time, not model latency", () => {
	it("sums every phase including approval and recovery", () => {
		const total = stepDuration({
			queueMs: 10,
			observeMs: 20,
			packMs: 5,
			decideMs: 100,
			approvalMs: 4_000,
			executeMs: 300,
			verifyMs: 50,
			recoveryMs: 0,
		});
		expect(total).toBe(4_485);
	});

	it("bounds overall speedup by the fraction actually improved", () => {
		// A decision step that is 20% of the time cannot beat 1.25x overall.
		expect(overallSpeedup(0.2, Number.POSITIVE_INFINITY)).toBeCloseTo(1.25, 12);
		expect(overallSpeedup(0.2, 2)).toBeCloseTo(1 / (0.8 + 0.1), 12);
		expect(overallSpeedup(1, 4)).toBeCloseTo(4, 12);
	});

	it("reports no speedup when nothing is improvable", () => {
		expect(overallSpeedup(0, 10)).toBeCloseTo(1, 12);
	});

	it("rejects a fraction outside [0,1] or a speedup below one", () => {
		expect(() => overallSpeedup(1.5, 2)).toThrow();
		expect(() => overallSpeedup(0.2, 0.5)).toThrow();
	});
});

describe("cheap-path-then-fallback economics", () => {
	it("decomposes expected cost as selector plus verification plus fallback", () => {
		expect(
			fallbackExpectedCost({ selectorCost: 2, verificationCost: 1, fallbackProbability: 0.25, fallbackCost: 8 }),
		).toBe(5);
	});

	it("identifies when the cheap path is not actually cheaper", () => {
		const expected = fallbackExpectedCost({
			selectorCost: 2,
			verificationCost: 1,
			fallbackProbability: 0.8,
			fallbackCost: 8,
		});
		expect(expected).toBeGreaterThan(8);
	});

	it("rejects a fallback probability outside [0,1]", () => {
		expect(() =>
			fallbackExpectedCost({ selectorCost: 1, verificationCost: 0, fallbackProbability: 1.5, fallbackCost: 1 }),
		).toThrow();
	});
});

describe("reselection damping", () => {
	it("allows a first retry on a fingerprint but not an endless loop", () => {
		expect(reselectionAllowed({ attemptsForFingerprint: 0, maxAttempts: 2, causeChanged: false }).allowed).toBe(true);
		expect(reselectionAllowed({ attemptsForFingerprint: 1, maxAttempts: 2, causeChanged: false }).allowed).toBe(true);
		const blocked = reselectionAllowed({ attemptsForFingerprint: 2, maxAttempts: 2, causeChanged: false });
		expect(blocked.allowed).toBe(false);
		if (!blocked.allowed) expect(blocked.reason).toBe("attempt-budget-exhausted");
	});

	it("permits another attempt only when the cause actually changed", () => {
		const changed = reselectionAllowed({ attemptsForFingerprint: 5, maxAttempts: 2, causeChanged: true });
		expect(changed.allowed).toBe(true);
	});

	it("rejects a non-positive attempt budget", () => {
		expect(() => reselectionAllowed({ attemptsForFingerprint: 0, maxAttempts: 0, causeChanged: false })).toThrow();
	});
});
