/**
 * Reasoning-Router evaluation governance (Goal 009, Req 1 / Lane E).
 *
 * Verifies the additive train/dev/holdout split, category, and feature-tag
 * metadata on the Goal 004 gold set (spec 008 Requirement 1 / tasks T001-T002):
 * stable ids/prompts/classes/holdout booleans, a deterministic content-blind
 * split, exact per-class counts, no duplicate ids, and a privacy-safe
 * aggregate-only holdout/split reporting helper. Also exercises the new pure
 * golden-diff and McNemar governance utility scripts
 * (packages/coding-agent/scripts/reasoning-router/{golden-diff,mcnemar}.ts) so
 * they stay type-checked and behaviorally correct.
 *
 * Pure-module test: no harness, no faux provider, no I/O, no real provider
 * keys/tokens. Does not read or print any GOLD_SET prompt text.
 */

import { describe, expect, it } from "vitest";
import {
	diffGoldenRecords,
	type GoldenDiffRecord,
	recordsFromMap,
} from "../../../scripts/reasoning-router/golden-diff.ts";
import { binomialCoefficient, mcnemarExactTwoSided, runMcNemar } from "../../../scripts/reasoning-router/mcnemar.ts";
import {
	computeGoldSetSplit,
	GOLD_SET,
	GOLD_SET_VERSION,
	GOLD_TASK_CLASSES,
	type GoldSplit,
	summarizeGoldSetSplit,
} from "../../fixtures/reasoning-router-gold-set.ts";

const EXPECTED_ROWS_PER_CLASS = 30;
const EXPECTED_HOLDOUT_PER_CLASS = 6;
const EXPECTED_DEV_PER_CLASS = 6;
const EXPECTED_TRAIN_PER_CLASS = 18;
const EXPECTED_TOTAL = GOLD_TASK_CLASSES.length * EXPECTED_ROWS_PER_CLASS;

describe("goal 009: reasoning-router evaluation governance (Lane E)", () => {
	describe("gold set shape (T001 acceptance: stable ids/prompts/classes/holdout, additive metadata)", () => {
		it(`has exactly ${EXPECTED_TOTAL} rows total`, () => {
			expect(EXPECTED_TOTAL).toBe(210);
			expect(GOLD_SET.length).toBe(EXPECTED_TOTAL);
		});

		it("has no duplicate ids", () => {
			const ids = GOLD_SET.map((entry) => entry.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it(`has exactly ${EXPECTED_ROWS_PER_CLASS} rows per class for all ${GOLD_TASK_CLASSES.length} classes`, () => {
			for (const taskClass of GOLD_TASK_CLASSES) {
				const rows = GOLD_SET.filter((entry) => entry.expectedClass === taskClass);
				expect(rows.length, `class=${taskClass}`).toBe(EXPECTED_ROWS_PER_CLASS);
			}
		});

		it("every row carries the current GOLD_SET_VERSION as labelVersion", () => {
			for (const entry of GOLD_SET) {
				expect(entry.labelVersion, entry.id).toBe(GOLD_SET_VERSION);
			}
		});

		it("split, category, and featureTags are present and well-formed on every row", () => {
			const validSplits = new Set<GoldSplit>(["train", "dev", "holdout"]);
			for (const entry of GOLD_SET) {
				expect(validSplits.has(entry.split), `${entry.id} split=${entry.split}`).toBe(true);
				expect(["core", "edge-case"], entry.id).toContain(entry.category);
				expect(Array.isArray(entry.featureTags), entry.id).toBe(true);
			}
		});
	});

	describe("deterministic split (T001 acceptance: content-blind, holdout boolean equals split)", () => {
		it("holdout boolean equals split exactly: holdout <=> split === 'holdout'", () => {
			for (const entry of GOLD_SET) {
				expect(entry.holdout, entry.id).toBe(entry.split === "holdout");
			}
		});

		it(`assigns exactly ${EXPECTED_HOLDOUT_PER_CLASS} holdout / ${EXPECTED_DEV_PER_CLASS} dev / ${EXPECTED_TRAIN_PER_CLASS} train rows per class`, () => {
			for (const taskClass of GOLD_TASK_CLASSES) {
				const rows = GOLD_SET.filter((entry) => entry.expectedClass === taskClass);
				const counts = { train: 0, dev: 0, holdout: 0 };
				for (const entry of rows) counts[entry.split] += 1;
				expect(counts, `class=${taskClass}`).toEqual({
					train: EXPECTED_TRAIN_PER_CLASS,
					dev: EXPECTED_DEV_PER_CLASS,
					holdout: EXPECTED_HOLDOUT_PER_CLASS,
				});
			}
		});

		it("recomputing the split from scratch (computeGoldSetSplit) reproduces GOLD_SET.split exactly", () => {
			const recomputed = computeGoldSetSplit(GOLD_SET);
			for (const entry of GOLD_SET) {
				expect(recomputed.get(entry.id), entry.id).toBe(entry.split);
			}
		});

		it("split is deterministic across repeated computation", () => {
			const first = computeGoldSetSplit(GOLD_SET);
			for (let i = 0; i < 5; i++) {
				const again = computeGoldSetSplit(GOLD_SET);
				for (const entry of GOLD_SET) {
					expect(again.get(entry.id), `${entry.id} iteration=${i}`).toBe(first.get(entry.id));
				}
			}
		});

		it("dev rows are exactly the 4th non-holdout row (0-indexed position 3, 7, 11, ...) per class sorted by id", () => {
			for (const taskClass of GOLD_TASK_CLASSES) {
				const nonHoldoutSortedIds = GOLD_SET.filter((entry) => entry.expectedClass === taskClass && !entry.holdout)
					.map((entry) => entry.id)
					.sort();
				const expectedDevIds = nonHoldoutSortedIds.filter((_, position) => position % 4 === 3);
				const actualDevIds = GOLD_SET.filter((entry) => entry.expectedClass === taskClass && entry.split === "dev")
					.map((entry) => entry.id)
					.sort();
				expect(actualDevIds, `class=${taskClass}`).toEqual(expectedDevIds);
			}
		});
	});

	describe("aggregate-only reporting helper (T001/T002 acceptance: no prompt text)", () => {
		const report = summarizeGoldSetSplit();

		it("total and overall counts match the full 210-row gold set", () => {
			expect(report.total).toBe(EXPECTED_TOTAL);
			expect(report.overall).toEqual({
				train: EXPECTED_TRAIN_PER_CLASS * GOLD_TASK_CLASSES.length,
				dev: EXPECTED_DEV_PER_CLASS * GOLD_TASK_CLASSES.length,
				holdout: EXPECTED_HOLDOUT_PER_CLASS * GOLD_TASK_CLASSES.length,
			});
		});

		it("per-class counts match 18 train / 6 dev / 6 holdout for every class", () => {
			for (const taskClass of GOLD_TASK_CLASSES) {
				expect(report.perClass[taskClass], taskClass).toEqual({
					train: EXPECTED_TRAIN_PER_CLASS,
					dev: EXPECTED_DEV_PER_CLASS,
					holdout: EXPECTED_HOLDOUT_PER_CLASS,
				});
			}
		});

		it("report shape is aggregate-only: no id or prompt-shaped keys", () => {
			expect(Object.keys(report).sort()).toEqual(["overall", "perClass", "total"]);
			expect(Object.keys(report.overall).sort()).toEqual(["dev", "holdout", "train"]);
			for (const taskClass of GOLD_TASK_CLASSES) {
				expect(Object.keys(report.perClass[taskClass]).sort(), taskClass).toEqual(["dev", "holdout", "train"]);
			}
		});

		it("serialized report never contains any GOLD_SET prompt text", () => {
			const serialized = JSON.stringify(report);
			for (const entry of GOLD_SET) {
				if (entry.prompt.length === 0) continue; // empty prompt is trivially "contained" everywhere
				expect(serialized.includes(entry.prompt), entry.id).toBe(false);
			}
		});

		it("serialized report never contains any GOLD_SET row id", () => {
			const serialized = JSON.stringify(report);
			for (const entry of GOLD_SET) {
				expect(serialized.includes(entry.id), entry.id).toBe(false);
			}
		});

		it("summarizing an explicit holdout-only subset stays aggregate-only and leaks no prompt text", () => {
			const holdoutOnly = GOLD_SET.filter((entry) => entry.holdout);
			const holdoutReport = summarizeGoldSetSplit(holdoutOnly);
			const expectedHoldoutTotal = EXPECTED_HOLDOUT_PER_CLASS * GOLD_TASK_CLASSES.length;
			expect(holdoutReport.total).toBe(expectedHoldoutTotal);
			expect(holdoutReport.overall).toEqual({ train: 0, dev: 0, holdout: expectedHoldoutTotal });
			const serialized = JSON.stringify(holdoutReport);
			for (const entry of holdoutOnly) {
				if (entry.prompt.length === 0) continue;
				expect(serialized.includes(entry.prompt), entry.id).toBe(false);
			}
		});
	});

	describe("mcnemar.ts governance utility (pure, CLI-safe exports)", () => {
		it("binomialCoefficient matches known values and symmetry C(n,k) === C(n,n-k)", () => {
			expect(binomialCoefficient(5, 0)).toBe(1);
			expect(binomialCoefficient(5, 5)).toBe(1);
			expect(binomialCoefficient(5, 2)).toBe(10);
			expect(binomialCoefficient(10, 3)).toBe(120);
			const pairs: ReadonlyArray<readonly [number, number]> = [
				[5, 2],
				[10, 3],
				[7, 4],
				[12, 5],
			];
			for (const [n, k] of pairs) {
				expect(binomialCoefficient(n, k), `n=${n} k=${k}`).toBe(binomialCoefficient(n, n - k));
			}
		});

		it("binomialCoefficient returns 0 for out-of-range k", () => {
			expect(binomialCoefficient(5, -1)).toBe(0);
			expect(binomialCoefficient(5, 6)).toBe(0);
		});

		it("mcnemarExactTwoSided(0, 0) is 1 (no discordant pairs => no evidence of a difference)", () => {
			expect(mcnemarExactTwoSided(0, 0)).toBe(1);
		});

		it("mcnemarExactTwoSided is exactly symmetric in (b, c)", () => {
			const pairs: ReadonlyArray<readonly [number, number]> = [
				[0, 0],
				[1, 0],
				[0, 1],
				[3, 3],
				[11, 4],
				[20, 5],
				[1, 9],
			];
			for (const [b, c] of pairs) {
				expect(mcnemarExactTwoSided(b, c), `b=${b} c=${c}`).toBe(mcnemarExactTwoSided(c, b));
			}
		});

		it("mcnemarExactTwoSided always returns a value in [0, 1]", () => {
			const pairs: ReadonlyArray<readonly [number, number]> = [
				[0, 0],
				[1, 0],
				[5, 5],
				[11, 4],
				[20, 5],
				[42, 42],
				[1, 41],
			];
			for (const [b, c] of pairs) {
				const p = mcnemarExactTwoSided(b, c);
				expect(p, `b=${b} c=${c}`).toBeGreaterThanOrEqual(0);
				expect(p, `b=${b} c=${c}`).toBeLessThanOrEqual(1);
			}
		});

		it("mcnemarExactTwoSided matches a hand-computed small-sample value (b=1, c=9)", () => {
			// n=10, lo=1: tail = C(10,0)+C(10,1) = 1+10 = 11; p = min(1, 2*11/1024).
			expect(mcnemarExactTwoSided(1, 9)).toBeCloseTo(22 / 1024, 9);
		});

		it("mcnemarExactTwoSided reproduces the Goal 004 Lane I5 v1-vs-v2 evidence value (b=11, c=4)", () => {
			// .omk/goals/004-reasoning-router-v2-impl/laneI5-eval.md recorded b=11, c=4, p=0.1185.
			expect(mcnemarExactTwoSided(11, 4)).toBeCloseTo(0.1185, 4);
		});

		it("mcnemarExactTwoSided rejects non-integer or negative inputs", () => {
			expect(() => mcnemarExactTwoSided(-1, 0)).toThrow();
			expect(() => mcnemarExactTwoSided(0, 1.5)).toThrow();
		});

		it("runMcNemar packages b, c, discordantTotal, pValue, and a significance flag", () => {
			const result = runMcNemar({ b: 11, c: 4 });
			expect(result.b).toBe(11);
			expect(result.c).toBe(4);
			expect(result.discordantTotal).toBe(15);
			expect(result.pValue).toBeCloseTo(0.1185, 4);
			expect(result.significant).toBe(false); // p=0.1185 > default alpha=0.05
		});

		it("runMcNemar flags significant at a lower discordant p-value", () => {
			const result = runMcNemar({ b: 1, c: 9 });
			expect(result.significant).toBe(true); // p ~ 0.0215 < default alpha=0.05
		});
	});

	describe("golden-diff.ts governance utility (pure, CLI-safe exports)", () => {
		it("reports zero changes when baseline and current are identical", () => {
			const snapshot: readonly GoldenDiffRecord[] = GOLD_SET.slice(0, 5).map((entry) => ({
				id: entry.id,
				value: entry.expectedClass,
			}));
			const summary = diffGoldenRecords(snapshot, snapshot);
			expect(summary.changedCount).toBe(0);
			expect(summary.addedCount).toBe(0);
			expect(summary.removedCount).toBe(0);
			expect(summary.unchangedCount).toBe(snapshot.length);
			expect(summary.changes).toEqual([]);
		});

		it("detects a single changed value between baseline and current", () => {
			const baseline: readonly GoldenDiffRecord[] = [
				{ id: "a", value: "debug" },
				{ id: "b", value: "plan" },
			];
			const current: readonly GoldenDiffRecord[] = [
				{ id: "a", value: "review" },
				{ id: "b", value: "plan" },
			];
			const summary = diffGoldenRecords(baseline, current);
			expect(summary.changedCount).toBe(1);
			expect(summary.unchangedCount).toBe(1);
			expect(summary.changes).toEqual([
				{ id: "a", kind: "changed", baselineValue: "debug", currentValue: "review" },
			]);
		});

		it("detects added and removed ids between baseline and current, sorted by id", () => {
			const baseline: readonly GoldenDiffRecord[] = [{ id: "a", value: "debug" }];
			const current: readonly GoldenDiffRecord[] = [{ id: "b", value: "plan" }];
			const summary = diffGoldenRecords(baseline, current);
			expect(summary.addedCount).toBe(1);
			expect(summary.removedCount).toBe(1);
			expect(summary.changes).toEqual([
				{ id: "a", kind: "removed", baselineValue: "debug" },
				{ id: "b", kind: "added", currentValue: "plan" },
			]);
		});

		it("output is sorted by id regardless of input order", () => {
			const baseline: readonly GoldenDiffRecord[] = [
				{ id: "z", value: "1" },
				{ id: "a", value: "1" },
			];
			const current: readonly GoldenDiffRecord[] = [
				{ id: "a", value: "2" },
				{ id: "z", value: "2" },
			];
			const summary = diffGoldenRecords(baseline, current);
			expect(summary.changes.map((change) => change.id)).toEqual(["a", "z"]);
		});

		it("rejects duplicate ids within a single snapshot", () => {
			const duplicated: readonly GoldenDiffRecord[] = [
				{ id: "a", value: "1" },
				{ id: "a", value: "2" },
			];
			expect(() => diffGoldenRecords(duplicated, [])).toThrow();
		});

		it("recordsFromMap round-trips a plain id -> value map into GoldenDiffRecord[]", () => {
			const map = { "gold-0001": "trivial", "gold-0031": "simple-edit" };
			const records = recordsFromMap(map);
			expect(records).toEqual([
				{ id: "gold-0001", value: "trivial" },
				{ id: "gold-0031", value: "simple-edit" },
			]);
		});

		it("is safe to diff the full GOLD_SET class labels against themselves (n=210, zero changes)", () => {
			const snapshot: readonly GoldenDiffRecord[] = GOLD_SET.map((entry) => ({
				id: entry.id,
				value: entry.expectedClass,
			}));
			const summary = diffGoldenRecords(snapshot, snapshot);
			expect(summary.totalBaseline).toBe(210);
			expect(summary.totalCurrent).toBe(210);
			expect(summary.changedCount).toBe(0);
		});
	});
});
