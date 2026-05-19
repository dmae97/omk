import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { ProviderHealthRegistry } from "./health.js";
import {
  DEEPSEEK_V4_FLASH_MODEL,
  DEEPSEEK_V4_PRO_MODEL,
  inferNodeRisk,
  normalizeProviderComplexity,
  routeProvider,
  selectDeepSeekModelTier,
} from "./router.js";
import type {
  DeepSeekRoutePlan,
  ProviderAssistMetadata,
  ProviderPolicy,
  ProviderRouteDecision,
  ProviderTaskMetadata,
} from "./types.js";
import { withProviderMetadata } from "./types.js";
import {
  classifyDeepSeekFailure,
  isDeepSeekPaymentOrAvailabilityFailure,
  isDeepSeekTransientFailure,
} from "./deepseek/deepseek-errors.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";
import {
  classifyKimiProviderFailure,
  formatKimiProviderFailureHint,
  type KimiProviderFailureDiagnosis,
} from "../kimi/runner.js";

export interface ProviderTaskRunnerOptions {
  kimiRunner: TaskRunner;
  deepseekRunner?: TaskRunner;
  providerHealth?: ProviderHealthRegistry;
  providerPolicy?: ProviderPolicy;
  deepseekMaxRetries?: number;
  onDeepSeekDisabled?: (event: DeepSeekDisableEvent) => void | Promise<void>;
}

export interface DeepSeekDisableEvent {
  nodeId: string;
  nodeRole: string;
  reason: string;
  failureKind: "availability";
  forced: true;
}

export function createProviderTaskRunner(options: ProviderTaskRunnerOptions): TaskRunner {
  const providerHealth = options.providerHealth ?? new ProviderHealthRegistry();
  let deepSeekDisabledCalled = false;

  const runWith = async (
    provider: "kimi" | "deepseek",
    runner: TaskRunner,
    node: DagNode,
    env: Record<string, string>,
    routeReason: string,
    requestedProvider = provider,
    metadata: Partial<ProviderTaskMetadata> = {},
    signal?: AbortSignal
  ): Promise<TaskResult> => {
    const result = await runner.run(node, {
      ...env,
      OMK_PROVIDER: provider,
      OMK_PROVIDER_REQUESTED: requestedProvider,
      OMK_PROVIDER_FALLBACK: "kimi",
      OMK_PROVIDER_ROUTE_REASON: routeReason,
    }, signal);
    return withProviderMetadata(result, {
      provider,
      requestedProvider,
      providerRouteReason: routeReason,
      ...metadata,
    });
  };

  const recoverFromKimiProviderFailure = async (
    kimiResult: TaskResult,
    node: DagNode,
    env: Record<string, string>,
    decision: ProviderRouteDecision,
    traceEnv: Record<string, string>,
    traceMetadata: Partial<ProviderTaskMetadata>,
    signal?: AbortSignal
  ): Promise<TaskResult> => {
    const diagnosis = diagnoseKimiProviderFailure(kimiResult);
    if (!diagnosis) return kimiResult;

    const annotatedKimiResult = withKimiProviderFailure(kimiResult, diagnosis);
    if (diagnosis.kind !== "monthly-quota") return annotatedKimiResult;

    providerHealth.markKimiUnavailable(diagnosis.title);
    if (!canFallbackKimiQuotaToDeepSeek(node, options.providerPolicy, options.deepseekRunner, providerHealth)) {
      return annotatedKimiResult;
    }

    const fallbackPlan = buildKimiQuotaDeepSeekFallbackPlan(node, env);
    const fallbackReason = `${diagnosis.title}; using read-only DeepSeek fallback`;
    const fallback = await runWith(
      "deepseek",
      options.deepseekRunner!,
      node,
      {
        ...env,
        ...traceEnv,
        ...deepseekRouteEnv(fallbackPlan),
        OMK_PROVIDER_FALLBACK_FROM: "kimi",
        OMK_PROVIDER_FALLBACK_REASON: fallbackReason,
        OMK_KIMI_FAILURE_KIND: diagnosis.kind,
      },
      fallbackReason,
      "kimi",
      {
        ...traceMetadata,
        ...deepseekMetadata(fallbackPlan),
      },
      signal
    );

    return withProviderMetadata(fallback, {
      provider: "deepseek",
      requestedProvider: "kimi",
      providerRouteReason: decision.reason,
      ...traceMetadata,
      providerAttemptCount: 1,
      ...deepseekMetadata(fallbackPlan),
      providerFallback: {
        from: "kimi",
        to: "deepseek",
        reason: fallbackReason,
        attempts: 1,
        failureKind: "quota",
      },
    });
  };

  const providerRunner: TaskRunner = {
    get onThinking() {
      return options.kimiRunner.onThinking;
    },
    set onThinking(fn) {
      options.kimiRunner.onThinking = fn;
      if (options.deepseekRunner) options.deepseekRunner.onThinking = fn;
    },

    fork(onThinking) {
      return createProviderTaskRunner({
        ...options,
        kimiRunner: options.kimiRunner.fork?.(onThinking) ?? options.kimiRunner,
        deepseekRunner: options.deepseekRunner?.fork?.(onThinking) ?? options.deepseekRunner,
        providerHealth,
      });
    },

    async run(node: DagNode, env: Record<string, string>, signal?: AbortSignal): Promise<TaskResult> {
      const runId = env.OMK_RUN_ID;
      const attemptNumber = (node.attempts?.length ?? 0) + 1;
      const attemptId = `${node.id}__${attemptNumber}`;
      const traceStore = runId ? createDecisionTraceStore() : undefined;

      const deepseekAvailable =
        Boolean(options.deepseekRunner) &&
        providerHealth.isDeepSeekAvailable();
      const requiresToolCalling = node.routing?.requiresToolCalling === true;
      const requiresMcp = node.routing?.requiresMcp === true;
      const decision = routeProvider({
        role: node.role,
        taskType: env.OMK_TASK_TYPE ?? "general",
        risk: inferNodeRisk(node),
        complexity: normalizeProviderComplexity(env.OMK_COMPLEXITY),
        needsToolCalling: requiresToolCalling,
        needsMcp: requiresMcp,
        readOnly: node.routing?.readOnly,
        estimatedTokens: Number(env.OMK_ESTIMATED_TOKENS ?? 0),
        deepseekAvailable,
        nodeId: node.id,
        providerHint: node.routing?.provider,
        providerPolicy: options.providerPolicy ?? "auto",
        preferredDeepSeekTier: node.routing?.providerModelTier,
      });

      // Record provider-router decision trace
      if (traceStore && runId) {
        traceStore.record(runId, {
          component: "provider-router",
          inputSummary: `node=${node.id} role=${node.role} risk=${inferNodeRisk(node)} complexity=${normalizeProviderComplexity(env.OMK_COMPLEXITY)} deepseekAvailable=${deepseekAvailable}`,
          outputDecision: `provider=${decision.provider} confidence=${decision.confidence.toFixed(2)}`,
          reason: decision.reason,
          scores: {
            confidence: decision.confidence,
            quorum: decision.routeEnsemble.quorum,
            candidates: decision.routeEnsemble.candidates.length,
          },
          nodeId: node.id,
          attemptId,
        });
      }

      const invocationKey = buildProviderInvocationKey(node, decision);
      const traceEnv = providerTraceEnv(decision, invocationKey);
      const traceMetadata: Partial<ProviderTaskMetadata> = {
        providerRouteConfidence: decision.confidence,
        providerRouteEnsemble: decision.routeEnsemble,
        providerInvocationKey: invocationKey,
      };

      if (decision.provider === "deepseek" && options.deepseekRunner) {
        const rawMaxRetries = Number(options.deepseekMaxRetries ?? 1);
        const maxRetries = Math.max(0, Math.floor(Number.isFinite(rawMaxRetries) ? rawMaxRetries : 1));
        const failures: TaskResult[] = [];
        let result: TaskResult | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          result = await runWith(
            "deepseek",
            options.deepseekRunner,
            node,
            {
              ...env,
              OMK_PROVIDER_ATTEMPT: String(attempt + 1),
              OMK_PROVIDER_MAX_RETRIES: String(maxRetries),
              ...traceEnv,
              ...deepseekRouteEnv(decision.deepseek),
            },
            decision.reason,
            "deepseek",
            {
              ...traceMetadata,
              ...deepseekMetadata(decision.deepseek),
            },
            signal
          );

          if (result.success) {
            return withProviderMetadata(result, {
              provider: "deepseek",
              requestedProvider: "deepseek",
              providerRouteReason: decision.reason,
              ...traceMetadata,
              providerAttemptCount: attempt + 1,
              ...deepseekMetadata(decision.deepseek),
            });
          }

          failures.push(result);
          if (!isDeepSeekTransientFailure(result)) break;

          // Abort-aware sleep with exponential backoff and full jitter
          if (attempt < maxRetries) {
            const baseMs = Math.min(1000 * Math.pow(2, attempt), 30000);
            const jitterMs = baseMs * Math.random();
            const delayMs = baseMs + jitterMs;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          if (!isDeepSeekTransientFailure(result)) break;
        }

        const lastFailure = result ?? failures[failures.length - 1];
        const fallbackReason = summarizeFailures(failures);
        const failureKind = lastFailure ? classifyDeepSeekFailure(lastFailure) : "unknown";
        if (lastFailure && isDeepSeekPaymentOrAvailabilityFailure(lastFailure)) {
          providerHealth.markDeepSeekUnavailable(fallbackReason || "DeepSeek provider availability failure");
          if (!deepSeekDisabledCalled) {
            deepSeekDisabledCalled = true;
            await options.onDeepSeekDisabled?.({
              nodeId: node.id,
              nodeRole: node.role,
              reason: fallbackReason || "DeepSeek provider availability failure",
              failureKind: "availability",
              forced: true,
            });
          }
        } else if (lastFailure && isDeepSeekTransientFailure(lastFailure)) {
          providerHealth.markDeepSeekUnavailable(fallbackReason || "DeepSeek transient provider failure");
        }

        const fallback = await runWith(
          "kimi",
          options.kimiRunner,
          node,
          {
            ...env,
            ...traceEnv,
            OMK_PROVIDER_FALLBACK_FROM: "deepseek",
            OMK_PROVIDER_FALLBACK_REASON: fallbackReason,
          },
          `Fallback from DeepSeek: ${fallbackReason || "unknown failure"}`,
          "deepseek",
          traceMetadata,
          signal
        );

        const annotatedFallback = withKimiProviderFailureIfNeeded(fallback, providerHealth);
        return withProviderMetadata(annotatedFallback, {
          provider: "kimi",
          requestedProvider: "deepseek",
          providerRouteReason: decision.reason,
          ...traceMetadata,
          providerAttemptCount: failures.length,
          ...deepseekMetadata(decision.deepseek),
          providerFallback: {
            from: "deepseek",
            to: "kimi",
            reason: fallbackReason,
            attempts: failures.length,
            failureKind,
          },
        });
      }

      if (decision.deepseek?.participation === "advisory" && options.deepseekRunner) {
        const advisory = await runDeepSeekAdvisory({
          node,
          env,
          deepseekRunner: options.deepseekRunner,
          routeReason: decision.reason,
          plan: decision.deepseek,
          invocationKey,
          traceEnv,
          signal,
        });

        if (!advisory.success && isDeepSeekPaymentOrAvailabilityFailure(advisory.result)) {
          providerHealth.markDeepSeekUnavailable(advisory.failureReason || "DeepSeek provider availability failure");
          if (!deepSeekDisabledCalled) {
            deepSeekDisabledCalled = true;
            await options.onDeepSeekDisabled?.({
              nodeId: node.id,
              nodeRole: node.role,
              reason: advisory.failureReason || "DeepSeek provider availability failure",
              failureKind: "availability",
              forced: true,
            });
          }
        } else if (!advisory.success && isDeepSeekTransientFailure(advisory.result)) {
          providerHealth.markDeepSeekUnavailable(advisory.failureReason || "DeepSeek transient provider failure");
        }

        const kimiResult = await runWith(
          "kimi",
          options.kimiRunner,
          node,
          {
            ...env,
            ...traceEnv,
            OMK_DEEPSEEK_ADVISORY_STATUS: advisory.success ? "success" : "failed",
            OMK_DEEPSEEK_ADVISORY_MODEL: decision.deepseek.model,
            OMK_DEEPSEEK_ADVISORY: advisory.summary,
          },
          decision.reason,
          "kimi",
          {
            ...traceMetadata,
            providerAssist: advisory.metadata,
          },
          signal
        );
        const recoveredKimiResult = await recoverFromKimiProviderFailure(
          kimiResult,
          node,
          env,
          decision,
          traceEnv,
          traceMetadata,
          signal
        );
        if (recoveredKimiResult.metadata?.provider === "deepseek") {
          return recoveredKimiResult;
        }

        return withProviderMetadata(recoveredKimiResult, {
          provider: "kimi",
          requestedProvider: "kimi",
          providerRouteReason: decision.reason,
          ...traceMetadata,
          providerAssist: advisory.metadata,
        });
      }

      const kimiResult = await runWith(
        "kimi",
        options.kimiRunner,
        node,
        { ...env, ...traceEnv },
        decision.reason,
        decision.provider,
        traceMetadata,
        signal
      );
      return recoverFromKimiProviderFailure(kimiResult, node, env, decision, traceEnv, traceMetadata, signal);
    },
  };

  return providerRunner;
}

function diagnoseKimiProviderFailure(result: TaskResult): KimiProviderFailureDiagnosis | null {
  if (result.success) return null;
  return classifyKimiProviderFailure(`${result.stderr}\n${result.stdout}`);
}

function withKimiProviderFailureIfNeeded(
  result: TaskResult,
  providerHealth: ProviderHealthRegistry
): TaskResult {
  const diagnosis = diagnoseKimiProviderFailure(result);
  if (!diagnosis) return result;
  if (diagnosis.kind === "monthly-quota") {
    providerHealth.markKimiUnavailable(diagnosis.title);
  }
  return withKimiProviderFailure(result, diagnosis);
}

function withKimiProviderFailure(
  result: TaskResult,
  diagnosis: KimiProviderFailureDiagnosis
): TaskResult {
  const providerHint = formatKimiProviderFailureHint(`${result.stderr}\n${result.stdout}`);
  const stderr = providerHint && !result.stderr.includes(`[omk] ${diagnosis.title}.`)
    ? result.stderr
      ? `${result.stderr}\n${providerHint}`
      : providerHint
    : result.stderr;
  return {
    ...result,
    stderr,
    metadata: {
      ...(result.metadata ?? {}),
      providerFailure: {
        provider: "kimi",
        kind: diagnosis.kind,
        title: diagnosis.title,
      },
    },
  };
}

function canFallbackKimiQuotaToDeepSeek(
  node: DagNode,
  providerPolicy: ProviderPolicy | undefined,
  deepseekRunner: TaskRunner | undefined,
  providerHealth: ProviderHealthRegistry
): boolean {
  if (!deepseekRunner || !providerHealth.isDeepSeekAvailable()) return false;
  if (providerPolicy === "kimi" || node.routing?.provider === "kimi") return false;
  if (inferNodeRisk(node) !== "read") return false;
  if (node.routing?.readOnly !== true) return false;
  if (node.routing?.requiresMcp === true || node.routing?.requiresToolCalling === true) return false;
  return true;
}

function buildKimiQuotaDeepSeekFallbackPlan(
  node: DagNode,
  env: Record<string, string>
): DeepSeekRoutePlan {
  const selected = selectDeepSeekModelTier([
    "kimi-quota-fallback",
    env.OMK_RUN_ID ?? "",
    node.id,
    node.role,
    env.OMK_TASK_TYPE ?? "general",
  ].join(":"));
  return {
    provider: "deepseek",
    model: selected.tier === "flash" ? DEEPSEEK_V4_FLASH_MODEL : DEEPSEEK_V4_PRO_MODEL,
    tier: selected.tier,
    participation: "direct",
    reasoningEffort: "max",
    ratioBucket: selected.ratioBucket,
  };
}

async function runDeepSeekAdvisory(options: {
  node: DagNode;
  env: Record<string, string>;
  deepseekRunner: TaskRunner;
  routeReason: string;
  plan: DeepSeekRoutePlan;
  invocationKey: string;
  traceEnv: Record<string, string>;
  signal?: AbortSignal;
}): Promise<{ success: boolean; result: TaskResult; summary: string; failureReason?: string; metadata: ProviderAssistMetadata }> {
  const result = await options.deepseekRunner.run(options.node, {
    ...options.env,
    ...options.traceEnv,
    ...deepseekRouteEnv(options.plan),
    OMK_PROVIDER: "deepseek",
    OMK_PROVIDER_REQUESTED: "deepseek",
    OMK_PROVIDER_FALLBACK: "kimi",
    OMK_PROVIDER_ROUTE_REASON: options.routeReason,
  }, options.signal);
  const success = result.success;
  const summary = success
    ? summarizeAdvisory(result.stdout)
    : "";
  const failureReason = success ? undefined : summarizeFailures([result]);
  return {
    success,
    result,
    summary,
    failureReason,
    metadata: {
      provider: "deepseek",
      model: options.plan.model,
      modelTier: options.plan.tier,
      participation: "advisory",
      invocationKey: options.invocationKey,
      success,
      summary,
      failureReason,
    },
  };
}

function providerTraceEnv(decision: ProviderRouteDecision, invocationKey: string): Record<string, string> {
  const env: Record<string, string> = {
    OMK_PROVIDER_ROUTE_CONFIDENCE: decision.confidence.toFixed(2),
    OMK_PROVIDER_INVOCATION_KEY: invocationKey,
  };
  const routeEnsemble = summarizeRouteEnsemble(decision.routeEnsemble);
  if (routeEnsemble) {
    env.OMK_PROVIDER_ROUTE_ENSEMBLE = routeEnsemble;
  }
  if (decision.deepseek) {
    env.OMK_DEEPSEEK_INVOCATION_KEY = invocationKey;
  }
  return env;
}

function summarizeRouteEnsemble(decision: ProviderRouteDecision["routeEnsemble"]): string {
  const candidates = decision.candidates
    .map((candidate) => [
      candidate.id,
      candidate.score.toFixed(2),
      candidate.selected ? "selected" : undefined,
      candidate.veto ? "veto" : undefined,
    ].filter(Boolean).join(":"))
    .join(",");
  return [
    `winner=${decision.winner}`,
    `confidence=${decision.confidence.toFixed(2)}`,
    `quorum=${decision.quorum}/${decision.candidates.length}`,
    `candidates=${candidates}`,
  ].join(";").slice(0, 1200);
}

function buildProviderInvocationKey(node: DagNode, decision: ProviderRouteDecision): string {
  const seed = [
    node.id,
    node.role,
    decision.provider,
    decision.deepseek?.model ?? "kimi",
    decision.deepseek?.participation ?? "authoritative",
    decision.reason,
  ].join(":");
  return `omk-${stableHash(seed).toString(16).padStart(8, "0")}`;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deepseekRouteEnv(plan: DeepSeekRoutePlan | undefined): Record<string, string> {
  if (!plan) return {};
  return {
    OMK_DEEPSEEK_MODEL: plan.model,
    OMK_DEEPSEEK_MODEL_TIER: plan.tier,
    OMK_DEEPSEEK_PARTICIPATION: plan.participation,
    OMK_DEEPSEEK_REASONING_EFFORT: plan.reasoningEffort,
    OMK_DEEPSEEK_RATIO_BUCKET: String(plan.ratioBucket),
  };
}

function deepseekMetadata(plan: DeepSeekRoutePlan | undefined): Partial<ProviderTaskMetadata> {
  if (!plan) return {};
  return {
    providerModel: plan.model,
    providerModelTier: plan.tier,
    providerParticipation: plan.participation,
  };
}

function summarizeAdvisory(stdout: string): string {
  return stdout
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

function summarizeFailures(failures: TaskResult[]): string {
  if (failures.length === 0) return "";
  return failures
    .map((failure, index) => {
      const text = `${failure.stderr}\n${failure.stdout}`.trim().replace(/\s+/g, " ");
      return `attempt ${index + 1}: ${text || `exit ${failure.exitCode ?? "unknown"}`}`;
    })
    .join(" | ")
    .slice(0, 500);
}
