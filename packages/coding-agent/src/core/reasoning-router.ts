/**
 * Reasoning-effort router: pure, side-effect-free task classification and
 * ThinkingLevel resolution for the `auto` thinking mode.
 *
 * Deterministic by construction: consumes only the prompt text and an optional
 * subagent lane type. No clock, randomness, I/O, or imports from session, TUI,
 * or provider code (the ThinkingLevel import below is type-only and erased).
 */

import type { ThinkingLevel } from "omk-agent-core";

/** Closed set of task classes the router can assign to a turn. */
export type TaskClass = "trivial" | "simple-edit" | "code-gen" | "debug" | "refactor" | "review" | "plan";

/** Subagent lane types recognized by the classifier and resolver. */
export type ReasoningLaneType = "planner" | "security" | "explorer" | "coder" | "reviewer" | "tester";

export interface TaskClassifierInput {
	prompt: string;
	laneType?: ReasoningLaneType;
}

/** Prompts shorter than this (trimmed) classify as trivial when no stronger signal matches. */
const TRIVIAL_MAX_CHARS = 40;
/** Prompts at/above this length with no keyword/code/diff signal are treated as long prose briefs (plan). */
const COMPLEX_PROSE_MIN_CHARS = 2400;

/**
 * Keyword families in FIXED precedence order:
 * debug > refactor > review > plan > simple-edit > code-gen.
 * The first matching family wins; ties are impossible by construction.
 * Patterns are case-insensitive and stateless (no `g` flag, so no lastIndex carry-over).
 */
const KEYWORD_FAMILIES: ReadonlyArray<{ taskClass: TaskClass; pattern: RegExp }> = [
	{
		taskClass: "debug",
		pattern:
			/\b(debug(ging)?|bugs?|fix(es|ing|ed)?|errors?|exceptions?|crash(es|ing|ed)?|stack\s*trace|traceback|regressions?|broken|fail(s|ing|ed|ure|ures)?|flaky|reproduce)\b/i,
	},
	{
		taskClass: "refactor",
		pattern:
			/\b(refactor(ing|ed)?|restructur(e|ing)|renam(e|ing)|extract(ing)?|clean\s*up|cleanup|simplif(y|ying|ied)|deduplicat(e|ing)|reorganiz(e|ing)|rewrit(e|ing)|modulariz(e|ing))\b/i,
	},
	{
		taskClass: "review",
		pattern: /\b(review(s|ing|ed)?|audit(s|ing|ed)?|critique|assess(ing|ment)?|inspect(ing)?|lgtm|approve)\b/i,
	},
	{
		taskClass: "plan",
		pattern:
			/\b(plan(s|ning)?|design(s|ing)?|architect(s|ure|ing)?|roadmap|spec(s|ification|ifications)?|strateg(y|ies|ize)|decompos(e|ing|ition)|break\s+(this\s+|it\s+)?down|milestones?)\b/i,
	},
	{
		taskClass: "simple-edit",
		pattern:
			/\b(typos?|tweak(s|ing|ed)?|one-?liner?|single\s+line|bump(s|ing|ed)?|whitespace|reword(s|ing|ed)?|indentation|punctuation)\b/i,
	},
	{
		taskClass: "code-gen",
		pattern:
			/\b(implement(s|ing|ation)?|writ(e|ing)|creat(e|es|ing)|add(s|ing|ed)?|build(s|ing)?|generat(e|es|ing)|scaffold(ing)?|prototype)\b/i,
	},
];

/** Fallback class per lane when no keyword, code/diff, or length signal decides. */
const LANE_FALLBACK_CLASS: Record<ReasoningLaneType, TaskClass> = {
	planner: "plan",
	security: "review",
	explorer: "review",
	coder: "code-gen",
	reviewer: "review",
	tester: "code-gen",
};

function hasCodeFence(text: string): boolean {
	return text.includes("```");
}

/**
 * Diff detection: explicit hunk (`@@ ... @@`) or `diff --git` headers count alone;
 * bare `+`/`-` line starts only count when both added AND removed lines are present
 * (avoids false positives on markdown bullet lists).
 */
function hasDiffMarkers(text: string): boolean {
	if (/^@@[^\n]*@@/m.test(text) || /^diff --git /m.test(text)) return true;
	return /^\+(?!\+)/m.test(text) && /^-(?!-)/m.test(text);
}

/**
 * Classify a turn deterministically. Signal precedence (first match wins):
 * 1. Keyword families (debug > refactor > review > plan > simple-edit > code-gen)
 * 2. Code fence or diff markers -> code-gen
 * 3. Trimmed length < TRIVIAL_MAX_CHARS -> trivial
 * 4. Trimmed length >= COMPLEX_PROSE_MIN_CHARS -> plan (long prose brief)
 * 5. Lane fallback (see LANE_FALLBACK_CLASS)
 * 6. Default -> code-gen
 */
export function classifyTask(input: TaskClassifierInput): TaskClass {
	const prompt = input.prompt.trim();

	for (const family of KEYWORD_FAMILIES) {
		if (family.pattern.test(prompt)) return family.taskClass;
	}

	if (hasCodeFence(prompt) || hasDiffMarkers(prompt)) return "code-gen";
	if (prompt.length < TRIVIAL_MAX_CHARS) return "trivial";
	if (prompt.length >= COMPLEX_PROSE_MIN_CHARS) return "plan";
	if (input.laneType) return LANE_FALLBACK_CLASS[input.laneType];
	return "code-gen";
}

/** Reasoning ladder used for targets and clamping. Intentionally excludes "off". */
const REASONING_LADDER: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** Static rule table: task class -> recommended ThinkingLevel (before lane adjustment and clamping). */
export const TASK_CLASS_THINKING_LEVELS: Readonly<Record<TaskClass, ThinkingLevel>> = {
	trivial: "minimal",
	"simple-edit": "low",
	"code-gen": "medium",
	debug: "high",
	refactor: "high",
	review: "high",
	plan: "xhigh",
};

/** Lane adjustment in ladder steps: planner/security escalate, explorer de-escalates. */
const LANE_STEP: Readonly<Partial<Record<ReasoningLaneType, 1 | -1>>> = {
	planner: 1,
	security: 1,
	explorer: -1,
};

/**
 * Resolve the recommended ThinkingLevel for a task class:
 * 1. Look up the static rule table.
 * 2. Apply the lane adjustment (one ladder step, saturating at ladder ends).
 * 3. Clamp to the highest level in `availableLevels` that is <= the target;
 *    if no available level is at/below the target, return the lowest available
 *    reasoning level. Never invents a level outside `availableLevels`.
 *
 * `"off"` is never a router output for reasoning models. If `availableLevels`
 * contains no ladder level at all (e.g. a non-reasoning model exposing only
 * "off"), the first available level is returned; callers are expected to
 * bypass the router entirely for models with `reasoning: false`.
 */
export function resolveThinkingLevel(
	taskClass: TaskClass,
	availableLevels: readonly ThinkingLevel[],
	laneType?: ReasoningLaneType,
): ThinkingLevel {
	const baseIndex = REASONING_LADDER.indexOf(TASK_CLASS_THINKING_LEVELS[taskClass]);
	const step = laneType ? (LANE_STEP[laneType] ?? 0) : 0;
	const targetIndex = Math.min(Math.max(baseIndex + step, 0), REASONING_LADDER.length - 1);

	const availableOnLadder = REASONING_LADDER.filter((level) => availableLevels.includes(level));
	if (availableOnLadder.length === 0) {
		return availableLevels[0] ?? "off";
	}

	for (let i = targetIndex; i >= 0; i--) {
		const candidate = REASONING_LADDER[i];
		if (availableOnLadder.includes(candidate)) return candidate;
	}
	return availableOnLadder[0];
}
