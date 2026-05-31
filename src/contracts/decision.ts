import type { OMK_DECISION_SCHEMA_VERSION } from "../version.js";

export type DecisionKind =
  | "provider-selection"
  | "fallback-routing"
  | "retry-policy"
  | "skip-policy"
  | "dependent-block"
  | "context-brokering"
  | "skill-assignment"
  | "evidence-verdict"
  | "security-policy";

export type DecisionActor =
  | "runtime-router"
  | "scheduler"
  | "evidence-gate"
  | "provider-router"
  | "operator";

export type DecisionTrace = {
  schemaVersion: typeof OMK_DECISION_SCHEMA_VERSION;
  runId: string;
  decisionId: string;
  timestamp: string;
  kind: DecisionKind;
  actor: DecisionActor;
  inputRefs: string[];
  outputRefs: string[];
  selected?: string;
  candidates?: string[];
  reason: string;
  confidence?: number;
};

export type DecisionRef = {
  schemaVersion?: typeof OMK_DECISION_SCHEMA_VERSION;
  decisionId: string;
  runId?: string;
  path?: string;
};
