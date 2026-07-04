/**
 * Reasoning-router v2 — pure weighted classifier + resolver (Goal 004, Lane I2/I3).
 *
 * Deterministic by construction: same (input, weights) -> same TaskClassV2, and
 * same (taskClass, availableLevels, laneType, bias, hint) -> same ThinkingLevel.
 * No clock, randomness, or I/O. Erasable TypeScript only (ThinkingLevel is
 * imported type-only and erased).
 *
 * ============================================================================
 * v1-COMPAT BEHAVIOR UNDER DEFAULT_WEIGHTS
 * ============================================================================
 * With DEFAULT_WEIGHTS (frozen in reasoning-router-weights.ts), classifyTaskV2
 * reproduces v1 classifyTask on the full v1 corpus (Goal 004 Req 1.4), with one
 * INTENTIONAL fix family: a lone WEAK-debug trigger ("fix") no longer dominates
 * a stronger class signal. Concretely, "fix the typo" classifies as simple-edit,
 * not debug (Goal 004 Req 1.3 — the v1 regression case). This is achieved by the
 * STRONG/WEAK keyword split below: "fix" lives in WEAK-debug only, and
 * DEFAULT_WEIGHTS weights only the STRONG diagonal, so a STRONG simple-edit hit
 * ("typo") outscores the unweighted WEAK "fix".
 *
 * The zero-score cascade (v1 steps 2-6) runs verbatim whenever every scoreClass
 * term is 0, preserving v1's length/lane/default behavior for signal-free turns.
 * sticky/consult/margin thresholds are 0 in DEFAULT_WEIGHTS and treated as
 * INACTIVE (<= 0), so v1-compat never enters the sticky/consult/judge paths.
 * ============================================================================
 */

import type { ThinkingLevel } from "omk-agent-core";

import {
	type ReasoningLaneTypeV2,
	type RouterFeatures,
	type RouterWeights,
	scoreClass,
	TASK_CLASSES_V2,
	type TaskClassV2,
} from "./reasoning-router-weights.ts";

export type {
	ReasoningLaneTypeV2,
	RouterFeatures,
	RouterWeights,
	TaskClassV2,
} from "./reasoning-router-weights.ts";
export { DEFAULT_WEIGHTS, scoreClass, TASK_CLASSES_V2 } from "./reasoning-router-weights.ts";

/** Prompts shorter than this (trimmed) classify as trivial via the zero-score cascade. */
const TRIVIAL_MAX_CHARS = 40;
/** Prompts at/above this length with no signal are treated as long prose briefs (plan). */
const COMPLEX_PROSE_MIN_CHARS = 2400;
/** Ring-buffer cap for multi-turn history (caller-owned). */
const HISTORY_CAP = 8;

/**
 * STRONG (class-defining) keyword families, derived from v1 KEYWORD_FAMILIES
 * (reasoning-router.ts). Each pattern is the v1 alternation MINUS the ambiguous
 * WEAK tokens that are split out below. Default i (no `g` flag): stateless.
 */
const STRONG_KEYWORDS: ReadonlyArray<{ taskClass: TaskClassV2; pattern: RegExp }> = [
	{
		taskClass: "debug",
		pattern:
			/\b(debug(ging)?|bugs?|errors?|exceptions?|crash(es|ing|ed)?|stack\s*trace|traceback|regressions?|broken|fail(s|ing|ed|ure|ures)?|flaky|reproduce)\b/i,
	},
	{
		taskClass: "refactor",
		pattern:
			/\b(refactor(ing|ed)?|restructur(e|ing)|renam(e|ing)|extract(ing)?|clean\s*up|cleanup|deduplicat(e|ing)|reorganiz(e|ing)|modulariz(e|ing))\b/i,
	},
	{
		taskClass: "review",
		pattern: /\b(review(s|ing|ed)?|audit(s|ing|ed)?|critique|inspect(ing)?)\b/i,
	},
	{
		taskClass: "plan",
		pattern:
			/\b(plan(s|ning)?|design(s|ing)?|architect(s|ure|ing)?|roadmap|spec(s|ification|ifications)?|strateg(y|ies|ize)|decompos(e|ing|ition)|milestones?)\b/i,
	},
	{
		taskClass: "simple-edit",
		pattern:
			/\b(typos?|tweak(s|ing|ed)?|one-?liner?|single\s+line|bump(s|ing|ed)?|whitespace|reword(s|ing|ed)?|indentation|punctuation)\b/i,
	},
	{
		taskClass: "code-gen",
		pattern:
			/\b(implement(s|ing|ation)?|writ(e|ing)|creat(e|es|ing)|build(s|ing)?|generat(e|es|ing)|scaffold(ing)?|prototype)\b/i,
	},
];

/**
 * WEAK (ambiguous) keyword sub-patterns split out of the v1 alternations. Under
 * DEFAULT_WEIGHTS these are INERT (the weight matrix has no WEAK coefficients),
 * so they do not affect v1-compat; they exist for calibrated weight presets.
 * The critical entry is debug "fix": a lone "fix" without a STRONG debug
 * co-trigger no longer wins debug over a stronger sibling-class signal.
 */
const WEAK_KEYWORDS: ReadonlyArray<{ taskClass: TaskClassV2; pattern: RegExp }> = [
	{ taskClass: "debug", pattern: /\bfix(es|ing|ed)?\b/i },
	{ taskClass: "code-gen", pattern: /\badd(s|ing|ed)?\b/i },
	{ taskClass: "refactor", pattern: /\b(simplif(y|ying|ied)|rewrit(e|ing))\b/i },
	{ taskClass: "review", pattern: /\b(assess(ing|ment)?|lgtm|approve)\b/i },
	{ taskClass: "plan", pattern: /\bbreak\s+(this\s+|it\s+)?down\b/i },
];

/** Lane fallback when no keyword/code/diff/length signal decides (mirrors v1). */
const LANE_FALLBACK_CLASS_V2: Record<ReasoningLaneTypeV2, TaskClassV2> = {
	planner: "plan",
	security: "review",
	explorer: "review",
	coder: "code-gen",
	reviewer: "review",
	tester: "code-gen",
};

/**
 * Tie-break / iteration order: v1 precedence (highest first). When two classes
 * tie on score, the one appearing earlier here wins, matching v1's first-match
 * semantics. trivial is last (it carries no keyword weight under any preset).
 */
const PRECEDENCE_ORDER: readonly TaskClassV2[] = [
	"debug",
	"refactor",
	"review",
	"plan",
	"simple-edit",
	"code-gen",
	"trivial",
];

function hasCodeFence(text: string): boolean {
	return text.includes("```");
}

/**
 * Diff detection, identical to v1: explicit hunk headers or `diff --git` count
 * alone; bare +/- line starts only count when BOTH added and removed are present
 * (avoids false positives on markdown bullets).
 */
function hasDiffMarkers(text: string): boolean {
	if (/^@@[^\n]*@@/m.test(text) || /^diff --git /m.test(text)) return true;
	return /^\+(?!\+)/m.test(text) && /^-(?!-)/m.test(text);
}

function clampLenBucket(len: number): number {
	// floor(log2(len+1)) clamped to [0,7]; integer comparison ladder, no float log.
	let bucket = 0;
	let v = len + 1;
	while (v > 1 && bucket < 7) {
		v >>= 1;
		bucket++;
	}
	return bucket;
}

/**
 * Caller-supplied turn input.
 *
 * - prompt: raw turn text (trimmed by the classifier).
 * - laneType: subagent lane, if any (drives lane fallback + resolver step).
 * - history: N=8 ring buffer of prior task classes, NEWEST FIRST (multi-turn).
 * - pressureBucket: context-pressure band 0..3 (see RouterFeatures).
 * - judgeVote: optional tier-2 LLM-judge label (default OFF; injected as data).
 */
export interface TaskClassifierInputV2 {
	prompt: string;
	laneType?: ReasoningLaneTypeV2;
	history?: readonly TaskClassV2[];
	pressureBucket?: number;
	judgeVote?: TaskClassV2 | null;
}

/**
 * Deterministic weighted multi-signal classifier (Goal 004 Req 1).
 *
 * Pipeline:
 *  1. Extract RouterFeatures from input (STRONG/WEAK keyword 0/1 counts per
 *     family, codeFence, diffHunk, lenBucket, multiTurnPrior, pressureBucket,
 *     judgeVote).
 *  2. Score every class via the frozen scoreClass(c, f, weights). top1 = argmax
 *     with v1-precedence tie-break; margin = top1 - top2.
 *  3. ZERO-SCORE CASCADE (v1-compat): when maxScore === 0, fall through exactly
 *     like v1 steps 2-6 (fence/diff -> code-gen; len<40 -> trivial; len>=2400
 *     -> plan; lane fallback; default code-gen).
 *  4. HYSTERESIS: only when weights.stickyThreshold > 0 (INACTIVE for
 *     DEFAULT_WEIGHTS). If margin < stickyThreshold and history is non-empty,
 *     keep the previous class unless a STRONG keyword matched for top1.
 *
 * Pure: same (input, weights) -> same TaskClassV2.
 */
export function classifyTaskV2(input: TaskClassifierInputV2, weights: RouterWeights): TaskClassV2 {
	const prompt = input.prompt.trim();

	const strongKeyword: Partial<Record<TaskClassV2, number>> = {};
	const weakKeyword: Partial<Record<TaskClassV2, number>> = {};
	for (const { taskClass, pattern } of STRONG_KEYWORDS) {
		strongKeyword[taskClass] = pattern.test(prompt) ? 1 : 0;
	}
	for (const { taskClass, pattern } of WEAK_KEYWORDS) {
		weakKeyword[taskClass] = (weakKeyword[taskClass] ?? 0) + (pattern.test(prompt) ? 1 : 0);
	}

	const codeFence = hasCodeFence(prompt);
	const diffHunk = hasDiffMarkers(prompt);
	const lenBucket = clampLenBucket(prompt.length);
	const history = input.history;
	const multiTurnPrior: TaskClassV2 | null = history !== undefined && history.length > 0 ? history[0] : null;
	const pressureBucket = input.pressureBucket ?? 0;
	const judgeVote = input.judgeVote ?? null;

	const features: RouterFeatures = {
		strongKeyword,
		weakKeyword,
		codeFence,
		diffHunk,
		lenBucket,
		multiTurnPrior,
		pressureBucket,
		judgeVote,
	};

	// Score every class; track top1 (v1-precedence tie-break) and the runner-up.
	const scores = new Map<TaskClassV2, number>();
	for (const c of TASK_CLASSES_V2) {
		scores.set(c, scoreClass(c, features, weights));
	}
	let top1: TaskClassV2 = PRECEDENCE_ORDER[0];
	for (const c of PRECEDENCE_ORDER) {
		if ((scores.get(c) ?? 0) > (scores.get(top1) ?? 0)) top1 = c;
	}
	let top2: TaskClassV2 | null = null;
	for (const c of PRECEDENCE_ORDER) {
		if (c === top1) continue;
		if (top2 === null || (scores.get(c) ?? 0) > (scores.get(top2) ?? 0)) top2 = c;
	}
	const maxScore = scores.get(top1) ?? 0;
	const margin = top2 !== null ? maxScore - (scores.get(top2) ?? 0) : maxScore;

	// ZERO-SCORE CASCADE: no weighted signal fired -> v1 steps 2-6 verbatim.
	if (maxScore <= 0) {
		if (codeFence || diffHunk) return "code-gen";
		if (prompt.length < TRIVIAL_MAX_CHARS) return "trivial";
		if (prompt.length >= COMPLEX_PROSE_MIN_CHARS) return "plan";
		if (input.laneType) return LANE_FALLBACK_CLASS_V2[input.laneType];
		return "code-gen";
	}

	// HYSTERESIS: keep previous class on low-margin multi-turn turns. INACTIVE for
	// DEFAULT_WEIGHTS (stickyThreshold === 0). A STRONG keyword hit on top1 always
	// bypasses stickiness so an intentional topic switch still wins.
	if (
		weights.stickyThreshold > 0 &&
		margin < weights.stickyThreshold &&
		multiTurnPrior !== null &&
		(features.strongKeyword[top1] ?? 0) <= 0
	) {
		return multiTurnPrior;
	}

	return top1;
}

/** Reasoning ladder used for targets and clamping. Intentionally excludes "off". */
const REASONING_LADDER_V2: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Static rule table: task class -> recommended ThinkingLevel (before lane
 * adjustment, bias, hint, and clamping). Identical to v1 TASK_CLASS_THINKING_LEVELS.
 */
export const TASK_CLASS_THINKING_LEVELS_V2: Readonly<Record<TaskClassV2, ThinkingLevel>> = {
	trivial: "minimal",
	"simple-edit": "low",
	"code-gen": "medium",
	debug: "high",
	refactor: "high",
	review: "high",
	plan: "xhigh",
};

/**
 * Lane ladder adjustment (mirrors DEFAULT_WEIGHTS.laneStep and v1 LANE_STEP):
 * planner/security escalate one step, explorer de-escalates one step.
 */
const LANE_STEP_V2: Readonly<Partial<Record<ReasoningLaneTypeV2, 1 | -1>>> = {
	planner: 1,
	security: 1,
	explorer: -1,
};

/** Maximum magnitude of the learning/consult bias (ladder steps). */
const BIAS_MAX = 2;
/** Confidence floor at which an override hint is fused into the target. */
const HINT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Resolve a ThinkingLevel for a task class (Goal 004 resolver).
 *
 * Pipeline: base rule table -> lane step -> bounded bias [-2,+2] -> optional hint
 * fusion (±2 bounded) -> clamp to availableLevels (v1 algorithm).
 *
 * The clamp guarantees model-capability safety: the return value is always a
 * member of availableLevels and never "off" for reasoning models. With
 * bias=0 and hint=null, output is identical to v1 resolveThinkingLevel.
 */
export function resolveThinkingLevelV2(
	taskClass: TaskClassV2,
	availableLevels: readonly ThinkingLevel[],
	laneType: ReasoningLaneTypeV2 | undefined,
	bias: number,
	hint: { level: ThinkingLevel; confidence: number } | null,
): ThinkingLevel {
	const baseIndex = REASONING_LADDER_V2.indexOf(TASK_CLASS_THINKING_LEVELS_V2[taskClass]);
	const laneStep = laneType ? (LANE_STEP_V2[laneType] ?? 0) : 0;
	const biasClamped = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, bias));
	const ladderTop = REASONING_LADDER_V2.length - 1;
	let targetIndex = Math.max(0, Math.min(baseIndex + laneStep + biasClamped, ladderTop));

	// Hint fusion (Phase A: hint is null). A valid high-confidence hint moves the
	// target toward hint.level by at most ±2 ladder steps (bounded blast radius).
	if (hint !== null && hint.confidence >= HINT_CONFIDENCE_THRESHOLD) {
		const hintIndex = REASONING_LADDER_V2.indexOf(hint.level);
		if (hintIndex >= 0) {
			const delta = hintIndex - targetIndex;
			const step = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, delta));
			targetIndex = Math.max(0, Math.min(targetIndex + step, ladderTop));
		}
	}

	// Clamp to capability: highest available level <= target, else lowest available.
	const availableOnLadder = REASONING_LADDER_V2.filter((level) => availableLevels.includes(level));
	if (availableOnLadder.length === 0) {
		return availableLevels[0] ?? "off";
	}
	for (let i = targetIndex; i >= 0; i--) {
		const candidate = REASONING_LADDER_V2[i];
		if (availableOnLadder.includes(candidate)) return candidate;
	}
	return availableOnLadder[0];
}

/**
 * Thin auto-mode wrapper: resolve with bias=0 and hint=null (what the session
 * calls in v2 auto thinking mode). Output equals v1 resolveThinkingLevel for the
 * same (taskClass, availableLevels, laneType).
 */
export function resolveThinkingLevelV2ForAuto(
	taskClass: TaskClassV2,
	availableLevels: readonly ThinkingLevel[],
	laneType: ReasoningLaneTypeV2 | undefined,
): ThinkingLevel {
	return resolveThinkingLevelV2(taskClass, availableLevels, laneType, 0, null);
}

export { HISTORY_CAP };
