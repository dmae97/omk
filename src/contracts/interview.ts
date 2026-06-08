// Contract: src/contracts/interview.ts
// Owner: Contract Worker (Deep Interview phase 0)
// OMK Deep Interview — uncertainty reducer for goal-driven agent runs.
//
// Read-only for downstream interview modules. These types are the shared
// language for question banking, scoring, assimilation, session building,
// and the `omk goal interview` / `omk goal refine` CLI commands.

import type { GoalSpec, RiskLevel } from "./goal.js";

export const INTERVIEW_SCHEMA_VERSION = "omk.interview.v1" as const;
export const INTERVIEW_DELTA_SCHEMA_VERSION = "omk.interview-delta.v1" as const;

export type InterviewDepth = "light" | "standard" | "deep";
export type InterviewMode = "create" | "refine";

export type InterviewQuestionKind =
  | "objective"
  | "success-criteria"
  | "artifact"
  | "constraint"
  | "non-goal"
  | "risk"
  | "authority"
  | "evidence"
  | "dependency"
  | "rollback";

/**
 * Field on GoalSpec (or a derived structure) that an answer is meant to fill.
 * A question without a targetField is low quality and must be dropped.
 */
export type InterviewTargetField =
  | "objective"
  | "successCriteria"
  | "expectedArtifacts"
  | "constraints"
  | "nonGoals"
  | "risks"
  | "riskLevel"
  | "intentFrame"
  | "actionAtoms";

export interface InterviewQuestion {
  id: string;
  kind: InterviewQuestionKind;
  prompt: string;
  required: boolean;
  targetField: InterviewTargetField;
  /** 0..1 — how much answering reduces uncertainty about the goal. */
  informationGain: number;
  /** 0..1 — how much answering reduces execution risk. */
  riskReduction: number;
  /** 0..1 — how strongly the answer reshapes the execution DAG. */
  dagImpact: number;
  /** 0..1 — how strongly the answer strengthens evidence gates. */
  evidenceImpact: number;
  /** 0..1 — burden on the user (penalty). */
  userCost: number;
  /** Derived ranking score, 0..1, rounded to 2 decimals. */
  score: number;
}

export interface InterviewAnswer {
  questionId: string;
  answer: string;
  answeredAt: string;
  skipped?: boolean;
}

export interface InterviewFinding {
  field: InterviewTargetField | string;
  value: unknown;
  sourceQuestionId: string;
  /** 0..1 confidence that this finding is correct and explicit. */
  confidence: number;
  /** True when this finding contradicts an existing explicit value. */
  conflict?: boolean;
}

export interface InterviewCompleteness {
  /** Weighted overall completeness, 0..1. */
  overall: number;
  objective: number;
  successCriteria: number;
  evidence: number;
  artifacts: number;
  constraints: number;
  risks: number;
  authority: number;
  /** Required fields with no usable value yet. */
  criticalMissing: string[];
  /** Unresolved contradictions between answers and existing values. */
  contradictions: string[];
}

export type InterviewDeltaField = keyof GoalSpec | "successCriteria" | "expectedArtifacts" | "riskLevel";

export interface InterviewSpecChange {
  field: InterviewDeltaField;
  op: "add" | "replace" | "remove";
  value: unknown;
  sourceQuestionId: string;
  /** 0..1 confidence used by the conflict resolver. */
  confidence: number;
}

export interface InterviewSpecDelta {
  schemaVersion: typeof INTERVIEW_DELTA_SCHEMA_VERSION;
  goalId?: string;
  changes: InterviewSpecChange[];
}

export type InterviewStatus = "open" | "complete" | "blocked";

export interface InterviewSession {
  schemaVersion: typeof INTERVIEW_SCHEMA_VERSION;
  sessionId: string;
  goalId?: string;
  mode: InterviewMode;
  depth: InterviewDepth;
  createdAt: string;
  updatedAt: string;
  rawPrompt?: string;
  /** Ambiguity score 0..1; higher means more interview is needed. */
  ambiguity: number;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  findings: InterviewFinding[];
  completeness: InterviewCompleteness;
  specDelta: InterviewSpecDelta;
  status: InterviewStatus;
}

/** Inputs the question bank needs to derive candidate questions. */
export interface InterviewSeed {
  rawPrompt: string;
  riskLevel?: RiskLevel;
  goal?: GoalSpec;
}

/** Result of applying a spec delta to a GoalSpec. */
export interface InterviewApplyResult {
  goal: GoalSpec;
  appliedChanges: InterviewSpecChange[];
  skippedChanges: InterviewSpecChange[];
  contradictions: string[];
}
