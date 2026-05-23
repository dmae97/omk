/**
 * RuntimeRouter — intent-aware runtime selection with evidence pass history.
 *
 * Routes capsules based on:
 * 1. NodeIntent (research, planning, coding, debugging, etc.)
 * 2. RuntimeScore (quality, cost, latency, evidence pass rate)
 * 3. Historical evidence pass rates from graph-state memory
 * 4. Fallback chain with runtime.supports() check
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { AgentRuntime, AgentRunResult, AgentTask, AgentResult } from "./agent-runtime.js";
import type { ContextCapsule } from "./context-capsule.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";

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

export interface RuntimeScore {
  readonly runtime: string;
  readonly qualityScore: number;
  readonly costScore: number;
  readonly latencyScore: number;
  readonly evidencePassRate: number;
  readonly recentFailurePenalty: number;
}

export interface RuntimeRouterOptions {
  readonly runtimes?: AgentRuntime[];
  readonly fallbackChain?: string[];
  readonly memoryPath?: string;
}

export interface RuntimeRouteDecision {
  readonly runtime: AgentRuntime;
  readonly reason: string;
  readonly fallbacks: AgentRuntime[];
  readonly intent: NodeIntent;
  readonly scores: RuntimeScore[];
}

interface EvidenceHistoryEntry {
  readonly runtime: string;
  readonly intent: string;
  readonly passed: boolean;
  readonly timestamp: string;
  readonly nodeId: string;
}

const INTENT_RUNTIME_PREFERENCES: Record<NodeIntent, string[]> = {
  research: ["kimi-cli", "kimi-api", "kimi-wire", "gemini-cli", "openrouter-api"],
  planning: ["kimi-cli", "kimi-api", "kimi-wire", "claude-code", "codex-cli"],
  coding: ["kimi-cli", "kimi-api", "kimi-wire", "codex-cli", "claude-code"],
  debugging: ["kimi-cli", "kimi-api", "kimi-wire", "codex-cli"],
  refactor: ["kimi-cli", "kimi-api", "kimi-wire", "codex-cli"],
  review: ["kimi-cli", "claude-code", "openrouter-api", "deepseek-api"],
  "test-generation": ["kimi-cli", "kimi-api", "kimi-wire", "codex-cli"],
  documentation: ["kimi-cli", "gemini-cli", "openrouter-api"],
  "shell-operation": ["kimi-cli", "kimi-api", "kimi-wire"],
};

export function createRuntimeRouter(options: RuntimeRouterOptions = {}) {
  const runtimes = options.runtimes ?? [];
  const memoryPath = options.memoryPath;
  const fallbackChain = options.fallbackChain;
  let evidenceCache: EvidenceHistoryEntry[] | undefined;

  function classifyIntent(capsule: ContextCapsule): NodeIntent {
    const text = `${capsule.nodeId} ${capsule.goal} ${capsule.task} ${capsule.system}`.toLowerCase();
    const role = capsule.node?.role?.toLowerCase() ?? "";

    if (/debug|fix|error|failure|bug|trace/.test(text) || role === "debugger") return "debugging";
    if (/review|audit|check|validate|verify/.test(text) || role === "reviewer") return "review";
    if (/test|spec|coverage|assertion/.test(text) || role === "tester") return "test-generation";
    if (/refactor|optimize|clean|improve|simplify/.test(text) || role === "refactor") return "refactor";
    if (/research|investigate|explore|search|discover|analyze/.test(text) || role === "researcher") return "research";
    if (/plan|design|architect|strategy|roadmap/.test(text) || role === "planner") return "planning";
    if (/doc|readme|changelog|comment/.test(text) || role === "documenter") return "documentation";
    if (/shell|command|run|exec|script/.test(text) || role === "shell") return "shell-operation";
    return "coding";
  }

  function classifyIntentFromTask(task: AgentTask): NodeIntent {
    const text = `${task.context.nodeId} ${task.context.goal ?? ""} ${task.prompt} ${task.context.system ?? ""}`.toLowerCase();
    const role = task.context.role?.toLowerCase() ?? "";

    if (/debug|fix|error|failure|bug|trace/.test(text) || role === "debugger") return "debugging";
    if (/review|audit|check|validate|verify/.test(text) || role === "reviewer") return "review";
    if (/test|spec|coverage|assertion/.test(text) || role === "tester") return "test-generation";
    if (/refactor|optimize|clean|improve|simplify/.test(text) || role === "refactor") return "refactor";
    if (/research|investigate|explore|search|discover|analyze/.test(text) || role === "researcher") return "research";
    if (/plan|design|architect|strategy|roadmap/.test(text) || role === "planner") return "planning";
    if (/doc|readme|changelog|comment/.test(text) || role === "documenter") return "documentation";
    if (/shell|command|run|exec|script/.test(text) || role === "shell") return "shell-operation";
    return "coding";
  }

  async function loadEvidenceHistory(): Promise<EvidenceHistoryEntry[]> {
    if (evidenceCache) return evidenceCache;
    const filePath = memoryPath ?? join(process.cwd(), ".omk", "memory", "graph-state.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const nodes = (data.nodes ?? []) as Array<Record<string, unknown>>;
      const entries: EvidenceHistoryEntry[] = [];
      for (const n of nodes) {
        if (n.type !== "Evidence") continue;
        const props = (n.properties ?? {}) as Record<string, unknown>;
        const kind = String(props.kind ?? "");
        if (kind !== "failure_pattern" && kind !== "successful_fix") continue;
        entries.push({
          runtime: String(props.runtime ?? "unknown"),
          intent: String(props.intent ?? "coding"),
          passed: kind === "successful_fix",
          timestamp: String(n.createdAt ?? ""),
          nodeId: String(props.sourceNodeId ?? ""),
        });
      }
      evidenceCache = entries;
      return entries;
    } catch {
      return [];
    }
  }

  function computeScores(
    runtime: AgentRuntime,
    intent: NodeIntent,
    history: EvidenceHistoryEntry[],
  ): RuntimeScore {
    const runtimeHistory = history.filter((e) => e.runtime === runtime.id);
    const intentHistory = runtimeHistory.filter((e) => e.intent === intent);

    const totalAttempts = runtimeHistory.length;
    const passedAttempts = runtimeHistory.filter((e) => e.passed).length;
    const evidencePassRate = totalAttempts > 0 ? passedAttempts / totalAttempts : 0.5;

    const recentFailures = runtimeHistory
      .filter((e) => !e.passed)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 5);
    const recentFailurePenalty = Math.min(0.3, recentFailures.length * 0.06);

    const intentPassRate = intentHistory.length > 0
      ? intentHistory.filter((e) => e.passed).length / intentHistory.length
      : 0.5;

    const qualityScore = 0.4 * evidencePassRate + 0.4 * intentPassRate + 0.2 * (1 - recentFailurePenalty);
    const costScore = runtime.priority > 50 ? 0.7 : 0.9;
    const latencyScore = runtime.priority > 50 ? 0.8 : 0.6;

    return {
      runtime: runtime.id,
      qualityScore,
      costScore,
      latencyScore,
      evidencePassRate,
      recentFailurePenalty,
    };
  }

  function selectByIntent(
    capsule: ContextCapsule,
    history: EvidenceHistoryEntry[],
  ): RuntimeRouteDecision {
    const intent = classifyIntent(capsule);
    const sorted = [...runtimes].sort((a, b) => b.priority - a.priority);
    const supporting = sorted.filter((r) => r.supports(capsule));

    if (supporting.length === 0) {
      throw new Error(`No runtime supports node ${capsule.nodeId}`);
    }

    const scores = supporting.map((r) => computeScores(r, intent, history));

    const preferred = fallbackChain ?? INTENT_RUNTIME_PREFERENCES[intent];
    const scored = supporting.map((r, i) => ({
      runtime: r,
      score: scores[i],
      composite: computeComposite(scores[i], preferred, r.id),
    }));

    scored.sort((a, b) => b.composite - a.composite);

    const primary = scored[0].runtime;
    const fallbacks = scored.slice(1).map((s) => s.runtime);

    const bestScore = scored[0].score;
    const reason = [
      `intent=${intent}`,
      `quality=${bestScore.qualityScore.toFixed(2)}`,
      `evidencePassRate=${bestScore.evidencePassRate.toFixed(2)}`,
      `recentPenalty=${bestScore.recentFailurePenalty.toFixed(2)}`,
    ].join("; ");

    return { runtime: primary, reason, fallbacks, intent, scores };
  }

  function selectByIntentForTask(
    task: AgentTask,
    history: EvidenceHistoryEntry[],
  ): RuntimeRouteDecision {
    const intent = classifyIntentFromTask(task);
    const sorted = [...runtimes].sort((a, b) => b.priority - a.priority);
    const supporting = sorted.filter((r) => typeof r.execute === "function");

    if (supporting.length === 0) {
      throw new Error(`No runtime supports task for node ${task.context.nodeId}`);
    }

    const scores = supporting.map((r) => computeScores(r, intent, history));

    const preferred = fallbackChain ?? INTENT_RUNTIME_PREFERENCES[intent];
    const scored = supporting.map((r, i) => ({
      runtime: r,
      score: scores[i],
      composite: computeComposite(scores[i], preferred, r.id),
    }));

    scored.sort((a, b) => b.composite - a.composite);

    const primary = scored[0].runtime;
    const fallbacks = scored.slice(1).map((s) => s.runtime);

    const bestScore = scored[0].score;
    const reason = [
      `intent=${intent}`,
      `quality=${bestScore.qualityScore.toFixed(2)}`,
      `evidencePassRate=${bestScore.evidencePassRate.toFixed(2)}`,
      `recentPenalty=${bestScore.recentFailurePenalty.toFixed(2)}`,
    ].join("; ");

    return { runtime: primary, reason, fallbacks, intent, scores };
  }

  function select(capsule: ContextCapsule): RuntimeRouteDecision {
    const intent = classifyIntent(capsule);
    const sorted = [...runtimes].sort((a, b) => b.priority - a.priority);
    const supporting = sorted.filter((r) => r.supports(capsule));

    if (supporting.length === 0) {
      throw new Error(`No runtime supports node ${capsule.nodeId}`);
    }

    const preferred = fallbackChain ?? INTENT_RUNTIME_PREFERENCES[intent];
    const scored = supporting.map((r) => ({
      runtime: r,
      composite: preferred.indexOf(r.id) >= 0 ? r.priority + 10 : r.priority,
    }));
    scored.sort((a, b) => b.composite - a.composite);

    const primary = scored[0].runtime;
    const fallbacks = scored.slice(1).map((s) => s.runtime);

    return {
      runtime: primary,
      reason: `intent=${intent}; priority-based (async history not loaded)`,
      fallbacks,
      intent,
      scores: [],
    };
  }

  async function runNode(capsule: ContextCapsule, signal: AbortSignal): Promise<AgentRunResult> {
    const history = await loadEvidenceHistory();
    const decision = selectByIntent(capsule, history);
    const allCandidates = [decision.runtime, ...decision.fallbacks];

    // Record runtime-router decision trace
    const runId = capsule.runId;
    const attemptNumber = (capsule.node?.attempts?.length ?? 0) + 1;
    const attemptId = `${capsule.nodeId}__${attemptNumber}`;
    if (runId && !runId.startsWith("local-")) {
      const traceStore = createDecisionTraceStore();
      traceStore.record(runId, {
        component: "runtime-router",
        inputSummary: `node=${capsule.nodeId} intent=${decision.intent}`,
        outputDecision: `runtime=${decision.runtime.id} fallbacks=${decision.fallbacks.map((r) => r.id).join(",")}`,
        reason: decision.reason,
        scores: decision.scores.reduce((acc, s) => {
          acc[s.runtime] = s.qualityScore;
          return acc;
        }, {} as Record<string, number>),
        nodeId: capsule.nodeId,
        attemptId,
      });
    }

    let lastError: AgentRunResult | undefined;
    for (const runtime of allCandidates) {
      if (signal.aborted) {
        return {
          success: false,
          exitCode: 130,
          stdout: "",
          stderr: "Aborted before execution",
          metadata: { runtime: runtime.id, aborted: true },
        };
      }

      try {
        const result = await runtime.runNode(capsule, signal);
        if (result.success) {
          return {
            ...result,
            metadata: {
              ...result.metadata,
              selectedRuntime: runtime.id,
              intent: decision.intent,
              fallbackChain: allCandidates.map((r) => r.id),
              scores: decision.scores,
            },
          };
        }
        lastError = result;
      } catch (err) {
        lastError = {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: String(err),
          metadata: { runtime: runtime.id, error: String(err) },
        };
      }
    }

    return (
      lastError ?? {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "No runtime available",
        metadata: { attempted: allCandidates.map((r) => r.id) },
      }
    );
  }

  async function execute(task: AgentTask): Promise<AgentResult> {
    const history = await loadEvidenceHistory();
    const decision = selectByIntentForTask(task, history);
    const allCandidates = [decision.runtime, ...decision.fallbacks];

    // Record runtime-router decision trace
    const runId = task.context.runId;
    const attemptId = `${task.context.nodeId}__1`;
    if (runId && !runId.startsWith("local-")) {
      const traceStore = createDecisionTraceStore();
      traceStore.record(runId, {
        component: "runtime-router",
        inputSummary: `node=${task.context.nodeId} intent=${decision.intent}`,
        outputDecision: `runtime=${decision.runtime.id} fallbacks=${decision.fallbacks.map((r) => r.id).join(",")}`,
        reason: decision.reason,
        scores: decision.scores.reduce((acc, s) => {
          acc[s.runtime] = s.qualityScore;
          return acc;
        }, {} as Record<string, number>),
        nodeId: task.context.nodeId,
        attemptId,
      });
    }

    let lastError: AgentResult | undefined;
    for (const runtime of allCandidates) {
      if (task.context.abortSignal?.aborted) {
        return {
          output: "",
          exitCode: 130,
          metadata: { runtime: runtime.id, aborted: true },
        };
      }

      if (typeof runtime.execute !== "function") {
        continue;
      }

      try {
        const result = await runtime.execute(task);
        if (result.exitCode === 0) {
          return {
            ...result,
            metadata: {
              ...result.metadata,
              selectedRuntime: runtime.id,
              intent: decision.intent,
              fallbackChain: allCandidates.map((r) => r.id),
              scores: decision.scores,
            },
          };
        }
        lastError = result;
      } catch (err) {
        lastError = {
          output: "",
          exitCode: 1,
          metadata: { runtime: runtime.id, error: String(err) },
        };
      }
    }

    return (
      lastError ?? {
        output: "No runtime available",
        exitCode: 1,
        metadata: { attempted: allCandidates.map((r) => r.id) },
      }
    );
  }

  function invalidateCache(): void {
    evidenceCache = undefined;
  }

  return {
    select,
    selectByIntent,
    runNode,
    execute,
    classifyIntent,
    listRuntimes(): AgentRuntime[] {
      return [...runtimes];
    },
    invalidateCache,
  };
}

function computeComposite(
  score: RuntimeScore,
  preferred: string[],
  runtimeId: string,
): number {
  const preferenceBonus = preferred.indexOf(runtimeId) >= 0 ? 0.15 : 0;
  return (
    0.35 * score.qualityScore +
    0.25 * score.evidencePassRate +
    0.15 * score.costScore +
    0.1 * score.latencyScore +
    0.15 * (1 - score.recentFailurePenalty) +
    preferenceBonus
  );
}
