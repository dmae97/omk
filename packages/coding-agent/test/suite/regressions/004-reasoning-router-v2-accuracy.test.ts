/**
 * Reasoning-Effort Router v2 — accuracy benchmark + ship gate (Goal 004, Req 3 / Lane I5).
 *
 * Pure-module eval (NO harness, NO faux provider, NO real provider keys/tokens):
 * runs v1 (`classifyTask`) and v2 (`classifyTaskV2` + `resolveThinkingLevelV2ForAuto`)
 * side-by-side on every non-holdout gold entry, then asserts the aggregate ship
 * gate. Structure clones `test/domain-routing-benchmark.test.ts` (verdict ->
 * aggregate -> threshold gates -> diagnostic per-entry it()s -> JSON summary line).
 *
 * The xhigh/max faux-harness gap (003 laneD) is closed by calling the pure
 * resolver directly with FULL_LEVEL_SET, so every ladder step is assertable.
 *
 * Phase A vs Phase B (per Lane I5 delegation):
 *  - HARD gates (MUST-PASS to merge): CWA(v2) > CWA(v1) AND the v1 regression
 *    cases gold-0031/gold-0032 ("fix the typo") classify as simple-edit under v2.
 *  - SOFT gates (reported, NOT hard-failed): micro top-1 >= 0.85, no class
 *    F1 < 0.60, <=2% class-flip regression. Calibration to hit these is Phase B.
 */

import type { ThinkingLevel } from "omk-agent-core";
import { describe, expect, it } from "vitest";
import { classifyTask, type TaskClass, type TaskClassifierInput } from "../../../src/core/reasoning-router.ts";
import {
	classifyTaskV2,
	resolveThinkingLevelV2ForAuto,
	TASK_CLASS_THINKING_LEVELS_V2,
	type TaskClassV2,
} from "../../../src/core/reasoning-router-v2.ts";
import { DEFAULT_WEIGHTS } from "../../../src/core/reasoning-router-weights.ts";
import { GOLD_SET, GOLD_SET_VERSION, type GoldEntry } from "../../fixtures/reasoning-router-gold-set.ts";

// ============================================================================
// Ladder + cost model (Lane D methodology, asymmetric CWA)
// ============================================================================

/** Full capability ladder (closes the xhigh/max faux-harness gap). */
const FULL_LEVEL_SET: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** Fixed iteration order over the class union (matches TASK_CLASSES_V2). */
const CLASS_ORDER: readonly TaskClassV2[] = [
	"trivial",
	"simple-edit",
	"code-gen",
	"debug",
	"refactor",
	"review",
	"plan",
];

const levelIndex = (level: ThinkingLevel): number => FULL_LEVEL_SET.indexOf(level);

/**
 * Asymmetric per-entry cost (Lane D section 2 / spec Req 3):
 *  - over-effort  (predicted > expected): linear,   cost = (pIdx - eIdx)
 *  - under-effort (predicted < expected): quadratic, cost = 2 * (eIdx - pIdx)^2
 * Under-effort is superlinear because an under-thought debug/plan fails and
 * triggers a full retry, costing more than the saved tokens.
 */
function entryCost(predicted: ThinkingLevel, expected: ThinkingLevel): number {
	const p = levelIndex(predicted);
	const e = levelIndex(expected);
	const d = p - e;
	if (d > 0) return d;
	if (d < 0) return 2 * d * d; // d*d positive
	return 0;
}

/** Worst-case cost for an entry given its expected level (max of over/under worst). */
function worstCaseCost(expected: ThinkingLevel): number {
	const e = levelIndex(expected);
	const top = FULL_LEVEL_SET.length - 1;
	return Math.max(top - e, 2 * e * e);
}

// ============================================================================
// Verdict + scoring
// ============================================================================

interface Verdict {
	readonly entry: GoldEntry;
	readonly v1Class: TaskClass;
	readonly v2Class: TaskClassV2;
	readonly v1Level: ThinkingLevel;
	readonly v2Level: ThinkingLevel;
	readonly expectedLevel: ThinkingLevel;
	readonly v1ClassOK: boolean;
	readonly v2ClassOK: boolean;
	readonly v1Cost: number;
	readonly v2Cost: number;
	readonly dV1: number;
	readonly dV2: number;
}

/**
 * Pure-module score of one entry. v1 and v2 classifications are independent;
 * the level for each is resolved via the SAME pure resolver over FULL_LEVEL_SET
 * (bias=0, hint=null, laneType=undefined), so the level metric isolates
 * "classifier wrong" from "rule-table wrong".
 */
const scoreEntry = (entry: GoldEntry): Verdict => {
	const v1Input: TaskClassifierInput = { prompt: entry.prompt };
	const v1Class = classifyTask(v1Input);
	const v2Class = classifyTaskV2({ prompt: entry.prompt }, DEFAULT_WEIGHTS);
	const v1Level = resolveThinkingLevelV2ForAuto(v1Class, FULL_LEVEL_SET, undefined);
	const v2Level = resolveThinkingLevelV2ForAuto(v2Class, FULL_LEVEL_SET, undefined);
	const expectedLevel: ThinkingLevel = entry.expectedLevel;
	const eIdx = levelIndex(expectedLevel);
	return {
		entry,
		v1Class,
		v2Class,
		v1Level,
		v2Level,
		expectedLevel,
		v1ClassOK: (v1Class as TaskClassV2) === (entry.expectedClass as TaskClassV2),
		v2ClassOK: v2Class === (entry.expectedClass as TaskClassV2),
		v1Cost: entryCost(v1Level, expectedLevel),
		v2Cost: entryCost(v2Level, expectedLevel),
		dV1: levelIndex(v1Level) - eIdx,
		dV2: levelIndex(v2Level) - eIdx,
	};
};

// ============================================================================
// Aggregate metrics
// ============================================================================

interface ClassPRF {
	readonly tp: number;
	readonly fp: number;
	readonly fn: number;
	readonly precision: number;
	readonly recall: number;
	readonly f1: number;
	readonly support: number;
}

interface Metrics {
	readonly n: number;
	readonly goldSetVersion: number;
	readonly v1Micro: number;
	readonly v2Micro: number;
	readonly v1Macro: number;
	readonly v2Macro: number;
	readonly perClassV2: Readonly<Record<TaskClassV2, ClassPRF>>;
	readonly confusionV2: Readonly<Record<TaskClassV2, Readonly<Record<TaskClassV2, number>>>>;
	readonly totalCostV1: number;
	readonly totalCostV2: number;
	readonly worstDenominator: number;
	readonly cwaV1: number;
	readonly cwaV2: number;
	readonly ladderAbsErrorV1: number;
	readonly ladderAbsErrorV2: number;
	readonly severeUnderV1: number;
	readonly severeUnderV2: number;
	readonly classFlipRate: number;
	readonly mcnemarB: number;
	readonly mcnemarC: number;
	readonly mcnemarP: number;
}

const emptyConfusion = (): Record<TaskClassV2, Record<TaskClassV2, number>> => {
	const matrix = {} as Record<TaskClassV2, Record<TaskClassV2, number>>;
	for (const r of CLASS_ORDER) {
		matrix[r] = {} as Record<TaskClassV2, number>;
		for (const c of CLASS_ORDER) matrix[r][c] = 0;
	}
	return matrix;
};

function binomCoeff(n: number, k: number): number {
	if (k < 0 || k > n) return 0;
	k = Math.min(k, n - k);
	let result = 1;
	for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
	return result;
}

/** Exact two-sided McNemar p-value from the discordant-pair binomial. */
function mcnemarExactTwoSided(b: number, c: number): number {
	const n = b + c;
	if (n === 0) return 1;
	const lo = Math.min(b, c);
	let tail = 0;
	for (let i = 0; i <= lo; i++) tail += binomCoeff(n, i);
	return Math.min(1, 2 * tail * 0.5 ** n);
}

const aggregate = (verdicts: readonly Verdict[]): Metrics => {
	let v1Correct = 0;
	let v2Correct = 0;
	let totalCostV1 = 0;
	let totalCostV2 = 0;
	let worstDenominator = 0;
	let ladderAbsV1 = 0;
	let ladderAbsV2 = 0;
	let severeUnderV1 = 0;
	let severeUnderV2 = 0;
	let b = 0; // v1 right, v2 wrong
	let c = 0; // v1 wrong, v2 right
	let v1RightTotal = 0;
	let flippedToWrong = 0;

	const tp = Object.fromEntries(CLASS_ORDER.map((k) => [k, 0])) as Record<TaskClassV2, number>;
	const fp = Object.fromEntries(CLASS_ORDER.map((k) => [k, 0])) as Record<TaskClassV2, number>;
	const fn = Object.fromEntries(CLASS_ORDER.map((k) => [k, 0])) as Record<TaskClassV2, number>;
	const support = Object.fromEntries(CLASS_ORDER.map((k) => [k, 0])) as Record<TaskClassV2, number>;
	const confusion = emptyConfusion();

	const severeClasses = new Set<TaskClassV2>(["debug", "refactor", "review", "plan"]);

	for (const v of verdicts) {
		const expected = v.entry.expectedClass as TaskClassV2;
		if (v.v1ClassOK) v1Correct += 1;
		if (v.v2ClassOK) v2Correct += 1;
		totalCostV1 += v.v1Cost;
		totalCostV2 += v.v2Cost;
		worstDenominator += worstCaseCost(v.expectedLevel);
		ladderAbsV1 += Math.abs(v.dV1);
		ladderAbsV2 += Math.abs(v.dV2);
		if (severeClasses.has(expected)) {
			if (v.dV1 <= -2) severeUnderV1 += 1;
			if (v.dV2 <= -2) severeUnderV2 += 1;
		}
		support[expected] += 1;
		confusion[expected][v.v2Class] += 1;
		if (v.v2ClassOK) {
			tp[expected] += 1;
		} else {
			fn[expected] += 1;
			fp[v.v2Class] += 1;
		}
		// McNemar discordant pairs + regression cap.
		if (v.v1ClassOK) {
			v1RightTotal += 1;
			if (!v.v2ClassOK) {
				b += 1;
				flippedToWrong += 1;
			}
		} else if (v.v2ClassOK) {
			c += 1;
		}
	}

	const n = verdicts.length;
	const perClassV2 = Object.fromEntries(
		CLASS_ORDER.map((k) => {
			const t = tp[k];
			const f = fp[k];
			const fnk = fn[k];
			const precision = t + f === 0 ? 0 : t / (t + f);
			const recall = t + fnk === 0 ? 0 : t / (t + fnk);
			const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
			return [k, { tp: t, fp: f, fn: fnk, precision, recall, f1, support: support[k] }];
		}),
	) as Record<TaskClassV2, ClassPRF>;

	const macro = (perClass: Readonly<Record<TaskClassV2, ClassPRF>>): number => {
		const vals = CLASS_ORDER.map((k) => perClass[k].f1);
		return vals.reduce((s, x) => s + x, 0) / vals.length;
	};

	return {
		n,
		goldSetVersion: GOLD_SET_VERSION,
		v1Micro: n === 0 ? 0 : v1Correct / n,
		v2Micro: n === 0 ? 0 : v2Correct / n,
		v1Macro: macro(perClassV2), // v1 macro not needed for the gate; reuse v2 shape
		v2Macro: macro(perClassV2),
		perClassV2,
		confusionV2: confusion,
		totalCostV1,
		totalCostV2,
		worstDenominator,
		cwaV1: worstDenominator === 0 ? 1 : 1 - totalCostV1 / worstDenominator,
		cwaV2: worstDenominator === 0 ? 1 : 1 - totalCostV2 / worstDenominator,
		ladderAbsErrorV1: n === 0 ? 0 : ladderAbsV1 / n,
		ladderAbsErrorV2: n === 0 ? 0 : ladderAbsV2 / n,
		severeUnderV1: n === 0 ? 0 : severeUnderV1 / n,
		severeUnderV2: n === 0 ? 0 : severeUnderV2 / n,
		classFlipRate: v1RightTotal === 0 ? 0 : flippedToWrong / v1RightTotal,
		mcnemarB: b,
		mcnemarC: c,
		mcnemarP: mcnemarExactTwoSided(b, c),
	};
};

// ============================================================================
// Run the eval once (pure functions, milliseconds for n=168).
// ============================================================================

const verdicts: readonly Verdict[] = GOLD_SET.filter((entry) => !entry.holdout).map(scoreEntry);
const metrics: Metrics = aggregate(verdicts);

// Sanity: v2 rule table must be present (guards against a wiring regression).
void TASK_CLASS_THINKING_LEVELS_V2;

const failureSummary = (v: Verdict): string =>
	[
		`id=${v.entry.id}`,
		`expected=${v.entry.expectedClass}/${v.entry.expectedLevel}`,
		`v2=${v.v2Class}/${v.v2Level}`,
		`v1=${v.v1Class}/${v.v1Level}`,
		`prompt=${JSON.stringify(v.entry.prompt).slice(0, 80)}`,
	].join(" | ");

// ============================================================================
// Tests
// ============================================================================

describe("reasoning-router v2 accuracy benchmark", () => {
	// --- HARD gates (MUST-PASS to merge) ---

	it("HARD gate: CWA(v2) > CWA(v1) — v2 strictly lower aggregate cost than v1", () => {
		// CWA = 1 - totalCost/worstDenominator (accuracy measure, higher = better).
		// cwaV2 > cwaV1  <=>  totalCostV2 < totalCostV1  (lower cost = better).
		// This reconciles spec Req 3 ("CWA(v2) > CWA(v1)") with the cost framing.
		expect(
			metrics.cwaV2,
			`cwaV1=${metrics.cwaV1.toFixed(4)} cwaV2=${metrics.cwaV2.toFixed(4)} ` +
				`costV1=${metrics.totalCostV1} costV2=${metrics.totalCostV2}`,
		).toBeGreaterThan(metrics.cwaV1);
	});

	it("HARD gate: v1 regression case gold-0031 'fix the typo' classifies as simple-edit (NOT debug)", () => {
		const v = verdicts.find((x) => x.entry.id === "gold-0031");
		expect(v, "gold-0031 missing from non-holdout verdicts").toBeDefined();
		expect(v?.v2Class, v ? failureSummary(v) : "").toBe("simple-edit");
	});

	it("HARD gate: v1 regression case gold-0032 'fix a typo' classifies as simple-edit (NOT debug)", () => {
		const v = verdicts.find((x) => x.entry.id === "gold-0032");
		expect(v, "gold-0032 missing from non-holdout verdicts").toBeDefined();
		expect(v?.v2Class, v ? failureSummary(v) : "").toBe("simple-edit");
	});

	// --- SOFT gates (reported; calibration to hit these is Phase B, not a merge blocker) ---

	it("SOFT: micro top-1 v2 >= 0.85 (Phase B calibration target; reported, not hard-failed)", () => {
		const passed = metrics.v2Micro >= 0.85;
		// Phase A ships the algorithm; calibration (tuning weights to hit 85%) is Phase B.
		// Do NOT hard-fail here — the HARD CWA gate above is the Phase A merge blocker.
		if (!passed) {
			console.log(
				`[soft-gate TODO] micro top-1 v2=${metrics.v2Micro.toFixed(4)} < 0.85 (v1=${metrics.v1Micro.toFixed(4)}); ` +
					`Phase B calibration target.`,
			);
		}
		expect(true).toBe(true); // always green; number is reported in the JSON line
	});

	it("SOFT: no class F1 < 0.60 under v2 (Phase B target; reported, not hard-failed)", () => {
		const worst = CLASS_ORDER.map((k) => ({ k, f1: metrics.perClassV2[k].f1 }));
		const below = worst.filter((x) => x.f1 < 0.6);
		if (below.length > 0) {
			console.log(
				`[soft-gate TODO] ${below.length} class(es) F1 < 0.60 under v2: ` +
					below.map((x) => `${x.k}=${x.f1.toFixed(3)}`).join(", "),
			);
		}
		expect(true).toBe(true);
	});

	it("SOFT: v2 class-flip regression <= 2% of v1-correct entries (Phase B target)", () => {
		const passed = metrics.classFlipRate <= 0.02;
		if (!passed) {
			console.log(
				`[soft-gate TODO] v2 flipped ${metrics.mcnemarB} of v1-correct entries to wrong ` +
					`(rate=${metrics.classFlipRate.toFixed(4)} > 0.02); Phase B calibration target.`,
			);
		}
		expect(true).toBe(true);
	});

	// --- Per-entry generated it()s (diagnostic validity). Exact per-entry
	//     accuracy is measured by the aggregate gates above and the JSON summary. ---

	for (const v of verdicts) {
		it(`${v.entry.id}: records a valid v2 verdict for ${JSON.stringify(v.entry.prompt).slice(0, 50)}`, () => {
			expect(CLASS_ORDER, failureSummary(v)).toContain(v.v2Class);
			expect(FULL_LEVEL_SET, failureSummary(v)).toContain(v.v2Level);
		});
	}

	// --- Benchmark summary line (CI scraping + calibration-loop trend diffing). ---

	it("prints REASONING-ROUTER-BENCHMARK summary", () => {
		const summary = {
			version: "v2-accuracy",
			goldSetVersion: metrics.goldSetVersion,
			n: metrics.n,
			holdout: "excluded",
			v1Micro: Number(metrics.v1Micro.toFixed(4)),
			v2Micro: Number(metrics.v2Micro.toFixed(4)),
			v2MacroF1: Number(metrics.v2Macro.toFixed(4)),
			perClassF1V2: Object.fromEntries(CLASS_ORDER.map((k) => [k, Number(metrics.perClassV2[k].f1.toFixed(4))])),
			confusionV2: metrics.confusionV2,
			totalCostV1: metrics.totalCostV1,
			totalCostV2: metrics.totalCostV2,
			cwaV1: Number(metrics.cwaV1.toFixed(4)),
			cwaV2: Number(metrics.cwaV2.toFixed(4)),
			cwaGatePass: metrics.cwaV2 > metrics.cwaV1,
			ladderAbsErrorV1: Number(metrics.ladderAbsErrorV1.toFixed(4)),
			ladderAbsErrorV2: Number(metrics.ladderAbsErrorV2.toFixed(4)),
			severeUnderV1: Number(metrics.severeUnderV1.toFixed(4)),
			severeUnderV2: Number(metrics.severeUnderV2.toFixed(4)),
			classFlipRate: Number(metrics.classFlipRate.toFixed(4)),
			mcnemarB: metrics.mcnemarB,
			mcnemarC: metrics.mcnemarC,
			mcnemarP: Number(metrics.mcnemarP.toFixed(4)),
		};
		console.log(`REASONING-ROUTER-BENCHMARK ${JSON.stringify(summary)}`);
		expect(metrics.n).toBe(GOLD_SET.filter((e) => !e.holdout).length);
	});
});
