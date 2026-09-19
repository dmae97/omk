import type { ThinkingLevel } from "omk-agent-core";
import { describe, expect, it } from "vitest";
import { REASONING_LADDER, resolveThinkingLevelCore } from "../src/core/reasoning-router-resolver.ts";
import {
	type ClassifierVerdictV4,
	resolveThinkingLevelV4ForAuto,
	resolveThinkingLevelV4WithUncertainty,
	type TaskClassV4,
} from "../src/core/reasoning-router-v4.ts";

/**
 * Resolver contract (audit F05/F06, 2026-09-19).
 *
 * F05: the only guarantee the low-confidence escalation gives is monotonicity
 * at a fixed bias and hint. It is not a floor at the class's base level: a
 * negative bias applied before the +1 escalation can still land below what
 * `resolveThinkingLevelV4ForAuto` returns for the same class.
 *
 * F06: a non-finite or fractional `bias`/`escalationSteps` must not walk the
 * ladder lookup off its integer indices and silently collapse to the lowest
 * available level. Invalid numbers are neutralized to 0 and fractions are
 * truncated toward zero, so a corrupted input keeps the class's own level.
 */

const ALL_LEVELS: readonly ThinkingLevel[] = [...REASONING_LADDER];
const CLASSES: readonly TaskClassV4[] = ["trivial", "simple-edit", "code-gen", "debug", "refactor", "review", "plan"];

function verdict(taskClass: TaskClassV4, band: ClassifierVerdictV4["confidenceBand"]): ClassifierVerdictV4 {
	return {
		taskClass,
		scores: { trivial: 0, "simple-edit": 0, "code-gen": 0, debug: 0, refactor: 0, review: 0, plan: 0 },
		runnerUp: null,
		margin: 0,
		confidence: band === "low" ? 0.1 : 0.9,
		confidenceBand: band,
		tieBreak: false,
		fallbackReason: null,
		suppressedFeatureIds: [],
		compoundIntent: false,
		secondClauseIntent: null,
	};
}

const rung = (level: ThinkingLevel): number => REASONING_LADDER.indexOf(level);

describe("low-confidence escalation (F05)", () => {
	it("is monotone in escalation at a fixed bias and hint, for every class and bias", () => {
		for (const taskClass of CLASSES) {
			for (const bias of [-2, -1, 0, 1, 2]) {
				const confident = resolveThinkingLevelV4WithUncertainty(
					verdict(taskClass, "high"),
					ALL_LEVELS,
					undefined,
					bias,
				);
				const unsure = resolveThinkingLevelV4WithUncertainty(
					verdict(taskClass, "low"),
					ALL_LEVELS,
					undefined,
					bias,
				);
				expect(rung(unsure), `${taskClass} bias=${bias}`).toBeGreaterThanOrEqual(rung(confident));
			}
		}
	});

	it("is not a floor at the class base level: a negative bias still wins one step against the escalation", () => {
		// debug -> high; bias -2 -> low; low-confidence +1 -> medium, below the auto result.
		const auto = resolveThinkingLevelV4ForAuto("debug", ALL_LEVELS, undefined);
		const unsureWithBias = resolveThinkingLevelV4WithUncertainty(verdict("debug", "low"), ALL_LEVELS, undefined, -2);
		expect(auto).toBe("high");
		expect(unsureWithBias).toBe("medium");
		expect(rung(unsureWithBias)).toBeLessThan(rung(auto));
	});
});

describe("numeric input boundary (F06)", () => {
	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"treats a non-finite bias %s as neutral instead of dropping to the lowest rung",
		(bias) => {
			expect(resolveThinkingLevelCore("debug", ALL_LEVELS, undefined, bias, null, 0)).toBe("high");
		},
	);

	it.each([Number.NaN, Number.POSITIVE_INFINITY])("treats non-finite escalation %s as no escalation", (escalation) => {
		expect(resolveThinkingLevelCore("debug", ALL_LEVELS, undefined, 0, null, escalation)).toBe("high");
	});

	it("truncates fractional steps toward zero rather than reading between ladder rungs", () => {
		// debug (index 3) + 0.5 would look up index 3.5 and miss every rung.
		expect(resolveThinkingLevelCore("debug", ALL_LEVELS, undefined, 0.5, null, 0)).toBe("high");
		expect(resolveThinkingLevelCore("debug", ALL_LEVELS, undefined, 1.9, null, 0)).toBe("xhigh");
		expect(resolveThinkingLevelCore("debug", ALL_LEVELS, undefined, -1.9, null, 0)).toBe("medium");
		expect(resolveThinkingLevelCore("debug", ALL_LEVELS, undefined, 0, null, 1.5)).toBe("xhigh");
	});

	it("never resolves below the class base level for an invalid bias on a restricted ladder", () => {
		const restricted: readonly ThinkingLevel[] = ["low", "high", "max"];
		expect(resolveThinkingLevelCore("debug", restricted, undefined, Number.NaN, null, 0)).toBe("high");
		expect(resolveThinkingLevelCore("plan", restricted, undefined, 2.5, null, 0)).toBe("max");
	});
});
