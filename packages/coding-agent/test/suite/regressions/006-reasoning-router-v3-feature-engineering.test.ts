/**
 * Reasoning-Router v3 — feature-engineering benchmark/focused regressions.
 *
 * This file intentionally leaves v1/v2 regression suites unchanged. It compares
 * the opt-in v3 pure core against the existing v2 baseline over non-holdout
 * synthetic GOLD_SET rows and hard-gates only focused v3 sentinel rows plus the
 * aggregate/fallback acceptance rule from Goal 007 Lane P1/P3.
 */

import type { ThinkingLevel } from "omk-agent-core";
import { describe, expect, it } from "vitest";

import {
	classifyTaskV2,
	resolveThinkingLevelV2ForAuto,
	type TaskClassV2,
} from "../../../src/core/reasoning-router-v2.ts";
import {
	classifyTaskV3,
	resolveThinkingLevelV3ForAuto,
	TASK_CLASS_THINKING_LEVELS_V3,
} from "../../../src/core/reasoning-router-v3.ts";
import { DEFAULT_WEIGHTS } from "../../../src/core/reasoning-router-weights.ts";
import {
	GOLD_SET,
	GOLD_SET_VERSION,
	type GoldEntry,
	type GoldTaskClass,
} from "../../fixtures/reasoning-router-gold-set.ts";

const FULL_LEVEL_SET: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

const CLASS_ORDER = Object.keys(TASK_CLASS_THINKING_LEVELS_V3);

const CURRENT_V2_MISS_IDS: readonly string[] = [
	"gold-0033",
	"gold-0038",
	"gold-0042",
	"gold-0043",
	"gold-0044",
	"gold-0048",
	"gold-0049",
	"gold-0051",
	"gold-0052",
	"gold-0053",
	"gold-0059",
	"gold-0078",
	"gold-0136",
	"gold-0156",
	"gold-0168",
	"gold-0179",
	"gold-0207",
	"gold-0209",
];

type Sentinel = {
	readonly id: string;
	readonly prompt: string;
	readonly expectedClass: GoldTaskClass;
};

const focusedSentinels = [
	{
		id: "gold-0033",
		prompt: "correct the spelling of 'recieve' to 'receive'",
		expectedClass: "simple-edit",
	},
	{
		id: "gold-0038",
		prompt: "fix the punctuation in the error message",
		expectedClass: "simple-edit",
	},
	{
		id: "gold-0078",
		prompt: "add error handling to the fetch call",
		expectedClass: "code-gen",
	},
	{
		id: "gold-0156",
		prompt: "review the diff for any regressions",
		expectedClass: "review",
	},
	{
		id: "gold-0207",
		prompt: "design the audit log architecture",
		expectedClass: "plan",
	},
	{
		id: "gold-0209",
		prompt: GOLD_SET.find((entry) => entry.id === "gold-0209")?.prompt ?? "",
		expectedClass: "plan",
	},
] as const satisfies readonly Sentinel[];

const focusedSentinelIds: ReadonlySet<string> = new Set(focusedSentinels.map((entry) => entry.id));

const levelIndex = (level: ThinkingLevel): number => FULL_LEVEL_SET.indexOf(level);

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

interface Verdict {
	readonly entry: GoldEntry;
	readonly v2Class: TaskClassV2;
	readonly v3Class: GoldTaskClass;
	readonly v2Level: ThinkingLevel;
	readonly v3Level: ThinkingLevel;
	readonly expectedLevel: ThinkingLevel;
	readonly v2ClassOK: boolean;
	readonly v3ClassOK: boolean;
	readonly v2Cost: number;
	readonly v3Cost: number;
}

function scoreEntry(entry: GoldEntry): Verdict {
	const v2Class = classifyTaskV2({ prompt: entry.prompt }, DEFAULT_WEIGHTS);
	const v3Class = classifyTaskV3({ prompt: entry.prompt });
	const v2Level = resolveThinkingLevelV2ForAuto(v2Class, FULL_LEVEL_SET, undefined);
	const v3Level = resolveThinkingLevelV3ForAuto(v3Class, FULL_LEVEL_SET, undefined);
	const expectedLevel = entry.expectedLevel;
	return {
		entry,
		v2Class,
		v3Class,
		v2Level,
		v3Level,
		expectedLevel,
		v2ClassOK: v2Class === entry.expectedClass,
		v3ClassOK: v3Class === entry.expectedClass,
		v2Cost: entryCost(v2Level, expectedLevel),
		v3Cost: entryCost(v3Level, expectedLevel),
	};
}

interface Metrics {
	readonly n: number;
	readonly v2Micro: number;
	readonly v3Micro: number;
	readonly cwaV2: number;
	readonly cwaV3: number;
	readonly totalCostV2: number;
	readonly totalCostV3: number;
	readonly v2MissIds: readonly string[];
	readonly fixedCurrentV2MissIds: readonly string[];
	readonly v2CorrectRegressions: number;
}

function aggregate(verdicts: readonly Verdict[]): Metrics {
	let v2Correct = 0;
	let v3Correct = 0;
	let totalCostV2 = 0;
	let totalCostV3 = 0;
	let worstDenominator = 0;
	let v2CorrectRegressions = 0;
	const v2MissIds: string[] = [];
	const fixedCurrentV2MissIds: string[] = [];

	for (const verdict of verdicts) {
		if (verdict.v2ClassOK) v2Correct += 1;
		if (verdict.v3ClassOK) v3Correct += 1;
		if (!verdict.v2ClassOK) v2MissIds.push(verdict.entry.id);
		if (CURRENT_V2_MISS_IDS.includes(verdict.entry.id) && verdict.v3ClassOK) {
			fixedCurrentV2MissIds.push(verdict.entry.id);
		}
		if (verdict.v2ClassOK && !verdict.v3ClassOK) v2CorrectRegressions += 1;
		totalCostV2 += verdict.v2Cost;
		totalCostV3 += verdict.v3Cost;
		worstDenominator += worstCaseCost(verdict.expectedLevel);
	}

	return {
		n: verdicts.length,
		v2Micro: verdicts.length === 0 ? 0 : v2Correct / verdicts.length,
		v3Micro: verdicts.length === 0 ? 0 : v3Correct / verdicts.length,
		cwaV2: worstDenominator === 0 ? 1 : 1 - totalCostV2 / worstDenominator,
		cwaV3: worstDenominator === 0 ? 1 : 1 - totalCostV3 / worstDenominator,
		totalCostV2,
		totalCostV3,
		v2MissIds,
		fixedCurrentV2MissIds,
		v2CorrectRegressions,
	};
}

const nonHoldoutVerdicts = GOLD_SET.filter((entry) => !entry.holdout).map(scoreEntry);
const metrics = aggregate(nonHoldoutVerdicts);

const failureSummary = (verdict: Verdict): string =>
	[
		`id=${verdict.entry.id}`,
		`expected=${verdict.entry.expectedClass}/${verdict.expectedLevel}`,
		`v2=${verdict.v2Class}/${verdict.v2Level}`,
		`v3=${verdict.v3Class}/${verdict.v3Level}`,
	].join(" | ");

describe("reasoning-router v3 feature-engineering benchmark", () => {
	it.each(focusedSentinels)("focused sentinel $id classifies as $expectedClass", (sentinel) => {
		expect(classifyTaskV3({ prompt: sentinel.prompt })).toBe(sentinel.expectedClass);
	});

	it("exposes the v3 plan thinking-level mapping", () => {
		expect(TASK_CLASS_THINKING_LEVELS_V3.plan).toBe("xhigh");
	});

	it("aggregate gate: v3 beats v2 CWA with micro >= 0.95, or fixes all known v2 misses with <=2 regressions", () => {
		const primaryGatePass = metrics.cwaV3 > metrics.cwaV2 && metrics.v3Micro >= 0.95;
		const missingCurrentFixes = CURRENT_V2_MISS_IDS.filter((id) => !metrics.fixedCurrentV2MissIds.includes(id));
		const fallbackGatePass = missingCurrentFixes.length === 0 && metrics.v2CorrectRegressions <= 2;
		expect(
			primaryGatePass || fallbackGatePass,
			[
				`goldSetVersion=${GOLD_SET_VERSION}`,
				`n=${metrics.n}`,
				`v2Micro=${metrics.v2Micro.toFixed(4)}`,
				`v3Micro=${metrics.v3Micro.toFixed(4)}`,
				`cwaV2=${metrics.cwaV2.toFixed(4)}`,
				`cwaV3=${metrics.cwaV3.toFixed(4)}`,
				`costV2=${metrics.totalCostV2}`,
				`costV3=${metrics.totalCostV3}`,
				`missingCurrentFixes=${missingCurrentFixes.join(",") || "none"}`,
				`v2CorrectRegressions=${metrics.v2CorrectRegressions}`,
			].join(" | "),
		).toBe(true);
	});

	it("classifier is deterministic across repeated non-holdout benchmark inputs", () => {
		for (const verdict of nonHoldoutVerdicts) {
			const first = classifyTaskV3({ prompt: verdict.entry.prompt });
			for (let i = 0; i < 5; i++) {
				expect(classifyTaskV3({ prompt: verdict.entry.prompt }), verdict.entry.id).toBe(first);
			}
		}
	});

	for (const verdict of nonHoldoutVerdicts) {
		if (focusedSentinelIds.has(verdict.entry.id)) continue;
		it(`${verdict.entry.id}: records a valid v3 diagnostic verdict`, () => {
			expect(CLASS_ORDER, failureSummary(verdict)).toContain(verdict.v3Class);
			expect(FULL_LEVEL_SET, failureSummary(verdict)).toContain(verdict.v3Level);
		});
	}

	it("prints REASONING-ROUTER-V3-BENCHMARK summary", () => {
		const summary = {
			version: "v3-feature-engineering",
			goldSetVersion: GOLD_SET_VERSION,
			n: metrics.n,
			holdout: "excluded",
			v2MissIds: metrics.v2MissIds,
			fixedCurrentV2MissIds: metrics.fixedCurrentV2MissIds,
			v2CorrectRegressions: metrics.v2CorrectRegressions,
			v2Micro: Number(metrics.v2Micro.toFixed(4)),
			v3Micro: Number(metrics.v3Micro.toFixed(4)),
			cwaV2: Number(metrics.cwaV2.toFixed(4)),
			cwaV3: Number(metrics.cwaV3.toFixed(4)),
		};
		console.log(`REASONING-ROUTER-V3-BENCHMARK ${JSON.stringify(summary)}`);
		expect(metrics.n).toBe(GOLD_SET.filter((entry) => !entry.holdout).length);
	});
});
