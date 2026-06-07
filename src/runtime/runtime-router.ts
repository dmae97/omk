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
import type { AgentResult, AgentRuntime, AgentRunResult, AgentTask, RuntimeCapabilities } from "./agent-runtime.js";
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
    const latencyScore = runtime.capabilities?.supportsStreaming === true || runtime.capabilities?.streaming === true
      ? 0.7
      : 0.6;

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
    const supporting = sorted.filter((runtime) =>
      runtime.supports(capsule) &&
      runtimeAllowedByLegacyPolicy(runtime, { preferredProviders: [], fallbackChain: options.fallbackChain })
    );

    if (supporting.length === 0) {
      throw new UnsupportedRuntimeError(capsule, detectedRuntimeLabels(sorted));
    }

    const scores = supporting.map((r) => computeScores(r, intent, history));

    const scored = supporting.map((r, i) => ({
      runtime: r,
      score: scores[i],
      composite: computeComposite(scores[i], r, intent),
    }));

    scored.sort((a, b) => compareScoredRuntimes(a, b, intent));

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
    scored.sort((a, b) => compareRuntimeCandidates(a.runtime, b.runtime, intent));

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
    let decision: RuntimeRouteDecision;
    try {
      decision = selectByIntent(capsule, history);
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

  async function executeTask(
    task: AgentTask,
    capsule: ContextCapsule,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    const history = await loadEvidenceHistory();
    let decision: RuntimeRouteDecision;
    try {
      decision = selectByIntent(capsule, history);
    } catch (err) {
      if (err instanceof UnsupportedRuntimeError) {
        return unsupportedRuntimeResult(err);
      }
      throw err;
    }

    const allCandidates = [decision.runtime, ...decision.fallbacks];
    let lastError: AgentRunResult | undefined;
    for (const runtime of allCandidates) {
      if (signal.aborted) {
        return {
          success: false,
          exitCode: 130,
          stdout: "",
          stderr: "Aborted before execution",
          metadata: { runtime: runtime.id, selectedRuntime: runtime.id, aborted: true },
        };
      }

      try {
        const result = runtime.execute
          ? agentResultToRunResult(await runtime.execute(task), runtime.id)
          : await runtime.runNode(capsule, signal);
        const routedResult: AgentRunResult = {
          ...result,
          metadata: {
            ...result.metadata,
            selectedRuntime: runtime.id,
            intent: decision.intent,
            fallbackChain: allCandidates.map((r) => r.id),
            scores: decision.scores,
          },
        };
        if (routedResult.success) return routedResult;
        lastError = routedResult;
      } catch (err) {
        lastError = {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: String(err),
          metadata: { runtime: runtime.id, selectedRuntime: runtime.id, error: String(err) },
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

    if (candidates.length === 0) {
      const mcpBlocked = task.capabilities.mcp || task.capabilities.toolCalling;
      if (mcpBlocked && runtimes.length > 0) {
        const runtime = runtimes[0];
        throw new Error(
          `Node requires MCP authority. ${runtimeDisplayName(runtime)} runtime does not receive OMK MCP authority.`
        );
      }
      throw new UnsupportedRuntimeError(capsule, detectedRuntimeLabels(runtimes));
    }

    const preferredRuntimeIds = task.providerPolicy?.fallbackChain ?? options.fallbackChain ?? [];
    candidates.sort((a, b) => {
      const runtimeDelta = runtimePreferenceIndex(a.id, preferredRuntimeIds)
        - runtimePreferenceIndex(b.id, preferredRuntimeIds);
      if (runtimeDelta !== 0 && Math.abs(runtimeDelta) < Number.MAX_SAFE_INTEGER) return runtimeDelta;
      if (preferredProviders.length > 0) {
        const providerDelta = providerPreferenceIndex(a.id, preferredProviders)
          - providerPreferenceIndex(b.id, preferredProviders);
        if (providerDelta !== 0) return providerDelta;
      }
      return compareRuntimeCandidates(a, b, intent);
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

      try {
        const result = runtime.execute
          ? agentResultToRunResult(await runtime.execute(task), runtime.id)
          : await runtime.runNode(capsule, signal);
        const routedResult: AgentRunResult = {
          ...result,
          metadata: {
            ...result.metadata,
            selectedRuntime: runtime.id,
            intent,
            fallbackChain: candidates.map((candidate) => candidate.id),
          },
        };
        if (routedResult.success) return routedResult;
        lastError = routedResult;
      } catch (err) {
        lastError = {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: String(err),
          metadata: { runtime: runtime.id, selectedRuntime: runtime.id, error: String(err) },
        };
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
  return {
    runId: task.context.runId || "local-runtime-router",
    nodeId,
    goal: task.context.goal || task.prompt,
    task: task.prompt,
    system: task.context.system || "",
    node: {
      id: nodeId,
      name: task.prompt,
      role: task.context.role || "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
    },
    dependencySummaries: [],
    evidenceRequirements: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    budget: { maxInputTokens: 0, compression: "small" },
  } as unknown as ContextCapsule;
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
  return {
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
  };
}

function computeComposite(score: RuntimeScore, runtime: AgentRuntime, intent: NodeIntent): number {
  return (
    0.35 * score.qualityScore +
    0.25 * score.evidencePassRate +
    0.15 * score.costScore +
    0.1 * score.latencyScore +
    0.15 * (1 - score.recentFailurePenalty) +
    0.15 * computeRuntimeCapabilityScore(runtime, intent) +
    0.05 * runtimePriorityScore(runtime)
  );
}

function compareScoredRuntimes(
  a: { runtime: AgentRuntime; composite: number },
  b: { runtime: AgentRuntime; composite: number },
  intent: NodeIntent,
): number {
  const compositeDelta = b.composite - a.composite;
  if (compositeDelta !== 0) return compositeDelta;
  return compareRuntimeCandidates(a.runtime, b.runtime, intent);
}

function compareRuntimeCandidates(a: AgentRuntime, b: AgentRuntime, intent: NodeIntent): number {
  const capabilityDelta = computeRuntimeCapabilityScore(b, intent) - computeRuntimeCapabilityScore(a, intent);
  if (capabilityDelta !== 0) return capabilityDelta;
  const priorityDelta = b.priority - a.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return a.id.localeCompare(b.id);
}

function computeRuntimeCapabilityScore(runtime: AgentRuntime, intent: NodeIntent): number {
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
