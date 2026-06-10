import type { TaskRunner } from "../contracts/orchestration.js";
import type { KimiTaskRunnerOptions } from "../kimi/runner.js";
import { style, status } from "../util/theme.js";
import { getProjectRoot } from "../util/fs.js";
import { checkDeepSeekBalance } from "./deepseek/deepseek-balance.js";
import { createDeepSeekReadOnlyTaskRunner } from "./deepseek/deepseek-provider.js";
import {
  forceDisableDeepSeek,
  getDeepSeekProviderStatus,
  resolveDeepSeekApiKey,
} from "./deepseek/deepseek-config.js";
import { ProviderHealthRegistry } from "./health.js";
import { createProviderTaskRunner } from "./provider-task-runner.js";
import { DEFAULT_AUTHORITY_PROVIDER, type ProviderId, type ProviderModelDefault, type ProviderPolicy } from "./types.js";
import { createDeepSeekProvider } from "./deepseek-provider.js";
import { createProviderRouter } from "./provider-router.js";
import type { AgentProvider } from "./provider.js";
import { createOpenAICompatibleReadOnlyTaskRunner } from "./openai-compatible-runner.js";
import { createAnthropicMessagesReadOnlyTaskRunner } from "./anthropic-messages-runner.js";
import { createCodexCliAdvisoryTaskRunner } from "./codex-cli-runner.js";
import { providerDoctorStatus, readProviderRegistry, type ProviderRegistryEntry } from "./model-registry.js";
import { createContextBroker } from "../runtime/context-broker.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { createRuntimeRouter } from "../runtime/runtime-router.js";
export interface ProviderBackedTaskRunnerOptions {
  kimi?: KimiTaskRunnerOptions;
  cwd?: string;
  providerPolicy?: ProviderPolicy;
  eventRunDir?: string;
  deepseekPromptPrefix?: string;
  allowDeepSeekAdvisoryFileNodes?: boolean;
  fallbackChain?: string[];
  providers?: AgentProvider[];
  runtimes?: AgentRuntime[];
}

export async function createProviderBackedTaskRunner(
  options: ProviderBackedTaskRunnerOptions
): Promise<TaskRunner> {
  const providerPolicy = options.providerPolicy ?? "auto";
  const kimiOptions: KimiTaskRunnerOptions = options.kimi ?? { cwd: options.cwd ?? getProjectRoot() };
  const runnerCwd = kimiOptions.cwd ?? options.cwd ?? getProjectRoot();
  const kimiRunner = createDisabledLegacyKimiRunner();
  const providerHealth = new ProviderHealthRegistry();

  const providers: AgentProvider[] = [];
  let deepseekRunnerRef: TaskRunner | undefined;
  const providerRunners: Partial<Record<ProviderId, TaskRunner>> = {};
  const providerModels: Partial<Record<ProviderId, ProviderModelDefault>> = {};
  for (const provider of options.providers ?? []) {
    providers.push(provider);
    const providerId = provider.id as ProviderId;
    providerRunners[providerId] = createAgentProviderTaskRunner(provider);
    providerModels[providerId] = {
      model: providerId,
      capabilities: ["read", "review", "qa", "advisory", "write"],
    };
  }

  const allowDeepSeek = providerPolicy === "auto" || providerPolicy === "deepseek";
  const deepseekStatus = allowDeepSeek ? await getDeepSeekProviderStatus() : undefined;
  const deepseekKey = allowDeepSeek && deepseekStatus?.enabled
    ? await resolveDeepSeekApiKey()
    : undefined;
  const deepseekCheck = allowDeepSeek && deepseekStatus?.enabled && deepseekKey?.apiKey
    ? await checkDeepSeekBalance({ apiKey: deepseekKey.apiKey })
    : undefined;

  if (deepseekCheck?.available) {
    const deepseekRunner = createDeepSeekReadOnlyTaskRunner({
      apiKey: deepseekKey?.apiKey,
      allowAdvisoryFileNodes: options.allowDeepSeekAdvisoryFileNodes ?? true,
      promptPrefix: options.deepseekPromptPrefix,
    });
    deepseekRunnerRef = deepseekRunner;
    const deepseekProvider = createDeepSeekProvider({ runner: deepseekRunner });
    providers.push(deepseekProvider);
    providerHealth.markDeepSeekAvailable();
  } else if (deepseekCheck) {
    providerHealth.markDeepSeekUnavailable(deepseekCheck.reason ?? "DeepSeek unavailable");
    if (deepseekCheck.reason?.includes("402")) {
      await forceDisableDeepSeek(deepseekCheck.reason, { disabledBy: "provider-402" });
      console.error(status.warn(`DeepSeek forced disabled: ${deepseekCheck.reason}`));
      console.error(style.gray("Configured authority fallback is active. Run /deepseek-enable after topping up."));
    }
  } else if (allowDeepSeek && deepseekStatus?.enabled === false) {
    providerHealth.markDeepSeekUnavailable(deepseekStatus.disabledReason ?? "DeepSeek disabled");
    console.error(status.warn(`DeepSeek disabled: ${deepseekStatus.disabledReason ?? "disabled by user"}`));
    console.error(style.gray("Configured authority fallback is active. Run /deepseek-enable to re-enable."));
  }

  const registry = await readProviderRegistry();
  for (const entry of registry) {
    if (!shouldUseOpenAICompatibleProvider(entry, providerPolicy)) continue;
    const apiKey = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined;
    if (apiKey && entry.baseUrl) {
      if (entry.wireApi === "anthropic-messages") {
        providerRunners[entry.id] = createAnthropicMessagesReadOnlyTaskRunner({
          provider: entry.id,
          baseUrl: entry.baseUrl,
          apiKey,
          apiKeyEnv: entry.apiKeyEnv,
          model: entry.defaultModel,
          promptPrefix: options.deepseekPromptPrefix,
          headers: openAICompatibleHeaders(entry, process.env),
          contextWindow: entry.contextWindow,
          reservedOutputTokens: entry.reservedOutputTokens,
        });
      } else {
        providerRunners[entry.id] = createOpenAICompatibleReadOnlyTaskRunner({
          provider: entry.id,
          baseUrl: entry.baseUrl,
          apiKey,
          apiKeyEnv: entry.apiKeyEnv,
          model: entry.defaultModel,
          promptPrefix: options.deepseekPromptPrefix,
          headers: openAICompatibleHeaders(entry, process.env),
          contextWindow: entry.contextWindow,
          reservedOutputTokens: entry.reservedOutputTokens,
        });
      }
      providerModels[entry.id] = providerModelDefault(entry);
    } else if (providerPolicy === entry.id) {
      console.error(status.warn(`${providerDisplayName(entry.id)} unavailable: missing ${entry.apiKeyEnv ?? "API key env"} or base URL. Configured authority fallback is active.`));
    }
  }

  const codex = registry.find((entry) => entry.id === "codex");
  if (codex && codex.enabled && (providerPolicy === "auto" || providerPolicy === "codex")) {
    // Don't override custom providers passed via options.providers
    const hasCustomCodex = (options.providers ?? []).some((p) => p.id === "codex");
    if (!hasCustomCodex) {
      const codexStatus = await providerDoctorStatus("codex");
      if (codexStatus.available) {
        providerRunners.codex = createCodexCliAdvisoryTaskRunner({
          cwd: runnerCwd,
          model: codex.defaultModel,
          contextWindow: codex.contextWindow,
          reservedOutputTokens: codex.reservedOutputTokens,
        });
        providerModels.codex = providerModelDefault(codex);
      } else if (providerPolicy === "codex") {
        console.error(status.warn("Codex unavailable or unauthenticated; configured authority fallback is active."));
      }
    }
  }

  const router = createProviderRouter({
    providers,
    defaultStrategy: "cost-aware",
  });

  // Create runtime instances for the RuntimeRouter
  const runtimes: AgentRuntime[] = [];
  runtimes.push(...(options.runtimes ?? []));

  const runtimeRouter = createRuntimeRouter({
    runtimes,
    fallbackChain: options.fallbackChain,
  });

  // Create the base task runner (existing provider-task-runner with Kimi/DeepSeek routing)
  const baseRunner = createProviderTaskRunner({
    kimiRunner,
    deepseekRunner: deepseekRunnerRef,
    authorityProvider: resolveProviderBackedAuthorityProvider(providerPolicy, providerRunners),
    authorityRunner: providerRunners[resolveProviderBackedAuthorityProvider(providerPolicy, providerRunners)],
    providerRunners,
    providerModels,
    providerPolicy,
    providerHealth,
    onDeepSeekDisabled: async (event) => {
      await forceDisableDeepSeek(event.reason, {
        disabledBy: event.reason.includes("402") ? "provider-402" : "provider-availability",
      });
      console.error(status.warn(`DeepSeek forced disabled: ${event.reason}`));
      console.error(style.gray(`Node ${event.nodeId} used the configured authority fallback. Run /deepseek-enable after fixing balance/auth.`));
    },
  });

  // Wrap provider routing with ContextBroker budget metadata. Provider routing
  // remains authoritative: RuntimeRouter failures are result values, not always
  // thrown exceptions, so running it first can bypass provider fallback metadata.
  const contextBroker = createContextBroker({ projectRoot: kimiOptions.cwd ?? options.cwd ?? getProjectRoot() });

  const wrappedRunner: TaskRunner = {
    onThinking: baseRunner.onThinking,
    fork: baseRunner.fork,
    async run(node, env, signal, context) {
      let budgetReport: unknown;
      try {
        budgetReport = (await contextBroker.buildCapsule(node)).report;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[omk] ContextBroker failed for node ${node.id}: ${errorMsg}\n`);
      }
      const taskResult = await baseRunner.run(node, env, signal, context);
      taskResult.metadata = {
        ...(taskResult.metadata ?? {}),
        ...(budgetReport ? { _budgetReport: budgetReport } : {}),
      };
      return taskResult;
    },
  };

  // Attach metadata for executor introspection
  (wrappedRunner as unknown as Record<string, unknown>)._runtimeRouter = runtimeRouter;
  (wrappedRunner as unknown as Record<string, unknown>)._providers = providers;
  (wrappedRunner as unknown as Record<string, unknown>)._router = router;
  (wrappedRunner as unknown as Record<string, unknown>)._contextBroker = contextBroker;

  return wrappedRunner;
}

function shouldUseOpenAICompatibleProvider(entry: ProviderRegistryEntry, providerPolicy: ProviderPolicy): boolean {
  if (entry.id === "deepseek") return false;
  if (entry.kind !== "openai-compatible") return false;
  if (!entry.enabled) return false;
  return providerPolicy === "auto" || providerPolicy === entry.id;
}

function providerModelDefault(entry: ProviderRegistryEntry): ProviderModelDefault {
  return {
    model: entry.defaultModel,
    capabilities: entry.capabilities,
  };
}

function openAICompatibleHeaders(
  entry: ProviderRegistryEntry,
  env: NodeJS.ProcessEnv
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(entry.headers ?? {}) };
  if (entry.id === "openrouter") {
    setHeaderFromEnv(headers, "HTTP-Referer", env.OPENROUTER_HTTP_REFERER ?? env.OPENROUTER_REFERER);
    setHeaderFromEnv(headers, "X-OpenRouter-Title", env.OPENROUTER_X_TITLE ?? env.OPENROUTER_APP_TITLE);
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function setHeaderFromEnv(headers: Record<string, string>, name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) headers[name] = trimmed;
}

function createAgentProviderTaskRunner(provider: AgentProvider): TaskRunner {
  return {
    async run(node, env, signal, context) {
      return provider.run({
        node,
        env,
        signal: signal ?? new AbortController().signal,
        attempt: Number(env.OMK_PROVIDER_ATTEMPT ?? 1),
        runContext: context,
      });
    },
  };
}

function resolveProviderBackedAuthorityProvider(
  providerPolicy: ProviderPolicy,
  providerRunners: Partial<Record<ProviderId, TaskRunner>>
): ProviderId {
  if (providerPolicy === "codex" && providerRunners.codex) return "codex";
  if (providerRunners.codex) return "codex";
  if (providerPolicy !== "auto" && providerPolicy !== "deepseek" && providerRunners[providerPolicy]) {
    return providerPolicy;
  }
  return DEFAULT_AUTHORITY_PROVIDER;
}


function createDisabledLegacyKimiRunner(): TaskRunner {
  return {
    async run() {
      return {
        success: false,
        exitCode: 78,
        stdout: "",
        stderr: "Legacy provider runner is disabled unless explicitly configured.",
        metadata: { provider: "legacy", disabled: true },
      };
    },
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
