/**
 * calibrate-v3.ts — Reasoning-router v3/v4 governance reverification (Goal
 * 009 Wave 2 Lane A1, specs/008-reasoning-router-advanced-accuracy tasks.md
 * T006: "Re-run current v3 against the new governance split").
 *
 * Manual, offline, read-only report script — never invoked automatically by
 * any product code path (matches the existing
 * packages/coding-agent/scripts/reasoning-router/*.ts convention: outside the
 * root tsconfig.json/biome.json include globs, evidenced by direct execution
 * rather than a CI-enforced gate — see compile-bias-snapshot.ts and this
 * lane's own evidence file). Imports ONLY already-shipped v2/v3/v4
 * classifiers, the gold-set fixture's additive split/category metadata (Goal
 * 009 Lane E), and this directory's own mcnemar.ts/golden-diff.ts governance
 * utilities. No new dependency, no I/O beyond stdout/stderr, no mutation of
 * any source file.
 *
 * v4 defaults to v3-equivalent classification decisions today (Goal 009 Wave
 * 1 Lane A's own audit: DEFAULT_WEIGHTS_V4 reproduces every v3 taskClass on
 * all 210 gold rows). This script independently re-verifies that claim (see
 * `v3v4DivergingCountFull`, computed via golden-diff.ts rather than
 * re-derived) and then reports, for v2 (baseline reference) / v3 / v4, per
 * governance split (train / dev / holdout, plus the historical
 * non-holdout=train+dev and full=210 combinations): micro accuracy, macro F1,
 * min-class F1, the Lane D asymmetric-cost CWA (identical formula to
 * test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts), the
 * severe-under-allocation rate, and a pairwise class-flip rate + exact
 * McNemar p-value against the v2 baseline (spec 008 Requirement 1's hard-gate
 * list: "CWA, micro accuracy, macro F1, min-class F1, severe
 * under-allocation, class-flip, and McNemar reporting").
 *
 * Privacy: never reads or prints GOLD_SET prompt text. The `holdout` and
 * `full` buckets are aggregate-only (no row ids) per spec 008 Req 1
 * acceptance ("Holdout test output never prints prompt text or per-row
 * holdout labels"); `train`/`dev`/`non-holdout` buckets may list bare
 * misclassified ids (never their expected class or prompt), matching the
 * existing 004/006/013 benchmark convention for the non-holdout set.
 *
 * Usage: node packages/coding-agent/scripts/reasoning-router/calibrate-v3.ts
 */

import { fileURLToPath } from "node:url";
import type { ThinkingLevel } from "omk-agent-core";

import { classifyTaskV2, resolveThinkingLevelV2ForAuto } from "../../src/core/reasoning-router-v2.ts";
import { classifyTaskV3, resolveThinkingLevelV3ForAuto } from "../../src/core/reasoning-router-v3.ts";
import { classifyTaskV4, resolveThinkingLevelV4ForAuto } from "../../src/core/reasoning-router-v4.ts";
import { DEFAULT_WEIGHTS } from "../../src/core/reasoning-router-weights.ts";
import {
	GOLD_SET,
	GOLD_SET_VERSION,
	GOLD_TASK_CLASSES,
	type GoldEntry,
	type GoldSplit,
	type GoldTaskClass,
} from "../../test/fixtures/reasoning-router-gold-set.ts";
import { diffGoldenRecords, type GoldenDiffRecord } from "./golden-diff.ts";
import { runMcNemar } from "./mcnemar.ts";

// ============================================================================
// Ladder + cost model (Lane D methodology; identical formulas to
// test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts).
// ============================================================================

const FULL_LEVEL_SET: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
const levelIndex = (level: ThinkingLevel): number => FULL_LEVEL_SET.indexOf(level);

/**
 * Asymmetric per-entry cost: over-effort is linear, under-effort is
 * quadratic (an under-thought debug/plan/review/refactor turn risks a failed
 * output and a full retry, which costs more than the tokens it saved).
 */
function entryCost(predicted: ThinkingLevel, expected: ThinkingLevel): number {
	const delta = levelIndex(predicted) - levelIndex(expected);
	if (delta > 0) return delta;
	if (delta < 0) return 2 * delta * delta;
	return 0;
}

function worstCaseCost(expected: ThinkingLevel): number {
	const expectedIndex = levelIndex(expected);
	const topIndex = FULL_LEVEL_SET.length - 1;
	return Math.max(topIndex - expectedIndex, 2 * expectedIndex * expectedIndex);
}

/** Classes where under-allocating thinking effort by >=2 ladder rungs risks a bad/failed outcome (Lane D / 004 methodology). */
const SEVERE_UNDER_CLASSES: ReadonlySet<GoldTaskClass> = new Set(["debug", "refactor", "review", "plan"]);

// ============================================================================
// Per-row scoring (v2/v3/v4 side by side; identical prompt input, no bias/hint).
// ============================================================================

type RouterVersion = "v2" | "v3" | "v4";

interface RowVerdict {
	readonly id: string;
	readonly split: GoldSplit;
	readonly expectedClass: GoldTaskClass;
	readonly expectedLevel: ThinkingLevel;
	readonly classByVersion: Readonly<Record<RouterVersion, GoldTaskClass>>;
	readonly levelByVersion: Readonly<Record<RouterVersion, ThinkingLevel>>;
}

function scoreRow(entry: GoldEntry): RowVerdict {
	const v2Class = classifyTaskV2({ prompt: entry.prompt }, DEFAULT_WEIGHTS);
	const v3Class = classifyTaskV3({ prompt: entry.prompt });
	const v4Class = classifyTaskV4({ prompt: entry.prompt }).taskClass;
	return {
		id: entry.id,
		split: entry.split,
		expectedClass: entry.expectedClass,
		expectedLevel: entry.expectedLevel,
		classByVersion: { v2: v2Class, v3: v3Class, v4: v4Class },
		levelByVersion: {
			v2: resolveThinkingLevelV2ForAuto(v2Class, FULL_LEVEL_SET, undefined),
			v3: resolveThinkingLevelV3ForAuto(v3Class, FULL_LEVEL_SET, undefined),
			v4: resolveThinkingLevelV4ForAuto(v4Class, FULL_LEVEL_SET, undefined),
		},
	};
}

const ALL_ROWS: readonly RowVerdict[] = GOLD_SET.map(scoreRow);

// ============================================================================
// Per-version aggregate metrics over an arbitrary row subset.
// ============================================================================

function zeroPerClass(): Record<GoldTaskClass, number> {
	return Object.fromEntries(GOLD_TASK_CLASSES.map((taskClass) => [taskClass, 0])) as Record<GoldTaskClass, number>;
}

interface VersionMetrics {
	readonly n: number;
	readonly correct: number;
	readonly micro: number;
	readonly macroF1: number;
	readonly minClassF1: number;
	readonly minClassF1Class: GoldTaskClass | null;
	readonly perClassF1: Readonly<Record<GoldTaskClass, number>>;
	readonly cwa: number;
	readonly severeUnderRate: number;
	readonly severeUnderCount: number;
	readonly severeUnderDenominator: number;
	readonly misclassifiedIds: readonly string[];
}

function computeVersionMetrics(rows: readonly RowVerdict[], version: RouterVersion): VersionMetrics {
	const tp = zeroPerClass();
	const fp = zeroPerClass();
	const fn = zeroPerClass();
	const support = zeroPerClass();
	let correct = 0;
	let totalCost = 0;
	let worstDenominator = 0;
	let severeUnderCount = 0;
	let severeUnderDenominator = 0;
	const misclassifiedIds: string[] = [];

	for (const row of rows) {
		const predicted = row.classByVersion[version];
		const level = row.levelByVersion[version];
		const ok = predicted === row.expectedClass;
		support[row.expectedClass] += 1;
		if (ok) {
			correct += 1;
			tp[row.expectedClass] += 1;
		} else {
			fn[row.expectedClass] += 1;
			fp[predicted] += 1;
			misclassifiedIds.push(row.id);
		}
		totalCost += entryCost(level, row.expectedLevel);
		worstDenominator += worstCaseCost(row.expectedLevel);
		if (SEVERE_UNDER_CLASSES.has(row.expectedClass)) {
			severeUnderDenominator += 1;
			if (levelIndex(level) - levelIndex(row.expectedLevel) <= -2) severeUnderCount += 1;
		}
	}

	const perClassF1 = zeroPerClass();
	const presentClasses = GOLD_TASK_CLASSES.filter((taskClass) => support[taskClass] > 0);
	for (const taskClass of presentClasses) {
		const precision = tp[taskClass] + fp[taskClass] === 0 ? 0 : tp[taskClass] / (tp[taskClass] + fp[taskClass]);
		const recall = tp[taskClass] + fn[taskClass] === 0 ? 0 : tp[taskClass] / (tp[taskClass] + fn[taskClass]);
		perClassF1[taskClass] = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
	}

	const macroF1 =
		presentClasses.length === 0
			? 0
			: presentClasses.reduce((sum, taskClass) => sum + perClassF1[taskClass], 0) / presentClasses.length;

	let minClassF1 = 0;
	let minClassF1Class: GoldTaskClass | null = null;
	for (const taskClass of presentClasses) {
		if (minClassF1Class === null || perClassF1[taskClass] < minClassF1) {
			minClassF1 = perClassF1[taskClass];
			minClassF1Class = taskClass;
		}
	}

	return {
		n: rows.length,
		correct,
		micro: rows.length === 0 ? 0 : correct / rows.length,
		macroF1,
		minClassF1,
		minClassF1Class,
		perClassF1,
		cwa: worstDenominator === 0 ? 1 : 1 - totalCost / worstDenominator,
		severeUnderRate: severeUnderDenominator === 0 ? 0 : severeUnderCount / severeUnderDenominator,
		severeUnderCount,
		severeUnderDenominator,
		misclassifiedIds,
	};
}

// ============================================================================
// Pairwise comparison (class-flip rate + exact McNemar) against a baseline.
// Reuses this directory's own mcnemar.ts rather than re-deriving the test.
// ============================================================================

interface PairComparison {
	readonly baseline: RouterVersion;
	readonly candidate: RouterVersion;
	readonly baselineCorrectCount: number;
	/** Rows where the baseline is correct and the candidate is wrong (a regression). */
	readonly b: number;
	/** Rows where the baseline is wrong and the candidate is correct (an improvement). */
	readonly c: number;
	/** b / baselineCorrectCount: fraction of previously-correct rows the candidate now flips to wrong. */
	readonly classFlipRate: number;
	readonly mcnemarP: number;
	readonly mcnemarSignificant: boolean;
	/** Rows where the two classifiers disagree with EACH OTHER, regardless of which (if either) matches expectedClass. */
	readonly divergingCount: number;
}

function compareVersions(
	rows: readonly RowVerdict[],
	baseline: RouterVersion,
	candidate: RouterVersion,
): PairComparison {
	let baselineCorrectCount = 0;
	let b = 0;
	let c = 0;
	let divergingCount = 0;
	for (const row of rows) {
		const baseClass = row.classByVersion[baseline];
		const candClass = row.classByVersion[candidate];
		const baseOk = baseClass === row.expectedClass;
		const candOk = candClass === row.expectedClass;
		if (baseClass !== candClass) divergingCount += 1;
		if (baseOk) {
			baselineCorrectCount += 1;
			if (!candOk) b += 1;
		} else if (candOk) {
			c += 1;
		}
	}
	const mcnemar = runMcNemar({ b, c });
	return {
		baseline,
		candidate,
		baselineCorrectCount,
		b,
		c,
		classFlipRate: baselineCorrectCount === 0 ? 0 : b / baselineCorrectCount,
		mcnemarP: mcnemar.pValue,
		mcnemarSignificant: mcnemar.significant,
		divergingCount,
	};
}

// ============================================================================
// Split buckets (Goal 009 Lane E governance metadata).
// ============================================================================

interface Bucket {
	readonly name: string;
	readonly rows: readonly RowVerdict[];
	/** Aggregate-only buckets never surface per-row ids (holdout / full, which includes holdout). */
	readonly aggregateOnly: boolean;
}

const BUCKETS: readonly Bucket[] = [
	{ name: "train", rows: ALL_ROWS.filter((row) => row.split === "train"), aggregateOnly: false },
	{ name: "dev", rows: ALL_ROWS.filter((row) => row.split === "dev"), aggregateOnly: false },
	{ name: "non-holdout", rows: ALL_ROWS.filter((row) => row.split !== "holdout"), aggregateOnly: false },
	{ name: "holdout", rows: ALL_ROWS.filter((row) => row.split === "holdout"), aggregateOnly: true },
	{ name: "full", rows: ALL_ROWS, aggregateOnly: true },
];

interface BucketReport {
	readonly split: string;
	readonly n: number;
	readonly v2: VersionMetrics;
	readonly v3: VersionMetrics;
	readonly v4: VersionMetrics;
	readonly v2VsV3: PairComparison;
	readonly v3VsV4: PairComparison;
}

function stripIdsIfAggregateOnly(metrics: VersionMetrics, aggregateOnly: boolean): VersionMetrics {
	return aggregateOnly ? { ...metrics, misclassifiedIds: [] } : metrics;
}

function buildBucketReport(bucket: Bucket): BucketReport {
	return {
		split: bucket.name,
		n: bucket.rows.length,
		v2: stripIdsIfAggregateOnly(computeVersionMetrics(bucket.rows, "v2"), bucket.aggregateOnly),
		v3: stripIdsIfAggregateOnly(computeVersionMetrics(bucket.rows, "v3"), bucket.aggregateOnly),
		v4: stripIdsIfAggregateOnly(computeVersionMetrics(bucket.rows, "v4"), bucket.aggregateOnly),
		v2VsV3: compareVersions(bucket.rows, "v2", "v3"),
		v3VsV4: compareVersions(bucket.rows, "v3", "v4"),
	};
}

/**
 * Independent v3-vs-v4 identity re-verification, reusing golden-diff.ts (Lane
 * E's own governance utility) rather than re-deriving the comparison inline.
 */
function v3v4GoldenDiffChangedCount(rows: readonly RowVerdict[]): number {
	const v3Records: readonly GoldenDiffRecord[] = rows.map((row) => ({ id: row.id, value: row.classByVersion.v3 }));
	const v4Records: readonly GoldenDiffRecord[] = rows.map((row) => ({ id: row.id, value: row.classByVersion.v4 }));
	return diffGoldenRecords(v3Records, v4Records).changedCount;
}

// ============================================================================
// Rounded, JSON-stable report shape.
// ============================================================================

function round4(value: number): number {
	return Number(value.toFixed(4));
}

interface RoundedVersionMetrics {
	readonly n: number;
	readonly correct: number;
	readonly micro: number;
	readonly macroF1: number;
	readonly minClassF1: number;
	readonly minClassF1Class: GoldTaskClass | null;
	readonly cwa: number;
	readonly severeUnderRate: number;
	readonly severeUnderCount: number;
	readonly severeUnderDenominator: number;
	readonly misclassifiedIds: readonly string[];
}

function roundedVersionMetrics(metrics: VersionMetrics): RoundedVersionMetrics {
	return {
		n: metrics.n,
		correct: metrics.correct,
		micro: round4(metrics.micro),
		macroF1: round4(metrics.macroF1),
		minClassF1: round4(metrics.minClassF1),
		minClassF1Class: metrics.minClassF1Class,
		cwa: round4(metrics.cwa),
		severeUnderRate: round4(metrics.severeUnderRate),
		severeUnderCount: metrics.severeUnderCount,
		severeUnderDenominator: metrics.severeUnderDenominator,
		misclassifiedIds: metrics.misclassifiedIds,
	};
}

interface RoundedPairComparison {
	readonly baseline: RouterVersion;
	readonly candidate: RouterVersion;
	readonly baselineCorrectCount: number;
	readonly b: number;
	readonly c: number;
	readonly classFlipRate: number;
	readonly mcnemarP: number;
	readonly mcnemarSignificant: boolean;
	readonly divergingCount: number;
}

function roundedPairComparison(pair: PairComparison): RoundedPairComparison {
	return {
		baseline: pair.baseline,
		candidate: pair.candidate,
		baselineCorrectCount: pair.baselineCorrectCount,
		b: pair.b,
		c: pair.c,
		classFlipRate: round4(pair.classFlipRate),
		mcnemarP: round4(pair.mcnemarP),
		mcnemarSignificant: pair.mcnemarSignificant,
		divergingCount: pair.divergingCount,
	};
}

interface RoundedBucketReport {
	readonly split: string;
	readonly n: number;
	readonly v2: RoundedVersionMetrics;
	readonly v3: RoundedVersionMetrics;
	readonly v4: RoundedVersionMetrics;
	readonly v2VsV3: RoundedPairComparison;
	readonly v3VsV4: RoundedPairComparison;
}

interface CalibrateV3Report {
	readonly script: "calibrate-v3";
	readonly goldSetVersion: number;
	readonly totalRows: number;
	/** Independent re-check of Lane A's "v4 == v3 on all 210 rows" claim; should always be 0. */
	readonly v3v4DivergingCountFull: number;
	readonly buckets: readonly RoundedBucketReport[];
}

function buildReport(): CalibrateV3Report {
	const buckets = BUCKETS.map(buildBucketReport).map(
		(bucket): RoundedBucketReport => ({
			split: bucket.split,
			n: bucket.n,
			v2: roundedVersionMetrics(bucket.v2),
			v3: roundedVersionMetrics(bucket.v3),
			v4: roundedVersionMetrics(bucket.v4),
			v2VsV3: roundedPairComparison(bucket.v2VsV3),
			v3VsV4: roundedPairComparison(bucket.v3VsV4),
		}),
	);
	return {
		script: "calibrate-v3",
		goldSetVersion: GOLD_SET_VERSION,
		totalRows: GOLD_SET.length,
		v3v4DivergingCountFull: v3v4GoldenDiffChangedCount(ALL_ROWS),
		buckets,
	};
}

function findBucket(report: CalibrateV3Report, split: string): RoundedBucketReport | undefined {
	return report.buckets.find((bucket) => bucket.split === split);
}

// ============================================================================
// Guarded CLI entrypoint. Never runs on import (e.g. from tests or other
// scripts); only runs when this file is executed directly.
// ============================================================================

function isMainModule(): boolean {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return fileURLToPath(import.meta.url) === entry;
	} catch {
		return false;
	}
}

if (isMainModule()) {
	const report = buildReport();
	console.log(`REASONING-ROUTER-CALIBRATE-V3 ${JSON.stringify(report)}`);

	const dev = findBucket(report, "dev");
	const holdout = findBucket(report, "holdout");
	const nonHoldout = findBucket(report, "non-holdout");
	process.stderr.write(
		`calibrate-v3: goldSetVersion=${report.goldSetVersion} totalRows=${report.totalRows} ` +
			`v3v4Diverging(full)=${report.v3v4DivergingCountFull}\n` +
			`  v3Micro   non-holdout=${nonHoldout?.v3.micro} dev=${dev?.v3.micro} holdout=${holdout?.v3.micro}\n` +
			`  v3CWA     non-holdout=${nonHoldout?.v3.cwa} dev=${dev?.v3.cwa} holdout=${holdout?.v3.cwa}\n` +
			`  v4Micro   non-holdout=${nonHoldout?.v4.micro} dev=${dev?.v4.micro} holdout=${holdout?.v4.micro}\n` +
			`  v4CWA     non-holdout=${nonHoldout?.v4.cwa} dev=${dev?.v4.cwa} holdout=${holdout?.v4.cwa}\n` +
			`  v2VsV3(holdout) b=${holdout?.v2VsV3.b} c=${holdout?.v2VsV3.c} p=${holdout?.v2VsV3.mcnemarP}\n` +
			`  v3VsV4(holdout) b=${holdout?.v3VsV4.b} c=${holdout?.v3VsV4.c} divergingCount=${holdout?.v3VsV4.divergingCount}\n`,
	);
}
