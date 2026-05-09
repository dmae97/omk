// Contract: src/contracts/orchestration.ts
// Owner: Contract Worker (Phase 0)
// Read-only for all other workers. Version-bump only via Integration Worker.

import type { Dag, DagNode } from "../orchestration/dag.js";

export type ApprovalPolicy = "interactive" | "auto" | "yolo" | "block";

export interface TaskResult {
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

export interface TimeoutPreset {
  name: string;
  timeoutMs: number;
  description?: string;
}

export interface CronJob {
  name: string;
  schedule: string;
  dagFile: string;
  concurrencyPolicy: "allow" | "forbid" | "replace";
  enabled: boolean;
  catchup: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  timeoutPreset?: string;
}

export interface CronRun {
  jobName: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
  runId: string;
  logPath: string;
  error?: string;
}

export interface NodeMonitor {
  nodeId: string;
  runId: string;
  lastHeartbeatAt: string;
  stallThresholdMs: number;
  status: "healthy" | "stalled" | "recovered";
}

export interface RunOptions {
  runId: string;
  workers: number;
  approvalPolicy: ApprovalPolicy;
  worktreeRoot?: string;
  nodeTimeoutMs?: number;
  timeoutPreset?: string;
  heartbeatIntervalMs?: number;
}

export type TaskType =
  | "explore"
  | "implement"
  | "bugfix"
  | "refactor"
  | "research"
  | "review"
  | "plan"
  | "test"
  | "document"
  | "migrate"
  | "security"
  | "general";

export type NextAction = "continue" | "replan" | "block" | "handoff" | "close";

export interface UserIntent {
  taskType: TaskType;
  complexity: "simple" | "moderate" | "complex";
  estimatedWorkers: number;
  requiredRoles: string[];
  isReadOnly: boolean;
  needsResearch: boolean;
  needsSecurityReview: boolean;
  needsTesting: boolean;
  needsDesignReview: boolean;
  parallelizable: boolean;
  rationale: string;
}

export type EstimateConfidence = "low" | "medium" | "high";

export interface RunProgressEstimate {
  elapsedMs: number;
  completedNodes: number;
  runningNodes: number;
  pendingNodes: number;
  failedNodes: number;
  blockedNodes: number;
  totalNodes: number;
  workerCount: number;
  percentComplete: number;
  fallbackDurationMs: number;
  averageCompletedDurationMs?: number;
  estimatedRemainingMs?: number;
  estimatedCompletedAt?: string;
  confidence: EstimateConfidence;
  updatedAt: string;
}

export interface TeamRuntimeWindowStatus {
  index: number;
  name: string;
  role: "coordinator" | "worker" | "reviewer" | "hud" | "unknown";
  nodeId?: string;
  status: "expected" | "present" | "missing";
  paneCount?: number;
}

export interface TeamRuntimeStatus {
  session: string;
  status: "starting" | "ready" | "attached" | "detached" | "missing";
  workerCount: number;
  reviewerCount: number;
  coordinatorPanes: number;
  statePath: string;
  windows: TeamRuntimeWindowStatus[];
  updatedAt: string;
}

export interface RunState {
  schemaVersion: 1;
  runId: string;
  goalId?: string;
  goalSnapshot?: {
    title: string;
    objective: string;
    successCriteria: Array<{ id: string; description: string; requirement: string }>;
  };
  nodes: DagNode[];
  startedAt: string;
  completedAt?: string;
  estimate?: RunProgressEstimate;
  iterationCount?: number;
  maxIterations?: number;
  /** ISO timestamp of the last time this state was persisted (activity or commit). */
  updatedAt?: string;
  /** ISO timestamp of the last meaningful worker activity (thinking update, node start/complete). */
  lastActivityAt?: string;
  /** ISO timestamp of the last heartbeat emit (may be more frequent than persist). */
  lastHeartbeatAt?: string;
  /** Monotonically-increasing sequence number for activity ordering. */
  activitySeq?: number;
  /** tmux/team runtime status snapshot for `omk team` and HUD reporting. */
  teamRuntime?: TeamRuntimeStatus;
}

export interface RunResult {
  state: RunState;
  success: boolean;
}

export interface TaskRunner {
  run(node: DagNode, env: Record<string, string>): Promise<TaskResult>;
  /** Optional live-thinking callback so the executor can surface runner progress. */
  onThinking?: (thinking: string) => void;
  /** Create a new runner with an isolated onThinking callback (parallel-safe). */
  fork?: (onThinking?: (thinking: string) => void) => TaskRunner;
}

export interface DagExecutor {
  execute(dag: Dag, runner: TaskRunner, options: RunOptions): Promise<RunResult>;
  onStateChange(handler: (state: RunState) => void): () => void;
  onNodeStart?(handler: (node: DagNode) => void): () => void;
  onNodeComplete?(handler: (node: DagNode, result: TaskResult) => void): () => void;
}
