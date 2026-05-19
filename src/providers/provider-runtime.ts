import type { TaskRunner } from "../contracts/orchestration.js";
import { createKimiTaskRunner, type KimiTaskRunnerOptions } from "../kimi/runner.js";
import { style, status } from "../util/theme.js";
import { checkDeepSeekBalance } from "./deepseek/deepseek-balance.js";
import { createDeepSeekReadOnlyTaskRunner } from "./deepseek/deepseek-provider.js";
import {
  forceDisableDeepSeek,
  getDeepSeekProviderStatus,
  resolveDeepSeekApiKey,
} from "./deepseek/deepseek-config.js";
import { ProviderHealthRegistry } from "./health.js";
import { createProviderTaskRunner } from "./provider-task-runner.js";
import type { ProviderPolicy } from "./types.js";
import { createKimiProvider } from "./kimi-provider.js";
import { createDeepSeekProvider } from "./deepseek-provider.js";
import { createProviderRouter } from "./provider-router.js";
import type { AgentProvider } from "./provider.js";
import { createContextBroker } from "../runtime/context-broker.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { createKimiPrintRuntime } from "../runtime/kimi-print-runtime.js";
import { createKimiWireRuntime } from "../runtime/kimi-wire-runtime.js";
import { createRuntimeRouter } from "../runtime/runtime-router.js";
export interface ProviderBackedTaskRunnerOptions {
  kimi: KimiTaskRunnerOptions;
  providerPolicy?: ProviderPolicy;
  deepseekPromptPrefix?: string;
  allowDeepSeekAdvisoryFileNodes?: boolean;
}

export async function createProviderBackedTaskRunner(
  options: ProviderBackedTaskRunnerOptions
): Promise<TaskRunner> {
  const providerPolicy = options.providerPolicy ?? "auto";
  const kimiRunner = createKimiTaskRunner(options.kimi);
  const providerHealth = new ProviderHealthRegistry();

  const providers: AgentProvider[] = [];
  const kimiProvider = createKimiProvider({ runner: kimiRunner });
  providers.push(kimiProvider);

  let deepseekRunnerRef: TaskRunner | undefined;

  const deepseekStatus = providerPolicy === "auto" ? await getDeepSeekProviderStatus() : undefined;
  const deepseekKey = providerPolicy === "auto" && deepseekStatus?.enabled
    ? await resolveDeepSeekApiKey()
    : undefined;
  const deepseekCheck = providerPolicy === "auto" && deepseekStatus?.enabled && deepseekKey?.apiKey
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
      console.error(style.gray("Kimi fallback is active. Run /deepseek-enable after topping up."));
    }
  } else if (providerPolicy === "auto" && deepseekStatus?.enabled === false) {
    providerHealth.markDeepSeekUnavailable(deepseekStatus.disabledReason ?? "DeepSeek disabled");
    console.error(status.warn(`DeepSeek disabled: ${deepseekStatus.disabledReason ?? "disabled by user"}`));
    console.error(style.gray("Kimi-only fallback is active. Run /deepseek-enable to re-enable."));
  }

  const router = createProviderRouter({
    providers,
    defaultStrategy: providerPolicy === "kimi" ? "kimi-first" : "cost-aware",
  });

  // Create runtime instances for the RuntimeRouter
  const runtimes: AgentRuntime[] = [];
  const kimiPrintRuntime = createKimiPrintRuntime(options.kimi);
  runtimes.push(kimiPrintRuntime);

  // Wire runtime is available but lower priority (incomplete tool handling)
  const kimiWireRuntime = createKimiWireRuntime({
    cwd: options.kimi.cwd,
    env: options.kimi.env as NodeJS.ProcessEnv | undefined,
  });
  runtimes.push(kimiWireRuntime);

  const runtimeRouter = createRuntimeRouter({
    runtimes,
    fallbackChain: ["kimi-print", "kimi-wire"],
  });

  // Create the base task runner (existing provider-task-runner with Kimi/DeepSeek routing)
  const baseRunner = createProviderTaskRunner({
    kimiRunner,
    deepseekRunner: deepseekRunnerRef,
    providerPolicy,
    providerHealth,
    onDeepSeekDisabled: async (event) => {
      await forceDisableDeepSeek(event.reason, {
        disabledBy: event.reason.includes("402") ? "provider-402" : "provider-availability",
      });
      console.error(status.warn(`DeepSeek forced disabled: ${event.reason}`));
      console.error(style.gray(`Node ${event.nodeId} fell back to Kimi. Run /deepseek-enable after fixing balance/auth.`));
    },
  });

  // Wrap provider routing with ContextBroker budget metadata. Provider routing
  // remains authoritative: RuntimeRouter failures are result values, not always
  // thrown exceptions, so running it first can bypass provider fallback metadata.
  const contextBroker = createContextBroker({ projectRoot: options.kimi.cwd });

  const wrappedRunner: TaskRunner = {
    onThinking: baseRunner.onThinking,
    fork: baseRunner.fork,
    async run(node, env, signal) {
      let budgetReport: unknown;
      try {
        budgetReport = (await contextBroker.buildCapsule(node)).report;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[omk] ContextBroker failed for node ${node.id}: ${errorMsg}\n`);
      }
      const taskResult = await baseRunner.run(node, env, signal);
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
