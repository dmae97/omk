// Contract: src/contracts/dag.ts
// Owner: Contract Worker (Phase 0)
// Read-only for all other workers. Version-bump only via Integration Worker.

import type { DeepSeekModelTier, DeepSeekParticipation, ProviderAuthority, ProviderId } from "../providers/types.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked" | "skipped";
export type DagContextBudget = "tiny" | "small" | "normal";
export type DagOutputGate = "file-exists" | "test-pass" | "review-pass" | "command-pass" | "summary" | "artifact" | "diff" | "none";

export interface DagNodeInput {
  name: string;
  ref: string;
  from?: string;
  required?: boolean;
}

export interface DagNodeOutput {
  name: string;
  ref?: string;
  gate?: DagOutputGate;
  required?: boolean;
}

export interface DagNodeRouting {
  provider?: "auto" | ProviderId;
  fallbackProvider?: ProviderId;
  providerReason?: string;
  providerModel?: string;
  providerModelTier?: DeepSeekModelTier;
  assignedProvider?: ProviderId;
  candidateProviders?: ProviderId[];
  assignedModel?: string;
  assignedProviderAuthority?: ProviderAuthority | DeepSeekParticipation;
  assignedProviderCapabilities?: string[];
  assignedCapabilities?: {
    skills?: string[];
    mcpServers?: string[];
    tools?: string[];
    hooks?: string[];
  };
  autoSpawned?: boolean;
  spawnReason?: string;
  routeSource?: "skill" | "mcp" | "hook" | "provider";
  /**
   * Skills/MCP/tools are routing hints for the Kimi runtime by default.
   * Set these booleans only when a node cannot run without live MCP/tool
   * authority; opportunistic providers can still advise from the hint list.
   */
  requiresMcp?: boolean;
  requiresToolCalling?: boolean;
  skills?: string[];
  mcpServers?: string[];
  tools?: string[];
  hooks?: string[];
  contextBudget?: DagContextBudget;
  readOnly?: boolean;
  risk?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  executionPrompt?: string;
  promptMode?: string;
  runtimeSidecar?: unknown;
  evidenceRequired?: boolean;
  rationale?: string;
  replanHint?: {
    criterionId?: string;
    artifactRef?: string;
    targetAtomId?: string;
    preserveEvidence?: boolean;
  };
  /** Freedomd sovereignty metadata for provider-independent routing. */
  freedomd?: {
    dataBoundary?: "public" | "internal" | "customer" | "secret";
    preferredProvider?: string;
    allowProviderExceptions?: boolean;
    degradedMode?: string;
    sovereigntyReason?: string;
  };
  rejected?: Array<{ id: string; reason: string }>;
  actionAtom?: {
    id: string;
    label: string;
    verb: string;
    object?: string;
    evidenceTarget: string;
    doneCondition: string;
  };
}

export interface DagNodeFailurePolicy {
  retryable?: boolean;
  blockDependents?: boolean;
  fallbackRole?: string;
  skipOnFailure?: boolean;
}

export interface DagNodeEvidence {
  gate: string;
  passed: boolean;
  ref?: string;
  message?: string;
  failureKind?: string;
}

export interface DagNodeAttempt {
  attempt: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status?: "done" | "failed";
  provider?: ProviderId;
  requestedProvider?: ProviderId;
  fallbackFrom?: ProviderId;
  fallbackReason?: string;
  providerModel?: string;
  providerModelTier?: DeepSeekModelTier;
  providerParticipation?: DeepSeekParticipation;
}

export interface DagNode {
  id: string;
  name: string;
  role: string;
  dependsOn: string[];
  status: TaskStatus;
  worktree?: string;
  retries: number;
  maxRetries: number;
  timeoutMs?: number;
  timeoutPreset?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempts?: DagNodeAttempt[];
  priority?: number;
  cost?: 1 | 2 | 3;
  inputs?: DagNodeInput[];
  outputs?: DagNodeOutput[];
  routing?: DagNodeRouting;
  executionMode?: "local" | "dry-run" | "advisory" | "live" | string;
  failurePolicy?: DagNodeFailurePolicy;
  blockedReason?: string;
  evidence?: DagNodeEvidence[];
  /** Live "thinking" text exposed while the node is running (e.g. ensemble progress). */
  thinking?: string;
}

export interface Dag {
  nodes: DagNode[];
}

export type DagNodeDefinition = Omit<DagNode, "status" | "retries">;
