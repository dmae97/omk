import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { ProviderHealthRegistry } from "./health.js";
import { inferNodeRisk, normalizeProviderComplexity, routeProvider } from "./router.js";
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

  const runWith = async (
    provider: "kimi" | "deepseek",
    runner: TaskRunner,
    node: DagNode,
    env: Record<string, string>,
    routeReason: string,
    requestedProvider = provider,
    metadata: Partial<ProviderTaskMetadata> = {}
  ): Promise<TaskResult> => {
    const result = await runner.run(node, {
      ...env,
      OMK_PROVIDER: provider,
      OMK_PROVIDER_REQUESTED: requestedProvider,
      OMK_PROVIDER_FALLBACK: "kimi",
      OMK_PROVIDER_ROUTE_REASON: routeReason,
    });
    return withProviderMetadata(result, {
      provider,
      requestedProvider,
      providerRouteReason: routeReason,
      ...metadata,
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

    async run(node: DagNode, env: Record<string, string>): Promise<TaskResult> {
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
      const invocationKey = buildProviderInvocationKey(node, decision);
      const traceEnv = providerTraceEnv(decision, invocationKey);
      const traceMetadata: Partial<ProviderTaskMetadata> = {
        providerRouteConfidence: decision.confidence,
        providerRouteEnsemble: decision.routeEnsemble,
        providerInvocationKey: invocationKey,
      };

      if (decision.provider === "deepseek" && options.deepseekRunner) {
        const maxRetries = Math.max(0, Math.floor(options.deepseekMaxRetries ?? 1));
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
            }
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
        }

        const lastFailure = result ?? failures[failures.length - 1];
        const fallbackReason = summarizeFailures(failures);
        const failureKind = lastFailure ? classifyDeepSeekFailure(lastFailure) : "unknown";
        if (lastFailure && isDeepSeekPaymentOrAvailabilityFailure(lastFailure)) {
          providerHealth.markDeepSeekUnavailable(fallbackReason || "DeepSeek provider availability failure");
          await options.onDeepSeekDisabled?.({
            nodeId: node.id,
            nodeRole: node.role,
            reason: fallbackReason || "DeepSeek provider availability failure",
            failureKind: "availability",
            forced: true,
          });
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
          traceMetadata
        );

        return withProviderMetadata(fallback, {
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
        });

        if (!advisory.success && isDeepSeekPaymentOrAvailabilityFailure(advisory.result)) {
          providerHealth.markDeepSeekUnavailable(advisory.failureReason || "DeepSeek provider availability failure");
          await options.onDeepSeekDisabled?.({
            nodeId: node.id,
            nodeRole: node.role,
            reason: advisory.failureReason || "DeepSeek provider availability failure",
            failureKind: "availability",
            forced: true,
          });
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
          }
        );

        return withProviderMetadata(kimiResult, {
          provider: "kimi",
          requestedProvider: "kimi",
          providerRouteReason: decision.reason,
          ...traceMetadata,
          providerAssist: advisory.metadata,
        });
      }

      return runWith("kimi", options.kimiRunner, node, { ...env, ...traceEnv }, decision.reason, decision.provider, traceMetadata);
    },
  };

  return providerRunner;
}

async function runDeepSeekAdvisory(options: {
  node: DagNode;
  env: Record<string, string>;
  deepseekRunner: TaskRunner;
  routeReason: string;
  plan: DeepSeekRoutePlan;
  invocationKey: string;
  traceEnv: Record<string, string>;
}): Promise<{ success: boolean; result: TaskResult; summary: string; failureReason?: string; metadata: ProviderAssistMetadata }> {
  const result = await options.deepseekRunner.run(options.node, {
    ...options.env,
    ...options.traceEnv,
    ...deepseekRouteEnv(options.plan),
    OMK_PROVIDER: "deepseek",
    OMK_PROVIDER_REQUESTED: "deepseek",
    OMK_PROVIDER_FALLBACK: "kimi",
    OMK_PROVIDER_ROUTE_REASON: options.routeReason,
  });
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
