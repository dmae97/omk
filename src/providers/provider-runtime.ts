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
import { toTaskResult } from "../runtime/agent-runtime.js";
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

  // Wrap with RuntimeRouter integration
  // The wrapped runner builds a ContextCapsule and routes through RuntimeRouter,
  // falling back to the base runner if no runtime supports the node.
  const contextBroker = createContextBroker({ projectRoot: options.kimi.cwd });

  const wrappedRunner: TaskRunner = {
    onThinking: baseRunner.onThinking,
    fork: baseRunner.fork,
    async run(node, env) {
      // Try runtime router first
      try {
        const { capsule, report } = await contextBroker.buildCapsule(node);
        // Attach report for executor token recording
        (capsule as unknown as Record<string, unknown>)._budgetReport = report;
        const controller = new AbortController();
        const timeoutMs = node.timeoutMs ?? 120_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const runtimeResult = await runtimeRouter.runNode(capsule, controller.signal);
          const taskResult = toTaskResult(runtimeResult);
          // Attach budget report for executor token recording
          (taskResult.metadata as Record<string, unknown>)._budgetReport = report;
          return taskResult;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        // Log runtime router error for debugging before falling back to base runner
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[omk] RuntimeRouter failed for node ${node.id}: ${errorMsg}\n`);
        // Fallback to base runner (existing Kimi/DeepSeek provider routing)
        return baseRunner.run(node, env);
      }
    },
  };

  // Attach metadata for executor introspection
  (wrappedRunner as unknown as Record<string, unknown>)._runtimeRouter = runtimeRouter;
  (wrappedRunner as unknown as Record<string, unknown>)._providers = providers;
  (wrappedRunner as unknown as Record<string, unknown>)._router = router;
  (wrappedRunner as unknown as Record<string, unknown>)._contextBroker = contextBroker;

  return wrappedRunner;
}
