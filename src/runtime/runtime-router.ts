/**
 * RuntimeRouter — intent-aware runtime selection with evidence pass history.
 *
 * Routes capsules based on:
 * 1. NodeIntent (research, planning, coding, debugging, etc.)
 * 2. RuntimeScore (quality, cost, latency, evidence pass rate)
 * 3. Historical evidence pass rates from graph-state memory
 * 4. Fallback chain with runtime.supports() check
 */

import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { maskSensitiveText } from "../util/secret-mask.js";
import type { AgentResult, AgentRuntime, AgentRunResult, AgentTask, RuntimeCapabilities, RuntimeHealth } from "./agent-runtime.js";
import type { ContextCapsule } from "./context-capsule.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";
import { runtimeIsAdvisory, runtimeSatisfiesAuthority } from "./authority-matrix.js";
import type { HealthState, RuntimeHealthProbeKind } from "./contracts/shared.js";
import { sanitizeRuntimeStderrResult, type PrivateStderrRetentionOptions } from "./private-stderr.js";
import { classifyRuntimeFailure, type RuntimeFailureClassification } from "./runtime-failure-classifier.js";

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
  readonly healthScore: number;
  readonly evidencePassRate: number;
  readonly recentFailurePenalty: number;
  readonly healthAvailable?: boolean;
  readonly healthReason?: string;
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

interface RuntimeCircuitState {
  readonly runtimeId: string;
  readonly failureClass: RuntimeFailureClassification["failureClass"];
  readonly retryable: boolean;
  readonly openedAt: number;
  readonly expiresAt: number;
  readonly failureCount: number;
  readonly reason: string;
}

class UnsupportedRuntimeError extends Error {
  readonly code = "RUNTIME_UNSUPPORTED_TASK";
  readonly nodeId: string;
  readonly detectedRuntimes: string[];
  readonly recoverable = true;

  constructor(capsule: ContextCapsule, detectedRuntimes: string[]) {
    super([
      `No runtime supports task for node ${capsule.nodeId}.`,
      detectedRuntimes.length > 0
        ? `Detected runtimes: ${detectedRuntimes.join(", ")}.`
        : "Detected runtimes: none.",
      "Next steps: run `omk doctor --providers --json`, use `omk run --dry-run ...`, or configure a live provider/runtime.",
    ].join(" "));
    this.name = "UnsupportedRuntimeError";
    this.nodeId = capsule.nodeId;
    this.detectedRuntimes = detectedRuntimes;
  }
}

const INTENT_CAPABILITY_WEIGHTS: Record<NodeIntent, ReadonlyArray<readonly [keyof RuntimeCapabilities, number]>> = {
  research: [["read", 0.35], ["review", 0.2], ["toolCalling", 0.15], ["vision", 0.1]],
  planning: [["read", 0.3], ["review", 0.2], ["toolCalling", 0.15]],
  coding: [["write", 0.3], ["patch", 0.25], ["shell", 0.15], ["toolCalling", 0.1]],
  debugging: [["read", 0.2], ["write", 0.2], ["patch", 0.2], ["shell", 0.15], ["toolCalling", 0.1]],
  refactor: [["write", 0.25], ["patch", 0.25], ["review", 0.15], ["toolCalling", 0.1]],
  review: [["review", 0.35], ["read", 0.25], ["toolCalling", 0.1]],
  "test-generation": [["write", 0.25], ["patch", 0.2], ["review", 0.15], ["toolCalling", 0.1]],
  documentation: [["read", 0.25], ["write", 0.15], ["review", 0.15], ["toolCalling", 0.1]],
  "shell-operation": [["shell", 0.4], ["read", 0.15], ["write", 0.1]],
};

interface LegacyRuntimePolicy {
  readonly preferredProviders: readonly string[];
  readonly fallbackChain?: readonly string[];
}

export function createRuntimeRouter(options: RuntimeRouterOptions = {}) {
  let runtimes = options.runtimes ?? [];
  const memoryPath = options.memoryPath;
  let evidenceCache: EvidenceHistoryEntry[] | undefined;
  const healthCache = new Map<string, RuntimeHealth>();
  const circuitBreakers = new Map<string, RuntimeCircuitState>();

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

  async function loadEvidenceHistory(): Promise<EvidenceHistoryEntry[]> {
    if (evidenceCache) return evidenceCache;
    const filePath = memoryPath ?? join(process.cwd(), ".omk", "memory", "graph-state.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const nodes = (data.nodes ?? []) as Array<Record<string, unknown>>;
      const edges = (data.edges ?? []) as Array<Record<string, unknown>>;
      const nodeById = new Map(nodes.map((node) => [String(node.id ?? ""), node]));
      const entries: EvidenceHistoryEntry[] = [];

      for (const n of nodes) {
        if (n.type !== "Evidence") continue;
        const props = (n.properties ?? {}) as Record<string, unknown>;
        const kind = String(props.kind ?? "");
        if (kind !== "failure_pattern" && kind !== "successful_fix") continue;
        pushEvidenceHistory(entries, {
          runtime: String(props.runtime ?? "unknown"),
          intent: String(props.intent ?? "coding"),
          passed: kind === "successful_fix",
          timestamp: String(n.createdAt ?? ""),
          nodeId: String(props.sourceNodeId ?? ""),
        });
      }

      // Audit graph v2 materializes ProviderRoute -> EVIDENCED_BY -> Evidence
      // with turn-result-pass/fail evidence. Feed those observations back into
      // routing scores so successful recent routes become preferred and failed
      // runtime paths decay without relying on raw logs.
      const evidenceEdgesByRoute = new Map<string, Record<string, unknown>[]>();
      for (const edge of edges) {
        if (edge.type !== "EVIDENCED_BY") continue;
        const from = String(edge.from ?? "");
        const to = String(edge.to ?? "");
        const evidence = nodeById.get(to);
        if (!evidence || evidence.type !== "Evidence") continue;
        const list = evidenceEdgesByRoute.get(from) ?? [];
        list.push(evidence);
        evidenceEdgesByRoute.set(from, list);
      }

      for (const route of nodes) {
        if (route.type !== "ProviderRoute") continue;
        const props = (route.properties ?? {}) as Record<string, unknown>;
        const runtime = routeRuntimeId(props);
        if (!runtime) continue;
        for (const evidence of evidenceEdgesByRoute.get(String(route.id ?? "")) ?? []) {
          const evidenceProps = (evidence.properties ?? {}) as Record<string, unknown>;
          const pass = auditEvidencePassState(String(evidenceProps.kind ?? ""));
          if (pass === undefined) continue;
          pushEvidenceHistory(entries, {
            runtime,
            intent: String(props.intent ?? props.role ?? "coding"),
            passed: pass,
            timestamp: String(evidence.updatedAt ?? evidence.createdAt ?? route.updatedAt ?? route.createdAt ?? ""),
            nodeId: String(props.nodeId ?? evidenceProps.nodeId ?? ""),
          });
        }
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
    health?: RuntimeHealth,
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
    const latencyScore = runtime.capabilities?.supportsStreaming === true || runtime.capabilities?.streaming === true
      ? 0.7
      : 0.6;
    const healthScore = runtimeHealthScore(health);

    return {
      runtime: runtime.id,
      qualityScore,
      costScore,
      latencyScore,
      healthScore,
      evidencePassRate,
      recentFailurePenalty,
      ...(health && { healthAvailable: health.available }),
      ...(health?.reason && { healthReason: health.reason }),
    };
  }

  async function collectRuntimeHealth(
    candidates: readonly AgentRuntime[],
    probeKind: RuntimeHealthProbeKind = "static",
    taskRisk?: string,
  ): Promise<Map<string, RuntimeHealth>> {
    const nowMs = Date.now();
    const entries = await Promise.all(candidates.map(async (runtime): Promise<[string, RuntimeHealth]> => {
      const cached = healthCache.get(runtime.id);
      if (cached?.vector?.expiresAt && Date.parse(cached.vector.expiresAt) > nowMs && probeRank(cached.vector.lastProbeKind) >= probeRank(probeKind)) {
        return [runtime.id, cached];
      }
      if (!runtime.health) {
        const now = new Date();
        const health: RuntimeHealth = {
          runtimeId: runtime.id,
          available: true,
          checkedAt: now.toISOString(),
          vector: {
            runtimeOk: true,
            authOk: true,
            modelOk: true,
            quotaOk: true,
            rateLimitOk: true,
            runtime: "pass",
            auth: "pass",
            model: "pass",
            quota: "unknown",
            rateLimit: "unknown",
            lastProbeKind: "none",
            checkedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 30_000).toISOString(),
          },
        };
        healthCache.set(runtime.id, health);
        return [runtime.id, health];
      }
      try {
        const health = normalizeRuntimeHealth(await runtime.health({ probeKind, taskRisk, highRisk: probeKind !== "static" }));
        healthCache.set(runtime.id, health);
        return [runtime.id, health];
      } catch (err) {
        const now = new Date();
        const reason = maskSensitiveText(err instanceof Error ? err.message : String(err));
        const health: RuntimeHealth = {
          runtimeId: runtime.id,
          available: false,
          reason,
          checkedAt: now.toISOString(),
          vector: {
            runtimeOk: false,
            authOk: true,
            modelOk: true,
            quotaOk: true,
            rateLimitOk: true,
            runtime: "fail",
            auth: "unknown",
            model: "unknown",
            quota: "unknown",
            rateLimit: "unknown",
            lastProbeKind: probeKind,
            checkedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 30_000).toISOString(),
          },
        };
        healthCache.set(runtime.id, health);
        return [runtime.id, health];
      }
    }));
    return new Map(entries);
  }

  function requiredProbeForTask(task: AgentTask): RuntimeHealthProbeKind {
    const risk = task.safety?.risk;
    if (risk === "merge") return "live-call";
    if (risk === "write" || risk === "shell" || task.capabilities.write || task.capabilities.patch || task.capabilities.shell || task.capabilities.merge) {
      return "cheap-call";
    }
    return "static";
  }

  function requiredProbeForCapsule(capsule: ContextCapsule): RuntimeHealthProbeKind {
    const risk = capsule.node.routing?.risk;
    if (risk === "merge") return "live-call";
    if (risk === "write" || risk === "shell") return "cheap-call";
    return "static";
  }

  function runtimeHealthy(runtime: AgentRuntime, healthMap: ReadonlyMap<string, RuntimeHealth>, probeKind: RuntimeHealthProbeKind = "static"): boolean {
    const health = healthMap.get(runtime.id);
    if (!health) return true;
    if (health.available === false) return false;
    const vector = health.vector;
    if (!vector) return true;
    const highRiskProbe = probeRank(probeKind) >= probeRank("cheap-call");
    const hardDimensionsOk = highRiskProbe
      ? statePassStrict(vector.runtime, vector.runtimeOk)
        && statePassStrict(vector.auth, vector.authOk)
        && statePassStrict(vector.model, vector.modelOk)
      : statePassOrUnknown(vector.runtime, vector.runtimeOk)
        && statePassOrUnknown(vector.auth, vector.authOk)
        && statePassOrUnknown(vector.model, vector.modelOk);
    return hardDimensionsOk
      && statePassOrUnknown(vector.quota, vector.quotaOk)
      && statePassOrUnknown(vector.rateLimit, vector.rateLimitOk);
  }

  function runtimeCircuitOpen(runtime: AgentRuntime): RuntimeCircuitState | undefined {
    const state = circuitBreakers.get(runtime.id);
    if (!state) return undefined;
    if (state.expiresAt <= Date.now()) {
      circuitBreakers.delete(runtime.id);
      return undefined;
    }
    return state;
  }

  function clearRuntimeCircuit(runtime: AgentRuntime): void {
    circuitBreakers.delete(runtime.id);
  }

  function recordRuntimeFailure(runtime: AgentRuntime, result: AgentRunResult): AgentRunResult {
    const classification = classifyRuntimeFailure({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      metadata: result.metadata,
    });
    if (classification.failureClass === "none") return result;

    const opened = maybeOpenRuntimeCircuit(runtime.id, classification);
    return {
      ...result,
      metadata: {
        ...(result.metadata ?? {}),
        failureClass: classification.failureClass,
        failureRetryable: classification.retryable,
        failureReason: classification.reason,
        ...(opened && {
          circuitBreaker: {
            runtimeId: opened.runtimeId,
            failureClass: opened.failureClass,
            retryable: opened.retryable,
            failureCount: opened.failureCount,
            openedAt: new Date(opened.openedAt).toISOString(),
            expiresAt: new Date(opened.expiresAt).toISOString(),
            reason: opened.reason,
          },
        }),
      },
    };
  }

  function maybeOpenRuntimeCircuit(runtimeId: string, classification: RuntimeFailureClassification): RuntimeCircuitState | undefined {
    if (!classification.circuitBreaker || classification.cooldownMs <= 0) return undefined;
    const now = Date.now();
    const previous = circuitBreakers.get(runtimeId);
    const state: RuntimeCircuitState = {
      runtimeId,
      failureClass: classification.failureClass,
      retryable: classification.retryable,
      openedAt: now,
      expiresAt: now + classification.cooldownMs,
      failureCount: (previous?.failureCount ?? 0) + 1,
      reason: classification.reason,
    };
    circuitBreakers.set(runtimeId, state);
    return state;
  }

  function circuitOpenResult(runtime: AgentRuntime, state: RuntimeCircuitState, fallbackChain: readonly AgentRuntime[], intent: NodeIntent): AgentRunResult {
    return {
      success: false,
      exitCode: 78,
      stdout: "",
      stderr: `Runtime ${runtime.id} skipped by circuit breaker: ${state.failureClass}`,
      metadata: {
        runtime: runtime.id,
        selectedRuntime: runtime.id,
        intent,
        fallbackChain: fallbackChain.map((candidate) => candidate.id),
        failureClass: state.failureClass,
        failureRetryable: state.retryable,
        circuitBreakerOpen: true,
        circuitBreaker: {
          runtimeId: state.runtimeId,
          failureClass: state.failureClass,
          retryable: state.retryable,
          failureCount: state.failureCount,
          openedAt: new Date(state.openedAt).toISOString(),
          expiresAt: new Date(state.expiresAt).toISOString(),
          reason: state.reason,
        },
      },
    };
  }

  function selectByIntent(
    capsule: ContextCapsule,
    history: EvidenceHistoryEntry[],
    healthMap?: ReadonlyMap<string, RuntimeHealth>,
    probeKind: RuntimeHealthProbeKind = "static",
  ): RuntimeRouteDecision {
    const intent = classifyIntent(capsule);
    const sorted = [...runtimes].sort((a, b) => b.priority - a.priority);
    const supporting = sorted.filter((runtime) =>
      runtime.supports(capsule) &&
      runtimeAllowedByLegacyPolicy(runtime, { preferredProviders: [], fallbackChain: options.fallbackChain }) &&
      (healthMap ? runtimeHealthy(runtime, healthMap, probeKind) : true)
    );

    if (supporting.length === 0) {
      throw new UnsupportedRuntimeError(capsule, detectedRuntimeLabels(sorted));
    }

    const scores = supporting.map((r) => computeScores(r, intent, history, healthMap?.get(r.id)));

    const scored = supporting.map((r, i) => ({
      runtime: r,
      score: scores[i],
      composite: computeComposite(scores[i], r, intent),
    }));

    const capabilityScoreCache = buildCapabilityScoreCache(supporting, intent);
    scored.sort((a, b) => compareScoredRuntimes(a, b, intent, capabilityScoreCache));

    const primary = scored[0].runtime;
    const fallbacks = scored.slice(1).map((s) => s.runtime);

    const bestScore = scored[0].score;
    const reason = [
      `intent=${intent}`,
      `quality=${bestScore.qualityScore.toFixed(2)}`,
      `evidencePassRate=${bestScore.evidencePassRate.toFixed(2)}`,
      `health=${bestScore.healthScore.toFixed(2)}`,
      `recentPenalty=${bestScore.recentFailurePenalty.toFixed(2)}`,
    ].join("; ");

    return { runtime: primary, reason, fallbacks, intent, scores };
  }

  function select(capsule: ContextCapsule): RuntimeRouteDecision {
    const intent = classifyIntent(capsule);
    const sorted = [...runtimes].sort((a, b) => b.priority - a.priority);
    const supporting = sorted.filter((runtime) =>
      runtime.supports(capsule) &&
      runtimeAllowedByLegacyPolicy(runtime, { preferredProviders: [], fallbackChain: options.fallbackChain })
    );

    if (supporting.length === 0) {
      throw new UnsupportedRuntimeError(capsule, detectedRuntimeLabels(sorted));
    }

    const scored = supporting.map((r) => ({
      runtime: r,
      composite: computeRuntimeCapabilityScore(r, intent),
    }));
    // Reuse the capability scores already computed above instead of recomputing
    // them inside the comparator on every comparison.
    const capabilityScoreCache = new Map<AgentRuntime, number>(
      scored.map((s): [AgentRuntime, number] => [s.runtime, s.composite]),
    );
    scored.sort((a, b) => compareRuntimeCandidates(a.runtime, b.runtime, intent, capabilityScoreCache));

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
    const probeKind = requiredProbeForCapsule(capsule);
    const healthMap = await collectRuntimeHealth(runtimes, probeKind, capsule.node.routing?.risk);
    let decision: RuntimeRouteDecision;
    try {
      decision = selectByIntent(capsule, history, healthMap, probeKind);
    } catch (err) {
      if (err instanceof UnsupportedRuntimeError) {
        return unsupportedRuntimeResult(err);
      }
      throw err;
    }
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

      const openCircuit = runtimeCircuitOpen(runtime);
      if (openCircuit) {
        lastError = circuitOpenResult(runtime, openCircuit, allCandidates, decision.intent);
        continue;
      }

      try {
        const result = await runtime.runNode(capsule, signal);
        const routedResult = sanitizeAgentRunResult({
          ...result,
          metadata: {
            ...result.metadata,
            selectedRuntime: runtime.id,
            intent: decision.intent,
            fallbackChain: allCandidates.map((r) => r.id),
            scores: decision.scores,
          },
        }, stderrArtifactOptions({ runId: capsule.runId, nodeId: capsule.nodeId, runtimeId: runtime.id, root: process.cwd(), env: process.env }));
        if (routedResult.success) {
          clearRuntimeCircuit(runtime);
          return routedResult;
        }
        lastError = recordRuntimeFailure(runtime, routedResult);
      } catch (err) {
        const error = maskSensitiveText(String(err));
        lastError = recordRuntimeFailure(runtime, sanitizeAgentRunResult({
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: error,
          metadata: { runtime: runtime.id, error },
        }, stderrArtifactOptions({ runId: capsule.runId, nodeId: capsule.nodeId, runtimeId: runtime.id, root: process.cwd(), env: process.env })));
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

  async function executeTask(
    task: AgentTask,
    capsule: ContextCapsule,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    const history = await loadEvidenceHistory();
    const probeKind = requiredProbeForTask(task);
    const healthMap = await collectRuntimeHealth(runtimes, probeKind, task.safety?.risk);
    let decision: RuntimeRouteDecision;
    try {
      decision = selectByIntent(capsule, history, healthMap, probeKind);
    } catch (err) {
      if (err instanceof UnsupportedRuntimeError) {
        return unsupportedRuntimeResult(err);
      }
      throw err;
    }

    const allCandidates = [decision.runtime, ...decision.fallbacks];

    // Record runtime-router decision trace for executeTask, the native runtime pipeline path.
    const runId = capsule.runId;
    const attemptNumber = (capsule.node?.attempts?.length ?? 0) + 1;
    const attemptId = `${capsule.nodeId}__${attemptNumber}`;
    if (runId && !runId.startsWith("local-")) {
      const traceStore = createDecisionTraceStore();
      traceStore.record(runId, {
        component: "runtime-router",
        inputSummary: `node=${capsule.nodeId} intent=${decision.intent} path=executeTask`,
        outputDecision: `runtime=${decision.runtime.id} fallbacks=${decision.fallbacks.map((r) => r.id).join(",")}`,
        reason: decision.reason,
        scores: decision.scores.reduce((acc, s) => {
          acc[s.runtime] = computeComposite(s, allCandidates.find((candidate) => candidate.id === s.runtime) ?? decision.runtime, decision.intent);
          return acc;
        }, {} as Record<string, number>),
        nodeId: capsule.nodeId,
        attemptId,
      });
    }

    const executionCandidates = allCandidates.filter((runtime) => {
      const boundary = runtimeSatisfiesAdvisoryBoundary(runtime, task);
      if (!boundary.ok) {
        if (decision.reason && !decision.reason.includes("advisory boundary")) {
          decision = {
            ...decision,
            reason: `${decision.reason}; advisory boundary excluded ${runtime.id}`,
          };
        }
      }
      return boundary.ok;
    });

    let lastError: AgentRunResult | undefined;
    for (const runtime of executionCandidates) {
      if (signal.aborted) {
        return {
          success: false,
          exitCode: 130,
          stdout: "",
          stderr: "Aborted before execution",
          metadata: { runtime: runtime.id, selectedRuntime: runtime.id, aborted: true },
        };
      }

      const openCircuit = runtimeCircuitOpen(runtime);
      if (openCircuit) {
        lastError = circuitOpenResult(runtime, openCircuit, executionCandidates, decision.intent);
        continue;
      }

      try {
        const result = runtime.execute
          ? agentResultToRunResult(await runtime.execute(task), runtime.id)
          : await runtime.runNode(capsule, signal);
        const routedResult = sanitizeAgentRunResult({
          ...result,
          metadata: {
            ...result.metadata,
            selectedRuntime: runtime.id,
            intent: decision.intent,
            fallbackChain: executionCandidates.map((r) => r.id),
            scores: decision.scores,
          },
        }, stderrArtifactOptions({ runId: task.context.runId, nodeId: task.context.nodeId, runtimeId: runtime.id, root: task.context.cwd, env: task.context.env ?? process.env }));
        if (routedResult.success) {
          clearRuntimeCircuit(runtime);
          return routedResult;
        }
        lastError = recordRuntimeFailure(runtime, routedResult);
      } catch (err) {
        const error = maskSensitiveText(String(err));
        lastError = recordRuntimeFailure(runtime, sanitizeAgentRunResult({
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: error,
          metadata: { runtime: runtime.id, selectedRuntime: runtime.id, error },
        }, stderrArtifactOptions({ runId: task.context.runId, nodeId: task.context.nodeId, runtimeId: runtime.id, root: task.context.cwd, env: task.context.env ?? process.env })));
      }
    }

    if (executionCandidates.length === 0 && allCandidates.length > 0) {
      const advisoryFailures = allCandidates
        .map((runtime) => runtimeSatisfiesAdvisoryBoundary(runtime, task))
        .filter((boundary) => !boundary.ok);
      return {
        success: false,
        exitCode: 78,
        stdout: "",
        stderr: advisoryFailures.map((boundary) => boundary.reason).join("\n") || "All candidate runtimes are advisory-only for this task",
        metadata: { authorityMode: "advisory", advisoryBoundaryFailures: advisoryFailures.map((boundary) => boundary.reason) },
      };
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

  async function execute(
    task: AgentTask,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<AgentRunResult> {
    const capsule = capsuleFromTask(task);
    const intent = classifyIntent(capsule);
    const preferredProviders = (task.providerPolicy?.preferredProviders ?? [])
      .filter((provider) => provider && provider !== "auto");
    const legacyRuntimePolicy: LegacyRuntimePolicy = {
      preferredProviders,
      fallbackChain: task.providerPolicy?.fallbackChain ?? options.fallbackChain,
    };
    let candidates = runtimes.filter((runtime) => {
      if (!runtime.supports(capsule)) return false;
      if (!runtimeAllowedByLegacyPolicy(runtime, legacyRuntimePolicy)) return false;
      return runtimeSatisfiesTask(runtime, task);
    });

    if (preferredProviders.length > 0) {
      candidates = candidates.filter((runtime) =>
        preferredProviders.some((provider) => runtimeMatchesProvider(runtime, provider))
      );
    }

    const probeKind = requiredProbeForTask(task);
    const healthMap = await collectRuntimeHealth(candidates, probeKind, task.safety?.risk);
    candidates = candidates.filter((runtime) => runtimeHealthy(runtime, healthMap, probeKind));

    const advisoryBoundaryFailures: string[] = [];
    const nonAdvisoryCandidates = candidates.filter((runtime) => {
      const boundary = runtimeSatisfiesAdvisoryBoundary(runtime, task);
      if (!boundary.ok) advisoryBoundaryFailures.push(`${runtime.id}: ${boundary.reason}`);
      return boundary.ok;
    });
    if (nonAdvisoryCandidates.length > 0) {
      candidates = nonAdvisoryCandidates;
    } else if (advisoryBoundaryFailures.length > 0) {
      return {
        success: false,
        exitCode: 78,
        stdout: "",
        stderr: `Advisory runtime boundary blocked execution:\n${advisoryBoundaryFailures.join("\n")}`,
        metadata: { authorityMode: "advisory", advisoryBoundaryFailures },
      };
    }

    if (candidates.length === 0) {
      const mcpBlocked = task.capabilities.mcp || task.capabilities.toolCalling;
      if (mcpBlocked && runtimes.length > 0) {
        const runtime = runtimes[0];
        throw new Error(
          `Node requires MCP authority. ${runtimeDisplayName(runtime)} runtime does not receive OMK MCP authority.`
        );
      }
      if (advisoryBoundaryFailures.length > 0) {
        return {
          success: false,
          exitCode: 78,
          stdout: "",
          stderr: `Advisory runtime boundary blocked execution:\n${advisoryBoundaryFailures.join("\n")}`,
          metadata: { authorityMode: "advisory", advisoryBoundaryFailures },
        };
      }
      throw new UnsupportedRuntimeError(capsule, detectedRuntimeLabels(runtimes));
    }

    const preferredRuntimeIds = task.providerPolicy?.fallbackChain ?? options.fallbackChain ?? [];
    const history = await loadEvidenceHistory();
    const scoreByRuntime = new Map<AgentRuntime, RuntimeScore>(
      candidates.map((runtime): [AgentRuntime, RuntimeScore] => [runtime, computeScores(runtime, intent, history, healthMap.get(runtime.id))]),
    );
    const capabilityScoreCache = buildCapabilityScoreCache(candidates, intent);
    candidates.sort((a, b) => {
      const runtimeDelta = runtimePreferenceIndex(a.id, preferredRuntimeIds)
        - runtimePreferenceIndex(b.id, preferredRuntimeIds);
      if (runtimeDelta !== 0 && Math.abs(runtimeDelta) < Number.MAX_SAFE_INTEGER) return runtimeDelta;
      if (preferredProviders.length > 0) {
        const providerDelta = providerPreferenceIndex(a.id, preferredProviders)
          - providerPreferenceIndex(b.id, preferredProviders);
        if (providerDelta !== 0) return providerDelta;
      }
      const aScore = scoreByRuntime.get(a) ?? computeScores(a, intent, history, healthMap.get(a.id));
      const bScore = scoreByRuntime.get(b) ?? computeScores(b, intent, history, healthMap.get(b.id));
      return compareScoredRuntimes(
        { runtime: a, composite: computeComposite(aScore, a, intent) },
        { runtime: b, composite: computeComposite(bScore, b, intent) },
        intent,
        capabilityScoreCache,
      );
    });

    let lastError: AgentRunResult | undefined;
    for (const runtime of candidates) {
      if (signal.aborted) {
        return {
          success: false,
          exitCode: 130,
          stdout: "",
          stderr: "Aborted before execution",
          metadata: { runtime: runtime.id, selectedRuntime: runtime.id, aborted: true },
        };
      }

      const openCircuit = runtimeCircuitOpen(runtime);
      if (openCircuit) {
        lastError = circuitOpenResult(runtime, openCircuit, candidates, intent);
        continue;
      }

      try {
        const result = runtime.execute
          ? agentResultToRunResult(await runtime.execute(task), runtime.id)
          : await runtime.runNode(capsule, signal);
        const routedResult = sanitizeAgentRunResult({
          ...result,
          metadata: {
            ...result.metadata,
            selectedRuntime: runtime.id,
            intent,
            fallbackChain: candidates.map((candidate) => candidate.id),
            scores: candidates.map((candidate) => scoreByRuntime.get(candidate)).filter((score): score is RuntimeScore => score !== undefined),
          },
        }, stderrArtifactOptions({ runId: task.context.runId, nodeId: task.context.nodeId, runtimeId: runtime.id, root: task.context.cwd, env: task.context.env ?? process.env }));
        if (routedResult.success) {
          clearRuntimeCircuit(runtime);
          return routedResult;
        }
        lastError = recordRuntimeFailure(runtime, routedResult);
      } catch (err) {
        const error = maskSensitiveText(String(err));
        lastError = recordRuntimeFailure(runtime, sanitizeAgentRunResult({
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: error,
          metadata: { runtime: runtime.id, selectedRuntime: runtime.id, error },
        }, stderrArtifactOptions({ runId: task.context.runId, nodeId: task.context.nodeId, runtimeId: runtime.id, root: task.context.cwd, env: task.context.env ?? process.env })));
      }
    }

    return lastError ?? {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "No runtime available",
      metadata: { attempted: candidates.map((runtime) => runtime.id) },
    };
  }

  function invalidateCache(): void {
    evidenceCache = undefined;
  }

  return {
    select,
    selectByIntent,
    runNode,
    execute,
    executeTask,
    classifyIntent,
    listRuntimes(): AgentRuntime[] {
      return [...runtimes];
    },
    setRuntimes(nextRuntimes: AgentRuntime[]): void {
      runtimes = [...nextRuntimes];
      invalidateCache();
    },
    invalidateCache,
  };
}

function capsuleFromTask(task: AgentTask): ContextCapsule {
  const nodeId = task.context.nodeId || "runtime-task";
  const promptHash = createHash("sha256").update(task.prompt).digest("hex");
  const publicLabel = `runtime task:${promptHash.slice(0, 12)}`;
  return {
    runId: task.context.runId || "local-runtime-router",
    nodeId,
    goal: task.context.goal || publicLabel,
    task: task.prompt,
    system: task.context.system || "",
    node: {
      id: nodeId,
      name: publicLabel,
      role: task.context.role || "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
      routing: {
        promptHash,
        promptMode: "synthetic-private",
        risk: task.safety?.risk,
        approvalPolicy: task.safety?.approvalPolicy,
        sandboxMode: task.safety?.sandboxMode,
        evidenceRequired: task.safety?.evidenceRequired,
      },
    },
    dependencySummaries: [],
    evidenceRequirements: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    budget: { maxInputTokens: 0, compression: "small" },
  } as unknown as ContextCapsule;
}

function pushEvidenceHistory(entries: EvidenceHistoryEntry[], entry: EvidenceHistoryEntry): void {
  if (!entry.runtime || entry.runtime === "unknown") return;
  entries.push(entry);
}

function routeRuntimeId(props: Record<string, unknown>): string | undefined {
  const selectedRuntime = String(props.selectedRuntime ?? "").trim();
  if (selectedRuntime && selectedRuntime !== "unknown") return selectedRuntime;
  const provider = String(props.provider ?? "").trim();
  return provider && provider !== "unknown" ? provider : undefined;
}

function auditEvidencePassState(kind: string): boolean | undefined {
  if (kind === "turn-result-pass" || kind === "command-pass" || kind === "test-pass") return true;
  if (kind === "turn-result-fail" || kind === "command-fail" || kind === "test-fail") return false;
  return undefined;
}

function detectedRuntimeLabels(runtimes: readonly AgentRuntime[]): string[] {
  return [...new Set(runtimes.map((runtime) => isLegacyRuntime(runtime) ? "legacy-external-runtime" : runtime.id))];
}

function runtimeSatisfiesTask(runtime: AgentRuntime, task: AgentTask): boolean {
  if (runtime.capabilities == null) return true;
  const capabilities = runtime.capabilities as RuntimeCapabilities & { supportsToolCalling?: boolean };
  const required = task.capabilities;
  if (required.write && capabilities.write !== true) return false;
  if (required.shell && capabilities.shell !== true) return false;
  if (required.patch && capabilities.patch !== true) return false;
  if (required.merge && capabilities.merge !== true) return false;
  if (required.review && capabilities.review !== true) return false;
  if (required.vision && capabilities.vision !== true) return false;
  if (required.mcp && capabilities.mcp !== true) return false;
  if (required.toolCalling && capabilities.toolCalling !== true && capabilities.supportsToolCalling !== true) return false;
  return true;
}

/**
 * Detect advisory-only runtimes that claim broad capabilities but are not allowed
 * to execute write/shell/merge/patch/tool-calling authority. If a non-read-only
 * task reaches such a runtime, reroute it to the first non-advisory fallback.
 */
function runtimeSatisfiesAdvisoryBoundary(runtime: AgentRuntime, task: AgentTask): {
  ok: boolean;
  reroute?: AgentRuntime;
  reason?: string;
} {
  const authority = runtimeSatisfiesAuthority(runtime, task);
  if (!authority.ok) {
    return { ok: false, reason: authority.reason };
  }
  if (!runtimeIsAdvisory(runtime)) return { ok: true };
  const required = task.capabilities;
  if (
    required.write ||
    required.patch ||
    required.shell ||
    required.merge ||
    required.mcp ||
    required.toolCalling
  ) {
    return {
      ok: false,
      reason: `advisory runtime ${runtime.id} cannot execute write/shell/merge/patch/MCP/tool-calling authority`,
    };
  }
  return { ok: true };
}

function runtimeMatchesProvider(runtime: AgentRuntime, provider: string): boolean {
  const normalizedProvider = normalizeRuntimeToken(provider);
  if (normalizedProvider.length === 0) return false;
  const normalizedRuntimeId = normalizeRuntimeToken(runtime.id);
  return normalizedRuntimeId === normalizedProvider ||
    normalizedRuntimeId.startsWith(`${normalizedProvider}-`) ||
    runtimeProviderId(runtime) === normalizedProvider;
}

function runtimeAllowedByLegacyPolicy(runtime: AgentRuntime, policy: LegacyRuntimePolicy): boolean {
  if (!isLegacyRuntime(runtime)) return true;
  return legacyRuntimeExplicitlyRequested(runtime, policy);
}

function isLegacyRuntime(runtime: AgentRuntime): boolean {
  return runtime.legacy === true || runtimeModeId(runtime) === "print" || runtimeModeId(runtime) === "wire";
}

function legacyRuntimeExplicitlyRequested(runtime: AgentRuntime, policy: LegacyRuntimePolicy): boolean {
  return (policy.fallbackChain ?? []).some((request) => fallbackRequestMatchesRuntime(runtime, request));
}

function fallbackRequestMatchesRuntime(runtime: AgentRuntime, request: string): boolean {
  const normalizedRequest = normalizeRuntimeToken(request);
  if (normalizedRequest.length === 0) return false;
  const normalizedRuntimeId = normalizeRuntimeToken(runtime.id);
  if (normalizedRequest === normalizedRuntimeId) return true;
  return !normalizedRequest.includes("-") && runtimeProviderId(runtime) === normalizedRequest;
}

function runtimeProviderId(runtime: AgentRuntime): string {
  return normalizeRuntimeToken(runtime.providerId ?? runtime.id).split("-")[0] ?? "";
}

function runtimeModeId(runtime: AgentRuntime): string {
  if (runtime.runtimeMode) return normalizeRuntimeToken(runtime.runtimeMode);
  const [, ...modeParts] = normalizeRuntimeToken(runtime.id).split("-");
  return modeParts.join("-");
}

function normalizeRuntimeToken(value: string): string {
  return value.trim().toLowerCase();
}

function providerPreferenceIndex(runtimeId: string, providers: readonly string[]): number {
  if (providers.length === 0) return 0;
  const runtime = { id: runtimeId } as AgentRuntime;
  const index = providers.findIndex((provider) => runtimeMatchesProvider(runtime, provider));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function runtimePreferenceIndex(runtimeId: string, preferredRuntimeIds: readonly string[]): number {
  const index = preferredRuntimeIds.indexOf(runtimeId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function runtimeDisplayName(runtime: AgentRuntime): string {
  if (isLegacyRuntime(runtime) && !runtime.displayName) return "Legacy external runtime";
  return runtime.displayName ?? formatRuntimeId(runtime.id);
}

function formatRuntimeId(runtimeId: string): string {
  return runtimeId
    .split("-")
    .filter(Boolean)
    .map((part) => ["api", "cli", "mcp", "llm"].includes(part) ? part.toUpperCase() : titleCase(part))
    .join(" ");
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function unsupportedRuntimeResult(err: UnsupportedRuntimeError): AgentRunResult {
  return {
    success: false,
    exitCode: 78,
    stdout: "",
    stderr: err.message,
    metadata: {
      code: err.code,
      nodeId: err.nodeId,
      detectedRuntimes: err.detectedRuntimes,
      recoverable: err.recoverable,
      hint: "Run `omk doctor --providers --json` or `omk run --dry-run ...`.",
    },
  };
}

function agentResultToRunResult(result: AgentResult, runtimeId: string): AgentRunResult {
  const success = result.exitCode === 0;
  return sanitizeAgentRunResult({
    success,
    exitCode: result.exitCode,
    stdout: result.output,
    stderr: success ? "" : result.output,
    metadata: {
      runtime: runtimeId,
      ...(result.thinking != null && { thinking: result.thinking }),
      ...(result.metadata ?? {}),
    },
    tokenUsage: result.tokenUsage,
    toolCalls: result.toolCalls,
  });
}

function stderrArtifactOptions(input: PrivateStderrRetentionOptions): PrivateStderrRetentionOptions {
  return input;
}

function sanitizeAgentRunResult(result: AgentRunResult, options: PrivateStderrRetentionOptions = {}): AgentRunResult {
  return sanitizeRuntimeStderrResult(result, options);
}

const NORMALIZED_COMPOSITE_WEIGHTS = {
  quality: 0.28,
  evidence: 0.18,
  health: 0.16,
  cost: 0.10,
  latency: 0.08,
  recentSuccess: 0.10,
  capability: 0.07,
  priority: 0.03,
} as const;

function computeComposite(score: RuntimeScore, runtime: AgentRuntime, intent: NodeIntent): number {
  return (
    NORMALIZED_COMPOSITE_WEIGHTS.quality * score.qualityScore +
    NORMALIZED_COMPOSITE_WEIGHTS.evidence * score.evidencePassRate +
    NORMALIZED_COMPOSITE_WEIGHTS.health * score.healthScore +
    NORMALIZED_COMPOSITE_WEIGHTS.cost * score.costScore +
    NORMALIZED_COMPOSITE_WEIGHTS.latency * score.latencyScore +
    NORMALIZED_COMPOSITE_WEIGHTS.recentSuccess * (1 - score.recentFailurePenalty) +
    NORMALIZED_COMPOSITE_WEIGHTS.capability * computeRuntimeCapabilityScore(runtime, intent) +
    NORMALIZED_COMPOSITE_WEIGHTS.priority * runtimePriorityScore(runtime)
  );
}

function normalizeRuntimeHealth(health: RuntimeHealth): RuntimeHealth {
  const now = new Date();
  const checkedAt = health.checkedAt ?? now.toISOString();
  const vector = health.vector;
  if (!vector) {
    return {
      ...health,
      vector: {
        runtimeOk: health.available,
        authOk: health.available,
        modelOk: health.available,
        quotaOk: true,
        rateLimitOk: true,
        runtime: health.available ? "pass" : "fail",
        auth: health.available ? "pass" : "fail",
        model: health.available ? "pass" : "fail",
        quota: "unknown",
        rateLimit: "unknown",
        lastProbeKind: "none",
        checkedAt,
        expiresAt: new Date(Date.parse(checkedAt) + 30_000).toISOString(),
      },
    };
  }
  return {
    ...health,
    vector: {
      ...vector,
      runtime: vector.runtime ?? legacyBoolToState(vector.runtimeOk),
      auth: vector.auth ?? legacyBoolToState(vector.authOk),
      model: vector.model ?? legacyBoolToState(vector.modelOk),
      quota: vector.quota ?? legacyBoolToState(vector.quotaOk),
      rateLimit: vector.rateLimit ?? legacyBoolToState(vector.rateLimitOk),
      lastProbeKind: vector.lastProbeKind ?? "static",
      checkedAt: vector.checkedAt ?? checkedAt,
      expiresAt: vector.expiresAt ?? new Date(Date.parse(checkedAt) + 60_000).toISOString(),
    },
  };
}

function probeRank(kind: RuntimeHealthProbeKind | undefined): number {
  switch (kind) {
    case "live-call":
      return 3;
    case "cheap-call":
      return 2;
    case "static":
      return 1;
    default:
      return 0;
  }
}

function legacyBoolToState(value: boolean | undefined): HealthState {
  if (value === true) return "pass";
  if (value === false) return "fail";
  return "unknown";
}

function statePassOrUnknown(state: HealthState | undefined, legacy?: boolean): boolean {
  const normalized = state ?? legacyBoolToState(legacy);
  return normalized !== "fail";
}

function statePassStrict(state: HealthState | undefined, legacy?: boolean): boolean {
  const normalized = state ?? legacyBoolToState(legacy);
  return normalized === "pass";
}

function healthStatePenalty(state: HealthState | undefined, legacy: boolean | undefined, failWeight: number, unknownWeight: number): number {
  const normalized = state ?? legacyBoolToState(legacy);
  if (normalized === "fail") return failWeight;
  if (normalized === "unknown") return unknownWeight;
  return 0;
}

function runtimeHealthScore(health: RuntimeHealth | undefined): number {
  if (!health) return 1;
  const vector = health.vector;
  if (!vector) return health.available ? 1 : 0;
  let score = 1;
  score -= healthStatePenalty(vector.runtime, vector.runtimeOk, 0.25, 0.08);
  score -= healthStatePenalty(vector.auth, vector.authOk, 0.25, 0.08);
  score -= healthStatePenalty(vector.model, vector.modelOk, 0.2, 0.05);
  score -= healthStatePenalty(vector.quota, vector.quotaOk, 0.2, 0.05);
  score -= healthStatePenalty(vector.rateLimit, vector.rateLimitOk, 0.1, 0.03);
  return Math.max(0, score);
}

function compareScoredRuntimes(
  a: { runtime: AgentRuntime; composite: number },
  b: { runtime: AgentRuntime; composite: number },
  intent: NodeIntent,
  scoreCache: Map<AgentRuntime, number>,
): number {
  const compositeDelta = b.composite - a.composite;
  if (compositeDelta !== 0) return compositeDelta;
  return compareRuntimeCandidates(a.runtime, b.runtime, intent, scoreCache);
}

function compareRuntimeCandidates(
  a: AgentRuntime,
  b: AgentRuntime,
  intent: NodeIntent,
  scoreCache: Map<AgentRuntime, number>,
): number {
  const capabilityDelta =
    capabilityScoreFromCache(scoreCache, b, intent) - capabilityScoreFromCache(scoreCache, a, intent);
  if (capabilityDelta !== 0) return capabilityDelta;
  const priorityDelta = b.priority - a.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return a.id.localeCompare(b.id);
}

// Precompute each candidate's capability score ONCE before sorting. Without this the
// comparator recomputed `computeRuntimeCapabilityScore` for both operands on every
// comparison, making the sort O(r log r * c) instead of O(r log r). Keyed by runtime
// object reference so identical ids with distinct objects can never alias.
function buildCapabilityScoreCache(
  runtimes: readonly AgentRuntime[],
  intent: NodeIntent,
): Map<AgentRuntime, number> {
  const cache = new Map<AgentRuntime, number>();
  for (const runtime of runtimes) {
    if (!cache.has(runtime)) cache.set(runtime, computeRuntimeCapabilityScore(runtime, intent));
  }
  return cache;
}

function capabilityScoreFromCache(
  cache: Map<AgentRuntime, number>,
  runtime: AgentRuntime,
  intent: NodeIntent,
): number {
  const cached = cache.get(runtime);
  if (cached !== undefined) return cached;
  const computed = computeRuntimeCapabilityScore(runtime, intent);
  cache.set(runtime, computed);
  return computed;
}

/** Test-only: deterministic capability-ordered sort using the precomputed score cache.
 * Mirrors the production comparator so tests can assert identical ordering to the
 * pre-change recompute-in-comparator reference. */
export function sortRuntimesByCapabilityScore(
  runtimes: readonly AgentRuntime[],
  intent: NodeIntent,
): AgentRuntime[] {
  const cache = buildCapabilityScoreCache(runtimes, intent);
  return [...runtimes].sort((a, b) => compareRuntimeCandidates(a, b, intent, cache));
}

export function computeRuntimeCapabilityScore(runtime: AgentRuntime, intent: NodeIntent): number {
  const capabilities = runtime.capabilities;
  if (capabilities == null) return 0;

  let score = 0;
  for (const [capability, weight] of INTENT_CAPABILITY_WEIGHTS[intent]) {
    if (runtimeCapabilityEnabled(capabilities, capability)) score += weight;
  }
  if (capabilities.maxTokens != null && capabilities.maxTokens > 0) {
    score += Math.min(0.1, capabilities.maxTokens / 1_000_000);
  }
  if (capabilities.maxContextTokens != null && capabilities.maxContextTokens > 0) {
    score += Math.min(0.1, capabilities.maxContextTokens / 1_000_000);
  }
  return score;
}

function runtimeCapabilityEnabled(
  capabilities: RuntimeCapabilities,
  capability: keyof RuntimeCapabilities,
): boolean {
  if (capability === "toolCalling") {
    return capabilities.toolCalling === true || capabilities.supportsToolCalling === true;
  }
  if (capability === "streaming") {
    return capabilities.streaming === true || capabilities.supportsStreaming === true;
  }
  return capabilities[capability] === true;
}

function runtimePriorityScore(runtime: AgentRuntime): number {
  return Math.max(0, Math.min(1, runtime.priority / 100));
}
