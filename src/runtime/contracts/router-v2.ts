/**
 * Router v2 contracts — Evidence-Calibrated Runtime Router (Algorithm 6)
 */

import type { AgentRuntime } from "../agent-runtime.js";

export type NodeIntent =
  | "research"
  | "planning"
  | "coding"
  | "debugging"
  | "refactor"
  | "review"
  | "test-generation"
  | "documentation"
  | "shell-operation";

export interface EvidenceHistoryEntry {
  readonly runtime: string;
  readonly intent: string;
  readonly passed: boolean;
  readonly timestamp: string;
  readonly nodeId: string;
}

export interface RuntimeScoreV2 {
  readonly runtimeId: string;
  readonly bayesianEvidenceScore: number;
  readonly confidence: number;
  readonly capabilityFit: number;
  readonly maturityScore: number;
  readonly latencyScore: number;
  readonly costScore: number;
  readonly recentFailurePenalty: number;
  readonly blastRadiusPenalty: number;
  readonly composite: number;
}

export interface RuntimeRouterDecisionV2 {
  readonly runtime: AgentRuntime;
  readonly reason: string;
  readonly fallbacks: AgentRuntime[];
  readonly intent: NodeIntent;
  readonly scores: RuntimeScoreV2[];
}

export interface BlastRadiusParams {
  readonly downstreamNodeCount: number;
  readonly affectedFileCount: number;
  readonly hasGlobalSideEffects: boolean;
}

export interface RouterV2Options {
  readonly enableBlastRadius?: boolean;
  readonly blastRadiusParams?: BlastRadiusParams;
}

export interface RouterV2ScoringEngine {
  score(runtime: AgentRuntime, intent: NodeIntent, history: EvidenceHistoryEntry[]): RuntimeScoreV2;
  select(candidates: AgentRuntime[], intent: NodeIntent, history: EvidenceHistoryEntry[]): RuntimeRouterDecisionV2;
}
