/**
 * RuntimeBackedTaskRunner — pure runtime-registry + runtime-router task runner.
 *
 * Replaces the provider-backed wrapper with a provider-neutral runtime pipeline:
 * 1. Build ContextCapsule via ContextBroker
 * 2. Route to best AgentRuntime via RuntimeRouter
 * 3. Convert AgentRunResult -> TaskResult
 */

import type { TaskRunner, TaskResult } from "../contracts/orchestration.js";
import type { TaskRunContext } from "../contracts/worker-context.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunResult } from "./agent-runtime.js";
import { toTaskResult } from "./agent-runtime.js";
import { capsuleToTask } from "./context-broker-converter.js";
import { applyTaskRunContextToAgentTask, envFromWorkerManifest } from "./worker-manifest.js";
import { createRuntimeRegistry, type RuntimeRegistry } from "./runtime-registry.js";
import { createRuntimeRouter } from "./runtime-router.js";
import { createContextBroker } from "./context-broker.js";
import { createKimiPrintRuntime } from "./kimi-print-runtime.js";
import { DeepSeekRuntime } from "./deepseek-runtime.js";
import { CodexRuntime } from "./codex-runtime.js";
import { createOpencodeCliAdapter } from "../adapters/opencode/opencode-cli-adapter.js";
import { createCommandcodeCliAdapter } from "../adapters/commandcode/commandcode-cli-adapter.js";
import { createChatAdvisoryRuntime } from "./chat-advisory-runtime.js";
import { LocalLlmRuntime } from "./local-llm-runtime.js";
import { checkCommand, resolveKimiBin } from "../util/shell.js";
import { createMimoApiRuntime } from "./mimo-api-runtime.js";
import { createKimiApiRuntime } from "./kimi-api-runtime.js";
import { getUserHome } from "../util/fs.js";

export interface RuntimeBackedTaskRunnerOptions {
  cwd: string;
  runtimePolicy?: string;
  defaultRuntime?: string;
  fallbackChain?: string[];
  env?: Record<string, string>;
  runId?: string;
  goal?: string;
  onOutput?: (text: string) => void;
}

async function createDefaultRuntimeRegistry(
  options: RuntimeBackedTaskRunnerOptions
): Promise<RuntimeRegistry> {
  const registry = createRuntimeRegistry();
  const legacyKimiEnabled = isLegacyKimiEnabled(options.env);

  // ── MiMo API runtime (Xiaomi MiMo — OpenAI-compatible, highest priority) ──
  let mimoApiKey = options.env?.MIMO_API_KEY ?? process.env.MIMO_API_KEY;
  if (!mimoApiKey) {
    mimoApiKey = readConfiguredProviderApiKey("mimo", { legacyKimiEnabled });
  }
  if (mimoApiKey) {
    registry.register(createMimoApiRuntime({ apiKey: mimoApiKey }));
  }

  // ── Kimi API runtime (Moonshot HTTP direct — no binary needed) ──
  let kimiApiKey = options.env?.KIMI_API_KEY ?? process.env.KIMI_API_KEY;
  if (legacyKimiEnabled && !kimiApiKey) {
    kimiApiKey = readConfiguredProviderApiKey("kimi", { legacyKimiEnabled });
  }
  if (legacyKimiEnabled && kimiApiKey) {
    registry.register(createKimiApiRuntime({ apiKey: kimiApiKey }));
  }

  // ── codex-cli ──
  const codexBin = options.env?.CODEX_BIN ?? process.env.CODEX_BIN ?? "codex";
  if (await checkCommand(codexBin).catch(() => false)) {
    registry.register(new CodexRuntime({ bin: codexBin, cwd: options.cwd }));
  }

  // ── kimi-print adapter (legacy binary — only if kimi CLI installed) ──
  const kimiBin = resolveKimiBin({ ...process.env, ...(options.env ?? {}) });
  if (legacyKimiEnabled && await checkCommand(kimiBin).catch(() => false)) {
    registry.register(createKimiPrintRuntime({ cwd: options.cwd, env: options.env }));
  }

  // ── local-llm (OpenAI-compatible local endpoint) ──
  const localBaseUrl = options.env?.LOCAL_LLM_BASE_URL ?? process.env.LOCAL_LLM_BASE_URL;
  if (localBaseUrl) {
    registry.register(new LocalLlmRuntime({
      baseUrl: localBaseUrl,
      model: options.env?.LOCAL_LLM_MODEL ?? process.env.LOCAL_LLM_MODEL,
      apiKey: options.env?.LOCAL_LLM_API_KEY ?? process.env.LOCAL_LLM_API_KEY,
    }));
  }

  // ── deepseek-api ──
  const deepseekKey = options.env?.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    registry.register(new DeepSeekRuntime({ apiKey: deepseekKey }));
  }

  // ── opencode-cli ──
  const opencodeBin = options.env?.OPENCODE_BIN ?? process.env.OPENCODE_BIN ?? "opencode";
  if (await checkCommand(opencodeBin).catch(() => false)) {
    registry.register(createOpencodeCliAdapter({ bin: opencodeBin, cwd: options.cwd, env: options.env }));
  }

  // ── commandcode-cli ──
  const configuredCommandcodeBin = options.env?.COMMANDCODE_BIN ?? process.env.COMMANDCODE_BIN;
  let commandcodeBin: string | null = null;
  if (configuredCommandcodeBin) {
    commandcodeBin = await checkCommand(configuredCommandcodeBin).catch(() => false)
      ? configuredCommandcodeBin
      : null;
  } else if (await checkCommand("commandcode").catch(() => false)) {
    commandcodeBin = "commandcode";
  }
  if (commandcodeBin) {
    registry.register(createCommandcodeCliAdapter({ bin: commandcodeBin, cwd: options.cwd, env: options.env }));
  }

  // ── chat advisory fallback ──
  if (registry.list().length === 0) {
    registry.register(createChatAdvisoryRuntime());
  }

  return registry;
}

function isLegacyKimiEnabled(env: Record<string, string> | undefined): boolean {
  const merged = { ...process.env, ...(env ?? {}) };
  return /^(1|true|yes)$/i.test(merged.OMK_LEGACY_KIMI_ENABLED ?? "");
}

function readConfiguredProviderApiKey(
  providerId: string,
  options: { legacyKimiEnabled: boolean }
): string | undefined {
  const configContents = [
    readProviderConfig(".omk"),
    ...(options.legacyKimiEnabled ? [readProviderConfig(".kimi")] : []),
  ].filter((content): content is string => content !== undefined);

  for (const configContent of configContents) {
    const match = configContent.match(
      new RegExp(`\\[providers\\.${escapeRegExp(providerId)}\\][\\s\\S]*?api_key\\s*=\\s*"([^"]+)"`)
    );
    if (match?.[1]) return match[1];
  }

  return undefined;
}

function readProviderConfig(configDir: ".omk" | ".kimi"): string | undefined {
  try {
    return readFileSync(join(getUserHome(), configDir, "config.toml"), "utf-8");
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function createRuntimeBackedTaskRunner(
  options: RuntimeBackedTaskRunnerOptions
): Promise<TaskRunner> {
  const registry = await createDefaultRuntimeRegistry(options);
  const runtimes = registry.list();

  const runtimeRouter = createRuntimeRouter({
    runtimes,
    fallbackChain: options.fallbackChain,
  });
  registry.onChange((nextRuntimes) => {
    runtimeRouter.setRuntimes(nextRuntimes);
  });

  const contextBroker = createContextBroker({
    projectRoot: options.cwd,
  });

  const runner: TaskRunner = {
    async run(node, env, signal, runContext?: TaskRunContext): Promise<TaskResult> {
      const runState = options.runId
        ? {
            schemaVersion: 1 as const,
            runId: options.runId,
            goalId: options.goal,
            nodes: [node],
            startedAt: new Date().toISOString(),
          }
        : undefined;
      const { capsule } = await contextBroker.buildCapsule(node, runState);
      const routing = capsule.node.routing;
      const providerFallbackChain = options.fallbackChain
        ?? (routing?.fallbackProvider ? [routing.fallbackProvider] : []);
      const abortSignal = signal ?? new AbortController().signal;

      const taskEnv = {
        ...(options.env ?? {}),
        ...(env ?? {}),
        ...(runContext ? envFromWorkerManifest(runContext.worker) : {}),
      };
      const baseTask = applyTaskRunContextToAgentTask(await capsuleToTask(capsule, {
        signal: abortSignal,
        cwd: options.cwd,
        env: taskEnv,
        fallbackChain: providerFallbackChain,
      }), runContext);
      const task = options.onOutput
        ? { ...baseTask, context: { ...baseTask.context, onOutput: options.onOutput } }
        : baseTask;

      const agentResult: AgentRunResult = await runtimeRouter.executeTask(task, capsule, abortSignal);
      const taskResult = toTaskResult(agentResult);

      // Ensure routing metadata is present even if the router failed to attach it
      taskResult.metadata = {
        ...(taskResult.metadata ?? {}),
        fallbackChain: task.providerPolicy.fallbackChain,
        ...(runContext && { workerOwner: runContext.worker.owner }),
      };

      return taskResult;
    },
  };

  // Attach introspection handles for executor debugging
  (runner as unknown as Record<string, unknown>)._runtimeRouter = runtimeRouter;
  (runner as unknown as Record<string, unknown>)._contextBroker = contextBroker;
  (runner as unknown as Record<string, unknown>)._registry = registry;

  return runner;
}
