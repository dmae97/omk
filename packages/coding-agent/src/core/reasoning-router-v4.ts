/**
 * Reasoning-router v4 — confidence-bearing classifier (Goal 009 Wave 1 Lane A,
 * specs/008-reasoning-router-advanced-accuracy Requirement 2).
 *
 * v4 is a NEW, OPT-IN, PURE sibling module. It does not import from, and is not
 * imported by, reasoning-router.ts (v1), reasoning-router-v2.ts,
 * reasoning-router-v3.ts, reasoning-router-weights.ts, or agent-session.ts.
 * Activating v4 in the product (a `/think auto-v4` mode, settings wiring, etc.)
 * is explicitly out of scope for this lane and is left to a later,
 * single-writer integration lane (specs/008 plan.md Wave 3).
 *
 * Deterministic by construction: same (input, weights) -> same
 * ClassifierVerdictV4; same (verdict, availableLevels, laneType, bias, hint) ->
 * same ThinkingLevel. No clock, randomness, I/O, model calls, network access,
 * or state mutation anywhere in this file (ThinkingLevel is a type-only import
 * and is erased).
 *
 * ============================================================================
 * WHAT'S NEW VS v3 (reasoning-router-v3.ts)
 * ============================================================================
 * 1. VERDICT, NOT JUST A CLASS. `classifyTaskV4` returns a `ClassifierVerdictV4`
 *    carrying the full per-class score map, the runner-up class, the margin,
 *    a normalized confidence ratio, a confidence band, a `tieBreak` flag (the
 *    top class won only via precedence order over an exact score tie), a
 *    `fallbackReason` (non-null exactly when the zero-score cascade decided
 *    the class instead of a real signal), and `suppressedFeatureIds` (an
 *    audit trail of which whole-prompt signals were nulled by bounded
 *    negation). None of this carries prompt text — every field is a bounded
 *    enum, number, boolean, or a closed set of short diagnostic-id strings.
 * 2. WEIGHTS TABLE, NOT LITERALS. Every score bump v3 hard-coded as an inline
 *    integer now reads from a `RouterWeightsV4` (see
 *    reasoning-router-v4-weights.ts). `DEFAULT_WEIGHTS_V4` reproduces v3's
 *    literals exactly, so classifyTaskV4(input, DEFAULT_WEIGHTS_V4).taskClass
 *    matches classifyTaskV3(input) on the full non-holdout GOLD_SET and every
 *    focused v3 sentinel (see the 013 regression test and this lane's
 *    evidence file). Passing a different `RouterWeightsV4` recalibrates
 *    without touching this file.
 * 3. BOUNDED NEGATION. Every whole-prompt keyword/contextual pattern scan
 *    (the ones v3 ran as a bare `PATTERN.test(prompt)`) is now negation-aware:
 *    a match is only counted if no negation cue (don't/doesn't/isn't/never/
 *    avoid/skip/without/instead of/rather than/no need to|for/not a/...) appears within
 *    `weights.negationWindowChars` characters immediately before it, and the
 *    scan never crosses a `.,;!?` clause boundary. Patterns anchored to the
 *    START of the leading clause (hasLeadingDebugAction, hasLeadingReviewIntent,
 *    etc.) are untouched and need no negation handling: "don't refactor" can
 *    never match an anchored `^refactor` test in the first place. Concrete
 *    fix: "don't refactor this, just fix the crash" now classifies as debug
 *    (v3 misclassifies this as refactor; see the 013 test).
 * 4. BOUNDED COMPOUND INTENT. A short-range conjunction split (bare "then",
 *    "and then", "and also", or ";", only within the first 300 characters)
 *    looks for a second, distinct leading-verb intent after the split point.
 *    When found and distinct from the primary leading intent, it contributes
 *    a bounded `secondClauseIntent` bump and sets `compoundIntent: true` on
 *    the verdict. This is proven inert on every current GOLD_SET row (no
 *    gold-set prompt produces a non-null, distinct second-clause intent), so
 *    it never changes an existing classification under DEFAULT_WEIGHTS_V4 —
 *    it only sharpens confidence/margin metadata for genuinely compound
 *    prompts and gives future calibration a lever.
 * 5. CONFIDENCE NEVER LOWERS EFFORT. `resolveThinkingLevelV4WithUncertainty`
 *    computes the exact same base target as v2/v3's resolvers (rule table +
 *    lane step + bias + hint), then ONLY ADDS a bounded escalation step when
 *    confidence is low or the class came from the fallback cascade. A prompt
 *    like "don't think hard, just fix the crash" cannot use its own text to
 *    talk the resolver down: the escalation term is strictly non-negative, so
 *    the output is always >= what the same taskClass would resolve to via
 *    `resolveThinkingLevelV4ForAuto` (mirrors spec 008 Req 2 acceptance
 *    criterion "confidence cannot lower effort").
 * ============================================================================
 */

import type { ThinkingLevel } from "omk-agent-core";
import {
	DEFAULT_WEIGHTS_V4,
	type ReasoningLaneTypeV4,
	type RouterWeightsV4,
	TASK_CLASSES_V4,
	type TaskClassV4,
} from "./reasoning-router-v4-weights.ts";

export type { ReasoningLaneTypeV4, RouterWeightsV4, TaskClassV4 } from "./reasoning-router-v4-weights.ts";
export { DEFAULT_WEIGHTS_V4, TASK_CLASSES_V4 } from "./reasoning-router-v4-weights.ts";

/** Prompts shorter than this (trimmed) fall back to trivial when no real signal scores > 0. */
const TRIVIAL_MAX_CHARS_V4 = 40;
/** Prompts at/above this length with no real signal fall back to plan (long prose brief). */
const COMPLEX_PROSE_MIN_CHARS_V4 = 2400;
/** Plan-brief prompts at/above this length count as a "long brief" even without PLAN_BRIEF_PATTERN. */
const LONG_BRIEF_MIN_CHARS_V4 = 512;
/** Compound-clause split only applies within this many leading characters (short direct commands, not long prose). */
const COMPOUND_SPLIT_MAX_INDEX_V4 = 300;
/** Minimum trimmed length of a candidate second clause to be worth checking for a leading intent. */
const COMPOUND_SECOND_CLAUSE_MIN_CHARS_V4 = 3;
/** Bounded look-ahead cap when checking a second clause's leading intent (defense in depth; independent of regex cost). */
const COMPOUND_SECOND_CLAUSE_SCAN_CHARS_V4 = 200;

/** Lane fallback class, used only when every scored class is <= 0 (zero-score cascade). Identical to v1/v2/v3. */
const LANE_FALLBACK_CLASS_V4: Readonly<Record<ReasoningLaneTypeV4, TaskClassV4>> = {
	planner: "plan",
	security: "review",
	explorer: "review",
	coder: "code-gen",
	reviewer: "review",
	tester: "code-gen",
};

// ============================================================================
// Whole-prompt / leading-clause patterns (copied verbatim from
// reasoning-router-v3.ts; identical regex source so DEFAULT_WEIGHTS_V4
// reproduces v3 exactly whenever no negation cue is present).
// ============================================================================

const LOCAL_EDIT_OBJECT_PATTERN =
	/\b(spelling|grammar|capitalization|date\s+format|author\s+e-?mail|copyright\s+year|headline|title|tooltip|placeholder|punctuation|comma|period|semicolon|closing\s+html\s+tag|closing\s+tag|double\s+space|whitespace|indentation|table\s+alignment|typos?|one-?liner?|single\s+line|sentence|stray|trailing)\b|오타|맞춤법|띄어쓰기|문구|제목/i;
const LOCAL_EDIT_ACTION_OBJECT_PATTERN =
	/\b(update|change|swap|remove|correct|fix|add|adjust|trim)\s+(?:the\s+|a\s+|an\s+)?(?:missing\s+|stray\s+|author\s+|two\s+)?(?:e-?mail|comma|period|semicolon|tag|word|words|headline|title|copyright|spelling|grammar)\b/i;
const IMPLEMENTATION_OBJECT_PATTERN =
	/\b(error\s+handling|input\s+validation|validation|auth(?:entication)?|retry|endpoint|migration|component|function|utility|helper|module|service|database|schema|column|middleware|rate\s+limiter|cache|caching|oauth|jwt|webhook)\b|에러\s*처리|오류\s*처리|입력\s*검증|인증|재시도|엔드포인트|마이그레이션|컴포넌트|함수|유틸|헬퍼|모듈|서비스|데이터베이스|스키마|미들웨어|레이트\s*리미터|캐시|웹훅|기능/i;
const HARD_DIAGNOSTIC_PATTERN =
	/\b(stack\s*trace|traceback|panic|segfault|crash(?:es|ing|ed)?|throws?|fails?|failing|flaky|hangs?|timeout|500|EADDRINUSE|silently\s+fails?)\b|\b(?:TypeError|ReferenceError|RangeError|Error):|크래시|스택\s*트레이스|세그폴트|먹통|멈춰|타임아웃/i;
const BUG_OBJECT_PATTERN =
	/\b(null\s+pointer|null\s+deref|race(?:\s+condition)?|heap(?:\s+overflow)?|use-after-free|memory\s+leak|deadlock|data\s+corruption|stale\s+data|off-by-one|encoding\s+bug|regression\s+(?:was\s+)?introduced|exceptions?|assertion\s+error|bugs?)\b|버그|예외|메모리\s*누수|데드락|무한\s*루프/i;
const NON_DIAGNOSTIC_DEBUG_CONTEXT_PATTERN = /\berror\s+(?:handling|messages?|budgets?)\b|에러\s*처리|오류\s*처리/i;
const GENERIC_DIAGNOSTIC_PATTERN = /\b(errors?|broken|wrong\s+results|rolls?\s+back|rollback)\b/i;
const PLAN_BRIEF_PATTERN =
	/\b(context\s+and\s+constraints|starting\s+state|target\s+state|cross-cutting|deliver:|deliverables?|roadmap|migration\s+wave|top\s+(?:ten\s+)?risks|component\s+diagram|data\s+model|architecture|go\/no-go|phased\s+(?:delivery|rollout)|bounded\s+contexts?|strangler\s+fig|event-driven|quarter-by-quarter|milestone)\b/i;
const OPERATIONAL_RUNBOOK_SIGNAL_PATTERNS: readonly { pattern: RegExp; critical: boolean }[] = [
	{ pattern: /\b(?:commit|commits|committed|committing)\b|커밋/i, critical: false },
	{ pattern: /\b(?:push|pushed|pushing)\b|푸시|푸쉬/i, critical: true },
	{
		pattern: /\b(?:release|releases|tag|version\s+bump|bump\s+(?:the\s+)?version)\b|릴리즈|태그|버전/i,
		critical: true,
	},
	{ pattern: /\bnpm\s+publish\b|\bpublish(?:ing|ed)?\b|퍼블리시|배포/i, critical: true },
	{ pattern: /\b(?:CHANGELOG\.md|changelog|release\s+notes?)\b|채널로그|체인지로그/i, critical: false },
	{ pattern: /\bREADME\.md\b|\breadme\b/i, critical: false },
	{ pattern: /\bci\s*\/\s*cd\b|\bgithub\s+actions?\b|\bworkflow\b|깃허브\s*액션|깃헙\s*액션/i, critical: false },
];
const EXPLICIT_RELEASE_RUNBOOK_PATTERN =
	/\bnpm\s+publish\b|\brelease\b[^\n]{0,80}\bv?\d+\.\d+\.\d+\b|릴리즈[^\n]{0,80}\d+\.\d+\.\d+/i;
const REVIEW_SCOPE_PATTERN =
	/\b(pr|pull\s+request|diff|codebase|strategy|plan|spec|schema|design|api|coverage|security\s+posture|licensing|risks?|edge\s+cases|clarity|consistency|dependencies|third-party|ci\s+pipeline|threat\s+model|retry\s+logic|error\s+handling\s+strategy|error\s+messages?)\b/i;
const REFACTOR_CUE_PATTERN =
	/\b(refactor(?:ing|ed)?|extract|rename|deduplicate|consolidate|modularize|reorganize|simplify|clean\s*up|restructure|split\s+module|move\s+logic|untangle|merge\s+duplicate)\b|리팩토링(?!하지\s*마|하지\s*말)|리팩터링(?!하지\s*마|하지\s*말)|구조\s*개선/i;
const ADD_KEYWORD_PATTERN = /\badd\b/i;
const LOW_RISK_EDIT_ACTION_PATTERN = /^(?:correct|update|swap|remove|reword|tweak|bump|trim)\b/i;

/** Whole-prompt keyword-family patterns (mirrors v3's KEYWORD_PATTERNS_V3; refactor/simple-edit reuse the patterns above). */
const DEBUG_KEYWORD_FAMILY_PATTERN =
	/^(?:debug|investigate\s+why|reproduce|trace\b)|\bfix\s+this\s+(?:traceback|panic|error)\b|디버깅|디버그|재현|원인\s*분석/i;
const REVIEW_KEYWORD_FAMILY_PATTERN =
	/\b(review|critique|assess|inspect|approve|lgtm|double-?check|audit(?!\s+log\b))\b|리뷰|검토|점검/i;
const PLAN_KEYWORD_FAMILY_PATTERN =
	/\b(plan|design|architect|architecture|roadmap|spec(?:ification)?|strategy|decompose|milestones?|write\s+a\s+(?:technical\s+)?spec|create\s+a\s+(?:roadmap|strategy|plan))\b|설계|로드맵|아키텍처|계획\s*세워|기획/i;
const CODE_GEN_KEYWORD_FAMILY_PATTERN =
	/\b(implement|write|create|build|generate|scaffold|prototype)\b|구현|만들어\s*줘|생성|작성|추가해/i;
const KO_SHORT_DEBUG_SIGNAL_PATTERN_V4 =
	/오류|에러|실패|안\s*돼|안\s*됨|깨졌|깨짐|고장|디버깅|디버그|재현|원인\s*(?:분석|파악)?/i;
const KO_SHORT_SIMPLE_EDIT_SIGNAL_PATTERN_V4 = /오타|맞춤법|띄어쓰기|문구|제목/i;
const KO_SHORT_REVIEW_SIGNAL_PATTERN_V4 = /리뷰|검토|점검/i;
const KO_SHORT_PLAN_SIGNAL_PATTERN_V4 = /설계|로드맵|아키텍처|계획\s*세워|기획/i;
const KO_SHORT_REFACTOR_SIGNAL_PATTERN_V4 = /리팩토링|리팩터링|구조\s*개선/i;
const KO_SHORT_CODE_GEN_SIGNAL_PATTERN_V4 =
	/구현|만들|생성|작성|추가|테스트|삭제|지워|지우|제거|고쳐|고치|수정|변경|바꿔|바꾸|옮겨|옮기|넣어/i;

/** Short-range compound-clause conjunction boundary. Only bare/compound "then"/"and also"/";" — never bare "and". */
const COMPOUND_SPLIT_PATTERN = /\band\s+then\b|\bthen\b|\band\s+also\b|;/i;

/**
 * Bounded negation-cue vocabulary (spec 008 plan.md "bounded negation window").
 * Deliberately excludes bare "not" (too broad; verified against the current
 * GOLD_SET that every listed cue here is either absent or occurs AFTER, not
 * before, a tracked keyword — see this lane's evidence file for the audit).
 */
const NEGATION_CUE_PATTERN =
	/\b(?:don't|do\s+not|doesn't|does\s+not|didn't|did\s+not|won't|will\s+not|shouldn't|should\s+not|wouldn't|would\s+not|can't|cannot|isn't|is\s+not|aren't|are\s+not|never|avoid|skip|without|instead\s+of|rather\s+than|no\s+need\s+(?:to|for)|no\s+longer\s+need(?:\s+(?:to|for))?)\b/i;
const DIRECT_NOT_OBJECT_CUE_PATTERN_V4 = /\b(?:not|no)\s+(?:a\s+|an\s+|the\s+)?$/i;
const DOUBLE_NEGATION_RESCUE_PATTERN_V4 =
	/\b(?:don't|do\s+not|doesn't|does\s+not|didn't|did\s+not|won't|will\s+not|shouldn't|should\s+not|wouldn't|would\s+not|can't|cannot)\s+(?:skip|avoid)\s+(?:the\s+|a\s+|an\s+)?$/i;
const DELIBERATIVE_QUESTION_RESCUE_PATTERN_V4 =
	/\b(?:shouldn't|should\s+not|wouldn't|would\s+not|can't|cannot)\s+(?:we|i|you)\s*$/i;
const POSTPOSITIONED_NEGATION_CUE_PATTERN_V4 =
	/^\s*(?:-\s*free\b|(?:is|are|was|were)?\s*(?:not\s+(?:needed|required|desired)|unnecessary|not\s+necessary)|(?:[은는이가을를도만]\s*)?(?:하지\s*(?:마(?:라|세요|십시오)?|말(?:고|아|라)?|않(?:아|는|고|을|게)?)|말고|금지))/i;

/** A closed set of clause-boundary characters; a negation cue never reaches across one of these into a prior clause. */
const CLAUSE_BOUNDARY_CHARS = [".", "!", "?", ";", ","] as const;

function hasCodeFence(text: string): boolean {
	return text.includes("```");
}

/** Identical to v1/v2/v3: explicit hunk headers or `diff --git` count alone; bare +/- only count together. */
function hasDiffMarkers(text: string): boolean {
	if (/^@@[^\n]*@@/m.test(text) || /^diff --git /m.test(text)) return true;
	return /^\+(?!\+)/m.test(text) && /^-(?!-)/m.test(text);
}

/** Identical to v3: first line (after stripping one polite prefix), capped at 180 chars. */
function firstClause(prompt: string): string {
	const firstLine =
		prompt.replace(/^(?:please|pls|can you|could you|would you|help me|i need you to)\s+/i, "").split("\n")[0] ?? "";
	return firstLine.slice(0, 180);
}

// --- Leading-clause intent tests. All are `^`-anchored against the LEADING
// clause text only, so a negation cue at the start ("don't refactor...") can
// never match one of these: none of the alternations include "don't"/"never"/
// etc, so they are negation-immune by construction and are left unchanged
// from v3. ---

function hasLeadingReviewIntent(text: string): boolean {
	return /^(?:review|audit(?!\s+log\b)|critique|inspect|assess|approve|double-?check|lgtm)\b/i.test(text);
}

function hasLeadingPlanIntent(text: string): boolean {
	return /^(?:plan|design|architect|decompose)\b|^(?:write|create)\s+(?:a\s+)?(?:technical\s+)?(?:spec|roadmap|strategy|plan)\b/i.test(
		text,
	);
}

function hasLeadingRefactorIntent(text: string): boolean {
	return /^(?:refactor(?:ing|ed)?|extract|rename|deduplicate|consolidate|modularize|reorganize|simplify|restructure|untangle)\b|^clean\s+up\b|^split\s+(?:the\s+)?module\b|^move\s+logic\b/i.test(
		text,
	);
}

function hasLeadingDebugAction(text: string): boolean {
	return /^(?:debug|investigate\s+why|reproduce|trace\b)|^fix\s+this\s+(?:traceback|panic|error)\b/i.test(text);
}

function hasLeadingCodeGenIntent(text: string): boolean {
	return /^(?:implement|write|create|build|generate|scaffold|prototype|add)\b/i.test(text);
}

function hasLeadingSimpleEditIntent(text: string): boolean {
	return /^(?:correct|update|swap|remove|adjust|fix|add|change|trim|reword|tweak|bump)\b/i.test(text);
}

// ============================================================================
// Bounded negation gating
// ============================================================================

interface UnnegatedMatchResultV4 {
	/** True when the pattern matched at least once and at least one occurrence was NOT preceded by a negation cue. */
	readonly matched: boolean;
	/** True when the pattern matched at least once but EVERY occurrence was negated (useful for suppressedFeatureIds). */
	readonly suppressed: boolean;
}

const NO_MATCH_RESULT_V4: UnnegatedMatchResultV4 = { matched: false, suppressed: false };

function matchOperationalRunbookV4(prompt: string, windowChars: number): UnnegatedMatchResultV4 {
	let distinctSignals = 0;
	let criticalSignals = 0;
	let sawSuppressed = false;
	for (const { pattern, critical } of OPERATIONAL_RUNBOOK_SIGNAL_PATTERNS) {
		const result = matchUnnegated(prompt, pattern, windowChars);
		if (result.matched) {
			distinctSignals += 1;
			if (critical) criticalSignals += 1;
		}
		if (result.suppressed) sawSuppressed = true;
	}
	const explicitRelease = matchUnnegated(prompt, EXPLICIT_RELEASE_RUNBOOK_PATTERN, windowChars).matched;
	const matched = explicitRelease || distinctSignals >= 3 || (criticalSignals >= 2 && distinctSignals >= 2);
	return { matched, suppressed: !matched && sawSuppressed };
}

/**
 * Negation-aware replacement for v3's bare `pattern.test(prompt)`. Finds every
 * occurrence of `pattern` in `prompt`; for each, looks back up to
 * `windowChars` characters (never crossing a `.,;!?` boundary into a prior
 * clause) for a `NEGATION_CUE_PATTERN` hit, and looks forward inside the same
 * bounded window for Hangul-only post-positioned negation cues such as
 * "하지 말고". `matched` is true iff at least one occurrence survives
 * un-negated. Deterministic, single pass per pattern, no shared regex state (a
 * fresh global-flag RegExp is constructed per call).
 */
function hasPrePositionedNegationCueV4(scoped: string): boolean {
	if (!NEGATION_CUE_PATTERN.test(scoped) && !DIRECT_NOT_OBJECT_CUE_PATTERN_V4.test(scoped)) return false;
	return !DOUBLE_NEGATION_RESCUE_PATTERN_V4.test(scoped) && !DELIBERATIVE_QUESTION_RESCUE_PATTERN_V4.test(scoped);
}

function hasPostPositionedNegationCueV4(prompt: string, matchEnd: number, windowChars: number): boolean {
	const scoped = prompt.slice(matchEnd, Math.min(prompt.length, matchEnd + windowChars));
	return POSTPOSITIONED_NEGATION_CUE_PATTERN_V4.test(scoped);
}

function matchUnnegated(prompt: string, pattern: RegExp, windowChars: number): UnnegatedMatchResultV4 {
	const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
	const globalPattern = new RegExp(pattern.source, flags);
	let sawMatch = false;
	let sawUnnegated = false;
	let match = globalPattern.exec(prompt);
	while (match !== null) {
		sawMatch = true;
		const matchStart = match.index;
		const windowStart = Math.max(0, matchStart - windowChars);
		const windowText = prompt.slice(windowStart, matchStart);
		let boundary = -1;
		for (const boundaryChar of CLAUSE_BOUNDARY_CHARS) {
			const idx = windowText.lastIndexOf(boundaryChar);
			if (idx > boundary) boundary = idx;
		}
		const scoped = boundary >= 0 ? windowText.slice(boundary + 1) : windowText;
		const preNegated = hasPrePositionedNegationCueV4(scoped);
		const postNegated =
			!preNegated && hasPostPositionedNegationCueV4(prompt, matchStart + match[0].length, windowChars);
		if (!preNegated && !postNegated) sawUnnegated = true;
		if (match[0].length === 0) globalPattern.lastIndex += 1;
		match = globalPattern.exec(prompt);
	}
	return { matched: sawUnnegated, suppressed: sawMatch && !sawUnnegated };
}

// ============================================================================
// Bounded compound-intent detection
// ============================================================================

/**
 * Splits off a bounded second clause after a short-range conjunction
 * ("then"/"and then"/"and also"/";"), only when the split point is within the
 * first `COMPOUND_SPLIT_MAX_INDEX_V4` characters (short direct commands, not
 * long prose briefs — verified this never fires inside the GOLD_SET's
 * >=2400-char plan entries). Returns null when no qualifying split exists.
 */
function splitCompoundClauseV4(prompt: string): string | null {
	const match = COMPOUND_SPLIT_PATTERN.exec(prompt);
	if (match === null || match.index > COMPOUND_SPLIT_MAX_INDEX_V4) return null;
	const second = prompt.slice(match.index + match[0].length).trim();
	if (second.length < COMPOUND_SECOND_CLAUSE_MIN_CHARS_V4) return null;
	return second;
}

/**
 * Leading-intent test for a compound prompt's SECOND clause. Reuses the same
 * `^`-anchored leading-intent tests as the primary clause (so it is equally
 * negation-immune), without the primary clause's diagnosticEvidence/localEdit
 * gating (a short second-clause fragment carries no such context of its own).
 */
function secondClauseLeadingIntentV4(clause: string): TaskClassV4 | null {
	const bounded = clause.slice(0, COMPOUND_SECOND_CLAUSE_SCAN_CHARS_V4);
	return leadingIntentFromLeadingClauseV4(bounded);
}

function leadingIntentFromLeadingClauseV4(leading: string): TaskClassV4 | null {
	if (hasLeadingDebugAction(leading)) return "debug";
	if (hasLeadingReviewIntent(leading)) return "review";
	if (hasLeadingPlanIntent(leading)) return "plan";
	if (hasLeadingRefactorIntent(leading)) return "refactor";
	if (hasLeadingSimpleEditIntent(leading)) return "simple-edit";
	if (hasLeadingCodeGenIntent(leading)) return "code-gen";
	return null;
}

function leadingIntentIsPostNegatedV4(leading: string, windowChars: number): boolean {
	const leadingIntentMatch =
		/^(?:debug|investigate\s+why|reproduce|trace\b|fix\s+this\s+(?:traceback|panic|error)|review|audit(?!\s+log\b)|critique|inspect|assess|approve|double-?check|lgtm|plan|design|architect|decompose|write\s+(?:a\s+)?(?:technical\s+)?(?:spec|roadmap|strategy|plan)|create\s+(?:a\s+)?(?:technical\s+)?(?:spec|roadmap|strategy|plan)|refactor(?:ing|ed)?|extract|rename|deduplicate|consolidate|modularize|reorganize|simplify|restructure|untangle|clean\s+up|split\s+(?:the\s+)?module|move\s+logic|correct|update|swap|remove|adjust|fix|add|change|trim|reword|tweak|bump|implement|build|generate|scaffold|prototype)\b/i.exec(
			leading,
		);
	return (
		leadingIntentMatch !== null && hasPostPositionedNegationCueV4(leading, leadingIntentMatch[0].length, windowChars)
	);
}

function classifyShortKoreanZeroScoreTaskV4(prompt: string, windowChars: number): TaskClassV4 | null {
	if (matchUnnegated(prompt, KO_SHORT_DEBUG_SIGNAL_PATTERN_V4, windowChars).matched) return "debug";
	if (matchUnnegated(prompt, KO_SHORT_SIMPLE_EDIT_SIGNAL_PATTERN_V4, windowChars).matched) return "simple-edit";
	if (matchUnnegated(prompt, KO_SHORT_REVIEW_SIGNAL_PATTERN_V4, windowChars).matched) return "review";
	if (matchUnnegated(prompt, KO_SHORT_PLAN_SIGNAL_PATTERN_V4, windowChars).matched) return "plan";
	if (matchUnnegated(prompt, KO_SHORT_REFACTOR_SIGNAL_PATTERN_V4, windowChars).matched) return "refactor";
	if (matchUnnegated(prompt, KO_SHORT_CODE_GEN_SIGNAL_PATTERN_V4, windowChars).matched) return "code-gen";
	return null;
}

// ============================================================================
// Feature extraction
// ============================================================================

interface ContextualFeaturesV4 {
	readonly firstClause: string;
	readonly codeFence: boolean;
	readonly diffHunk: boolean;
	readonly localEdit: boolean;
	readonly diagnosticEvidence: boolean;
	readonly reviewScope: boolean;
	readonly planBrief: boolean;
	readonly operationalRunbook: boolean;
	readonly refactorCue: boolean;
	readonly implementationObject: boolean;
	readonly leadingIntent: TaskClassV4 | null;
	readonly secondClauseIntent: TaskClassV4 | null;
	readonly compoundIntent: boolean;
	readonly keywordFamilyMatch: Readonly<Record<TaskClassV4, boolean>>;
	readonly addKeywordMatch: boolean;
}

interface LeadingIntentInputV4 {
	readonly firstClause: string;
	readonly localEdit: boolean;
	readonly diagnosticEvidence: boolean;
}

/** Identical decision order to v3's `leadingIntent`. */
function leadingIntentV4(input: LeadingIntentInputV4): TaskClassV4 | null {
	if (
		input.diagnosticEvidence &&
		(hasLeadingDebugAction(input.firstClause) || hasLeadingSimpleEditIntent(input.firstClause))
	)
		return "debug";
	if (hasLeadingReviewIntent(input.firstClause)) return "review";
	if (hasLeadingPlanIntent(input.firstClause)) return "plan";
	if (hasLeadingRefactorIntent(input.firstClause)) return "refactor";
	if (input.localEdit && hasLeadingSimpleEditIntent(input.firstClause)) return "simple-edit";
	if (!input.localEdit && hasLeadingCodeGenIntent(input.firstClause)) return "code-gen";
	return null;
}

/** Identical decision structure to v3's `hasDiagnosticEvidence`, parameterized over precomputed negation-aware matches. */
function hasDiagnosticEvidenceV4(
	leading: string,
	hardDiagnosticMatched: boolean,
	bugObjectMatched: boolean,
	genericDiagnosticMatched: boolean,
	nonDiagnosticContext: boolean,
): boolean {
	if (hasLeadingDebugAction(leading) || hardDiagnosticMatched) return true;
	const hasContextualDiagnostic = bugObjectMatched || (genericDiagnosticMatched && !nonDiagnosticContext);
	if (!hasContextualDiagnostic) return false;
	return !hasLeadingReviewIntent(leading) && !hasLeadingPlanIntent(leading) && !hasLeadingRefactorIntent(leading);
}

/**
 * Extracts every v4 feature from one prompt, negation-gating every
 * whole-prompt scan exactly once and recording a `negation:<channel>` id in
 * `suppressed` whenever a match existed but every occurrence was negated.
 */
function extractFeaturesV4(prompt: string, weights: RouterWeightsV4, suppressed: string[]): ContextualFeaturesV4 {
	const leading = firstClause(prompt);
	const window = weights.negationWindowChars;

	const implementationObjectResult = matchUnnegated(prompt, IMPLEMENTATION_OBJECT_PATTERN, window);
	if (implementationObjectResult.suppressed) suppressed.push("negation:implementation-object");
	const implementationObject = implementationObjectResult.matched;

	const lowRiskEditAction = LOW_RISK_EDIT_ACTION_PATTERN.test(leading);
	const localEditObjectResult = matchUnnegated(prompt, LOCAL_EDIT_OBJECT_PATTERN, window);
	if (localEditObjectResult.suppressed) suppressed.push("negation:local-edit-object");
	const localEditActionResult = matchUnnegated(prompt, LOCAL_EDIT_ACTION_OBJECT_PATTERN, window);
	if (localEditActionResult.suppressed) suppressed.push("negation:local-edit-action-object");
	const localEdit =
		!implementationObject && (lowRiskEditAction || localEditObjectResult.matched || localEditActionResult.matched);

	const hardDiagnosticResult = matchUnnegated(prompt, HARD_DIAGNOSTIC_PATTERN, window);
	if (hardDiagnosticResult.suppressed) suppressed.push("negation:hard-diagnostic");
	const bugObjectResult = matchUnnegated(prompt, BUG_OBJECT_PATTERN, window);
	if (bugObjectResult.suppressed) suppressed.push("negation:bug-object");
	const genericDiagnosticResult = matchUnnegated(prompt, GENERIC_DIAGNOSTIC_PATTERN, window);
	const nonDiagnosticContext = NON_DIAGNOSTIC_DEBUG_CONTEXT_PATTERN.test(prompt);
	if (genericDiagnosticResult.suppressed && !nonDiagnosticContext) suppressed.push("negation:generic-diagnostic");
	const diagnosticEvidence = hasDiagnosticEvidenceV4(
		leading,
		hardDiagnosticResult.matched,
		bugObjectResult.matched,
		genericDiagnosticResult.matched,
		nonDiagnosticContext,
	);

	const reviewScopeResult = matchUnnegated(prompt, REVIEW_SCOPE_PATTERN, window);
	if (reviewScopeResult.suppressed) suppressed.push("negation:review-scope");
	const reviewScope = hasLeadingReviewIntent(leading) && reviewScopeResult.matched;

	const planBriefResult = matchUnnegated(prompt, PLAN_BRIEF_PATTERN, window);
	if (planBriefResult.suppressed) suppressed.push("negation:plan-brief");
	const planBrief =
		hasLeadingPlanIntent(leading) && (planBriefResult.matched || prompt.length >= LONG_BRIEF_MIN_CHARS_V4);

	const operationalRunbookResult = matchOperationalRunbookV4(prompt, window);
	if (operationalRunbookResult.suppressed) suppressed.push("negation:operational-runbook");
	const operationalRunbook = operationalRunbookResult.matched;

	const refactorCueResult = matchUnnegated(prompt, REFACTOR_CUE_PATTERN, window);
	if (refactorCueResult.suppressed) suppressed.push("negation:refactor-cue");
	const refactorCue = refactorCueResult.matched;

	const rawPrimaryIntent = leadingIntentV4({ firstClause: leading, localEdit, diagnosticEvidence });
	const primaryIntent =
		rawPrimaryIntent !== null && leadingIntentIsPostNegatedV4(leading, window) ? null : rawPrimaryIntent;

	const secondClauseText = splitCompoundClauseV4(prompt);
	const secondClauseIntent = secondClauseText === null ? null : secondClauseLeadingIntentV4(secondClauseText);
	const compoundIntent = secondClauseIntent !== null && secondClauseIntent !== primaryIntent;

	const debugKeywordResult = diagnosticEvidence
		? matchUnnegated(prompt, DEBUG_KEYWORD_FAMILY_PATTERN, window)
		: NO_MATCH_RESULT_V4;
	if (debugKeywordResult.suppressed) suppressed.push("negation:keyword-debug");

	const reviewKeywordResult = matchUnnegated(prompt, REVIEW_KEYWORD_FAMILY_PATTERN, window);
	if (reviewKeywordResult.suppressed) suppressed.push("negation:keyword-review");

	const planKeywordResult = matchUnnegated(prompt, PLAN_KEYWORD_FAMILY_PATTERN, window);
	if (planKeywordResult.suppressed) suppressed.push("negation:keyword-plan");

	const codeGenKeywordResult = matchUnnegated(prompt, CODE_GEN_KEYWORD_FAMILY_PATTERN, window);
	if (codeGenKeywordResult.suppressed) suppressed.push("negation:keyword-code-gen");

	const addKeywordResult = localEdit ? NO_MATCH_RESULT_V4 : matchUnnegated(prompt, ADD_KEYWORD_PATTERN, window);
	if (addKeywordResult.suppressed) suppressed.push("negation:add-keyword");

	return {
		firstClause: leading,
		codeFence: hasCodeFence(prompt),
		diffHunk: hasDiffMarkers(prompt),
		localEdit,
		diagnosticEvidence,
		reviewScope,
		planBrief,
		operationalRunbook,
		refactorCue,
		implementationObject,
		leadingIntent: primaryIntent,
		secondClauseIntent,
		compoundIntent,
		keywordFamilyMatch: {
			trivial: false,
			debug: debugKeywordResult.matched,
			refactor: refactorCue,
			review: reviewKeywordResult.matched,
			plan: planKeywordResult.matched,
			"simple-edit": localEditObjectResult.matched,
			"code-gen": codeGenKeywordResult.matched,
		},
		addKeywordMatch: addKeywordResult.matched,
	};
}

// ============================================================================
// Scoring
// ============================================================================

function emptyScoresV4(): Record<TaskClassV4, number> {
	return {
		trivial: 0,
		"simple-edit": 0,
		"code-gen": 0,
		debug: 0,
		refactor: 0,
		review: 0,
		plan: 0,
	};
}

function computeScoresV4(features: ContextualFeaturesV4, weights: RouterWeightsV4): Record<TaskClassV4, number> {
	const scores = emptyScoresV4();
	if (features.codeFence || features.diffHunk) scores["code-gen"] += weights.codeFenceOrDiff;
	if (features.leadingIntent !== null) scores[features.leadingIntent] += weights.leadingIntent;
	if (features.secondClauseIntent !== null) scores[features.secondClauseIntent] += weights.secondClauseIntent;
	if (features.localEdit) scores["simple-edit"] += weights.localEdit;
	if (features.diagnosticEvidence) scores.debug += weights.diagnosticEvidence;
	if (features.reviewScope) scores.review += weights.reviewScope;
	if (features.planBrief) scores.plan += weights.planBrief;
	if (features.operationalRunbook) scores.plan += weights.operationalRunbook;
	if (features.refactorCue) scores.refactor += weights.refactorCue;
	if (features.implementationObject) scores["code-gen"] += weights.implementationObject;

	for (const taskClass of TASK_CLASSES_V4) {
		if (features.keywordFamilyMatch[taskClass]) scores[taskClass] += weights.keywordFamily[taskClass];
	}
	if (features.addKeywordMatch) scores["code-gen"] += weights.addKeyword;

	return scores;
}

/**
 * Extension signals (history / context-pressure / judge vote). Every
 * coefficient is 0 under DEFAULT_WEIGHTS_V4 (inert until calibrated by a
 * future governance-backed lane); the mechanism exists so
 * `TaskClassifierInputV4`'s optional fields are meaningfully wired rather than
 * silently accepted-and-ignored (as they are in v3's identical-shaped input).
 */
function applyExtensionSignalsV4(
	scores: Record<TaskClassV4, number>,
	input: TaskClassifierInputV4,
	weights: RouterWeightsV4,
): void {
	const priorClass = input.history !== undefined && input.history.length > 0 ? input.history[0] : null;
	if (priorClass !== null && weights.multiTurnPrior !== 0) scores[priorClass] += weights.multiTurnPrior;

	const judgeVote = input.judgeVote ?? null;
	if (judgeVote !== null && weights.judgeVote !== 0) scores[judgeVote] += weights.judgeVote;

	const pressureBucket = input.pressureBucket ?? 0;
	if (pressureBucket > 0 && weights.pressureBucket !== 0) {
		const bump = pressureBucket * weights.pressureBucket;
		scores.debug += bump;
		scores.review += bump;
		scores.plan += bump;
	}
}

// ============================================================================
// Public types
// ============================================================================

/**
 * Caller-supplied turn input. Identical shape to `TaskClassifierInputV3` /
 * `TaskClassifierInputV2` (prompt + optional lane/history/pressure/judge
 * slots), so existing callers can switch versions without reshaping data.
 */
export interface TaskClassifierInputV4 {
	prompt: string;
	laneType?: ReasoningLaneTypeV4;
	history?: readonly TaskClassV4[];
	pressureBucket?: number;
	judgeVote?: TaskClassV4 | null;
}

/** Confidence band derived from `margin / topScore`, bucketed by `weights.lowConfidenceThreshold`/`highConfidenceThreshold`. */
export type ConfidenceBandV4 = "low" | "medium" | "high";

/** Which branch of the zero-score fallback cascade decided `taskClass`; null when a real weighted signal decided it. */
export type FallbackReasonV4 =
	| "code-fence-or-diff"
	| "trivial-length"
	| "ko-short-task-signal"
	| "long-prose"
	| "lane-fallback"
	| "default";

/**
 * The full, privacy-safe classification verdict (spec 008 Req 2). Every field
 * is a bounded enum, number, boolean, or a closed set of short diagnostic-id
 * strings (`suppressedFeatureIds`) — never raw prompt text, so this value is
 * safe to pass to evaluation, learning, and Adaptorch-advisory code.
 */
export interface ClassifierVerdictV4 {
	/** The decided task class (post zero-score-cascade if one fired). */
	readonly taskClass: TaskClassV4;
	/** Raw per-class score map from the weighted signals (pre-cascade; audit-only). */
	readonly scores: Readonly<Record<TaskClassV4, number>>;
	/** Second-highest-scoring class by the argmax, or null if every other class tied at the bottom. */
	readonly runnerUp: TaskClassV4 | null;
	/** `scores[argmaxClass] - scores[runnerUp]` (pre-cascade); 0 or negative-margin-free by construction (weights are non-negative). */
	readonly margin: number;
	/** Normalized confidence in [0, 1]: `margin / topScore`, or 0 when `topScore <= 0` (fallback cascade fired). */
	readonly confidence: number;
	/** Confidence bucketed by `weights.lowConfidenceThreshold` / `highConfidenceThreshold`. */
	readonly confidenceBand: ConfidenceBandV4;
	/** True when the argmax class won only via precedence-order tie-break over an exact score tie with the runner-up. */
	readonly tieBreak: boolean;
	/** Non-null exactly when the zero-score cascade (not a real weighted signal) decided `taskClass`. */
	readonly fallbackReason: FallbackReasonV4 | null;
	/** Audit trail of `negation:<channel>` ids for every whole-prompt signal that had a match but was fully negated. */
	readonly suppressedFeatureIds: readonly string[];
	/** True when a distinct second-clause leading intent was detected (bounded compound-intent detection). */
	readonly compoundIntent: boolean;
	/** The second clause's own leading intent, or null when no compound structure (or no distinct intent) was found. */
	readonly secondClauseIntent: TaskClassV4 | null;
}

// ============================================================================
// Classifier
// ============================================================================

/**
 * Deterministic confidence-bearing classifier (spec 008 Req 2).
 *
 * Pipeline: extract negation/compound-aware contextual features -> score every
 * class from `weights` -> argmax with `TASK_CLASSES_V4` precedence tie-break,
 * tracking the runner-up -> compute margin/confidence/confidenceBand/tieBreak
 * from the RAW scores -> if `topScore <= 0`, replace `taskClass` (and record
 * `fallbackReason`) via the same zero-score cascade v1/v2/v3 use (fence/diff
 * -> code-gen; length < 40 -> trivial; length >= 2400 -> plan; lane fallback;
 * default code-gen) — the raw scores/margin/runnerUp/tieBreak fields still
 * reflect the pre-cascade computation, for audit purposes.
 *
 * Pure: same (input, weights) -> same ClassifierVerdictV4.
 */
export function classifyTaskV4(
	input: TaskClassifierInputV4,
	weights: RouterWeightsV4 = DEFAULT_WEIGHTS_V4,
): ClassifierVerdictV4 {
	const prompt = input.prompt.trim();
	const suppressed: string[] = [];
	const features = extractFeaturesV4(prompt, weights, suppressed);
	const scores = computeScoresV4(features, weights);
	applyExtensionSignalsV4(scores, input, weights);

	let top: TaskClassV4 = TASK_CLASSES_V4[0];
	for (const c of TASK_CLASSES_V4) {
		if (scores[c] > scores[top]) top = c;
	}
	let runnerUp: TaskClassV4 | null = null;
	for (const c of TASK_CLASSES_V4) {
		if (c === top) continue;
		if (runnerUp === null || scores[c] > scores[runnerUp]) runnerUp = c;
	}

	const topScore = scores[top];
	const runnerUpScore = runnerUp !== null ? scores[runnerUp] : 0;
	const margin = topScore - runnerUpScore;
	const tieBreak = runnerUp !== null && topScore === runnerUpScore;
	const confidence = topScore <= 0 ? 0 : Math.max(0, Math.min(1, margin / topScore));
	const confidenceBand: ConfidenceBandV4 =
		confidence <= weights.lowConfidenceThreshold
			? "low"
			: confidence >= weights.highConfidenceThreshold
				? "high"
				: "medium";

	let taskClass: TaskClassV4 = top;
	let fallbackReason: FallbackReasonV4 | null = null;
	if (topScore <= 0) {
		if (features.codeFence || features.diffHunk) {
			taskClass = "code-gen";
			fallbackReason = "code-fence-or-diff";
		} else if (prompt.length < TRIVIAL_MAX_CHARS_V4) {
			const shortKoreanTaskClass = classifyShortKoreanZeroScoreTaskV4(prompt, weights.negationWindowChars);
			if (shortKoreanTaskClass !== null) {
				taskClass = shortKoreanTaskClass;
				fallbackReason = "ko-short-task-signal";
			} else {
				taskClass = "trivial";
				fallbackReason = "trivial-length";
			}
		} else if (prompt.length >= COMPLEX_PROSE_MIN_CHARS_V4) {
			taskClass = "plan";
			fallbackReason = "long-prose";
		} else if (input.laneType !== undefined) {
			taskClass = LANE_FALLBACK_CLASS_V4[input.laneType];
			fallbackReason = "lane-fallback";
		} else {
			taskClass = "code-gen";
			fallbackReason = "default";
		}
	}

	return {
		taskClass,
		scores,
		runnerUp,
		margin,
		confidence,
		confidenceBand,
		tieBreak,
		fallbackReason,
		suppressedFeatureIds: suppressed,
		compoundIntent: features.compoundIntent,
		secondClauseIntent: features.secondClauseIntent,
	};
}

// ============================================================================
// Resolver
// ============================================================================

/** Reasoning ladder used for targets and clamping. Intentionally excludes "off". Identical to v1/v2/v3. */
const REASONING_LADDER_V4: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** Static rule table: task class -> recommended ThinkingLevel. Identical to v1/v2/v3. */
export const TASK_CLASS_THINKING_LEVELS_V4: Readonly<Record<TaskClassV4, ThinkingLevel>> = {
	trivial: "minimal",
	"simple-edit": "low",
	"code-gen": "medium",
	debug: "high",
	refactor: "high",
	review: "high",
	plan: "xhigh",
};

/** Lane ladder adjustment. Identical to v1/v2/v3: planner/security escalate one step, explorer de-escalates. */
const LANE_STEP_V4: Readonly<Partial<Record<ReasoningLaneTypeV4, 1 | -1>>> = {
	planner: 1,
	security: 1,
	explorer: -1,
};

/** Maximum magnitude of the learning/consult bias (ladder steps). Identical bound to v2/v3. */
const BIAS_MAX_V4 = 2;
/** Confidence floor at which an override hint is fused into the target. Identical to v2/v3. */
const HINT_CONFIDENCE_THRESHOLD_V4 = 0.7;
/**
 * Bounded, strictly non-negative escalation applied when the verdict's own
 * confidence is low or a fallback (not a real signal) decided the class. This
 * is the ONLY place confidence touches the target index, and it can only add:
 * confidence can never lower effort (spec 008 Req 2 acceptance criterion).
 */
const LOW_CONFIDENCE_ESCALATION_STEPS_V4 = 1;

function clampToLadderIndexV4(index: number): number {
	return Math.max(0, Math.min(index, REASONING_LADDER_V4.length - 1));
}

function clampToAvailableV4(targetIndex: number, availableLevels: readonly ThinkingLevel[]): ThinkingLevel {
	const availableOnLadder = REASONING_LADDER_V4.filter((level) => availableLevels.includes(level));
	if (availableOnLadder.length === 0) return availableLevels[0] ?? "off";
	for (let i = targetIndex; i >= 0; i--) {
		const candidate = REASONING_LADDER_V4[i];
		if (availableOnLadder.includes(candidate)) return candidate;
	}
	return availableOnLadder[0];
}

/**
 * Thin auto-mode wrapper with no uncertainty adjustment: base rule table ->
 * lane step -> clamp to availableLevels. Equivalent to
 * `resolveThinkingLevelV3ForAuto` / `resolveThinkingLevelV2ForAuto` for the
 * same (taskClass, availableLevels, laneType) — i.e. v4's "confident" path.
 */
export function resolveThinkingLevelV4ForAuto(
	taskClass: TaskClassV4,
	availableLevels: readonly ThinkingLevel[],
	laneType: ReasoningLaneTypeV4 | undefined,
): ThinkingLevel {
	const baseIndex = REASONING_LADDER_V4.indexOf(TASK_CLASS_THINKING_LEVELS_V4[taskClass]);
	const laneStep = laneType ? (LANE_STEP_V4[laneType] ?? 0) : 0;
	const targetIndex = clampToLadderIndexV4(baseIndex + laneStep);
	return clampToAvailableV4(targetIndex, availableLevels);
}

/**
 * Uncertainty-aware resolver (spec 008 Req 2 / plan.md step 5).
 *
 * Pipeline: base rule table for `verdict.taskClass` -> lane step -> bounded
 * bias [-2,+2] -> optional hint fusion (±2 bounded, same as v2/v3) -> bounded
 * non-negative confidence escalation (+1 ladder step exactly when
 * `verdict.confidenceBand === "low"` or `verdict.fallbackReason !== null`) ->
 * clamp to `availableLevels`.
 *
 * The confidence-escalation term is strictly `>= 0`: low confidence can only
 * hold the base+lane+bias+hint target or push it one step higher, never lower
 * it. This guarantees a low-confidence verdict never resolves BELOW what
 * `resolveThinkingLevelV4ForAuto` would give the same class (with bias=0,
 * hint=null) — text alone cannot talk the resolver down.
 */
export function resolveThinkingLevelV4WithUncertainty(
	verdict: ClassifierVerdictV4,
	availableLevels: readonly ThinkingLevel[],
	laneType: ReasoningLaneTypeV4 | undefined,
	bias = 0,
	hint: { level: ThinkingLevel; confidence: number } | null = null,
): ThinkingLevel {
	const baseIndex = REASONING_LADDER_V4.indexOf(TASK_CLASS_THINKING_LEVELS_V4[verdict.taskClass]);
	const laneStep = laneType ? (LANE_STEP_V4[laneType] ?? 0) : 0;
	const biasClamped = Math.max(-BIAS_MAX_V4, Math.min(BIAS_MAX_V4, bias));
	let targetIndex = clampToLadderIndexV4(baseIndex + laneStep + biasClamped);

	if (hint !== null && hint.confidence >= HINT_CONFIDENCE_THRESHOLD_V4) {
		const hintIndex = REASONING_LADDER_V4.indexOf(hint.level);
		if (hintIndex >= 0) {
			const delta = hintIndex - targetIndex;
			const step = Math.max(-BIAS_MAX_V4, Math.min(BIAS_MAX_V4, delta));
			targetIndex = clampToLadderIndexV4(targetIndex + step);
		}
	}

	if (verdict.confidenceBand === "low" || verdict.fallbackReason !== null) {
		targetIndex = clampToLadderIndexV4(targetIndex + LOW_CONFIDENCE_ESCALATION_STEPS_V4);
	}

	return clampToAvailableV4(targetIndex, availableLevels);
}
