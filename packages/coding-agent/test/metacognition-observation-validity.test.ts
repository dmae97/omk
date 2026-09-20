/**
 * Observation validity and state packing — Jev audit algorithm A2 (finding F10).
 *
 * F10: the existing `freshness` value is really a change indicator. A score of
 * zero can mean "a static screen observed one millisecond ago", so age and
 * change must be reported as two separate signals, and a risky action must gate
 * on an explicit maximum age and generation equality rather than on a decay
 * score at all.
 *
 * The packing half enforces the other A2 rule: required evidence is never
 * silently dropped to fit a budget. It comes back as `incomplete-state` so the
 * caller narrows the observation instead of executing on a truncated view.
 */

import { describe, expect, it } from "vitest";
import {
	changeIndicator,
	evaluateObservationValidity,
	packState,
	timeDecayFreshness,
} from "../src/metacognition/observation-validity.ts";

const BASE = {
	observedAtMs: 1_000,
	dispatchAtMs: 1_000,
	decayConstantMs: 10_000,
	maxObservationAgeMs: 5_000,
	observedDocumentGeneration: 3,
	currentDocumentGeneration: 3,
	observedActionGeneration: 7,
	currentActionGeneration: 7,
};

describe("freshness and change are separate signals", () => {
	it("decays with elapsed time", () => {
		expect(timeDecayFreshness(0, 10_000)).toBeCloseTo(1, 12);
		expect(timeDecayFreshness(10_000, 10_000)).toBeCloseTo(Math.exp(-1), 12);
		expect(timeDecayFreshness(20_000, 10_000)).toBeCloseTo(Math.exp(-2), 12);
	});

	it("reports a just-observed static screen as fresh but unchanged (F10)", () => {
		const verdict = evaluateObservationValidity(BASE);
		expect(verdict.valid).toBe(true);
		if (verdict.valid) {
			expect(verdict.freshness).toBeCloseTo(1, 12);
			expect(verdict.changed).toBe(0);
		}
	});

	it("distinguishes an unchanged hash from a stale observation", () => {
		expect(changeIndicator("h1", "h1")).toBe(0);
		expect(changeIndicator("h1", "h2")).toBe(1);
	});

	it("rejects a negative elapsed time rather than inventing a future observation", () => {
		expect(() => timeDecayFreshness(-1, 10_000)).toThrow();
		expect(() => timeDecayFreshness(1, 0)).toThrow();
	});
});

describe("validity gates take precedence over the decay score", () => {
	it("refuses a navigation that changed the document generation", () => {
		const verdict = evaluateObservationValidity({ ...BASE, currentDocumentGeneration: 4 });
		expect(verdict).toEqual({ valid: false, reason: "document-generation-changed" });
	});

	it("refuses when the chosen element was replaced", () => {
		const verdict = evaluateObservationValidity({ ...BASE, currentActionGeneration: 8 });
		expect(verdict).toEqual({ valid: false, reason: "action-generation-changed" });
	});

	it("refuses an observation older than the explicit bound even when decay looks high", () => {
		const verdict = evaluateObservationValidity({
			...BASE,
			dispatchAtMs: BASE.observedAtMs + 6_000,
			decayConstantMs: 10_000_000,
		});
		expect(verdict).toEqual({ valid: false, reason: "max-age-exceeded" });
	});

	it("reports a generation change ahead of age so the cause is not misleading", () => {
		const verdict = evaluateObservationValidity({
			...BASE,
			currentDocumentGeneration: 4,
			dispatchAtMs: BASE.observedAtMs + 6_000,
		});
		expect(verdict).toEqual({ valid: false, reason: "document-generation-changed" });
	});

	it("tolerates an unrelated change when both generations still match", () => {
		const verdict = evaluateObservationValidity({ ...BASE, previousStateHash: "a", currentStateHash: "b" });
		expect(verdict.valid).toBe(true);
		if (verdict.valid) expect(verdict.changed).toBe(1);
	});

	it("rejects a dispatch timestamp that precedes the observation", () => {
		expect(() => evaluateObservationValidity({ ...BASE, dispatchAtMs: BASE.observedAtMs - 1 })).toThrow();
	});
});

describe("state packing preserves required evidence", () => {
	const items = [
		{ id: "goal", tokenCost: 10, utility: 5, required: true },
		{ id: "policy", tokenCost: 10, utility: 4, required: true },
		{ id: "candidates", tokenCost: 20, utility: 9, required: false },
		{ id: "history", tokenCost: 40, utility: 6, required: false },
	];

	it("pins required items and fills the remainder by utility density", () => {
		const result = packState(items, 50);
		expect(result.status).toBe("packed");
		if (result.status === "packed") {
			expect(result.selected).toContain("goal");
			expect(result.selected).toContain("policy");
			expect(result.selected).toContain("candidates");
			expect(result.tokensUsed).toBe(40);
		}
	});

	it("returns incomplete-state rather than truncating required evidence", () => {
		const result = packState(items, 15);
		expect(result.status).toBe("incomplete-state");
		if (result.status === "incomplete-state") {
			expect(result.requiredTokens).toBe(20);
			expect(result.budget).toBe(15);
			expect(result.missingRequired).toEqual(["goal", "policy"]);
		}
	});

	it("packs required-only when nothing optional fits", () => {
		const result = packState(items, 20);
		expect(result.status).toBe("packed");
		if (result.status === "packed") {
			expect([...result.selected].sort()).toEqual(["goal", "policy"]);
			expect(result.tokensUsed).toBe(20);
		}
	});

	it("never exceeds the budget", () => {
		for (const budget of [20, 30, 45, 60, 80]) {
			const result = packState(items, budget);
			if (result.status === "packed") expect(result.tokensUsed).toBeLessThanOrEqual(budget);
		}
	});

	it("is deterministic for equal densities", () => {
		const tied = [
			{ id: "b", tokenCost: 10, utility: 5, required: false },
			{ id: "a", tokenCost: 10, utility: 5, required: false },
		];
		const first = packState(tied, 10);
		const second = packState(tied, 10);
		expect(first).toEqual(second);
	});

	it("rejects malformed items and budgets", () => {
		expect(() => packState([{ id: "x", tokenCost: -1, utility: 1, required: false }], 10)).toThrow();
		expect(() => packState(items, -1)).toThrow();
		expect(() => packState([{ id: "", tokenCost: 1, utility: 1, required: false }], 10)).toThrow();
	});

	it("treats a zero budget with no required items as an empty pack", () => {
		const result = packState([{ id: "opt", tokenCost: 1, utility: 1, required: false }], 0);
		expect(result.status).toBe("packed");
		if (result.status === "packed") expect(result.selected).toEqual([]);
	});
});
