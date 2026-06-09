/**
 * Benchmark contracts — omk.benchmark.v1
 *
 * Reproducible evaluation surface for OMK control plane tasks.
 */

import type { AttemptRecord, AttemptStatus, RuntimeId } from "../evidence/attempt-record.js";
import type { DecisionTraceEntry } from "../contracts/replay.js";
import type { RuntimeRouterDecisionV2, RuntimeScoreV2 } from "../runtime/contracts/router-v2.js";
import type { RuntimeRouteDecision } from "../runtime/runtime-router.js";

export const BENCHMARK_SCHEMA_VERSION = "omk.benchmark.v1";

export type BenchmarkTaskCategory =
  | "read-only-repo-qa"
  | "small-bug-fix"
  | "failing-test-repair"
  | "multi-file-refactor"
  | "cli-command-task"
  | "dependency-update"
  | "merge-conflict-task"
  | "security-sensitive-task"
  | "provider-failure-fallback"
  | "quota-auth-failure-fallback";

export interface BenchmarkTask {
  readonly taskId: string;
  readonly category: BenchmarkTaskCategory;
  readonly intent: string;
  readonly description: string;
  readonly treeHash: string;
  readonly seed: number;
  readonly providerConfigHash: string;
  readonly omkVersion: string;
  readonly worktreePath?: string;
  readonly relevantFiles: readonly string[];
  readonly expectedOutcome: "success" | "failure" | "fallback";
  readonly recordedAttempts: readonly BenchmarkAttemptStub[];
}

export interface BenchmarkAttemptStub {
  readonly attemptId: string;
  readonly runtime: RuntimeId;
  readonly model: string;
  readonly provider: string;
  readonly status: AttemptStatus;
  readonly latencyMs: number;
  readonly inputTokensEstimated: number;
  readonly outputTokensEstimated: number;
  readonly costUsdEstimated: number;
  readonly evidenceResults: readonly { gate: string; passed: boolean }[];
  readonly changedFiles: readonly string[];
  readonly commandsRun: readonly string[];
  readonly summary: string;
  readonly error?: string;
}

export interface BenchmarkRunResult {
  readonly taskId: string;
  readonly solved: boolean;
  readonly evidenceTrustScore: number;
  readonly falseDone: boolean;
  readonly fallbackUsed: boolean;
  readonly fallbackSucceeded: boolean;
  readonly routerRegret: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly rolledBack: boolean;
  readonly sandboxViolations: number;
  readonly attemptCount: number;
  readonly decisions: readonly BenchmarkDecisionRecord[];
}

export interface BenchmarkDecisionRecord {
  readonly component: "runtime-router-v1" | "runtime-router-v2" | "provider-router";
  readonly selectedRuntime: string;
  readonly bestAvailableRuntime: string;
  readonly regret: number;
  readonly reason: string;
  readonly scoresV2?: readonly RuntimeScoreV2[];
}

export interface BenchmarkSummary {
  readonly schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly treeHash: string;
  readonly seed: number;
  readonly providerConfigHash: string;
  readonly omkVersion: string;
  readonly mode: "shadow" | "live";
  readonly totalTasks: number;
  readonly solvedCount: number;
  readonly solveRate: number;
  readonly evidenceTrustScoreMean: number;
  readonly falseDoneRate: number;
  readonly fallbackSuccessRate: number;
  readonly routerRegretMean: number;
  readonly costPerSolvedTask: number;
  readonly p95LatencyMs: number;
  readonly rollbackRate: number;
  readonly sandboxViolationCount: number;
  readonly results: readonly BenchmarkRunResult[];
}

export interface ShadowModeRecord {
  readonly taskId: string;
  readonly nodeId: string;
  readonly intent: string;
  readonly v1Decision: RuntimeRouteDecision | null;
  readonly v2Decision: RuntimeRouterDecisionV2 | null;
  readonly regretV1: number;
  readonly regretV2: number;
  readonly disagreement: boolean;
  readonly timestamp: string;
}

export interface BenchmarkConfig {
  readonly mode: "shadow" | "live";
  readonly tasksDir: string;
  readonly outputDir: string;
  readonly runId: string;
  readonly maxConcurrency: number;
  readonly pinTreeHash?: string;
  readonly pinSeed?: number;
  readonly pinProviderConfigHash?: string;
  readonly categories?: readonly BenchmarkTaskCategory[];
}

export interface BenchmarkFixture {
  readonly tasks: readonly BenchmarkTask[];
  readonly version: string;
}
