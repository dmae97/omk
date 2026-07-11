/**
 * allow: SIZE_OK — governance regression gate keeps corpus shape, aggregate
 * benchmark reporting, calibration helper coverage, and safety invariants in one
 * deterministic test file.
 */

import type { ThinkingLevel } from "omk-agent-core";
import { describe, expect, it } from "vitest";

import {
	buildGapCards,
	type CalibrationSample,
	computeCalibrationMetrics,
} from "../../../scripts/reasoning-router/calibration.ts";
import { runMcNemar } from "../../../scripts/reasoning-router/mcnemar.ts";
import {
	type ClassifierVerdictV4,
	classifyTaskV4,
	resolveThinkingLevelV4ForAuto,
	resolveThinkingLevelV4WithUncertainty,
} from "../../../src/core/reasoning-router-v4.ts";
import {
	computeGeneralizationFingerprint,
	computeGeneralizationPriorFingerprint,
	computeGeneralizationSplit,
	GENERALIZATION_EXPANSION_ROWS_PER_CLASS,
	GENERALIZATION_EXTENSIBLE,
	GENERALIZATION_FEATURE_TAGS,
	GENERALIZATION_HOLDOUT_MAX_RATIO,
	GENERALIZATION_HOLDOUT_MIN_RATIO,
	GENERALIZATION_PRIOR_FINGERPRINT,
	GENERALIZATION_PRIOR_ROWS_PER_CLASS,
	GENERALIZATION_PRIOR_TOTAL_ROWS,
	GENERALIZATION_SET_VERSION,
	GENERALIZATION_SPLITS,
	GENERALIZATION_TARGET_ROWS_PER_CLASS,
	GENERALIZATION_TASK_CLASSES,
	GENERALIZATION_WAVE1_PRIOR_FINGERPRINT,
	GENERALIZATION_WAVE1_PRIOR_ROWS_PER_CLASS,
	GENERALIZATION_WAVE1_PRIOR_TOTAL_ROWS,
	GENERALIZATION_WAVE1_SLICE_ROWS_PER_CLASS,
	type GeneralizationEntry,
	type GeneralizationFeatureTag,
	type GeneralizationTaskClass,
	REASONING_ROUTER_GENERALIZATION_SET,
	summarizeGeneralizationSet,
	summarizeGeneralizationSplit,
} from "../../fixtures/reasoning-router-generalization-set.ts";
import { GOLD_SET } from "../../fixtures/reasoning-router-gold-set.ts";

const FULL_LEVEL_SET = ["minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[];
const LEVEL_INDEX: Readonly<Record<ThinkingLevel, number>> = {
	off: -1,
	minimal: 0,
	low: 1,
	medium: 2,
	high: 3,
	xhigh: 4,
	max: 5,
	ultra: 6,
};
const EXPECTED_TOTAL = GENERALIZATION_TASK_CLASSES.length * GENERALIZATION_TARGET_ROWS_PER_CLASS;
const EXPECTED_EXPANSION_TOTAL = GENERALIZATION_TASK_CLASSES.length * GENERALIZATION_EXPANSION_ROWS_PER_CLASS;
const EXPECTED_WAVE1_SLICE_TOTAL = GENERALIZATION_TASK_CLASSES.length * GENERALIZATION_WAVE1_SLICE_ROWS_PER_CLASS;
const BENCHMARK_PREFIX = "REASONING-ROUTER-V4-GENERALIZATION-BENCHMARK";
const HOLDOUT_PREFIX = "REASONING-ROUTER-V4-GENERALIZATION-HOLDOUT";
const DEV_GAP_CARDS_PREFIX = "REASONING-ROUTER-V4-GENERALIZATION-DEV-GAP-CARDS";

interface ScoredGeneralizationRow {
	readonly entry: GeneralizationEntry;
	readonly verdict: ClassifierVerdictV4;
	readonly resolvedLevel: ThinkingLevel;
}

type MutableClassStats = { expected: number; predicted: number; truePositive: number };

const normalizePrompt = (prompt: string): string => prompt.trim().replace(/\s+/g, " ").toLowerCase();

function levelIndex(level: ThinkingLevel): number {
	return LEVEL_INDEX[level];
}

function formatPriorId(position: number): string {
	return `gen-v4-${String(position + 1).padStart(4, "0")}`;
}

function zeroClassStats(): Record<GeneralizationTaskClass, MutableClassStats> {
	return {
		trivial: { expected: 0, predicted: 0, truePositive: 0 },
		"simple-edit": { expected: 0, predicted: 0, truePositive: 0 },
		"code-gen": { expected: 0, predicted: 0, truePositive: 0 },
		debug: { expected: 0, predicted: 0, truePositive: 0 },
		refactor: { expected: 0, predicted: 0, truePositive: 0 },
		review: { expected: 0, predicted: 0, truePositive: 0 },
		plan: { expected: 0, predicted: 0, truePositive: 0 },
	};
}

function zeroClassCounts(): Record<GeneralizationTaskClass, number> {
	return { trivial: 0, "simple-edit": 0, "code-gen": 0, debug: 0, refactor: 0, review: 0, plan: 0 };
}

function scoreRows(
	entries: readonly GeneralizationEntry[] = REASONING_ROUTER_GENERALIZATION_SET,
): readonly ScoredGeneralizationRow[] {
	return entries.map((entry) => {
		const verdict = classifyTaskV4({ prompt: entry.prompt });
		return {
			entry,
			verdict,
			resolvedLevel: resolveThinkingLevelV4WithUncertainty(verdict, FULL_LEVEL_SET, undefined),
		};
	});
}

function countUnderAllocation(rows: readonly ScoredGeneralizationRow[], distance: number): number {
	return rows.filter((row) => levelIndex(row.resolvedLevel) === levelIndex(row.entry.expectedLevel) - distance).length;
}

function countSevereUnderAllocation(rows: readonly ScoredGeneralizationRow[]): number {
	return rows.filter((row) => levelIndex(row.resolvedLevel) <= levelIndex(row.entry.expectedLevel) - 2).length;
}

function computeBenchmarkMetrics(rows: readonly ScoredGeneralizationRow[]) {
	const classStats = zeroClassStats();
	let correct = 0;
	let highConfidenceIncorrect = 0;
	for (const row of rows) {
		classStats[row.entry.expectedClass].expected += 1;
		classStats[row.verdict.taskClass].predicted += 1;
		if (row.verdict.taskClass === row.entry.expectedClass) {
			correct += 1;
			classStats[row.entry.expectedClass].truePositive += 1;
		} else if (row.verdict.confidenceBand === "high") {
			highConfidenceIncorrect += 1;
		}
	}
	const perClassRecall = zeroClassCounts();
	let f1Sum = 0;
	for (const taskClass of GENERALIZATION_TASK_CLASSES) {
		const stats = classStats[taskClass];
		const precision = stats.predicted === 0 ? 0 : stats.truePositive / stats.predicted;
		const recall = stats.expected === 0 ? 0 : stats.truePositive / stats.expected;
		perClassRecall[taskClass] = recall;
		f1Sum += precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
	}
	const calibrationSamples: readonly CalibrationSample<GeneralizationTaskClass>[] = rows.map((row) => ({
		predicted: row.verdict.taskClass,
		expected: row.entry.expectedClass,
		confidence: row.verdict.confidence,
		confidenceBand: row.verdict.confidenceBand,
	}));
	return {
		microAccuracy: rows.length === 0 ? 0 : correct / rows.length,
		macroF1: f1Sum / GENERALIZATION_TASK_CLASSES.length,
		perClassRecall,
		mildUnderAllocation: countUnderAllocation(rows, 1),
		severeUnderAllocation: countSevereUnderAllocation(rows),
		highConfidenceIncorrect,
		calibration: computeCalibrationMetrics(calibrationSamples),
	};
}

function benchmarkSummary(label: "full" | "holdout", rows: readonly ScoredGeneralizationRow[]) {
	const metrics = computeBenchmarkMetrics(rows);
	const entries = rows.map((row) => row.entry);
	const setSummary = summarizeGeneralizationSet(entries);
	return {
		schemaVersion: 2,
		label,
		corpusVersion: GENERALIZATION_SET_VERSION,
		n: rows.length,
		perClassCounts: setSummary.perClass,
		perSplitCounts: setSummary.perSplit,
		micro: Number(metrics.microAccuracy.toFixed(4)),
		macroF1: Number(metrics.macroF1.toFixed(4)),
		perClassRecall: metrics.perClassRecall,
		mildUnderAllocation: metrics.mildUnderAllocation,
		severeUnderAllocation: metrics.severeUnderAllocation,
		highConfidenceIncorrect: metrics.highConfidenceIncorrect,
		ece: Number(metrics.calibration.expectedCalibrationError.toFixed(4)),
		mce: Number(metrics.calibration.maximumCalibrationError.toFixed(4)),
		brier: Number(metrics.calibration.brierScore.toFixed(4)),
		bandErrorRates: metrics.calibration.bandErrorRates,
	};
}

function assertCalibrationBounds(sampleCount: number, metrics: ReturnType<typeof computeBenchmarkMetrics>): void {
	expect(metrics.calibration.sampleCount).toBe(sampleCount);
	expect(metrics.calibration.expectedCalibrationError).toBeGreaterThanOrEqual(0);
	expect(metrics.calibration.expectedCalibrationError).toBeLessThanOrEqual(1);
	expect(metrics.calibration.maximumCalibrationError).toBeGreaterThanOrEqual(0);
	expect(metrics.calibration.maximumCalibrationError).toBeLessThanOrEqual(1);
	expect(metrics.calibration.brierScore).toBeGreaterThanOrEqual(0);
	expect(metrics.calibration.brierScore).toBeLessThanOrEqual(1);
}

const SCORED_ROWS = scoreRows();
const HOLDOUT_SCORED_ROWS = SCORED_ROWS.filter((row) => row.entry.split === "holdout");
const DEV_SCORED_ROWS = SCORED_ROWS.filter((row) => row.entry.split === "dev");
const BENCHMARK = computeBenchmarkMetrics(SCORED_ROWS);
const HOLDOUT_BENCHMARK = computeBenchmarkMetrics(HOLDOUT_SCORED_ROWS);

const PROHIBITED_SYNTHETIC_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
	{ name: "url", pattern: /https?:\/\/|\bwww\./i },
	{ name: "absolute-path", pattern: /(?:\/home\/|\/Users\/|~\/|[A-Za-z]:\\)/ },
	{ name: "email-address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
	{ name: "jwt-shaped", pattern: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/ },
];

describe("goal 013 lane EVAL: reasoning-router v4 governed generalization corpus", () => {
	describe("fixture shape and hygiene", () => {
		it("has 420 rows, exactly 60 per class, and is marked extensible", () => {
			const summary = summarizeGeneralizationSet();
			expect(GENERALIZATION_EXTENSIBLE).toBe(true);
			expect(summary.total).toBe(EXPECTED_TOTAL);
			for (const taskClass of GENERALIZATION_TASK_CLASSES) {
				expect(summary.perClass[taskClass], taskClass).toBe(GENERALIZATION_TARGET_ROWS_PER_CLASS);
			}
		});

		it("preserves the original 210 ids/prompts and adds only new ids after them", () => {
			const priorRows = REASONING_ROUTER_GENERALIZATION_SET.slice(0, GENERALIZATION_PRIOR_TOTAL_ROWS);
			const expansionRows = REASONING_ROUTER_GENERALIZATION_SET.slice(GENERALIZATION_PRIOR_TOTAL_ROWS);
			const priorCounts = zeroClassCounts();
			for (const [position, entry] of priorRows.entries()) {
				expect(entry.id).toBe(formatPriorId(position));
				priorCounts[entry.expectedClass] += 1;
			}
			for (const taskClass of GENERALIZATION_TASK_CLASSES) {
				expect(priorCounts[taskClass], taskClass).toBe(GENERALIZATION_PRIOR_ROWS_PER_CLASS);
			}
			expect(computeGeneralizationPriorFingerprint(priorRows)).toBe(GENERALIZATION_PRIOR_FINGERPRINT);
			expect(expansionRows.length).toBe(EXPECTED_EXPANSION_TOTAL);
			expect(expansionRows[0]?.id).toBe(formatPriorId(GENERALIZATION_PRIOR_TOTAL_ROWS));
		});

		it("preserves the previous 315 ids/prompts and appends the wave-1 slice after them", () => {
			const priorRows = REASONING_ROUTER_GENERALIZATION_SET.slice(0, GENERALIZATION_WAVE1_PRIOR_TOTAL_ROWS);
			const wave1Rows = REASONING_ROUTER_GENERALIZATION_SET.slice(GENERALIZATION_WAVE1_PRIOR_TOTAL_ROWS);
			const priorCounts = zeroClassCounts();
			for (const [position, entry] of priorRows.entries()) {
				expect(entry.id).toBe(formatPriorId(position));
				priorCounts[entry.expectedClass] += 1;
			}
			for (const taskClass of GENERALIZATION_TASK_CLASSES) {
				expect(priorCounts[taskClass], taskClass).toBe(GENERALIZATION_WAVE1_PRIOR_ROWS_PER_CLASS);
			}
			expect(computeGeneralizationFingerprint(priorRows)).toBe(GENERALIZATION_WAVE1_PRIOR_FINGERPRINT);
			expect(wave1Rows.length).toBe(EXPECTED_WAVE1_SLICE_TOTAL);
			expect(wave1Rows[0]?.id).toBe(formatPriorId(GENERALIZATION_WAVE1_PRIOR_TOTAL_ROWS));
		});

		it("uses unique opaque ids and current label metadata", () => {
			const ids = REASONING_ROUTER_GENERALIZATION_SET.map((entry) => entry.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const entry of REASONING_ROUTER_GENERALIZATION_SET) {
				expect(entry.id).toMatch(/^gen-v4-\d{4}$/);
				expect(entry.labelVersion).toBe(GENERALIZATION_SET_VERSION);
				expect(entry.prompt.trim().length, entry.id).toBeGreaterThan(0);
			}
		});

		it("assigns a deterministic content-blind train/dev/holdout split", () => {
			const splitSummary = summarizeGeneralizationSplit();
			const holdoutMin = Math.ceil(EXPECTED_TOTAL * GENERALIZATION_HOLDOUT_MIN_RATIO);
			const holdoutMax = Math.floor(EXPECTED_TOTAL * GENERALIZATION_HOLDOUT_MAX_RATIO);
			expect(splitSummary.total).toBe(EXPECTED_TOTAL);
			expect(splitSummary.perSplit.holdout).toBeGreaterThanOrEqual(holdoutMin);
			expect(splitSummary.perSplit.holdout).toBeLessThanOrEqual(holdoutMax);
			expect(splitSummary.perSplit.dev).toBeGreaterThan(0);
			expect(splitSummary.perSplit.train).toBeGreaterThan(0);
			for (const taskClass of GENERALIZATION_TASK_CLASSES) {
				const counts = splitSummary.perClassSplit[taskClass];
				expect(counts.train + counts.dev + counts.holdout, taskClass).toBe(GENERALIZATION_TARGET_ROWS_PER_CLASS);
				expect(counts.holdout, `${taskClass}:holdout`).toBeGreaterThan(0);
				expect(counts.dev, `${taskClass}:dev`).toBeGreaterThan(0);
			}
			for (const entry of REASONING_ROUTER_GENERALIZATION_SET) {
				expect(GENERALIZATION_SPLITS.includes(entry.split), entry.id).toBe(true);
				expect(entry.split, entry.id).toBe(
					computeGeneralizationSplit({ id: entry.id, expectedClass: entry.expectedClass }),
				);
			}
		});

		it("has unique prompts with no exact normalized overlap with the gold set or prior rows", () => {
			const normalizedGoldPrompts = new Set(GOLD_SET.map((entry) => normalizePrompt(entry.prompt)));
			const normalizedGeneralizationPrompts = REASONING_ROUTER_GENERALIZATION_SET.map((entry) =>
				normalizePrompt(entry.prompt),
			);
			expect(new Set(normalizedGeneralizationPrompts).size).toBe(normalizedGeneralizationPrompts.length);
			for (const entry of REASONING_ROUTER_GENERALIZATION_SET) {
				expect(normalizedGoldPrompts.has(normalizePrompt(entry.prompt)), entry.id).toBe(false);
			}
			const priorPrompts = new Set(
				REASONING_ROUTER_GENERALIZATION_SET.slice(0, GENERALIZATION_PRIOR_TOTAL_ROWS).map((entry) =>
					normalizePrompt(entry.prompt),
				),
			);
			for (const entry of REASONING_ROUTER_GENERALIZATION_SET.slice(GENERALIZATION_PRIOR_TOTAL_ROWS)) {
				expect(priorPrompts.has(normalizePrompt(entry.prompt)), entry.id).toBe(false);
			}
		});

		it("keeps feature tags closed, non-empty per row, and fully covered by at least one row", () => {
			const validTags = new Set<GeneralizationFeatureTag>(GENERALIZATION_FEATURE_TAGS);
			for (const entry of REASONING_ROUTER_GENERALIZATION_SET) {
				expect(entry.featureTags.length, entry.id).toBeGreaterThan(0);
				for (const featureTag of entry.featureTags) {
					expect(validTags.has(featureTag), `${entry.id} tag=${featureTag}`).toBe(true);
				}
			}
			const counts = summarizeGeneralizationSet().perFeatureTag;
			for (const featureTag of GENERALIZATION_FEATURE_TAGS) {
				expect(counts[featureTag], featureTag).toBeGreaterThan(0);
			}
		});

		it("passes synthetic-only heuristics: no URLs, real paths, emails, or token-shaped strings", () => {
			for (const entry of REASONING_ROUTER_GENERALIZATION_SET) {
				for (const { name, pattern } of PROHIBITED_SYNTHETIC_PATTERNS) {
					expect(pattern.test(entry.prompt), `${entry.id} synthetic hygiene pattern=${name}`).toBe(false);
				}
			}
		});
	});

	describe("benchmark reporting and governance invariants", () => {
		it(`prints ${BENCHMARK_PREFIX}, ${HOLDOUT_PREFIX}, and aggregate dev gap cards`, () => {
			const selfComparison = runMcNemar({ b: 0, c: 0 });
			const fullSummary = benchmarkSummary("full", SCORED_ROWS);
			const holdoutSummary = benchmarkSummary("holdout", HOLDOUT_SCORED_ROWS);
			const devGapCards = buildGapCards(
				DEV_SCORED_ROWS.map((row) => ({
					predicted: row.verdict.taskClass,
					expected: row.entry.expectedClass,
					confidenceBand: row.verdict.confidenceBand,
					featureTags: row.entry.featureTags,
				})),
			);
			console.log(
				`${BENCHMARK_PREFIX} ${JSON.stringify({ ...fullSummary, mcnemarSelfComparison: selfComparison })}`,
			);
			console.log(`${HOLDOUT_PREFIX} ${JSON.stringify(holdoutSummary)}`);
			console.log(
				`${DEV_GAP_CARDS_PREFIX} ${JSON.stringify({ schemaVersion: 1, n: DEV_SCORED_ROWS.length, gapCards: devGapCards })}`,
			);
			expect(fullSummary.n).toBe(EXPECTED_TOTAL);
			expect(holdoutSummary.n).toBe(summarizeGeneralizationSplit().perSplit.holdout);
			expect(fullSummary.micro).toBeGreaterThanOrEqual(0);
			expect(fullSummary.micro).toBeLessThanOrEqual(1);
			expect(holdoutSummary.micro).toBeGreaterThanOrEqual(0);
			expect(holdoutSummary.micro).toBeLessThanOrEqual(1);
			expect(fullSummary.macroF1).toBeGreaterThanOrEqual(0);
			expect(fullSummary.macroF1).toBeLessThanOrEqual(1);
			expect(holdoutSummary.macroF1).toBeGreaterThanOrEqual(0);
			expect(holdoutSummary.macroF1).toBeLessThanOrEqual(1);
			assertCalibrationBounds(EXPECTED_TOTAL, BENCHMARK);
			assertCalibrationBounds(HOLDOUT_SCORED_ROWS.length, HOLDOUT_BENCHMARK);
			expect(selfComparison.pValue).toBe(1);
			for (const card of devGapCards) {
				expect(card.count).toBeGreaterThan(0);
				expect(card.featureTag.trim().length).toBeGreaterThan(0);
			}
		});

		it("keeps uncertainty resolution escalate-only against the confident auto path", () => {
			for (const row of SCORED_ROWS) {
				const confidentLevel = resolveThinkingLevelV4ForAuto(row.verdict.taskClass, FULL_LEVEL_SET, undefined);
				const uncertainLevel = resolveThinkingLevelV4WithUncertainty(row.verdict, FULL_LEVEL_SET, undefined);
				expect(levelIndex(uncertainLevel), row.entry.id).toBeGreaterThanOrEqual(levelIndex(confidentLevel));
			}
		});
	});

	describe("calibration helper", () => {
		it("aggregates gap cards by expected/predicted/feature/confidence with counts only", () => {
			const gapCards = buildGapCards([
				{
					predicted: "review",
					expected: "debug",
					confidenceBand: "high",
					featureTags: ["debug-vs-review", "precedence"],
				},
				{ predicted: "review", expected: "debug", confidenceBand: "high", featureTags: ["debug-vs-review"] },
				{ predicted: "debug", expected: "debug", confidenceBand: "low", featureTags: ["debug-vs-review"] },
				{ predicted: "code-gen", expected: "plan", confidenceBand: "medium", featureTags: ["plan-vs-codegen"] },
			]);
			expect(gapCards).toEqual([
				{ expected: "debug", predicted: "review", featureTag: "debug-vs-review", confidenceBand: "high", count: 2 },
				{ expected: "debug", predicted: "review", featureTag: "precedence", confidenceBand: "high", count: 1 },
				{
					expected: "plan",
					predicted: "code-gen",
					featureTag: "plan-vs-codegen",
					confidenceBand: "medium",
					count: 1,
				},
			]);
		});

		it("computes exact ECE, MCE, Brier, and band error rates on a hand-crafted fixture", () => {
			const samples: readonly CalibrationSample[] = [
				{ predicted: "a", expected: "a", confidence: 0.9, confidenceBand: "high" },
				{ predicted: "a", expected: "a", confidence: 0.7, confidenceBand: "high" },
				{ predicted: "a", expected: "b", confidence: 0.2, confidenceBand: "low" },
				{ predicted: "b", expected: "a", confidence: 0.4, confidenceBand: "medium" },
			];
			const metrics = computeCalibrationMetrics(samples);
			expect(metrics.expectedCalibrationError).toBeCloseTo(0.25, 12);
			expect(metrics.maximumCalibrationError).toBeCloseTo(0.4, 12);
			expect(metrics.brierScore).toBeCloseTo(0.075, 12);
			expect(metrics.bandErrorRates).toEqual([
				{ band: "low", count: 1, correct: 0, incorrect: 1, accuracy: 0, errorRate: 1, meanConfidence: 0.2 },
				{
					band: "medium",
					count: 1,
					correct: 0,
					incorrect: 1,
					accuracy: 0,
					errorRate: 1,
					meanConfidence: 0.4,
				},
				{ band: "high", count: 2, correct: 2, incorrect: 0, accuracy: 1, errorRate: 0, meanConfidence: 0.8 },
			]);
		});

		it("rejects invalid confidence values", () => {
			expect(() =>
				computeCalibrationMetrics([{ predicted: "a", expected: "a", confidence: 1.1, confidenceBand: "high" }]),
			).toThrow(RangeError);
		});
	});

	describe("soft safety gate", () => {
		it("has zero severe under-allocation on full and frozen holdout subsets", () => {
			const severeByExpectedClass = zeroClassCounts();
			const holdoutSevereByExpectedClass = zeroClassCounts();
			for (const row of SCORED_ROWS) {
				if (levelIndex(row.resolvedLevel) <= levelIndex(row.entry.expectedLevel) - 2) {
					severeByExpectedClass[row.entry.expectedClass] += 1;
					if (row.entry.split === "holdout") {
						holdoutSevereByExpectedClass[row.entry.expectedClass] += 1;
					}
				}
			}
			const message = JSON.stringify({
				severeUnderAllocation: BENCHMARK.severeUnderAllocation,
				holdoutSevereUnderAllocation: HOLDOUT_BENCHMARK.severeUnderAllocation,
				severeByExpectedClass,
				holdoutSevereByExpectedClass,
				action: "Inspect aggregate class/tag gaps; add public synthetic regressions before changing router rules.",
			});
			expect(BENCHMARK.severeUnderAllocation, message).toBe(0);
			expect(HOLDOUT_BENCHMARK.severeUnderAllocation, message).toBe(0);
		});
	});
});
