/**
 * ContextCapsule — bounded per-node context for agent runtimes.
 *
 * OMK memory = canonical (graph-state.json, .omk/runs/).
 * Adapter-local memory = disposable (isolated HOME per node).
 */

import type { DagNode } from "../orchestration/dag.js";

export interface FileSlice {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
}

export type MemoryFactKind =
  | "project_constraint"
  | "architecture_decision"
  | "file_responsibility"
  | "api_contract"
  | "failure_pattern"
  | "successful_fix"
  | "user_preference"
  | "provider_behavior";

export interface MemoryFact {
  readonly id?: string;
  readonly kind: MemoryFactKind;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly confidence: number;
  readonly sourceRunId?: string;
  readonly sourceNodeId?: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
  /** Backward compat: derived from subject+predicate if not set */
  readonly key: string;
  /** Backward compat: derived from object if not set */
  readonly value: string;
  /** Backward compat: derived from kind if not set */
  readonly category: string;
}

export interface AttemptDigest {
  readonly attempt: number;
  readonly provider: string;
  readonly status: "done" | "failed";
  readonly durationMs?: number;
  readonly failureSummary?: string;
}

export interface EvidenceSpec {
  readonly gate: string;
  readonly ref?: string;
  readonly required: boolean;
}

export interface ContextBudget {
  readonly maxInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly maxFileTokens: number;
  readonly maxToolResultTokens: number;
  readonly maxMemoryFacts: number;
  readonly compression: "none" | "lossless-ish" | "summary" | "aggressive";
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxInputTokens: 8192,
  reservedOutputTokens: 4096,
  maxFileTokens: 4096,
  maxToolResultTokens: 2048,
  maxMemoryFacts: 10,
  compression: "lossless-ish",
};

export const CONTEXT_BUDGET_PRESETS: Record<string, ContextBudget> = {
  tiny: { maxInputTokens: 4096, reservedOutputTokens: 2048, maxFileTokens: 2048, maxToolResultTokens: 1024, maxMemoryFacts: 5, compression: "aggressive" },
  small: DEFAULT_CONTEXT_BUDGET,
  normal: { maxInputTokens: 16384, reservedOutputTokens: 8192, maxFileTokens: 8192, maxToolResultTokens: 4096, maxMemoryFacts: 20, compression: "lossless-ish" },
};

export interface ContextCapsule {
  readonly runId: string;
  readonly nodeId: string;
  readonly goal: string;
  readonly system: string;
  readonly task: string;
  readonly dependencySummaries: readonly string[];
  readonly relevantFiles: readonly FileSlice[];
  readonly graphMemory: readonly MemoryFact[];
  readonly priorAttempts: readonly AttemptDigest[];
  readonly evidenceRequirements: readonly EvidenceSpec[];
  readonly budget: ContextBudget;
  readonly node: DagNode;
}

export function estimateCapsuleTokens(capsule: ContextCapsule): number {
  const b = breakdownCapsuleTokens(capsule);
  return b.total;
}

export interface CapsuleTokenBreakdown {
  readonly system: number;
  readonly task: number;
  readonly goal: number;
  readonly dependencies: number;
  readonly files: number;
  readonly memory: number;
  readonly evidence: number;
  readonly priorAttempts: number;
  readonly total: number;
}

export function breakdownCapsuleTokens(capsule: ContextCapsule): CapsuleTokenBreakdown {
  const system = Math.ceil(capsule.system.length / 4);
  const task = Math.ceil(capsule.task.length / 4);
  const goal = Math.ceil(capsule.goal.length / 4);

  let dependencies = 0;
  for (const s of capsule.dependencySummaries) dependencies += Math.ceil(s.length / 4);

  let files = 0;
  for (const f of capsule.relevantFiles) files += Math.ceil(f.content.length / 4);

  let memory = 0;
  for (const m of capsule.graphMemory) memory += Math.ceil((m.key.length + m.value.length) / 4);

  let evidence = 0;
  for (const e of capsule.evidenceRequirements) evidence += Math.ceil((e.gate.length + (e.ref?.length ?? 0)) / 4);

  let priorAttempts = 0;
  for (const a of capsule.priorAttempts) {
    priorAttempts += Math.ceil(
      (String(a.attempt).length + a.provider.length + a.status.length + (a.failureSummary?.length ?? 0)) / 4
    );
  }

  const total = system + task + goal + dependencies + files + memory + evidence + priorAttempts;
  return { system, task, goal, dependencies, files, memory, evidence, priorAttempts, total };
}
