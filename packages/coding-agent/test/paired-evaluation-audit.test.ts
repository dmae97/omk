/**
 * R12 spec §21.1 audit-value checks against the existing McNemar implementation
 * and spec arithmetic. No benchmark runs, no provider calls, no new algorithms —
 * the paired-test engine already exists in scripts/reasoning-router/mcnemar.ts
 * and is exercised by the promotion gate; this file pins its audited numbers.
 */
import { describe, expect, it } from "vitest";
import { mcnemarExactTwoSided } from "../scripts/reasoning-router/mcnemar.ts";

describe("paired evaluation audit values (spec §14.5/§21.1)", () => {
	it("reproduces the historical discordance arithmetic", () => {
		// 2 vs 3 discordant pairs over N=24: delta = -4.1667pp, exact p = 1.
		expect((2 - 3) / 24).toBeCloseTo(-0.041667, 5);
		expect(mcnemarExactTwoSided(2, 3)).toBe(1);
	});

	it("resolves a lopsided discordance as significant", () => {
		expect(mcnemarExactTwoSided(100, 0)).toBeLessThan(0.001);
	});

	it("keeps symmetry and rejects malformed input", () => {
		expect(mcnemarExactTwoSided(3, 2)).toBe(1);
		expect(() => mcnemarExactTwoSided(-1, 0)).toThrow(RangeError);
		expect(() => mcnemarExactTwoSided(1.5, 2)).toThrow(RangeError);
	});

	it("reproduces the zero-failure one-sided upper bound (n=100, alpha=.05)", () => {
		// Independent-check value from spec §21.1, computed here from the formula.
		expect(1 - 0.05 ** (1 / 100)).toBeCloseTo(0.029513, 5);
	});
});
