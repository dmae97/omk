// Module: src/goal/interview-scoring.ts
// OMK Deep Interview — pure deterministic scoring/ranking.
//
// 100% deterministic: no I/O, no Date.now, no randomness, no network/LLM calls.
// All 0..1 outputs are clamped to [0,1] and scores rounded to 2 decimals.

import type { GoalSpec } from "../contracts/goal.js";
import type {
  InterviewCompleteness,
  InterviewDepth,
  InterviewFinding,
  InterviewQuestion,
  InterviewSeed,
  InterviewTargetField,
} from "../contracts/interview.js";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Max questions surfaced per interview depth. */
export const DEPTH_LIMITS: Record<InterviewDepth, number> = {
  light: 5,
  standard: 10,
  deep: 18,
};

/**
 * Derive the ranking score for a candidate question.
 * score = informationGain*0.35 + riskReduction*0.25 + dagImpact*0.20
 *       + evidenceImpact*0.15 - userCost*0.05, clamped to [0,1].
 */
export function scoreInterviewQuestion(input: Omit<InterviewQuestion, "score">): InterviewQuestion {
  const raw =
    input.informationGain * 0.35 +
    input.riskReduction * 0.25 +
    input.dagImpact * 0.2 +
    input.evidenceImpact * 0.15 -
    input.userCost * 0.05;
  const score = round2(clamp01(raw));
  return { ...input, score };
}

/**
 * Select the highest-value questions for a depth, dropping questions whose
 * target field is already answered by the goal (unless marked required).
 */
export function selectInterviewQuestions(
  goal: GoalSpec | undefined,
  candidates: InterviewQuestion[],
  depth: InterviewDepth,
  maxQuestions?: number,
): InterviewQuestion[] {
  const limit = maxQuestions != null ? Math.min(maxQuestions, DEPTH_LIMITS[depth]) : DEPTH_LIMITS[depth];

  const answeredTargets = new Set<InterviewTargetField>();
  if (goal) {
    if (goal.objective?.trim()) answeredTargets.add("objective");
    if (goal.successCriteria.length > 0) answeredTargets.add("successCriteria");
    if (goal.expectedArtifacts.length > 0) answeredTargets.add("expectedArtifacts");
    if (goal.constraints.length > 0) answeredTargets.add("constraints");
    if (goal.nonGoals.length > 0) answeredTargets.add("nonGoals");
    if (goal.risks.length > 0) answeredTargets.add("risks");
  }

  const filtered = candidates.filter((q) => q.required || !answeredTargets.has(q.targetField));

  const byScoreThenRequired = (a: InterviewQuestion, b: InterviewQuestion): number => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    return Number(b.required) - Number(a.required);
  };

  // Pin required questions so a small --max-questions/limit can never drop a
  // required axis; optional questions fill the remaining slots by score.
  const required = filtered.filter((q) => q.required).sort(byScoreThenRequired);
  const optional = filtered.filter((q) => !q.required).sort(byScoreThenRequired);
  const remaining = Math.max(0, limit - required.length);
  return [...required, ...optional.slice(0, remaining)].sort(byScoreThenRequired);
}

/** Keyword/regex heuristics describing one ambiguity axis. */
const AMBIGUITY_AXES: ReadonlyArray<{
  weight: number;
  pattern: RegExp;
  goalPresent: (seed: InterviewSeed) => boolean;
}> = [
  {
    weight: 0.18,
    pattern: /\b(objective|goal|implement|build|create|add|fix|refactor|design|develop|generate|support|enable)\b/,
    goalPresent: (s) => !!s.goal?.objective?.trim(),
  },
  {
    weight: 0.18,
    pattern: /\b(acceptance|success criteria|criteria|criterion|definition of done|done when|must pass|requirement|expected result|should)\b/,
    goalPresent: (s) => (s.goal?.successCriteria.length ?? 0) > 0,
  },
  {
    weight: 0.13,
    pattern: /\b(test|verify|verification|check|lint|typecheck|build|coverage|assert|validate)\b/,
    goalPresent: (s) => (s.goal?.expectedArtifacts.some((a) => a.gate === "command-pass") ?? false),
  },
  {
    weight: 0.12,
    pattern: /(\.[a-z]{2,4}\b|\bfile\b|\bpath\b|\bmodule\b|\bcomponent\b|\bdirectory\b|\bartifact\b|\boutput\b)/,
    goalPresent: (s) => (s.goal?.expectedArtifacts.length ?? 0) > 0,
  },
  {
    weight: 0.1,
    pattern: /\b(constraint|must not|only|do not|don't|limit|restrict|without|avoid|never|forbidden)\b/,
    goalPresent: (s) => (s.goal?.constraints.length ?? 0) > 0,
  },
  {
    weight: 0.08,
    pattern: /\b(risk|danger|safe|safety|destructive|irreversible|production|rollback|backup|prod)\b/,
    goalPresent: (s) => (s.goal?.risks.length ?? 0) > 0 || s.riskLevel != null,
  },
  {
    weight: 0.08,
    pattern: /\b(write|edit|modify|delete|shell|command|merge|commit|push|deploy|permission|read.only|authority|scope)\b/,
    goalPresent: (s) => !!s.goal?.intentFrame?.directives?.some((d) => d.kind === "read-only" || d.kind === "no-edits" || d.kind === "scope"),
  },
  {
    weight: 0.07,
    pattern: /\b(non-goal|out of scope|exclude|except|not (include|touch|modify|change|do)|do not (edit|modify|change|touch))\b/,
    goalPresent: (s) => (s.goal?.nonGoals.length ?? 0) > 0,
  },
  {
    weight: 0.06,
    pattern: /\b(depend|dependenc|requires|require|prerequisite|blocked by|relies on|integrat|import)\b/,
    goalPresent: () => false,
  },
];

/**
 * Ambiguity 0..1 — higher means more interview is needed. Computed as the
 * weighted sum of axes that are neither described in the prompt nor present on
 * the goal. Axis weights sum to 1.
 */
export function computeAmbiguity(seed: InterviewSeed): number {
  const prompt = (seed.rawPrompt ?? "").toLowerCase();
  let missing = 0;
  for (const axis of AMBIGUITY_AXES) {
    const present = axis.pattern.test(prompt) || axis.goalPresent(seed);
    if (!present) missing += axis.weight;
  }
  return round2(clamp01(missing));
}

/**
 * Map an ambiguity score to a recommended depth.
 * <0.25 light (caller may skip) · <0.50 light · <0.75 standard · else deep.
 */
export function recommendDepth(ambiguity: number): InterviewDepth {
  if (ambiguity < 0.5) return "light";
  if (ambiguity < 0.75) return "standard";
  return "deep";
}

/** Per-axis completeness: 0.6 if goal field populated, +0.4 if a finding matches. */
function axisScore(goalPopulated: boolean, fields: readonly string[], findings: InterviewFinding[]): number {
  const hasFinding = findings.some((f) => fields.includes(String(f.field)));
  let score = 0;
  if (goalPopulated) score += 0.6;
  if (hasFinding) score += 0.4;
  return round2(clamp01(score));
}

/**
 * Completeness across required and supporting axes, blending populated goal
 * fields with assimilated interview findings.
 */
export function computeCompleteness(
  goal: GoalSpec | undefined,
  findings: InterviewFinding[],
): InterviewCompleteness {
  const objective = axisScore(!!goal?.objective?.trim(), ["objective"], findings);
  const successCriteria = axisScore((goal?.successCriteria.length ?? 0) > 0, ["successCriteria"], findings);
  const evidence = axisScore(
    (goal?.expectedArtifacts.some((a) => !!a.gate) ?? false) ||
      (goal?.successCriteria.some((c) => c.requirement === "required") ?? false),
    ["evidence"],
    findings,
  );
  const artifacts = axisScore(
    (goal?.expectedArtifacts.length ?? 0) > 0,
    ["expectedArtifacts", "artifact", "artifacts"],
    findings,
  );
  const constraints = axisScore((goal?.constraints.length ?? 0) > 0, ["constraints"], findings);
  const risks = axisScore(
    (goal?.risks.length ?? 0) > 0,
    ["risks", "riskLevel"],
    findings,
  );
  const authority = axisScore(
    !!goal?.intentFrame?.directives?.some((d) => d.kind === "read-only" || d.kind === "no-edits" || d.kind === "scope"),
    ["authority", "intentFrame"],
    findings,
  );

  const overall = round2(
    clamp01(
      objective * 0.15 +
        successCriteria * 0.25 +
        evidence * 0.2 +
        artifacts * 0.15 +
        constraints * 0.1 +
        risks * 0.1 +
        authority * 0.05,
    ),
  );

  const criticalMissing: string[] = [];
  if (objective < 0.5) criticalMissing.push("objective");
  if (successCriteria < 0.5) criticalMissing.push("successCriteria");
  if (evidence < 0.5) criticalMissing.push("evidence");

  const contradictions = findings.filter((f) => f.conflict).map((f) => String(f.field));

  return {
    overall,
    objective,
    successCriteria,
    evidence,
    artifacts,
    constraints,
    risks,
    authority,
    criticalMissing,
    contradictions,
  };
}
