/**
 * RuntimeBackedTaskRunner — pure runtime-registry + runtime-router task runner.
 *
 * Replaces the provider-backed wrapper with a provider-neutral runtime pipeline:
 * 1. Build ContextCapsule via ContextBroker
 * 2. Route to best AgentRuntime via RuntimeRouter
 * 3. Convert AgentRunResult -> TaskResult
 */

import type { TaskRunner, TaskResult } from "../contracts/orchestration.js";
import type { RuntimeId, AgentTask, AgentResult, AgentRunResult, CapabilityManifest } from "./agent-runtime.js";
import { toTaskResult } from "./agent-runtime.js";
import { createRuntimeRegistry, type RuntimeRegistry } from "./runtime-registry.js";
import { createRuntimeRouter } from "./runtime-router.js";
import { createContextBroker } from "./context-broker.js";
import { createKimiPrintRuntime } from "./kimi-print-runtime.js";
import { createCodexCliRuntime } from "./codex-cli-runtime.js";
import { DeepSeekRuntime } from "./deepseek-runtime.js";
import { CodexRuntime } from "./codex-runtime.js";
import { createOpencodeCliAdapter } from "../adapters/opencode/opencode-cli-adapter.js";
import { createCommandcodeCliAdapter } from "../adapters/commandcode/commandcode-cli-adapter.js";
import { createChatAdvisoryRuntime } from "./chat-advisory-runtime.js";
import { checkCommand, resolveKimiBin } from "../util/shell.js";

export interface RuntimeBackedTaskRunnerOptions {
  cwd: string;
  runtimePolicy?: string;
  defaultRuntime?: RuntimeId;
  fallbackChain?: string[];
  env?: Record<string, string>;
}

async function createDefaultRuntimeRegistry(
  options: RuntimeBackedTaskRunnerOptions
): Promise<RuntimeRegistry> {
  const registry = createRuntimeRegistry();

  // codex-cli (legacy factory + new task-aware class)
  if (await checkCommand("codex").catch(() => false)) {
    registry.register(createCodexCliRuntime({ cwd: options.cwd }));
    registry.register(new CodexRuntime({ cwd: options.cwd }));
  }

  // kimi-print adapter (compatibility runtime; authority is selected by OMK routing)
  const kimiBin = resolveKimiBin({ ...process.env, ...(options.env ?? {}) });
  if (await checkCommand(kimiBin).catch(() => false)) {
    registry.register(
      createKimiPrintRuntime({ cwd: options.cwd, env: options.env })
    );
  }

  // deepseek-api
  const deepseekKey = options.env?.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    registry.register(new DeepSeekRuntime({ apiKey: deepseekKey }));
  }

  // opencode-cli
  if (await checkCommand("opencode").catch(() => false)) {
    registry.register(createOpencodeCliAdapter());
  }

  // commandcode-cli
  if (await checkCommand("commandcode").catch(() => false)) {
    registry.register(createCommandcodeCliAdapter());
  }

  // chat advisory fallback — when no runtime is available, show setup guidance
  if (registry.list().length === 0) {
    registry.register(createChatAdvisoryRuntime());
  }

  return registry;
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

  const contextBroker = createContextBroker({
    projectRoot: options.cwd,
  });

  const runner: TaskRunner = {
    async run(node, _env, signal): Promise<TaskResult> {
      const { capsule } = await contextBroker.buildCapsule(node);
      const abortSignal = signal ?? new AbortController().signal;
      const capabilities = taskCapabilitiesFromNode(capsule.node);
      const routing = capsule.node.routing;
      const preferredProviders: string[] = [];
      if (routing?.provider && routing.provider !== "auto") {
        preferredProviders.push(routing.provider);
      }
      if (routing?.candidateProviders?.length) {
        preferredProviders.push(...routing.candidateProviders);
      }
      const providerFallbackChain = options.fallbackChain
        ?? (routing?.fallbackProvider ? [routing.fallbackProvider] : []);

      // Build AgentTask from capsule (inline conversion; TODO: import capsuleToTask when available)
      const task: AgentTask = {
        prompt: capsule.task,
        context: {
          runId: capsule.runId,
          nodeId: capsule.nodeId,
          role: capsule.node.role,
          goal: capsule.goal,
          system: capsule.system,
          files: capsule.relevantFiles.map((f) => f.path),
          memory: capsule.graphMemory.map((m) => ({
            key: m.key,
            source: m.sourceRunId ?? m.sourceNodeId ?? "unknown",
            summary: m.value,
          })),
          cwd: options.cwd,
          env: options.env,
          abortSignal,
        },
        tools: {
          available: [],
          // TODO: populate from capsule/node tools once capsuleToTask is available
        },
        providerPolicy: {
          strategy: "priority-first",
          preferredProviders,
          fallbackChain: providerFallbackChain,
        },
        capabilities,
      };

      let taskResult: TaskResult;
      if (typeof runtimeRouter.execute === "function") {
        const agentResult: AgentResult = await runtimeRouter.execute(task);
        // Adapt AgentResult -> AgentRunResult so toTaskResult can consume it
        const adapted: AgentRunResult = {
          success: agentResult.exitCode === 0,
          exitCode: agentResult.exitCode,
          stdout: agentResult.output,
          stderr: "",
          metadata: {
            ...agentResult.metadata,
            ...(agentResult.thinking && { thinking: agentResult.thinking }),
            ...(agentResult.todos && { todos: agentResult.todos }),
          },
          tokenUsage: agentResult.tokenUsage,
          toolCalls: agentResult.toolCalls,
        };
        taskResult = toTaskResult(adapted);
      } else {
        const agentResult = await runtimeRouter.runNode(capsule, abortSignal);
        taskResult = toTaskResult(agentResult);
      }

      // Ensure routing metadata is present even if the router failed to attach it
      taskResult.metadata = {
        ...(taskResult.metadata ?? {}),
        fallbackChain: providerFallbackChain,
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

function taskCapabilitiesFromNode(node: {
  role?: string;
  outputs?: Array<{ gate?: string }>;
  routing?: { requiresMcp?: boolean; requiresToolCalling?: boolean; mcpServers?: string[] };
}): CapabilityManifest {
  const role = node.role?.toLowerCase() ?? "";
  const gates = node.outputs?.map((output) => output.gate).filter(Boolean) ?? [];
  const merge = role === "merger" || role === "integrator" || role === "orchestrator";
  const write = merge || role === "coder" || role === "executor" || role === "refactorer";
  const shell = node.routing?.requiresToolCalling === true || gates.includes("command-pass") || gates.includes("test-pass");
  const review = role === "reviewer" || role === "qa" || role === "tester" || gates.includes("review-pass");
  const mcp = node.routing?.requiresMcp === true || (node.routing?.mcpServers?.length ?? 0) > 0;
  return {
    read: true,
    write,
    shell,
    mcp,
    patch: write,
    review,
    merge,
    vision: false,
    toolCalling: node.routing?.requiresToolCalling === true,
  };
}
