import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { TaskRunContext } from "../contracts/worker-context.js";
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
  ProviderFailureKind,
  ProviderId,
  ProviderModelDefault,
  ProviderModelRef,
  ProviderPolicy,
  ProviderRouteDecision,
  ProviderRouteInput,
  ProviderTaskMetadata,
} from "./types.js";
import { DEFAULT_AUTHORITY_PROVIDER } from "./types.js";
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
} from "./kimi-provider-failure.js";

export interface ProviderTaskRunnerOptions {
  kimiRunner: TaskRunner;
  deepseekRunner?: TaskRunner;
  authorityProvider?: ProviderId;
  authorityRunner?: TaskRunner;
  providerRunners?: Partial<Record<ProviderId, TaskRunner>>;
  providerModels?: Partial<Record<ProviderId, ProviderModelDefault>>;
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
  const authorityProvider = options.authorityProvider ?? DEFAULT_AUTHORITY_PROVIDER;
  const providerRunners: Partial<Record<ProviderId, TaskRunner>> = {
    ...(options.providerRunners ?? {}),
  };
  const authorityRunner = options.authorityRunner
    ?? providerRunners[authorityProvider]
    ?? (authorityProvider === "kimi" ? options.kimiRunner : undefined);
  if (authorityRunner && authorityProvider !== "kimi") {
    providerRunners[authorityProvider] = authorityRunner;
  }
  let deepSeekDisabledCalled = false;

  const runWith = async (
    provider: ProviderId,
    runner: TaskRunner,
    node: DagNode,
    env: Record<string, string>,
    routeReason: string,
    requestedProvider: ProviderId = provider,
    metadata: Partial<ProviderTaskMetadata> = {},
    signal?: AbortSignal,
    context?: TaskRunContext
  ): Promise<TaskResult> => {
    const result = await runner.run(node, {
      ...env,
      OMK_PROVIDER: provider,
      OMK_PROVIDER_REQUESTED: requestedProvider,
      OMK_PROVIDER_FALLBACK: provider === "kimi" ? "kimi" : authorityProvider,
      OMK_PROVIDER_AUTHORITY: provider === authorityProvider ? authorityProvider : env.OMK_PROVIDER_AUTHORITY ?? provider,
      OMK_PROVIDER_ROUTE_REASON: routeReason,
    }, signal, context);
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
    signal?: AbortSignal,
    context?: TaskRunContext
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
      signal,
      context
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
      if (options.authorityRunner) options.authorityRunner.onThinking = fn;
      for (const runner of Object.values(providerRunners)) {
        if (runner) runner.onThinking = fn;
      }
    },

    fork(onThinking) {
      const forkedProviderRunners = Object.fromEntries(
        Object.entries(providerRunners).map(([provider, runner]) => [
          provider,
          runner?.fork?.(onThinking) ?? runner,
        ])
      ) as Partial<Record<ProviderId, TaskRunner>>;
      return createProviderTaskRunner({
        ...options,
        kimiRunner: options.kimiRunner.fork?.(onThinking) ?? options.kimiRunner,
        deepseekRunner: options.deepseekRunner?.fork?.(onThinking) ?? options.deepseekRunner,
        authorityRunner: options.authorityRunner?.fork?.(onThinking) ?? options.authorityRunner,
        providerRunners: forkedProviderRunners,
        providerHealth,
      });
    },

    async run(node: DagNode, env: Record<string, string>, signal?: AbortSignal, context?: TaskRunContext): Promise<TaskResult> {
      const runId = env.OMK_RUN_ID;
      const attemptNumber = (node.attempts?.length ?? 0) + 1;
      const attemptId = `${node.id}__${attemptNumber}`;
      const traceStore = runId ? createDecisionTraceStore() : undefined;

      const deepseekAvailable =
        Boolean(options.deepseekRunner) &&
        providerHealth.isDeepSeekAvailable();
      const requiresToolCalling = node.routing?.requiresToolCalling === true;
      const requiresMcp = node.routing?.requiresMcp === true;
      const providerAvailability = providerAvailabilityForNode(
        node,
        options.providerPolicy ?? "auto",
        deepseekAvailable,
        providerRunners
      );
      const routeInput: ProviderRouteInput = {
        role: node.role,
        taskType: env.OMK_TASK_TYPE ?? "general",
        risk: inferNodeRisk(node),
        complexity: normalizeProviderComplexity(env.OMK_COMPLEXITY),
        needsToolCalling: requiresToolCalling,
        needsMcp: requiresMcp,
        readOnly: node.routing?.readOnly,
        estimatedTokens: Number(env.OMK_ESTIMATED_TOKENS ?? 0),
        deepseekAvailable,
        providerAvailability,
        providerModels: options.providerModels,
        nodeId: node.id,
        providerHint: node.routing?.provider,
        providerPolicy: options.providerPolicy ?? "auto",
        authorityProvider,
        preferredModel: node.routing?.providerModel ?? env.OMK_PROVIDER_MODEL ?? node.routing?.assignedModel,
        preferredDeepSeekTier: node.routing?.providerModelTier,
      };
      const decision = routeProvider(routeInput);

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

      const unavailableProviderSkip = resolveUnavailableSkippableProviderLane({
        node,
        routeInput,
        decision,
        providerPolicy: options.providerPolicy ?? "auto",
        providerAvailability,
      });
      if (unavailableProviderSkip) {
        return providerLaneSkipResult({
          node,
          provider: unavailableProviderSkip.provider,
          requestedProvider: unavailableProviderSkip.provider,
          decision,
          reason: unavailableProviderSkip.reason,
          failureKind: "availability",
          attempts: 0,
          traceMetadata,
          providerModel: unavailableProviderSkip.providerModel ?? decision.providerModel,
          deepseekPlan: unavailableProviderSkip.deepseekPlan ?? decision.deepseek,
          baseResult: {
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: unavailableProviderSkip.reason,
          },
        });
      }

      if (decision.provider === "deepseek" && options.deepseekRunner) {
        const rawMaxRetries = Number(options.deepseekMaxRetries ?? 1);
        const shouldSkipDeepSeekFallback = shouldSkipProviderFallback(node, "deepseek");
        const maxRetries = shouldSkipDeepSeekFallback ? 0 : Math.max(0, Math.floor(Number.isFinite(rawMaxRetries) ? rawMaxRetries : 1));
        const failures: TaskResult[] = [];
        let result: TaskResult | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
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
              signal,
              context
            );
          } catch (error: unknown) {
            if (!shouldSkipDeepSeekFallback) throw error;
            result = providerExceptionResult(error);
          }

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
          if (signal?.aborted) break;
          if (!isDeepSeekTransientFailure(result)) break;

          // Abort-aware sleep with exponential backoff and full jitter
          if (attempt < maxRetries) {
            const baseMs = Math.min(1000 * Math.pow(2, attempt), 30000);
            const jitterMs = baseMs * Math.random();
            const delayMs = baseMs + jitterMs;
            await sleepWithAbort(delayMs, signal);
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

        if (lastFailure && shouldSkipDeepSeekFallback) {
          return providerLaneSkipResult({
            node,
            provider: "deepseek",
            requestedProvider: "deepseek",
            decision,
            reason: fallbackReason || `${providerDisplayName("deepseek")} provider failed`,
            failureKind,
            attempts: failures.length,
            traceMetadata,
            deepseekPlan: decision.deepseek,
            baseResult: lastFailure,
          });
        }

        if (!shouldUseLegacyKimiFallback(options.providerPolicy, decision, authorityProvider) && !(authorityRunner && authorityProvider !== "kimi")) {
          return providerLaneSkipResult({
            node,
            provider: "deepseek",
            requestedProvider: "deepseek",
            decision,
            reason: `${fallbackReason || "DeepSeek provider failed"}; legacy CLI fallback disabled by provider-neutral policy`,
            failureKind,
            attempts: failures.length,
            traceMetadata,
            deepseekPlan: decision.deepseek,
            baseResult: lastFailure,
          });
        }

        const fallbackProvider = authorityRunner && authorityProvider !== "kimi" ? authorityProvider : "kimi";
        const fallbackRunner = fallbackProvider === "kimi" ? options.kimiRunner : authorityRunner!;
        const fallback = await runWith(
          fallbackProvider,
          fallbackRunner,
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
          signal,
          context
        );

        const annotatedFallback = fallbackProvider === "kimi"
          ? withKimiProviderFailureIfNeeded(fallback, providerHealth)
          : fallback;
        return withProviderMetadata(annotatedFallback, {
          provider: fallbackProvider,
          requestedProvider: "deepseek",
          providerRouteReason: decision.reason,
          ...traceMetadata,
          providerAttemptCount: failures.length,
          ...deepseekMetadata(decision.deepseek),
          providerFallback: {
            from: "deepseek",
            to: fallbackProvider,
            reason: fallbackReason,
            attempts: failures.length,
            failureKind,
          },
        });
      }

      if (isExternalProvider(decision.provider, authorityProvider)) {
        const externalRunner = providerRunners[decision.provider];
        if (externalRunner) {
          let result: TaskResult;
          try {
            result = await runWith(
              decision.provider,
              externalRunner,
              node,
              { ...env, ...traceEnv, ...providerModelEnv(decision.providerModel) },
              decision.reason,
              decision.provider,
              { ...traceMetadata, ...providerModelMetadata(decision.providerModel) },
              signal,
              context
            );
          } catch (error: unknown) {
            if (!shouldSkipProviderFallback(node, decision.provider)) throw error;
            result = providerExceptionResult(error);
          }
          if (result.success) {
            return withProviderMetadata(result, {
              provider: decision.provider,
              requestedProvider: decision.provider,
              providerRouteReason: decision.reason,
              ...traceMetadata,
              ...providerModelMetadata(decision.providerModel),
              providerAttemptCount: 1,
            });
          }

          const fallbackReason = summarizeFailures([result]) || `${decision.provider} provider failed`;
          if (shouldSkipProviderFallback(node, decision.provider)) {
            return providerLaneSkipResult({
              node,
              provider: decision.provider,
              requestedProvider: decision.provider,
              decision,
              reason: fallbackReason,
              failureKind: "availability",
              attempts: 1,
              traceMetadata,
              providerModel: decision.providerModel,
              baseResult: result,
            });
          }

          if (!shouldUseLegacyKimiFallback(options.providerPolicy, decision, authorityProvider) && !(authorityRunner && authorityProvider !== "kimi")) {
            return providerLaneSkipResult({
              node,
              provider: decision.provider,
              requestedProvider: decision.provider,
              decision,
              reason: `${fallbackReason}; legacy CLI fallback disabled by provider-neutral policy`,
              failureKind: "availability",
              attempts: 1,
              traceMetadata,
              providerModel: decision.providerModel,
              baseResult: result,
            });
          }

          const fallbackProvider = authorityRunner && authorityProvider !== "kimi" ? authorityProvider : "kimi";
          const fallbackRunner = fallbackProvider === "kimi" ? options.kimiRunner : authorityRunner!;
          const fallback = await runWith(
            fallbackProvider,
            fallbackRunner,
            node,
            {
              ...env,
              ...traceEnv,
              OMK_PROVIDER_FALLBACK_FROM: decision.provider,
              OMK_PROVIDER_FALLBACK_REASON: fallbackReason,
            },
            `Fallback from ${decision.provider}: ${fallbackReason}`,
            decision.provider,
            traceMetadata,
            signal,
            context
          );
          return withProviderMetadata(fallback, {
            provider: fallbackProvider,
            requestedProvider: decision.provider,
            providerRouteReason: decision.reason,
            ...traceMetadata,
            ...providerModelMetadata(decision.providerModel),
            providerAttemptCount: 1,
            providerFallback: {
              from: decision.provider,
              to: fallbackProvider,
              reason: fallbackReason,
              attempts: 1,
              failureKind: "availability",
            },
          });
        }
        return providerLaneSkipResult({
          node,
          provider: decision.provider,
          requestedProvider: decision.provider,
          decision,
          reason: `${providerDisplayName(decision.provider)} runner unavailable; legacy CLI fallback disabled by provider-neutral policy`,
          failureKind: "availability",
          attempts: 0,
          traceMetadata,
          providerModel: decision.providerModel,
          baseResult: {
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: `${providerDisplayName(decision.provider)} runner unavailable; legacy CLI fallback disabled by provider-neutral policy`,
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

        if (!advisory.success && shouldSkipProviderFallback(node, "deepseek")) {
          return providerLaneSkipResult({
            node,
            provider: "deepseek",
            requestedProvider: "deepseek",
            decision,
            reason: advisory.failureReason || `${providerDisplayName("deepseek")} advisory failed`,
            failureKind: classifyDeepSeekFailure(advisory.result),
            attempts: 1,
            traceMetadata,
            deepseekPlan: decision.deepseek,
            providerAssist: advisory.metadata,
            baseResult: advisory.result,
          });
        }

        if (!shouldUseLegacyKimiFallback(options.providerPolicy, decision, authorityProvider) && !(authorityRunner && authorityProvider !== "kimi")) {
          return providerLaneSkipResult({
            node,
            provider: decision.provider,
            requestedProvider: decision.provider,
            decision,
            reason: "DeepSeek advisory completed, but authority-provider execution is unavailable without explicit Kimi policy",
            failureKind: "policy",
            attempts: 0,
            traceMetadata,
            deepseekPlan: decision.deepseek,
            providerAssist: advisory.metadata,
            baseResult: advisory.result,
          });
        }

        const advisoryJsonEnv: Record<string, string> = advisory.advisoryJson
          ? { OMK_DEEPSEEK_ADVISORY_JSON: advisory.advisoryJson }
          : {};
        const authorityResult = authorityRunner && authorityProvider !== "kimi"
          ? await runWith(
            authorityProvider,
            authorityRunner,
            node,
            {
              ...env,
              ...traceEnv,
              OMK_DEEPSEEK_ADVISORY_STATUS: advisory.success ? "success" : "failed",
              OMK_DEEPSEEK_ADVISORY_MODEL: decision.deepseek.model,
              OMK_DEEPSEEK_ADVISORY: advisory.summary,
              ...advisoryJsonEnv,
            },
            decision.reason,
            authorityProvider,
            {
              ...traceMetadata,
              providerAssist: advisory.metadata,
            },
            signal
          )
          : undefined;
        if (authorityResult) {
          return withProviderMetadata(authorityResult, {
            provider: authorityProvider,
            requestedProvider: authorityProvider,
            providerRouteReason: decision.reason,
            ...traceMetadata,
            providerAssist: advisory.metadata,
          });
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
              ...advisoryJsonEnv,
            },
          decision.reason,
          "kimi",
          {
            ...traceMetadata,
            providerAssist: advisory.metadata,
          },
          signal,
          context
        );
        const recoveredKimiResult = await recoverFromKimiProviderFailure(
          kimiResult,
          node,
          env,
          decision,
          traceEnv,
          traceMetadata,
          signal,
          context
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

      const genericAdvisoryProvider = genericAdvisoryProviderForDecision(decision, authorityProvider);
      if (genericAdvisoryProvider) {
        const genericRunner = providerRunners[genericAdvisoryProvider];
        if (genericRunner) {
          const advisory = await runGenericProviderAdvisory({
            node,
            env,
            runner: genericRunner,
            routeReason: decision.reason,
            modelRef: decision.providerModel,
            invocationKey,
            traceEnv,
            signal,
          });
          if (!advisory.success && shouldSkipProviderFallback(node, genericAdvisoryProvider)) {
            return providerLaneSkipResult({
              node,
              provider: genericAdvisoryProvider,
              requestedProvider: genericAdvisoryProvider,
              decision,
              reason: advisory.failureReason || `${providerDisplayName(genericAdvisoryProvider)} advisory failed`,
              failureKind: "availability",
              attempts: 1,
              traceMetadata,
              providerModel: decision.providerModel,
              providerAssist: advisory.metadata,
              baseResult: advisory.result,
            });
          }
          if (!shouldUseLegacyKimiFallback(options.providerPolicy, decision, authorityProvider) && !(authorityRunner && authorityProvider !== "kimi")) {
            return providerLaneSkipResult({
              node,
              provider: genericAdvisoryProvider,
              requestedProvider: genericAdvisoryProvider,
              decision,
              reason: "Generic advisory completed, but authority-provider execution is unavailable without explicit Kimi policy",
              failureKind: "policy",
              attempts: 0,
              traceMetadata,
              providerModel: decision.providerModel,
              providerAssist: advisory.metadata,
              baseResult: advisory.result,
            });
          }

          const authorityResult = authorityRunner && authorityProvider !== "kimi"
            ? await runWith(
              authorityProvider,
              authorityRunner,
              node,
              {
                ...env,
                ...traceEnv,
                OMK_PROVIDER_ADVISORY_STATUS: advisory.success ? "success" : "failed",
                OMK_PROVIDER_ADVISORY_PROVIDER: genericAdvisoryProvider,
                OMK_PROVIDER_ADVISORY_MODEL: decision.providerModel?.model ?? "",
                OMK_PROVIDER_ADVISORY: advisory.summary,
              },
              decision.reason,
              authorityProvider,
              {
                ...traceMetadata,
                providerAssist: advisory.metadata,
                ...providerModelMetadata(decision.providerModel),
              },
              signal
            )
            : undefined;
          if (authorityResult) {
            return withProviderMetadata(authorityResult, {
              provider: authorityProvider,
              requestedProvider: authorityProvider,
              providerRouteReason: decision.reason,
              ...traceMetadata,
              providerAssist: advisory.metadata,
              ...providerModelMetadata(decision.providerModel),
            });
          }

          const kimiResult = await runWith(
            "kimi",
            options.kimiRunner,
            node,
            {
              ...env,
              ...traceEnv,
              OMK_PROVIDER_ADVISORY_STATUS: advisory.success ? "success" : "failed",
              OMK_PROVIDER_ADVISORY_PROVIDER: genericAdvisoryProvider,
              OMK_PROVIDER_ADVISORY_MODEL: decision.providerModel?.model ?? "",
              OMK_PROVIDER_ADVISORY: advisory.summary,
            },
            decision.reason,
            "kimi",
            {
              ...traceMetadata,
              providerAssist: advisory.metadata,
              ...providerModelMetadata(decision.providerModel),
            },
            signal,
            context
          );
          return withProviderMetadata(kimiResult, {
            provider: "kimi",
            requestedProvider: "kimi",
            providerRouteReason: decision.reason,
            ...traceMetadata,
            providerAssist: advisory.metadata,
            ...providerModelMetadata(decision.providerModel),
          });
        }
      }

      if (authorityRunner && decision.provider === authorityProvider) {
        const requestedProvider = requestedProviderForAuthorityDecision(decision, authorityProvider);
        const authorityResult = await runWith(
          authorityProvider,
          authorityRunner,
          node,
          { ...env, ...traceEnv },
          decision.reason,
          requestedProvider,
          {
            ...traceMetadata,
            ...providerModelMetadata(decision.providerModel),
          },
          signal,
          context
        );
        if (authorityProvider === "kimi") {
          const recoveredAuthorityResult = await recoverFromKimiProviderFailure(
            authorityResult,
            node,
            env,
            decision,
            traceEnv,
            traceMetadata,
            signal,
            context
          );
          if (recoveredAuthorityResult.metadata?.provider === "deepseek") {
            return recoveredAuthorityResult;
          }
          return withProviderMetadata(recoveredAuthorityResult, {
            provider: authorityProvider,
            requestedProvider,
            providerRouteReason: decision.reason,
            ...traceMetadata,
            ...providerModelMetadata(decision.providerModel),
          });
        }
        return withProviderMetadata(authorityResult, {
          provider: authorityProvider,
          requestedProvider,
          providerRouteReason: decision.reason,
          ...traceMetadata,
          ...providerModelMetadata(decision.providerModel),
        });
      }

      if (!shouldUseLegacyKimiFallback(options.providerPolicy, decision, authorityProvider)) {
        return providerLaneSkipResult({
          node,
          provider: decision.provider,
          requestedProvider: decision.provider,
          decision,
          reason: `${providerDisplayName(decision.provider)} selected, but no provider runner is available and legacy CLI fallback is disabled by provider-neutral policy`,
          failureKind: "availability",
          attempts: 0,
          traceMetadata,
          providerModel: decision.providerModel,
          baseResult: {
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: `${providerDisplayName(decision.provider)} selected, but no provider runner is available and legacy CLI fallback is disabled by provider-neutral policy`,
          },
        });
      }

      const kimiResult = await runWith(
        "kimi",
        options.kimiRunner,
        node,
        { ...env, ...traceEnv },
        decision.reason,
        requestedProviderForKimiDecision(decision, authorityProvider),
        {
          ...traceMetadata,
          ...providerModelMetadata(decision.providerModel),
        },
        signal,
        context
      );
      return recoverFromKimiProviderFailure(kimiResult, node, env, decision, traceEnv, traceMetadata, signal, context);
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

function providerAvailabilityForNode(
  node: DagNode,
  providerPolicy: ProviderPolicy,
  deepseekAvailable: boolean,
  providerRunners: Partial<Record<ProviderId, TaskRunner>> | undefined
): Partial<Record<ProviderId, boolean>> {
  const availability: Partial<Record<ProviderId, boolean>> = {
    ...Object.fromEntries(
      Object.keys(providerRunners ?? {}).map((provider) => [provider, true])
    ),
    deepseek: deepseekAvailable,
  };
  for (const provider of [node.routing?.provider, providerPolicy]) {
    if (!provider || provider === "auto" || provider === "kimi") continue;
    if (availability[provider] !== undefined) continue;
    availability[provider] = provider === "deepseek" ? deepseekAvailable : Boolean(providerRunners?.[provider]);
  }
  return availability;
}

function resolveUnavailableSkippableProviderLane(options: {
  node: DagNode;
  routeInput: ProviderRouteInput;
  decision: ProviderRouteDecision;
  providerPolicy: ProviderPolicy;
  providerAvailability: Partial<Record<ProviderId, boolean>>;
}): { provider: ProviderId; reason: string; providerModel?: ProviderModelRef; deepseekPlan?: DeepSeekRoutePlan } | undefined {
  const explicitProvider = requestedProviderFromNodeOrPolicy(options.node, options.providerPolicy);
  if (
    explicitProvider &&
    shouldSkipProviderFallback(options.node, explicitProvider) &&
    !isProviderAvailableForSkip(explicitProvider, options.providerAvailability)
  ) {
    return {
      provider: explicitProvider,
      reason: `${providerDisplayName(explicitProvider)} unavailable; optional provider lane is skippable`,
      providerModel: options.decision.providerModel,
      deepseekPlan: explicitProvider === "deepseek"
        ? options.decision.deepseek ?? deepseekPlanFromNode(options.node)
        : undefined,
    };
  }

  if (
    options.providerPolicy === "auto" &&
    !options.providerAvailability.deepseek &&
    shouldSkipProviderFallback(options.node, "deepseek")
  ) {
    const optimisticDeepSeekDecision = routeProvider({
      ...options.routeInput,
      deepseekAvailable: true,
      providerAvailability: {
        ...(options.routeInput.providerAvailability ?? {}),
        deepseek: true,
      },
    });
    if (optimisticDeepSeekDecision.provider === "deepseek" || optimisticDeepSeekDecision.deepseek) {
      return {
        provider: "deepseek",
        reason: "DeepSeek unavailable; optional provider lane is skippable",
        providerModel: optimisticDeepSeekDecision.providerModel,
        deepseekPlan: optimisticDeepSeekDecision.deepseek,
      };
    }
  }

  return undefined;
}

function requestedProviderFromNodeOrPolicy(
  node: DagNode,
  providerPolicy: ProviderPolicy
): ProviderId | undefined {
  const routingProvider = node.routing?.provider;
  if (routingProvider && routingProvider !== "auto" && routingProvider !== "kimi") return routingProvider;
  if (providerPolicy !== "auto" && providerPolicy !== "kimi") return providerPolicy;
  return undefined;
}

function isProviderAvailableForSkip(
  provider: ProviderId,
  providerAvailability: Partial<Record<ProviderId, boolean>>
): boolean {
  if (provider === "deepseek") return providerAvailability.deepseek === true;
  const explicit = providerAvailability[provider];
  return explicit === undefined ? true : explicit;
}

function shouldSkipProviderFallback(node: DagNode, provider: ProviderId): boolean {
  if (provider === "kimi") return false;
  if (provider === "deepseek" && isDeepSeekLaneNode(node)) return true;
  if (node.failurePolicy?.skipOnFailure === true) return true;
  if (hasOnlyOptionalOutputs(node)) return true;
  return false;
}

function isDeepSeekLaneNode(node: DagNode): boolean {
  return node.id.toLowerCase().startsWith("deepseek-") || node.routing?.provider === "deepseek";
}

function hasOnlyOptionalOutputs(node: DagNode): boolean {
  return Boolean(node.outputs?.length) && node.outputs!.every((output) => output.required === false);
}

function markProviderLaneSkippable(node: DagNode): void {
  node.failurePolicy = {
    ...(node.failurePolicy ?? {}),
    skipOnFailure: true,
  };
}

function providerLaneSkipResult(options: {
  node: DagNode;
  provider: ProviderId;
  requestedProvider: ProviderId;
  decision: ProviderRouteDecision;
  reason: string;
  failureKind: ProviderFailureKind;
  attempts: number;
  traceMetadata: Partial<ProviderTaskMetadata>;
  providerModel?: ProviderModelRef;
  deepseekPlan?: DeepSeekRoutePlan;
  providerAssist?: ProviderAssistMetadata;
  baseResult: TaskResult;
}): TaskResult {
  markProviderLaneSkippable(options.node);
  const stdout = options.baseResult.stdout || `[omk] ${providerDisplayName(options.provider)} optional lane skipped: ${options.reason}\n`;
  const stderr = options.baseResult.stderr || options.reason;
  const metadata: ProviderTaskMetadata = {
    provider: options.provider,
    requestedProvider: options.requestedProvider,
    providerRouteReason: options.decision.reason,
    ...options.traceMetadata,
    providerAttemptCount: options.attempts,
    ...(options.provider === "deepseek"
      ? deepseekMetadata(options.deepseekPlan)
      : providerModelMetadata(options.providerModel)),
    providerSkip: {
      provider: options.provider,
      reason: options.reason,
      skippable: true,
      attempts: options.attempts,
      failureKind: options.failureKind,
    },
  };
  if (options.providerAssist) {
    metadata.providerAssist = options.providerAssist;
  }

  return withProviderMetadata({
    ...options.baseResult,
    success: false,
    exitCode: options.baseResult.exitCode ?? 1,
    stdout,
    stderr,
  }, metadata);
}

function providerExceptionResult(error: unknown): TaskResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: message,
  };
}

function deepseekPlanFromNode(node: DagNode): DeepSeekRoutePlan | undefined {
  if (!isDeepSeekLaneNode(node)) return undefined;
  const model = [node.routing?.providerModel, node.routing?.assignedModel]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const tier = node.routing?.providerModelTier
    ?? (model.includes("pro") ? "pro" : model.includes("flash") ? "flash" : undefined);
  if (!tier) return undefined;
  return {
    provider: "deepseek",
    model: tier === "flash" ? DEEPSEEK_V4_FLASH_MODEL : DEEPSEEK_V4_PRO_MODEL,
    tier,
    participation: "direct",
    reasoningEffort: "max",
    ratioBucket: tier === "flash" ? 0 : 9,
  };
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    }, { once: true });
  });
}

function resolveDeepSeekAdvisoryTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OMK_DEEPSEEK_ADVISORY_TIMEOUT_MS;
  if (!raw) return 30_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
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
}): Promise<{ success: boolean; result: TaskResult; summary: string; advisoryJson?: string; failureReason?: string; metadata: ProviderAssistMetadata }> {
  const advisoryTimeoutMs = resolveDeepSeekAdvisoryTimeoutMs();
  const advisoryAbortController = new AbortController();
  const advisorySignal = options.signal
    ? AbortSignal.any([options.signal, advisoryAbortController.signal])
    : advisoryAbortController.signal;

  const advisoryPromise = options.deepseekRunner.run(options.node, {
    ...options.env,
    ...options.traceEnv,
    ...deepseekRouteEnv(options.plan),
    OMK_PROVIDER: "deepseek",
    OMK_PROVIDER_REQUESTED: "deepseek",
    OMK_PROVIDER_FALLBACK: "kimi",
    OMK_PROVIDER_ROUTE_REASON: options.routeReason,
  }, advisorySignal);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  const cleanup = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (abortListener !== undefined) {
      options.signal?.removeEventListener("abort", abortListener);
      abortListener = undefined;
    }
  };

  const timeoutPromise = new Promise<TaskResult>((_, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error("Aborted"));
      return;
    }
    timer = setTimeout(() => {
      const timeoutError = new Error(`DeepSeek advisory timed out after ${advisoryTimeoutMs}ms`);
      advisoryAbortController.abort(timeoutError);
      reject(timeoutError);
    }, advisoryTimeoutMs);
    abortListener = () => {
      clearTimeout(timer);
      const reason = options.signal!.reason ?? new Error("Aborted");
      advisoryAbortController.abort(reason);
      reject(reason);
    };
    options.signal?.addEventListener("abort", abortListener, { once: true });
  });

  let result: TaskResult;
  try {
    result = await Promise.race([advisoryPromise, timeoutPromise]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: message,
    };
  } finally {
    cleanup();
  }

  const success = result.success;
  const summary = success
    ? summarizeAdvisory(result.stdout)
    : "";
  const advisoryJson = success ? normalizeAdvisoryJson(result.stdout) : undefined;
  const failureReason = success ? undefined : summarizeFailures([result]);
  return {
    success,
    result,
    summary,
    advisoryJson,
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

async function runGenericProviderAdvisory(options: {
  node: DagNode;
  env: Record<string, string>;
  runner: TaskRunner;
  routeReason: string;
  modelRef?: ProviderModelRef;
  invocationKey: string;
  traceEnv: Record<string, string>;
  signal?: AbortSignal;
}): Promise<{ success: boolean; result: TaskResult; summary: string; failureReason?: string; metadata: ProviderAssistMetadata }> {
  let result: TaskResult;
  try {
    result = await options.runner.run(options.node, {
      ...options.env,
      ...options.traceEnv,
      ...providerModelEnv(options.modelRef),
      OMK_PROVIDER: options.modelRef?.provider ?? "external",
      OMK_PROVIDER_REQUESTED: options.modelRef?.provider ?? "external",
      OMK_PROVIDER_FALLBACK: "kimi",
      OMK_PROVIDER_ROUTE_REASON: options.routeReason,
      OMK_PROVIDER_AUTHORITY: "advisory",
    }, options.signal);
  } catch (error: unknown) {
    result = providerExceptionResult(error);
  }
  const success = result.success;
  const summary = success ? summarizeAdvisory(result.stdout) : "";
  const failureReason = success ? undefined : summarizeFailures([result]);
  return {
    success,
    result,
    summary,
    failureReason,
    metadata: {
      provider: options.modelRef?.provider ?? "external",
      model: options.modelRef?.model,
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
  if (decision.providerModel) {
    env.OMK_PROVIDER_MODEL = decision.providerModel.model;
    env.OMK_PROVIDER_AUTHORITY = decision.providerModel.authority;
    env.OMK_PROVIDER_CAPABILITIES = decision.providerModel.capabilities.join(",");
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
    decision.deepseek?.model ?? decision.providerModel?.model ?? "kimi",
    decision.deepseek?.participation ?? decision.providerModel?.authority ?? "authoritative",
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
    providerAuthority: plan.participation,
  };
}

function providerModelEnv(modelRef: ProviderModelRef | undefined): Record<string, string> {
  if (!modelRef) return {};
  return {
    OMK_PROVIDER_MODEL: modelRef.model,
    OMK_PROVIDER_AUTHORITY: modelRef.authority,
    OMK_PROVIDER_CAPABILITIES: modelRef.capabilities.join(","),
  };
}

function providerModelMetadata(modelRef: ProviderModelRef | undefined): Partial<ProviderTaskMetadata> {
  if (!modelRef) return {};
  return {
    providerModel: modelRef.model,
    providerParticipation: modelRef.authority === "authority" || modelRef.authority === "veto" ? undefined : modelRef.authority,
    providerAuthority: modelRef.authority,
    providerModelRef: modelRef,
  };
}

function providerDisplayName(provider: ProviderId): string {
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "qwen") return "Qwen";
  if (provider === "codex") return "Codex";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "kimi") return "Kimi";
  return provider;
}

function isExternalProvider(provider: ProviderId, authorityProvider: ProviderId): boolean {
  return provider !== authorityProvider && provider !== "kimi" && provider !== "deepseek";
}

function genericAdvisoryProviderForDecision(
  decision: ProviderRouteDecision,
  authorityProvider: ProviderId
): ProviderId | undefined {
  const modelRef = decision.providerModel;
  if (!modelRef) return undefined;
  const provider = modelRef.provider;
  if (isExternalProvider(provider, authorityProvider) && modelRef.authority === "advisory") return provider;
  return undefined;
}

function requestedProviderForKimiDecision(
  decision: ProviderRouteDecision,
  authorityProvider: ProviderId
): ProviderId {
  return requestedProviderForAuthorityDecision(decision, authorityProvider);
}

function requestedProviderForAuthorityDecision(
  decision: ProviderRouteDecision,
  authorityProvider: ProviderId
): ProviderId {
  const modelRef = decision.providerModel;
  if (!modelRef) return decision.provider;
  const provider = modelRef.provider;
  if (isExternalProvider(provider, authorityProvider) && modelRef.authority === "veto") return provider;
  return decision.provider;
}

function shouldUseLegacyKimiFallback(
  providerPolicy: ProviderPolicy | undefined,
  decision: ProviderRouteDecision,
  authorityProvider: ProviderId
): boolean {
  return providerPolicy === "kimi" || authorityProvider === "kimi" || decision.provider === "kimi" || decision.fallbackProvider === "kimi";
}

function summarizeAdvisory(stdout: string): string {
  return stdout
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

function normalizeAdvisoryJson(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const normalized = { ...(parsed as Record<string, unknown>) };
    if (normalized.questionsForAuthorityProvider === undefined && normalized.questionsForKimi !== undefined) {
      normalized.questionsForAuthorityProvider = normalized.questionsForKimi;
    }
    delete normalized.questionsForKimi;
    return JSON.stringify(normalized);
  } catch {
    return undefined;
  }
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
