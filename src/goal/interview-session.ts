// src/goal/interview-session.ts
// OMK Deep Interview — session orchestrator.
//
// Composes the three deterministic modules (question-bank, scoring,
// assimilation) into an InterviewSession lifecycle:
//   seed -> ambiguity -> question ranking -> answers -> findings
//        -> spec delta -> completeness -> status
//
// This module owns the critical integration path and is intentionally
// deterministic except for timestamps and the session id.

import type {
  InterviewAnswer,
  InterviewDepth,
  InterviewMode,
  InterviewQuestion,
  InterviewSeed,
  InterviewSession,
} from "../contracts/interview.js";
import { INTERVIEW_SCHEMA_VERSION, INTERVIEW_DELTA_SCHEMA_VERSION } from "../contracts/interview.js";
import {
  computeAmbiguity,
  computeCompleteness,
  recommendDepth,
  scoreInterviewQuestion,
  selectInterviewQuestions,
} from "./interview-scoring.js";
import { buildInterviewQuestionBank } from "./interview-question-bank.js";
import { assimilateAnswers, applyInterviewDelta } from "./interview-assimilation.js";
import { createGoalSpec } from "./intake.js";
import { redactSecretText } from "./intent-frame.js";

/** Completeness threshold above which the interview is considered done. */
export const COMPLETENESS_THRESHOLD = 0.82;

function generateSessionId(): string {
  return `iv-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export interface BuildInterviewSessionInput {
  seed: InterviewSeed;
  mode: InterviewMode;
  depth?: InterviewDepth;
  maxQuestions?: number;
  sessionId?: string;
  goalId?: string;
}

/**
 * Build a fresh interview session: score ambiguity, rank deterministic
 * questions, and emit an empty spec delta. No answers are applied yet.
 */
export function buildInterviewSession(input: BuildInterviewSessionInput): InterviewSession {
  const now = new Date().toISOString();
  const ambiguity = computeAmbiguity(input.seed);
  const depth = input.depth ?? recommendDepth(ambiguity);

  const candidates = buildInterviewQuestionBank(input.seed);
  const scored: InterviewQuestion[] = candidates.map((candidate) => scoreInterviewQuestion(candidate));
  const questions = selectInterviewQuestions(input.seed.goal, scored, depth, input.maxQuestions);

  const completeness = computeCompleteness(input.seed.goal, []);

  return {
    schemaVersion: INTERVIEW_SCHEMA_VERSION,
    sessionId: input.sessionId ?? generateSessionId(),
    goalId: input.goalId ?? input.seed.goal?.goalId,
    mode: input.mode,
    depth,
    createdAt: now,
    updatedAt: now,
    rawPrompt: redactSecretText(input.seed.rawPrompt),
    ambiguity,
    questions,
    answers: [],
    findings: [],
    completeness,
    specDelta: {
      schemaVersion: INTERVIEW_DELTA_SCHEMA_VERSION,
      goalId: input.goalId ?? input.seed.goal?.goalId,
      changes: [],
    },
    status: "open",
  };
}

/**
 * Apply a batch of answers to an open session: assimilate into findings and a
 * spec delta, recompute completeness, and decide the terminal status.
 *
 * Termination (spec): complete when completeness >= 0.82 AND no critical
 * missing field AND no unresolved contradiction. Contradictions => blocked.
 */
export function ingestAnswers(
  session: InterviewSession,
  seed: InterviewSeed,
  newAnswers: InterviewAnswer[],
): InterviewSession {
  // Redact secrets from answers before they are assimilated, persisted, or
  // echoed so tokens never reach interview artifacts or the GoalSpec.
  const redactedAnswers = newAnswers.map((answer) => ({
    ...answer,
    answer: redactSecretText(answer.answer),
  }));
  const mergedAnswers = mergeAnswers(session.answers, redactedAnswers);

  const { findings, specDelta, contradictions } = assimilateAnswers({
    seed,
    questions: session.questions,
    answers: mergedAnswers,
    goal: seed.goal,
  });

  // Completeness is measured against the PROJECTED goal (base + delta) so the
  // score reflects what the answers actually contribute to the GoalSpec, not
  // the empty seed goal. This makes the 0.82 termination threshold meaningful.
  const baseGoal = seed.goal ?? createGoalSpec(seed.rawPrompt);
  const projected = applyInterviewDelta(baseGoal, specDelta).goal;
  const completeness = computeCompleteness(projected, findings);
  completeness.contradictions = uniqueStrings([...completeness.contradictions, ...contradictions]);

  const status = decideStatus(completeness);

  return {
    ...session,
    updatedAt: new Date().toISOString(),
    answers: mergedAnswers,
    findings,
    completeness,
    specDelta: {
      ...specDelta,
      goalId: session.goalId ?? specDelta.goalId,
    },
    status,
  };
}

export function decideStatus(completeness: InterviewSession["completeness"]): InterviewSession["status"] {
  if (completeness.contradictions.length > 0) return "blocked";
  if (completeness.overall >= COMPLETENESS_THRESHOLD && completeness.criticalMissing.length === 0) {
    return "complete";
  }
  return "open";
}

function mergeAnswers(existing: InterviewAnswer[], incoming: InterviewAnswer[]): InterviewAnswer[] {
  const byId = new Map<string, InterviewAnswer>();
  for (const answer of existing) byId.set(answer.questionId, answer);
  for (const answer of incoming) byId.set(answer.questionId, answer);
  return [...byId.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
