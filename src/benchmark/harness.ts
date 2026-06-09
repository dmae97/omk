/**
 * Benchmark Harness — run benchmark suite, compute metrics, write report.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type {
  BenchmarkConfig,
  BenchmarkTask,
  BenchmarkRunResult,
  BenchmarkSummary,
  BenchmarkAttemptStub,
} from "./contracts.js";
import { generateSyntheticTraces, loadRecordedTraces, hashConfig } from "./fixtures.js";
import { createShadowModeEngine } from "./shadow-mode.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import type { ContextCapsule } from "../runtime/context-capsule.js";
import { createEvidenceTrustScoreV2Engine } from "../evidence/evidence-trust-score.js";
import type { EvidenceHistoryEntry } from "../runtime/contracts/router-v2.js";
import type { EvidenceKind, EvidenceVerdict } from "../runtime/contracts/evidence.js";

export interface HarnessOptions {
  readonly config: BenchmarkConfig;
  readonly runtimes: AgentRuntime[];
  readonly history?: EvidenceHistoryEntry[];
}

function capsuleFromTask(task: BenchmarkTask): ContextCapsule {
  return {
    runId: task.taskId,
    nodeId: task.taskId,
    goal: task.description,
    system: "Benchmark system prompt",
    task: task.description,
    dependencySummaries: [],
    relevantFiles: task.relevantFiles.map((path) => ({
      path,
      startLine: 1,
      endLine: 10,
      content: "// synthetic",
    })),
    graphMemory: [],
    priorAttempts: [],
    evidenceRequirements: [],
    budget: { maxInputTokens: 8000, reservedOutputTokens: 4096, maxFileTokens: 4096, maxToolResultTokens: 2048, maxMemoryFacts: 10, compression: "lossless-ish" },
    node: {
      id: task.taskId,
      name: task.description,
      role: "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
    },
  };
}

function mapGateToKind(gate: string): EvidenceKind {
  switch (gate) {
    case "test": return "test";
    case "lint": return "command";
    case "audit": return "audit";
    case "review": return "review";
    case "command": return "command";
    case "stdout-match": return "trace";
    case "diff": return "diff";
    default: return "trace";
  }
}

function attemptToEvidenceItem(attempt: BenchmarkAttemptStub) {
  return attempt.evidenceResults.map((ev) => ({
    id: `${attempt.attemptId}-${ev.gate}`,
    kind: mapGateToKind(ev.gate),
    source: "runner" as const,
    description: ev.gate,
    verdict: (ev.passed ? "pass" : "fail") as EvidenceVerdict,
    timestamp: new Date().toISOString(),
    confidence: 0.9,
    linkedFilePaths: [...attempt.changedFiles],
  }));
}

export async function runBenchmarkSuite(options: HarnessOptions): Promise<BenchmarkSummary> {
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();
  const { config, runtimes, history = [] } = options;

  await mkdir(config.outputDir, { recursive: true });

  // Load tasks
  const tasks: BenchmarkTask[] = [];
  if (config.mode === "shadow") {
    const version = process.env.npm_package_version ?? "0.0.0";
    const treeHash = config.pinTreeHash ?? "synthetic";
    const seed = config.pinSeed ?? 42;
    const providerHash = config.pinProviderConfigHash ?? hashConfig(runtimes.map((r) => r.id));
    const fixture = generateSyntheticTraces(2, seed, version, treeHash, providerHash);
    tasks.push(...fixture.tasks);
  } else {
    const fixture = await loadRecordedTraces(config.tasksDir);
    tasks.push(...fixture.tasks);
  }

  if (config.categories && config.categories.length > 0) {
    const allowed = new Set(config.categories);
    const filtered = tasks.filter((t) => allowed.has(t.category));
    tasks.length = 0;
    tasks.push(...filtered);
  }

  const shadowEngine = createShadowModeEngine({ runtimes, history });
  const etsEngine = createEvidenceTrustScoreV2Engine();

  const results: BenchmarkRunResult[] = [];

  for (const task of tasks) {
    const capsule = capsuleFromTask(task);
    const shadowRecord = shadowEngine.evaluate(task.taskId, task.taskId, capsule);
    const decisions = shadowEngine.toBenchmarkDecision(shadowRecord);

    // Simulate execution using recorded attempts
    const lastAttempt = task.recordedAttempts[task.recordedAttempts.length - 1];
    const solved = lastAttempt?.status === "success";
    const fallbackUsed = task.recordedAttempts.length > 1;
    const fallbackSucceeded = fallbackUsed && solved;
    const rolledBack = task.recordedAttempts.some((a) => a.status === "cancelled");
    const sandboxViolations = task.recordedAttempts.some((a) =>
      a.changedFiles.some((f) => f.startsWith("/") && !f.includes("worktree")),
    )
      ? 1
      : 0;

    // ETS v2 evaluation
    const allEvidence = task.recordedAttempts.flatMap((a) => attemptToEvidenceItem(a));
    const etsResult = await etsEngine.evaluate({
      output: lastAttempt?.summary ?? "",
      taskType: task.category.includes("security") ? "security" : "feature",
      risk: task.category.includes("security") ? "critical" : "medium",
      runArtifacts: {
        items: allEvidence,
        meta: {
          runId: task.taskId,
          nodeId: task.taskId,
          provider: lastAttempt?.provider ?? "unknown",
          model: lastAttempt?.model ?? "unknown",
          cwd: "[repo-root]",
          treeHashBefore: task.treeHash,
          treeHashAfter: task.treeHash,
          commandHash: hashConfig(task.recordedAttempts.map((a) => a.commandsRun)),
          timestamp: new Date().toISOString(),
          command: task.recordedAttempts.map((a) => a.commandsRun.join("; ")).join(" || "),
        },
      },
      dependencyGraphFiles: task.relevantFiles,
    });

    const falseDone = !solved && etsResult.verdict === "pass";

    const totalLatency = task.recordedAttempts.reduce((s, a) => s + a.latencyMs, 0);
    const totalCost = task.recordedAttempts.reduce((s, a) => s + a.costUsdEstimated, 0);

    results.push({
      taskId: task.taskId,
      solved,
      evidenceTrustScore: etsResult.score,
      falseDone,
      fallbackUsed,
      fallbackSucceeded,
      routerRegret: shadowRecord.regretV2,
      costUsd: totalCost,
      latencyMs: totalLatency,
      rolledBack,
      sandboxViolations,
      attemptCount: task.recordedAttempts.length,
      decisions,
    });
  }

  const completedAt = new Date().toISOString();
  const durationMs = Math.round(performance.now() - startedMs);

  const solvedCount = results.filter((r) => r.solved).length;
  const totalTasks = results.length;
  const solveRate = totalTasks > 0 ? solvedCount / totalTasks : 0;
  const evidenceMean = totalTasks > 0 ? results.reduce((s, r) => s + r.evidenceTrustScore, 0) / totalTasks : 0;
  const falseDoneRate = totalTasks > 0 ? results.filter((r) => r.falseDone).length / totalTasks : 0;
  const fallbackAttempts = results.filter((r) => r.fallbackUsed);
  const fallbackSuccessRate = fallbackAttempts.length > 0
    ? fallbackAttempts.filter((r) => r.fallbackSucceeded).length / fallbackAttempts.length
    : 0;
  const routerRegretMean = totalTasks > 0 ? results.reduce((s, r) => s + r.routerRegret, 0) / totalTasks : 0;
  const costPerSolved = solvedCount > 0 ? results.reduce((s, r) => s + r.costUsd, 0) / solvedCount : 0;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1] : 0;
  const rollbackRate = totalTasks > 0 ? results.filter((r) => r.rolledBack).length / totalTasks : 0;
  const sandboxViolationCount = results.reduce((s, r) => s + r.sandboxViolations, 0);

  const summary: BenchmarkSummary = {
    schemaVersion: "omk.benchmark.v1",
    runId: config.runId,
    startedAt,
    completedAt,
    durationMs,
    treeHash: config.pinTreeHash ?? "synthetic",
    seed: config.pinSeed ?? 42,
    providerConfigHash: config.pinProviderConfigHash ?? hashConfig(runtimes.map((r) => r.id)),
    omkVersion: process.env.npm_package_version ?? "0.0.0",
    mode: config.mode,
    totalTasks,
    solvedCount,
    solveRate,
    evidenceTrustScoreMean: evidenceMean,
    falseDoneRate,
    fallbackSuccessRate,
    routerRegretMean,
    costPerSolvedTask: costPerSolved,
    p95LatencyMs: p95Latency,
    rollbackRate,
    sandboxViolationCount,
    results,
  };

  const outPath = join(config.outputDir, `${config.runId}.json`);
  await writeFile(outPath, JSON.stringify(summary, null, 2), "utf-8");

  return summary;
}

export { createShadowModeEngine, computeRouterRegret } from "./shadow-mode.js";
