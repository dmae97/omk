/**
 * Reasoning-Router v4 — confidence-bearing classifier accuracy + metadata
 * suite (Goal 009 Wave 1 Lane A, specs/008-reasoning-router-advanced-accuracy
 * Requirement 2 / tasks.md T007).
 *
 * v1/v2/v3 source files are untouched by this lane; they are imported here
 * ONLY for side-by-side comparison, exactly as 004/006's benchmark tests do.
 *
 * Coverage:
 *  - v4 fixes every current v2 miss on the non-holdout gold set (HARD gate).
 *  - v4 has zero classification regressions vs v3 across the FULL gold set,
 *    holdout included (HARD gate; v3's own holdout is never used for tuning,
 *    but v4 must not silently break what v3 already gets right on it).
 *  - Confidence/margin/runnerUp/tieBreak/fallbackReason/suppressedFeatureIds
 *    are well-formed on every gold row, and resolveThinkingLevelV4WithUncertainty
 *    never resolves BELOW resolveThinkingLevelV4ForAuto for the same class.
 *  - Bounded negation: fixes concrete v2/v3 misclassifications caused by an
 *    un-negated keyword scan, without suppressing a same-family keyword that
 *    sits in a different clause or after the negation cue.
 *  - Bounded compound intent: detects a genuine second, distinct leading
 *    intent without changing any existing gold-set classification.
 *  - Deterministic: repeated classifyTaskV4 calls on identical input produce
 *    byte-identical verdicts.
 *
 * Every prompt used below to demonstrate negation/compound/tie-break behavior
 * is synthetic, written from scratch for this test file — no real session
 * text, user names, repo paths, tokens, or URLs.
 */

import type { ThinkingLevel } from "omk-agent-core";
import { describe, expect, it } from "vitest";

import { classifyTaskV2 } from "../../../src/core/reasoning-router-v2.ts";
import { classifyTaskV3 } from "../../../src/core/reasoning-router-v3.ts";
import {
	type ClassifierVerdictV4,
	classifyTaskV4,
	resolveThinkingLevelV4ForAuto,
	resolveThinkingLevelV4WithUncertainty,
	TASK_CLASS_THINKING_LEVELS_V4,
	TASK_CLASSES_V4,
	type TaskClassV4,
} from "../../../src/core/reasoning-router-v4.ts";
import { DEFAULT_WEIGHTS } from "../../../src/core/reasoning-router-weights.ts";
import { GOLD_SET, GOLD_SET_VERSION, type GoldEntry } from "../../fixtures/reasoning-router-gold-set.ts";

const FULL_LEVEL_SET: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
const levelIndex = (level: ThinkingLevel): number => FULL_LEVEL_SET.indexOf(level);
const SORTED_TASK_CLASSES = [...TASK_CLASSES_V4].sort();

interface GoldVerdict {
	readonly entry: GoldEntry;
	readonly v2Class: TaskClassV4;
	readonly v3Class: TaskClassV4;
	readonly v4: ClassifierVerdictV4;
}

function scoreEntry(entry: GoldEntry): GoldVerdict {
	return {
		entry,
		v2Class: classifyTaskV2({ prompt: entry.prompt }, DEFAULT_WEIGHTS),
		v3Class: classifyTaskV3({ prompt: entry.prompt }),
		v4: classifyTaskV4({ prompt: entry.prompt }),
	};
}

const allVerdicts = GOLD_SET.map(scoreEntry);
const nonHoldoutVerdicts = allVerdicts.filter((v) => !v.entry.holdout);

const v2MissIds = nonHoldoutVerdicts.filter((v) => v.v2Class !== v.entry.expectedClass).map((v) => v.entry.id);
const v4FixedV2MissIds = nonHoldoutVerdicts
	.filter((v) => v.v2Class !== v.entry.expectedClass && v.v4.taskClass === v.entry.expectedClass)
	.map((v) => v.entry.id);
const v3RegressionIds = allVerdicts
	.filter((v) => v.v3Class === v.entry.expectedClass && v.v4.taskClass !== v.entry.expectedClass)
	.map((v) => v.entry.id);
const v3IdentityMismatchIds = allVerdicts.filter((v) => v.v4.taskClass !== v.v3Class).map((v) => v.entry.id);

const failureSummary = (v: GoldVerdict): string =>
	[
		`id=${v.entry.id}`,
		`expected=${v.entry.expectedClass}`,
		`v2=${v.v2Class}`,
		`v3=${v.v3Class}`,
		`v4=${v.v4.taskClass}`,
		`fallback=${v.v4.fallbackReason}`,
		`confidence=${v.v4.confidence.toFixed(3)}`,
	].join(" | ");

describe("reasoning-router v4 accuracy + confidence-metadata suite", () => {
	describe("v4 fixes current v2 misses (non-holdout)", () => {
		it(`v2 currently misses ${v2MissIds.length} non-holdout gold rows (governance baseline; must be > 0 or this gate is vacuous)`, () => {
			expect(v2MissIds.length).toBeGreaterThan(0);
		});

		it("HARD gate: v4 correctly classifies every non-holdout gold row that v2 currently misses", () => {
			const unfixed = v2MissIds.filter((id) => !v4FixedV2MissIds.includes(id));
			expect(unfixed, `unfixed v2 misses: ${unfixed.join(",") || "none"}`).toEqual([]);
		});

		const focusedV2Misses: readonly {
			readonly id: string;
			readonly prompt: string;
			readonly expectedClass: TaskClassV4;
		}[] = [
			{ id: "gold-0033", prompt: "correct the spelling of 'recieve' to 'receive'", expectedClass: "simple-edit" },
			{ id: "gold-0038", prompt: "fix the punctuation in the error message", expectedClass: "simple-edit" },
			{ id: "gold-0078", prompt: "add error handling to the fetch call", expectedClass: "code-gen" },
			{ id: "gold-0156", prompt: "review the diff for any regressions", expectedClass: "review" },
			{ id: "gold-0207", prompt: "design the audit log architecture", expectedClass: "plan" },
		];
		it.each(focusedV2Misses)(
			"focused known v2-miss $id classifies as $expectedClass under v4",
			({ prompt, expectedClass }) => {
				expect(classifyTaskV4({ prompt }).taskClass).toBe(expectedClass);
			},
		);
	});

	describe("no v3 regressions (full gold set, holdout included)", () => {
		it("HARD gate: v4 never turns a v3-correct row wrong", () => {
			expect(v3RegressionIds, `regressed ids: ${v3RegressionIds.join(",") || "none"}`).toEqual([]);
		});

		it("v4 taskClass equals v3 taskClass on every gold row (0 of 210 differ) under DEFAULT_WEIGHTS_V4", () => {
			expect(v3IdentityMismatchIds, `differing ids: ${v3IdentityMismatchIds.join(",") || "none"}`).toEqual([]);
		});

		for (const v of nonHoldoutVerdicts) {
			it(`${v.entry.id}: v4 taskClass matches v3 taskClass`, () => {
				expect(v.v4.taskClass, failureSummary(v)).toBe(v.v3Class);
			});
		}

		it("prints REASONING-ROUTER-V4-BENCHMARK summary", () => {
			const v4Correct = nonHoldoutVerdicts.filter((v) => v.v4.taskClass === v.entry.expectedClass).length;
			const v2Correct = nonHoldoutVerdicts.filter((v) => v.v2Class === v.entry.expectedClass).length;
			const summary = {
				version: "v4-accuracy",
				goldSetVersion: GOLD_SET_VERSION,
				n: nonHoldoutVerdicts.length,
				holdout: "identity-checked-only",
				v2Micro: Number((v2Correct / nonHoldoutVerdicts.length).toFixed(4)),
				v4Micro: Number((v4Correct / nonHoldoutVerdicts.length).toFixed(4)),
				v2MissIds,
				v4FixedV2MissIds,
				v3RegressionIds,
			};
			console.log(`REASONING-ROUTER-V4-BENCHMARK ${JSON.stringify(summary)}`);
			expect(nonHoldoutVerdicts.length).toBe(GOLD_SET.filter((e) => !e.holdout).length);
		});
	});

	describe("confidence metadata is well-formed on every gold row", () => {
		it("exposes the v4 plan thinking-level mapping (rule-table parity with v1/v2/v3)", () => {
			expect(TASK_CLASS_THINKING_LEVELS_V4.plan).toBe("xhigh");
			expect(TASK_CLASS_THINKING_LEVELS_V4.trivial).toBe("minimal");
		});

		for (const v of nonHoldoutVerdicts) {
			it(`${v.entry.id}: verdict has a well-formed score map, margin, confidence band, and audit flags`, () => {
				expect(Object.keys(v.v4.scores).sort(), failureSummary(v)).toEqual(SORTED_TASK_CLASSES);
				for (const c of TASK_CLASSES_V4) {
					expect(v.v4.scores[c], `${failureSummary(v)} class=${c}`).toBeGreaterThanOrEqual(0);
				}
				expect(v.v4.margin, failureSummary(v)).toBeGreaterThanOrEqual(0);
				expect(v.v4.confidence, failureSummary(v)).toBeGreaterThanOrEqual(0);
				expect(v.v4.confidence, failureSummary(v)).toBeLessThanOrEqual(1);
				expect(["low", "medium", "high"], failureSummary(v)).toContain(v.v4.confidenceBand);
				expect(typeof v.v4.tieBreak, failureSummary(v)).toBe("boolean");
				expect(typeof v.v4.compoundIntent, failureSummary(v)).toBe("boolean");
				expect(Array.isArray(v.v4.suppressedFeatureIds), failureSummary(v)).toBe(true);
				for (const id of v.v4.suppressedFeatureIds) {
					expect(id, failureSummary(v)).toMatch(/^negation:/);
				}
			});
		}

		it("HARD gate: resolveThinkingLevelV4WithUncertainty never resolves below resolveThinkingLevelV4ForAuto (bias=0, hint=null)", () => {
			for (const v of nonHoldoutVerdicts) {
				const confidentLevel = resolveThinkingLevelV4ForAuto(v.v4.taskClass, FULL_LEVEL_SET, undefined);
				const uncertainLevel = resolveThinkingLevelV4WithUncertainty(v.v4, FULL_LEVEL_SET, undefined);
				expect(levelIndex(uncertainLevel), failureSummary(v)).toBeGreaterThanOrEqual(levelIndex(confidentLevel));
			}
		});
	});

	describe("bounded negation", () => {
		it("fixes a v3 misclassification: negated refactor cue does not steal a debug-evidenced prompt", () => {
			const prompt = "don't refactor this, just fix the crash";
			expect(classifyTaskV3({ prompt }), "v3 baseline (documenting the bug this fixes)").toBe("refactor");
			expect(classifyTaskV2({ prompt }, DEFAULT_WEIGHTS), "v2 baseline (already correct by precedence luck)").toBe(
				"debug",
			);
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("debug");
			expect(verdict.suppressedFeatureIds).toContain("negation:refactor-cue");
			expect(verdict.scores.refactor).toBe(0);
		});

		it("fixes a SHARED v2+v3 misclassification: negated review keyword lets an unnegated code-gen verb win", () => {
			const prompt = "skip the review, just build the feature";
			expect(classifyTaskV3({ prompt }), "v3 baseline (documenting the shared miss this fixes)").toBe("review");
			expect(
				classifyTaskV2({ prompt }, DEFAULT_WEIGHTS),
				"v2 baseline (documenting the shared miss this fixes)",
			).toBe("review");
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("code-gen");
			expect(verdict.suppressedFeatureIds).toContain("negation:keyword-review");
			expect(verdict.scores.review).toBe(0);
		});

		it("does NOT suppress a keyword that appears BEFORE the negation cue in the prompt", () => {
			// "without" follows "refactor"; a backward-only negation window must not reach forward across it.
			const prompt = "refactor for readability without changing behavior";
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("refactor");
			expect(verdict.suppressedFeatureIds).toEqual([]);
		});

		it("does NOT let a negation cue cross a sentence boundary into a later, unrelated clause", () => {
			const prompt = "this isn't a bug. refactor the parser.";
			const verdict = classifyTaskV4({ prompt });
			// The negated "bug" mention is suppressed (no debug signal survives)...
			expect(verdict.suppressedFeatureIds).toContain("negation:bug-object");
			expect(verdict.scores.debug).toBe(0);
			// ...but "refactor" sits in the NEXT sentence after "isn't" and must not be swept up too.
			expect(verdict.taskClass).toBe("refactor");
			expect(verdict.scores.refactor).toBeGreaterThan(0);
		});
	});

	describe("bounded compound intent", () => {
		it("detects a genuine second, distinct leading intent (annotation only; no v3 regression)", () => {
			const prompt = "review the diff and then implement the fix";
			expect(classifyTaskV3({ prompt })).toBe("review");
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("review");
			expect(verdict.compoundIntent).toBe(true);
			expect(verdict.secondClauseIntent).toBe("code-gen");
			expect(verdict.confidenceBand).toBe("medium");
			expect(verdict.margin).toBeLessThan(verdict.scores.review);
		});

		it("does not fire inside a long prose brief (split point beyond the 300-char bound)", () => {
			const longPlanEntry = GOLD_SET.find((entry) => entry.id === "gold-0208");
			expect(longPlanEntry).toBeDefined();
			const verdict = classifyTaskV4({ prompt: longPlanEntry?.prompt ?? "" });
			expect(verdict.compoundIntent).toBe(false);
			expect(verdict.taskClass).toBe("plan");
		});

		it("does not fire on a bare 'and' (only 'then' / 'and then' / 'and also' / ';' qualify)", () => {
			const verdict = classifyTaskV4({ prompt: "audit the api and generate the docs" });
			expect(verdict.compoundIntent).toBe(false);
		});
	});

	describe("multilingual routing (Korean)", () => {
		const cases: readonly { prompt: string; expectedClass: TaskClassV4 }[] = [
			{ prompt: "오타 'recieve'를 'receive'로 고쳐줘", expectedClass: "simple-edit" },
			{ prompt: "fetch 호출에 에러 처리를 추가해줘", expectedClass: "code-gen" },
			{ prompt: "diff를 리뷰해서 회귀가 있는지 확인해줘", expectedClass: "review" },
			{ prompt: "감사 로그 아키텍처를 설계해줘", expectedClass: "plan" },
			{ prompt: "크래시를 재현하고 원인을 디버깅해줘", expectedClass: "debug" },
		];

		it.each(cases)("routes $prompt to $expectedClass", ({ prompt, expectedClass }) => {
			expect(classifyTaskV4({ prompt }).taskClass).toBe(expectedClass);
		});

		it.each([
			{ prompt: "오류 고쳐줘", expectedClass: "debug" as const },
			{ prompt: "테스트 실패 원인 분석해줘", expectedClass: "debug" as const },
			{ prompt: "디버깅해줘", expectedClass: "debug" as const },
			{ prompt: "안 쓰는 코드 삭제해줘", expectedClass: "code-gen" as const },
			{ prompt: "버튼 색 바꿔줘", expectedClass: "code-gen" as const },
		])("routes short zero-score Korean task signal $prompt via bounded fallback", ({ prompt, expectedClass }) => {
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe(expectedClass);
			expect(verdict.fallbackReason).toBe("ko-short-task-signal");
			expect(verdict.scores[expectedClass]).toBe(0);
		});

		it("keeps short Korean greeting without task signal trivial", () => {
			const verdict = classifyTaskV4({ prompt: "안녕하세요" });
			expect(verdict.taskClass).toBe("trivial");
			expect(verdict.fallbackReason).toBe("trivial-length");
		});

		it("does not promote a short Korean task signal when it is post-negated", () => {
			const verdict = classifyTaskV4({ prompt: "삭제하지 마" });
			expect(verdict.taskClass).toBe("trivial");
			expect(verdict.fallbackReason).toBe("trivial-length");
		});

		it("handles Korean post-positioned refactor negation without stealing a crash fix", () => {
			const verdict = classifyTaskV4({ prompt: "리팩토링하지 말고 크래시만 고쳐줘" });
			expect(verdict.taskClass).toBe("debug");
			expect(verdict.scores.refactor).toBe(0);
			expect(verdict.scores.debug).toBeGreaterThan(0);
		});

		it.each([
			{
				prompt: "리뷰하지 말고 구현해줘",
				expectedClass: "code-gen" as const,
				expectedSuppression: "negation:keyword-review",
				suppressedScore: "review" as const,
				winningScore: "code-gen" as const,
			},
			{
				prompt: "설계하지 말고 구현해줘",
				expectedClass: "code-gen" as const,
				expectedSuppression: "negation:keyword-plan",
				suppressedScore: "plan" as const,
				winningScore: "code-gen" as const,
			},
			{
				prompt: "구현하지 말고 설계해줘",
				expectedClass: "plan" as const,
				expectedSuppression: "negation:keyword-code-gen",
				suppressedScore: "code-gen" as const,
				winningScore: "plan" as const,
			},
			{
				prompt: "리팩토링은 하지 말고 버그만 고쳐줘",
				expectedClass: "debug" as const,
				expectedSuppression: "negation:refactor-cue",
				suppressedScore: "refactor" as const,
				winningScore: "debug" as const,
			},
		])(
			"suppresses Korean post-positioned negation in $prompt",
			({ prompt, expectedClass, expectedSuppression, suppressedScore, winningScore }) => {
				const verdict = classifyTaskV4({ prompt });
				expect(verdict.taskClass).toBe(expectedClass);
				expect(verdict.suppressedFeatureIds).toContain(expectedSuppression);
				expect(verdict.scores[suppressedScore]).toBe(0);
				expect(verdict.scores[winningScore]).toBeGreaterThan(0);
			},
		);

		it("does not suppress non-negated Korean refactor intent", () => {
			const verdict = classifyTaskV4({ prompt: "파서를 리팩토링해줘" });
			expect(verdict.taskClass).toBe("refactor");
			expect(verdict.scores.refactor).toBeGreaterThan(0);
			expect(verdict.suppressedFeatureIds).toEqual([]);
		});

		it("does not over-promote Korean README/changelog copy edits to an operational runbook", () => {
			const verdict = classifyTaskV4({ prompt: "README 제목 고치고 채널로그 문구만 다듬어줘" });
			expect(verdict.taskClass).toBe("simple-edit");
			expect(verdict.scores.plan).toBe(0);
		});
	});

	describe("operational runbook intent", () => {
		it("promotes release-bound commit/push/publish bundles to plan instead of default code-gen", () => {
			const prompt =
				"이제 깃헙 커밋, 푸쉬, 릴리즈 업데이트, omk tui 0.90.4, 채널로그, README.md, CI/CD, npm publish까지 완벽하게 가자";
			expect(classifyTaskV3({ prompt }), "v3 baseline falls through to default code-gen").toBe("code-gen");
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("plan");
			expect(verdict.fallbackReason).toBeNull();
			expect(verdict.scores.plan).toBeGreaterThan(verdict.scores["code-gen"]);
			expect(verdict.confidenceBand).toBe("high");
		});

		it("does not over-promote plain README and changelog copy edits", () => {
			const prompt = "update the README title and reword the changelog entry";
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("simple-edit");
			expect(verdict.scores.plan).toBe(0);
		});
	});

	describe("tie-break metadata", () => {
		it("surfaces a genuine precedence tie between two equally-weighted keyword families", () => {
			const prompt = "please help with an audit and generate a report";
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("review");
			expect(verdict.runnerUp).toBe("code-gen");
			expect(verdict.margin).toBe(0);
			expect(verdict.tieBreak).toBe(true);
			expect(verdict.confidence).toBe(0);
			expect(verdict.confidenceBand).toBe("low");
		});
	});

	describe("deterministic behavior", () => {
		it("classifyTaskV4 is deterministic across repeated calls on every non-holdout gold prompt", () => {
			for (const v of nonHoldoutVerdicts) {
				const first = classifyTaskV4({ prompt: v.entry.prompt });
				for (let i = 0; i < 5; i++) {
					const repeat = classifyTaskV4({ prompt: v.entry.prompt });
					expect(repeat, v.entry.id).toEqual(first);
				}
			}
		});

		it("classifyTaskV4 is deterministic on negation/compound-bearing prompts", () => {
			const prompts = [
				"don't refactor this, just fix the crash",
				"skip the review, just build the feature",
				"review the diff and then implement the fix",
				"please help with an audit and generate a report",
				"this isn't a bug. refactor the parser.",
				"크래시를 재현하고 원인을 디버깅해줘",
				"리팩토링하지 말고 크래시만 고쳐줘",
				"README 제목 고치고 채널로그 문구만 다듬어줘",
			];
			for (const prompt of prompts) {
				const first = classifyTaskV4({ prompt });
				for (let i = 0; i < 5; i++) {
					expect(classifyTaskV4({ prompt }), prompt).toEqual(first);
				}
			}
		});
	});
});
