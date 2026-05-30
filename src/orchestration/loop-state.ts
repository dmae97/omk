import type { RunState } from "../contracts/orchestration.js";

export type LoopDecisionAction =
  | "close"
  | "continue"
  | "replan"
  | "verify-only"
  | "block"
  | "handoff";

export interface LoopDecision {
  schemaVersion: 1;
  action: LoopDecisionAction;
  reason: string;
  confidence: number;
  inputId: string;
  runId: string;
  iteration: number;
  nextPrompt?: string;
  failedGates: string[];
  requiredEvidenceMissing: string[];
  createdAt: string;
}

export interface OrchestrationLoopState {
  schemaVersion: 1;
  runId: string;
  parentRunId?: string;
  inputId: string;
  iteration: number;
  maxIterations: number;
  status: "running" | "closed" | "blocked" | "failed";
  decisions: LoopDecision[];
  stateSnapshot?: Pick<RunState, "runId" | "iterationCount" | "maxIterations" | "completedAt">;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluateLoopDecisionInput {
  runId: string;
  inputId: string;
  runState: RunState;
  iteration?: number;
  maxIterations?: number;
  requestedAction?: "continue" | "replan" | "verify";
  now?: () => Date;
}
