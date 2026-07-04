import type { ThinkingLevel } from "omk-agent-core";
import type { ReasoningLaneTypeV2, TaskClassV2 } from "./reasoning-router-v2.ts";
import { resolveThinkingLevelV2ForAuto, TASK_CLASS_THINKING_LEVELS_V2 } from "./reasoning-router-v2.ts";

export type TaskClassV3 = TaskClassV2;
export type ReasoningLaneTypeV3 = ReasoningLaneTypeV2;

export interface TaskClassifierInputV3 {
	prompt: string;
	laneType?: ReasoningLaneTypeV3;
	history?: readonly TaskClassV3[];
	pressureBucket?: number;
	judgeVote?: TaskClassV3 | null;
}

const TRIVIAL_MAX_CHARS = 40;
const COMPLEX_PROSE_MIN_CHARS = 2400;
const LONG_BRIEF_MIN_CHARS = 512;

const PRECEDENCE_ORDER_V3: readonly TaskClassV3[] = [
	"debug",
	"refactor",
	"review",
	"plan",
	"simple-edit",
	"code-gen",
	"trivial",
];

const LANE_FALLBACK_CLASS_V3: Readonly<Record<ReasoningLaneTypeV3, TaskClassV3>> = {
	planner: "plan",
	security: "review",
	explorer: "review",
	coder: "code-gen",
	reviewer: "review",
	tester: "code-gen",
};

interface FeaturePattern {
	readonly taskClass: TaskClassV3;
	readonly pattern: RegExp;
	readonly weight: number;
}

interface ContextualFeatures {
	readonly firstClause: string;
	readonly codeFence: boolean;
	readonly diffHunk: boolean;
	readonly localEdit: boolean;
	readonly diagnosticEvidence: boolean;
	readonly reviewScope: boolean;
	readonly planBrief: boolean;
	readonly refactorCue: boolean;
	readonly implementationObject: boolean;
}

const LOCAL_EDIT_OBJECT_PATTERN =
	/\b(spelling|grammar|capitalization|date\s+format|author\s+e-?mail|copyright\s+year|headline|title|tooltip|placeholder|punctuation|comma|period|semicolon|closing\s+html\s+tag|closing\s+tag|double\s+space|whitespace|indentation|table\s+alignment|typos?|one-?liner?|single\s+line|sentence|stray|trailing)\b/i;
const LOCAL_EDIT_ACTION_OBJECT_PATTERN =
	/\b(update|change|swap|remove|correct|fix|add|adjust|trim)\s+(?:the\s+|a\s+|an\s+)?(?:missing\s+|stray\s+|author\s+|two\s+)?(?:e-?mail|comma|period|semicolon|tag|word|words|headline|title|copyright|spelling|grammar)\b/i;
const IMPLEMENTATION_OBJECT_PATTERN =
	/\b(error\s+handling|input\s+validation|validation|auth(?:entication)?|retry|endpoint|migration|component|function|utility|helper|module|service|database|schema|column|middleware|rate\s+limiter|cache|caching|oauth|jwt|webhook)\b/i;
const HARD_DIAGNOSTIC_PATTERN =
	/\b(stack\s*trace|traceback|panic|segfault|crash(?:es|ing|ed)?|throws?|fails?|failing|flaky|hangs?|timeout|500|EADDRINUSE|silently\s+fails?)\b|\b(?:TypeError|ReferenceError|RangeError|Error):/i;
const BUG_OBJECT_PATTERN =
	/\b(null\s+pointer|null\s+deref|race(?:\s+condition)?|heap(?:\s+overflow)?|use-after-free|memory\s+leak|deadlock|data\s+corruption|stale\s+data|off-by-one|encoding\s+bug|regression\s+(?:was\s+)?introduced|exceptions?|assertion\s+error|bugs?)\b/i;
const NON_DIAGNOSTIC_DEBUG_CONTEXT_PATTERN = /\berror\s+(?:handling|messages?|budgets?)\b/i;
const GENERIC_DIAGNOSTIC_PATTERN = /\b(errors?|broken|wrong\s+results|rolls?\s+back|rollback)\b/i;
const PLAN_BRIEF_PATTERN =
	/\b(context\s+and\s+constraints|starting\s+state|target\s+state|cross-cutting|deliver:|deliverables?|roadmap|migration\s+wave|top\s+(?:ten\s+)?risks|component\s+diagram|data\s+model|architecture|go\/no-go|phased\s+(?:delivery|rollout)|bounded\s+contexts?|strangler\s+fig|event-driven|quarter-by-quarter|milestone)\b/i;
const REVIEW_SCOPE_PATTERN =
	/\b(pr|pull\s+request|diff|codebase|strategy|plan|spec|schema|design|api|coverage|security\s+posture|licensing|risks?|edge\s+cases|clarity|consistency|dependencies|third-party|ci\s+pipeline|threat\s+model|retry\s+logic|error\s+handling\s+strategy|error\s+messages?)\b/i;
const REFACTOR_CUE_PATTERN =
	/\b(refactor|extract|rename|deduplicate|consolidate|modularize|reorganize|simplify|clean\s*up|restructure|split\s+module|move\s+logic|untangle|merge\s+duplicate)\b/i;

const ADD_KEYWORD_PATTERN = /\badd\b/i;

const KEYWORD_PATTERNS_V3: readonly FeaturePattern[] = [
	{
		taskClass: "debug",
		pattern: /^(?:debug|investigate\s+why|reproduce|trace\b)|\bfix\s+this\s+(?:traceback|panic|error)\b/i,
		weight: 4,
	},
	{ taskClass: "refactor", pattern: REFACTOR_CUE_PATTERN, weight: 4 },
	{
		taskClass: "review",
		pattern: /\b(review|critique|assess|inspect|approve|lgtm|double-?check|audit(?!\s+log\b))\b/i,
		weight: 4,
	},
	{
		taskClass: "plan",
		pattern:
			/\b(plan|design|architect|architecture|roadmap|spec(?:ification)?|strategy|decompose|milestones?|write\s+a\s+(?:technical\s+)?spec|create\s+a\s+(?:roadmap|strategy|plan))\b/i,
		weight: 4,
	},
	{ taskClass: "simple-edit", pattern: LOCAL_EDIT_OBJECT_PATTERN, weight: 4 },
	{ taskClass: "code-gen", pattern: /\b(implement|write|create|build|generate|scaffold|prototype)\b/i, weight: 4 },
	{ taskClass: "code-gen", pattern: ADD_KEYWORD_PATTERN, weight: 1 },
];

function hasCodeFence(text: string): boolean {
	return text.includes("```");
}

function hasDiffMarkers(text: string): boolean {
	if (/^@@[^\n]*@@/m.test(text) || /^diff --git /m.test(text)) return true;
	return /^\+(?!\+)/m.test(text) && /^-(?!-)/m.test(text);
}

function firstClause(prompt: string): string {
	const firstLine =
		prompt.replace(/^(?:please|pls|can you|could you|would you|help me|i need you to)\s+/i, "").split("\n")[0] ?? "";
	return firstLine.slice(0, 180);
}

function hasLeadingReviewIntent(text: string): boolean {
	return /^(?:review|audit(?!\s+log\b)|critique|inspect|assess|approve|double-?check|lgtm)\b/i.test(text);
}

function hasLeadingPlanIntent(text: string): boolean {
	return /^(?:plan|design|architect|decompose)\b|^(?:write|create)\s+(?:a\s+)?(?:technical\s+)?(?:spec|roadmap|strategy|plan)\b/i.test(
		text,
	);
}

function hasLeadingRefactorIntent(text: string): boolean {
	return /^(?:refactor|extract|rename|deduplicate|consolidate|modularize|reorganize|simplify|restructure|untangle)\b|^clean\s+up\b|^split\s+(?:the\s+)?module\b|^move\s+logic\b/i.test(
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

function hasDiagnosticEvidence(prompt: string, leading: string): boolean {
	if (hasLeadingDebugAction(leading) || HARD_DIAGNOSTIC_PATTERN.test(prompt)) return true;
	const hasContextualDiagnostic =
		BUG_OBJECT_PATTERN.test(prompt) ||
		(GENERIC_DIAGNOSTIC_PATTERN.test(prompt) && !NON_DIAGNOSTIC_DEBUG_CONTEXT_PATTERN.test(prompt));
	if (!hasContextualDiagnostic) return false;
	return !hasLeadingReviewIntent(leading) && !hasLeadingPlanIntent(leading) && !hasLeadingRefactorIntent(leading);
}

function extractFeatures(prompt: string): ContextualFeatures {
	const leading = firstClause(prompt);
	const implementationObject = IMPLEMENTATION_OBJECT_PATTERN.test(prompt);
	const lowRiskEditAction = /^(?:correct|update|swap|remove|reword|tweak|bump|trim)\b/i.test(leading);
	return {
		firstClause: leading,
		codeFence: hasCodeFence(prompt),
		diffHunk: hasDiffMarkers(prompt),
		localEdit:
			!implementationObject &&
			(lowRiskEditAction || LOCAL_EDIT_OBJECT_PATTERN.test(prompt) || LOCAL_EDIT_ACTION_OBJECT_PATTERN.test(prompt)),
		diagnosticEvidence: hasDiagnosticEvidence(prompt, leading),
		reviewScope: hasLeadingReviewIntent(leading) && REVIEW_SCOPE_PATTERN.test(prompt),
		planBrief:
			hasLeadingPlanIntent(leading) && (PLAN_BRIEF_PATTERN.test(prompt) || prompt.length >= LONG_BRIEF_MIN_CHARS),
		refactorCue: REFACTOR_CUE_PATTERN.test(prompt),
		implementationObject,
	};
}

function leadingIntent(features: ContextualFeatures): TaskClassV3 | null {
	if (
		features.diagnosticEvidence &&
		(hasLeadingDebugAction(features.firstClause) || hasLeadingSimpleEditIntent(features.firstClause))
	)
		return "debug";
	if (hasLeadingReviewIntent(features.firstClause)) return "review";
	if (hasLeadingPlanIntent(features.firstClause)) return "plan";
	if (hasLeadingRefactorIntent(features.firstClause)) return "refactor";
	if (features.localEdit && hasLeadingSimpleEditIntent(features.firstClause)) return "simple-edit";
	if (!features.localEdit && hasLeadingCodeGenIntent(features.firstClause)) return "code-gen";
	return null;
}

function emptyScores(): Record<TaskClassV3, number> {
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

function applyKeywordScores(scores: Record<TaskClassV3, number>, prompt: string, features: ContextualFeatures): void {
	for (const { taskClass, pattern, weight } of KEYWORD_PATTERNS_V3) {
		if (taskClass === "debug" && !features.diagnosticEvidence) continue;
		if (pattern === ADD_KEYWORD_PATTERN && features.localEdit) continue;
		if (pattern.test(prompt)) scores[taskClass] += weight;
	}
}

function chooseTop(scores: Record<TaskClassV3, number>): TaskClassV3 {
	let top: TaskClassV3 = "debug";
	for (const taskClass of PRECEDENCE_ORDER_V3) {
		if (scores[taskClass] > scores[top]) top = taskClass;
	}
	return top;
}

export function classifyTaskV3(input: TaskClassifierInputV3): TaskClassV3 {
	const prompt = input.prompt.trim();
	const features = extractFeatures(prompt);
	const scores = emptyScores();

	if (features.codeFence || features.diffHunk) scores["code-gen"] += 4;
	const intent = leadingIntent(features);
	if (intent !== null) scores[intent] += 8;
	if (features.localEdit) scores["simple-edit"] += 7;
	if (features.diagnosticEvidence) scores.debug += 7;
	if (features.reviewScope) scores.review += 3;
	if (features.planBrief) scores.plan += 8;
	if (features.refactorCue) scores.refactor += 6;
	if (features.implementationObject) scores["code-gen"] += 3;
	applyKeywordScores(scores, prompt, features);

	const top = chooseTop(scores);
	if (scores[top] <= 0) {
		if (prompt.length < TRIVIAL_MAX_CHARS) return "trivial";
		if (prompt.length >= COMPLEX_PROSE_MIN_CHARS) return "plan";
		if (input.laneType) return LANE_FALLBACK_CLASS_V3[input.laneType];
		return "code-gen";
	}
	return top;
}

export const TASK_CLASS_THINKING_LEVELS_V3: Readonly<Record<TaskClassV3, ThinkingLevel>> =
	TASK_CLASS_THINKING_LEVELS_V2;

export function resolveThinkingLevelV3ForAuto(
	taskClass: TaskClassV3,
	availableLevels: readonly ThinkingLevel[],
	laneType: ReasoningLaneTypeV3 | undefined,
): ThinkingLevel {
	return resolveThinkingLevelV2ForAuto(taskClass, availableLevels, laneType);
}
