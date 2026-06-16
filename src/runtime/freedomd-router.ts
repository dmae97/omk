/**
 * Freedomd runtime router.
 *
 * Wraps the base RuntimeRouter with provider-sovereignty scoring, data-retention
 * gating, cutoff-resilient fallback, degraded-mode planning, and local-first
 * evidence envelopes. This is the control-plane boundary that keeps OMK loops
 * alive when a provider becomes unavailable or policy-blocked.
 */

import type { AgentResult, AgentRunResult, AgentRuntime, AgentTask, AgentTaskSovereignty } from "./agent-runtime.js";
import type { ContextCapsule } from "./context-capsule.js";
import type { LocalGraphMemoryStore } from "../memory/local-graph-memory-store.js";
import { createRuntimeRouter, type RuntimeRouterOptions } from "./runtime-router.js";
import { computeRuntimeCapabilityScore, type NodeIntent } from "./runtime-router.js";
import { compileFreedomdPolicy, type FreedomdMode, type FreedomdPolicy } from "./freedomd-policy.js";
import {
  buildProviderSovereigntyProfiles,
  computeProviderSovereigntyScore,
  lookupSovereigntyProfile,
  type ProviderIncidentState,
  type ProviderSovereigntyProfile,
  type SovereigntyScore,
} from "./provider-sovereignty.js";
import { evaluateDataRetentionGate, type DataRetentionGateResult } from "./data-retention-gate.js";
import { buildLocalFirstEvidenceEnvelope, type FreedomdEvidenceEnvelope } from "./freedomd-evidence-envelope.js";
import { runtimeProviderId, runtimeModeOf } from "./authority-matrix.js";
import { maskSensitiveText } from "../util/secret-mask.js";
import { loadProviderIncidents } from "./freedomd-incidents.js";
import { requestProviderException, type ProviderExceptionResult } from "./freedomd-exception.js";

export type { FreedomdMode };

export interface FreedomdRouterOptions extends RuntimeRouterOptions {
  readonly freedomdMode?: FreedomdMode;
  readonly userCountry?: string;
  readonly sovereigntyProfiles?: Readonly<Record<string, ProviderSovereigntyProfile>>;
  readonly incidents?: readonly ProviderIncidentState[];
  readonly graphStore?: LocalGraphMemoryStore;
  readonly allowRedaction?: boolean;
  readonly projectRoot?: string;
  readonly autoLoadIncidents?: boolean;
  readonly promptUser?: (message: string) => Promise<string>;
  readonly isTty?: boolean;
}

export interface FreedomdScoredRuntime {
  readonly runtime: AgentRuntime;
  readonly score: number;
  readonly sovereignty: SovereigntyScore;
  readonly retention: DataRetentionGateResult;
}

export interface FreedomdDegradedPlan {
  readonly mode: string;
  readonly runtime?: AgentRuntime;
  readonly allowedCapabilities: readonly string[];
  readonly reason: string;
  readonly blockedOriginalAuthority?: readonly string[];
}

export interface FreedomdRouteResult {
  readonly selectedRuntime?: AgentRuntime;
  readonly fallbackChain: readonly AgentRuntime[];
  readonly degradedPlan?: FreedomdDegradedPlan;
  readonly sovereignty: AgentTaskSovereignty;
  readonly diagnostics: string;
  readonly providerException?: ProviderExceptionResult;
}

function severityOrdinal(severity: string): number {
  if (severity === "block") return 2;
  if (severity === "warn") return 1;
  return 0;
}

function hasLocalRuntime(runtimes: readonly AgentRuntime[]): boolean {
  return runtimes.some((r) => runtimeProviderId(r) === "local-llm" || r.id.startsWith("local-"));
}

export function evaluateTaskSovereignty(
  task: AgentTask,
  policy: FreedomdPolicy,
  runtimes: readonly AgentRuntime[],
  incidents?: readonly ProviderIncidentState[],
): AgentTaskSovereignty {
  const localAvailable = hasLocalRuntime(runtimes);
  const candidateProviderIds = new Set(runtimes.map((r) => runtimeProviderId(r)));
  const matchedIncidents = (incidents ?? []).filter((i) => candidateProviderIds.has(i.providerId));
  const incident = matchedIncidents.sort((a, b) => severityOrdinal(b.severity) - severityOrdinal(a.severity))[0];
  const cutoffRisk = incident?.severity === "block" ? 1.0 : incident?.severity === "warn" ? 0.5 : 0.0;

  let retentionDecision: AgentTaskSovereignty["retentionDecision"] = "allow";
  if (policy.mode === "strict" && !localAvailable) {
    retentionDecision = "block";
  } else if (!policy.allowExportRestrictedProvider && incident?.kind === "export-control") {
    retentionDecision = "block";
  }

  let jurisdictionDecision: AgentTaskSovereignty["jurisdictionDecision"] = "allow";
  if (incident?.kind === "jurisdiction" || incident?.kind === "export-control") {
    jurisdictionDecision = incident.severity === "block" ? "block" : "downgrade";
  }

  const reasonParts: string[] = [`mode=${policy.mode}`];
  if (incident) reasonParts.push(`incident=${incident.kind}:${incident.severity}`);
  if (!localAvailable) reasonParts.push("no-local-fallback");

  return {
    mode: policy.mode === "off" ? "standard" : "freedomd",
    dataBoundary: "internal",
    retentionDecision,
    jurisdictionDecision,
    providerCutoffRisk: cutoffRisk,
    localFallbackAvailable: localAvailable,
    reason: reasonParts.join("; "),
  };
}

function classifyFreedomdIntent(task: AgentTask, capsule?: ContextCapsule): NodeIntent {
  const text = `${task.context.nodeId} ${task.context.goal ?? ""} ${task.prompt} ${task.context.role ?? ""} ${capsule?.node?.role ?? ""}`.toLowerCase();
  const role = (task.context.role ?? capsule?.node?.role ?? "").toLowerCase();

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

function runtimePriorityScore(runtime: AgentRuntime): number {
  return Math.max(0, Math.min(1, runtime.priority / 100));
}

export function scoreRuntimesWithSovereignty(
  task: AgentTask,
  runtimes: readonly AgentRuntime[],
  policy: FreedomdPolicy,
  options: {
    readonly profiles?: Readonly<Record<string, ProviderSovereigntyProfile>>;
    readonly incidents?: readonly ProviderIncidentState[];
    readonly userCountry?: string;
    readonly allowRedaction?: boolean;
    readonly capsule?: ContextCapsule;
  } = {},
): FreedomdScoredRuntime[] {
  const profiles = options.profiles ?? buildProviderSovereigntyProfiles();
  const incidents = options.incidents ?? [];
  const intent = classifyFreedomdIntent(task, options.capsule);
  const scored: FreedomdScoredRuntime[] = [];

  for (const runtime of runtimes) {
    const profile = lookupSovereigntyProfile(runtime, profiles);
    if (!profile) continue;

    const sovereignty = computeProviderSovereigntyScore(runtime, task, {
      profile,
      userCountry: options.userCountry,
      taskRisk: task.safety?.risk,
      incidents,
      localAvailable: runtimeProviderId(runtime) === "local-llm" || runtime.id.startsWith("local-"),
    });

    if (policy.mode !== "off") {
      if (sovereignty.diagnostics.jurisdictionRisk > policy.maxJurisdictionRisk) continue;
      if (sovereignty.diagnostics.retentionRisk > policy.maxRetentionRisk) continue;
      if (sovereignty.diagnostics.cutoffRisk > policy.maxCutoffRisk) continue;
    }

    const retention = evaluateDataRetentionGate({
      task,
      runtime,
      providerProfile: profile,
      orgMaxRetentionDays: policy.maxRetentionDays,
      allowRedaction: options.allowRedaction ?? false,
    });

    if (retention.decision === "block") continue;

    const capabilityScore = computeRuntimeCapabilityScore(runtime, intent);
    const priorityScore = runtimePriorityScore(runtime);

    let capabilityWeight: number;
    let priorityWeight: number;
    let sovereigntyWeight: number;

    if (policy.mode === "strict") {
      capabilityWeight = 0.3;
      priorityWeight = 0.1;
      sovereigntyWeight = 0.6;
      const isLocal = runtimeProviderId(runtime) === "local-llm" || runtime.id.startsWith("local-");
      if (isLocal) {
        sovereigntyWeight = 0.5;
        capabilityWeight = 0.4;
      }
    } else if (policy.mode === "balanced") {
      capabilityWeight = 0.5;
      priorityWeight = 0.2;
      sovereigntyWeight = 0.3;
    } else {
      capabilityWeight = 0.7;
      priorityWeight = 0.3;
      sovereigntyWeight = 0.0;
    }

    const score =
      capabilityWeight * capabilityScore +
      priorityWeight * priorityScore +
      sovereigntyWeight * sovereignty.score;

    scored.push({ runtime, score, sovereignty, retention });
  }

  return scored.sort((a, b) => b.score - a.score);
}

export function buildFreedomdDegradedPlan(
  task: AgentTask,
  reason: string,
  runtimes: readonly AgentRuntime[],
): FreedomdDegradedPlan {
  const localAuthority = runtimes.find((r) => {
    const pid = runtimeProviderId(r);
    return (pid === "local-llm" || r.id.startsWith("local-")) && (r.capabilities?.write || r.capabilities?.shell);
  });

  if (localAuthority) {
    return {
      mode: "local-authority",
      runtime: localAuthority,
      allowedCapabilities: ["read", "write", "patch", "shell"],
      reason,
    };
  }

  const localRead = runtimes.find((r) => runtimeProviderId(r) === "local-llm" || r.id.startsWith("local-"));
  if (localRead) {
    return {
      mode: "read-only-local-review",
      runtime: localRead,
      allowedCapabilities: ["read", "review"],
      reason,
      blockedOriginalAuthority: Object.entries(task.capabilities)
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    };
  }

  return {
    mode: "blocked",
    allowedCapabilities: [],
    reason,
  };
}

function agentResultToRunResult(result: AgentResult, runtimeId: string): AgentRunResult {
  return {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.output,
    stderr: "",
    metadata: { ...result.metadata, runtime: runtimeId },
    tokenUsage: result.tokenUsage,
    toolCalls: result.toolCalls,
  };
}

export async function createFreedomdRuntimeRouter(options: FreedomdRouterOptions = {}) {
  const policy = compileFreedomdPolicy({
    taskFlags: options.freedomdMode ? { mode: options.freedomdMode } : undefined,
  });
  const profiles = options.sovereigntyProfiles ?? buildProviderSovereigntyProfiles();
  const loadedIncidents = options.autoLoadIncidents !== false ? await loadProviderIncidents({ projectRoot: options.projectRoot, feedUrls: policy.incidentFeedUrls }) : [];
  const incidents = options.incidents ?? loadedIncidents;
  const graphStore = options.graphStore;
  const projectRoot = options.projectRoot ?? process.cwd();

  const baseOptions: RuntimeRouterOptions = {
    runtimes: options.runtimes,
    fallbackChain: options.fallbackChain,
    memoryPath: options.memoryPath,
  };
  const baseRouter = createRuntimeRouter(baseOptions);

  async function materialize(
    runId: string,
    nodeId: string,
    route: FreedomdRouteResult,
    envelope?: FreedomdEvidenceEnvelope,
  ): Promise<void> {
    if (!graphStore) return;
    try {
      await graphStore.materializeFreedomdSovereignty({
        runId,
        nodeId,
        providerId: route.selectedRuntime ? runtimeProviderId(route.selectedRuntime) : "none",
        runtimeMode: route.selectedRuntime ? runtimeModeOf(route.selectedRuntime) : "none",
        sovereignty: route.sovereignty,
        degradedMode: route.degradedPlan?.mode,
        incident: route.sovereignty.providerCutoffRisk >= 0.5
          ? { kind: "cutoff", severity: route.sovereignty.providerCutoffRisk >= 1 ? "block" : "warn", reason: route.sovereignty.reason }
          : undefined,
      });
      if (envelope) {
        await graphStore.materializeFreedomdEvidenceEnvelope({
          runId,
          nodeId,
          envelopePath: `.omk/runs/${runId}/freedomd/${nodeId}-evidence-envelope.json`,
        });
      }
    } catch {
      // Graph materialization is best-effort; do not block turn execution.
    }
  }

  async function freedomdRoute(task: AgentTask, capsule: ContextCapsule): Promise<FreedomdRouteResult> {
    const sovereignty = evaluateTaskSovereignty(task, policy, options.runtimes ?? [], incidents);

    if (sovereignty.retentionDecision === "block" || sovereignty.jurisdictionDecision === "block") {
      const degraded = buildFreedomdDegradedPlan(task, sovereignty.reason, options.runtimes ?? []);
      return {
        fallbackChain: [],
        degradedPlan: degraded,
        sovereignty,
        diagnostics: `blocked; degraded=${degraded.mode}`,
      };
    }

    const scored = scoreRuntimesWithSovereignty(task, options.runtimes ?? [], policy, {
      profiles,
      incidents,
      userCountry: options.userCountry,
      allowRedaction: options.allowRedaction,
      capsule,
    });

    if (scored.length === 0) {
      const degraded = buildFreedomdDegradedPlan(task, "NO_FREEDOMD_COMPATIBLE_RUNTIME", options.runtimes ?? []);

      if (policy.allowProviderExceptions && options.isTty !== false) {
        const blocked = options.runtimes?.[0];
        if (blocked) {
          const profile = lookupSovereigntyProfile(blocked, profiles);
          const exception = await requestProviderException(
            {
              providerId: runtimeProviderId(blocked),
              runtimeMode: runtimeModeOf(blocked),
              blockedReason: "NO_FREEDOMD_COMPATIBLE_RUNTIME",
              retentionDays: profile?.retentionDays ?? 0,
              jurisdictionRisk: profile ? computeProviderSovereigntyScore(blocked, task, { profile, incidents }).diagnostics.jurisdictionRisk : 0,
              localFallbackAvailable: hasLocalRuntime(options.runtimes ?? []),
              taskSensitivity: task.safety?.risk ?? "unknown",
            },
            {
              runId: task.context.runId,
              nodeId: task.context.nodeId,
              projectRoot,
              graphStore,
              isTty: options.isTty,
              promptUser: options.promptUser,
            },
          );
          if (exception.decision === "once" || exception.decision === "run") {
            return {
              selectedRuntime: blocked,
              fallbackChain: [],
              sovereignty,
              diagnostics: `provider exception ${exception.decision} for ${blocked.id}`,
              providerException: exception,
            };
          }
        }
      }

      return {
        fallbackChain: [],
        degradedPlan: degraded,
        sovereignty,
        diagnostics: "no compatible runtime; degraded",
      };
    }

    const selected = scored[0];
    const fallbackChain = scored.slice(1).map((s) => s.runtime);

    if (selected.retention.decision === "downgrade") {
      const degraded = buildFreedomdDegradedPlan(task, selected.retention.reason, options.runtimes ?? []);
      return {
        selectedRuntime: selected.runtime,
        fallbackChain,
        degradedPlan: degraded,
        sovereignty,
        diagnostics: `retention downgrade; selected=${selected.runtime.id}; fallback=${fallbackChain.map((r) => r.id).join(",")}`,
      };
    }

    return {
      selectedRuntime: selected.runtime,
      fallbackChain,
      sovereignty,
      diagnostics: `selected=${selected.runtime.id}; sovereignty=${selected.sovereignty.score.toFixed(2)}; fallback=${fallbackChain.map((r) => r.id).join(",")}`,
    };
  }

  async function executeTask(task: AgentTask, capsule: ContextCapsule, signal: AbortSignal): Promise<AgentRunResult> {
    const route = await freedomdRoute(task, capsule);
    return runFreedomdRoute(task, capsule, route, signal);
  }

  async function runFreedomdRoute(
    task: AgentTask,
    capsule: ContextCapsule,
    route: FreedomdRouteResult,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    const runId = task.context.runId;
    const nodeId = task.context.nodeId;

    if (route.degradedPlan && !route.selectedRuntime) {
      const result: AgentRunResult = {
        success: false,
        exitCode: 78,
        stdout: "",
        stderr: `Freedomd degraded mode: ${route.degradedPlan.mode}. ${route.degradedPlan.reason}`,
        metadata: {
          freedomd: true,
          degradedMode: route.degradedPlan.mode,
          sovereignty: route.sovereignty,
          remediation: [
            "Enable local-llm runtime",
            "Configure an authority-capable CLI runtime",
            "Lower task authority to read/review",
            "Provide user-approved provider exception",
          ],
        },
      };
      await materialize(runId, nodeId, route);
      return result;
    }

    const primary = route.selectedRuntime!;
    const allCandidates = [primary, ...route.fallbackChain];

    let lastError: AgentRunResult | undefined;
    for (const runtime of allCandidates) {
      if (signal.aborted) {
        return {
          success: false,
          exitCode: 130,
          stdout: "",
          stderr: "Aborted before execution",
          metadata: { runtime: runtime.id, aborted: true, sovereignty: route.sovereignty },
        };
      }

      try {
        const rawResult = runtime.execute
          ? await runtime.execute(task)
          : await runtime.runNode(capsule, signal);
        const result: AgentRunResult = "stdout" in rawResult ? rawResult : agentResultToRunResult(rawResult as AgentResult, runtime.id);

        const safeResult: AgentRunResult = {
          success: result.success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: maskSensitiveText(result.stderr),
          metadata: {
            ...result.metadata,
            selectedRuntime: runtime.id,
            sovereignty: route.sovereignty,
            fallbackChain: allCandidates.map((r) => r.id),
            freedomd: true,
          },
          tokenUsage: result.tokenUsage,
          toolCalls: result.toolCalls,
        };

        const envelope = await buildLocalFirstEvidenceEnvelope({
          task,
          selectedRuntime: runtime,
          runContext: { runId, nodeId, projectRoot },
          providerResponse: safeResult,
          sovereignty: route.sovereignty,
        });
        await materialize(runId, nodeId, route, envelope);

        if (safeResult.success) {
          return {
            ...safeResult,
            metadata: {
              ...safeResult.metadata,
              freedomdEvidenceEnvelope: envelope.localArtifacts[envelope.localArtifacts.length - 1]?.path,
            },
          };
        }

        lastError = safeResult;
      } catch (err) {
        const error = maskSensitiveText(String(err));
        lastError = {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: error,
          metadata: { runtime: runtime.id, error, sovereignty: route.sovereignty },
        };
      }
    }

    const final: AgentRunResult = lastError ?? {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "No Freedomd runtime available",
      metadata: { attempted: allCandidates.map((r) => r.id), sovereignty: route.sovereignty },
    };

    const envelope = await buildLocalFirstEvidenceEnvelope({
      task,
      selectedRuntime: primary,
      runContext: { runId, nodeId, projectRoot },
      providerResponse: final,
      sovereignty: route.sovereignty,
    });
    await materialize(runId, nodeId, route, envelope);
    return final;
  }

  return {
    policy,
    // baseRouter intentionally omitted from public return type to avoid leaking
    // internal RuntimeRouter history types; use executeTask for routing.
    baseRouter: baseRouter as unknown,
    freedomdRoute,
    scoreRuntimesWithSovereignty: (task: AgentTask): FreedomdScoredRuntime[] =>
      scoreRuntimesWithSovereignty(task, options.runtimes ?? [], policy, {
        profiles,
        incidents,
        userCountry: options.userCountry,
        allowRedaction: options.allowRedaction,
      }),
    executeTask,
  } as const;
}
