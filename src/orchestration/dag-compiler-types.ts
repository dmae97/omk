import type { IntentFrame, GoalSpec } from "../contracts/goal.js";
import type {
  ExecutionSelectionDecision,
  ExecutionStrategy,
  UserIntentV2,
} from "../contracts/orchestration.js";
import type { InputEnvelope } from "../input/input-envelope.js";
import type { Dag } from "./dag.js";
import type { TopologyDecision } from "./adaptorch-topology.js";

export interface DagCompileInput {
  input: InputEnvelope;
  goal?: GoalSpec;
  intent?: UserIntentV2;
  intentFrame?: IntentFrame;
  executionDecision?: ExecutionSelectionDecision;
  workerCount?: number;
  resources?: unknown;
}

export interface DagCompileArtifactSummary {
  capabilityRouting?: unknown;
  explanation: string;
}

export interface DagCompileResult {
  schemaVersion: 1;
  inputId: string;
  runId: string;
  dag: Dag;
  workerCount: number;
  executionStrategy: ExecutionStrategy;
  intent?: UserIntentV2;
  intentFrame?: IntentFrame;
  artifacts: DagCompileArtifactSummary;
  compiledAt: string;
  /** AdaptOrch topology routing — additive, optional, non-fatal */
  topology?: TopologyDecision;
}

export interface BuildDagCompileResultInput {
  input: InputEnvelope;
  dag: Dag;
  workerCount: number;
  executionStrategy: ExecutionStrategy;
  intent?: UserIntentV2;
  intentFrame?: IntentFrame;
  explanation: string;
  capabilityRouting?: unknown;
  compiledAt?: string;
}
