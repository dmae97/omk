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
import type { AgentRunResult, AgentTask } from "./agent-runtime.js";
import { toTaskResult } from "./agent-runtime.js";
import { checkEvidenceGate } from "./contracts/evidence.js";
import { capsuleToTask } from "./context-broker-converter.js";
import { applyTaskRunContextToAgentTask, envFromWorkerManifest } from "./worker-manifest.js";
import { createRuntimeRegistry, type RuntimeRegistry } from "./runtime-registry.js";
import { createRuntimeRouter } from "./runtime-router.js";
import { createContextBroker } from "./context-broker.js";
import type { ContextCapsule } from "./context-capsule.js";
import { maybeCompactWithHeadroom } from "./headroom-policy.js";

const REQUIRED_CONTEXT_SECTIONS = [
  "task",
  "node routing",
  "evidence requirements",
  "safety constraints",
  "capabilities",
];

interface CompactValidationResult {
  readonly ok: boolean;
  readonly missing: readonly string[];
}

function validateCompactedContext(
  compactedText: string,
  capsule: ContextCapsule,
): CompactValidationResult {
  const lower = compactedText.toLowerCase();
  const missing: string[] = [];

  // Task section: compacted text should mention at least part of the task prompt.
  const taskLower = capsule.task.toLowerCase().trim();
  if (taskLower.length > 0 && !lower.includes(taskLower.slice(0, Math.min(40, taskLower.length)))) {
    missing.push("task");
  }

  // Node routing section: provider, risk, and sandbox/readOnly must be recoverable.
  const routing = capsule.node.routing;
  if (routing) {
    if (routing.provider && !lower.includes(routing.provider.toLowerCase())) missing.push("node routing provider");
    if (routing.risk && !lower.includes(routing.risk.toLowerCase())) missing.push("node routing risk");
    if (routing.sandboxMode && !lower.includes(routing.sandboxMode.toLowerCase())) missing.push("node routing sandboxMode");
    if (routing.readOnly === true && !lower.includes("read-only") && !lower.includes("readonly")) {
      missing.push("node routing readOnly");
    }
  }

  // Evidence requirements: required gates should be preserved.
  const requiredGates = capsule.evidenceRequirements
    .filter((e) => e.required)
    .map((e) => e.gate.toLowerCase());
  if (requiredGates.length > 0) {
    const hasAnyGate = requiredGates.some((gate) => lower.includes(gate));
    if (!hasAnyGate) missing.push("evidence requirements");
  }

  // Safety constraints: system instruction should remain in the compacted text or explicitly referenced.
  const systemLower = capsule.system.toLowerCase();
  const safetyMarkers = ["preserve", "safety", "constraints", "evidence required", "capabilities"];
  const hasSafetyMarker = safetyMarkers.some((marker) => lower.includes(marker));
  const hasSystemOverlap = systemLower.length > 0 && lower.includes(systemLower.slice(0, Math.min(60, systemLower.length)));
  if (!hasSafetyMarker && !hasSystemOverlap) missing.push("safety constraints");

  // Capability manifest: assigned provider capabilities should be mentioned.
  const assignedCaps = new Set(routing?.assignedProviderCapabilities?.map((c) => c.toLowerCase()) ?? []);
  if (assignedCaps.size > 0) {
    const hasAnyCap = Array.from(assignedCaps).some((cap) => lower.includes(cap));
    if (!hasAnyCap) missing.push("capabilities");
  }

  return { ok: missing.length === 0, missing };
}

function buildMissingContextGuardNote(missing: readonly string[]): string {
  return `Headroom compaction removed required sections: ${missing.join(", ")}; using original capsule.`;
}
import { DeepSeekRuntime } from "./deepseek-runtime.js";
import { CodexRuntime } from "./codex-runtime.js";
import { createOpencodeCliAdapter } from "../adapters/opencode/opencode-cli-adapter.js";
import { createCommandcodeCliAdapter } from "../adapters/commandcode/commandcode-cli-adapter.js";
import { createChatAdvisoryRuntime } from "./chat-advisory-runtime.js";
import { LocalLlmRuntime } from "./local-llm-runtime.js";
import { checkCommand } from "../util/shell.js";
import { createMimoApiRuntime } from "./mimo-api-runtime.js";
import { createKimiApiRuntime } from "./kimi-api-runtime.js";
import { createGlmApiRuntime } from "./glm-api-runtime.js";
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
  headroomCompactor?: (text: string) => Promise<string | null>;
}

async function createDefaultRuntimeRegistry(
  options: RuntimeBackedTaskRunnerOptions
): Promise<RuntimeRegistry> {
  const registry = createRuntimeRegistry();
  // ── MiMo API runtime (Xiaomi MiMo — OpenAI-compatible, highest priority) ──
  let mimoApiKey = options.env?.MIMO_API_KEY ?? process.env.MIMO_API_KEY;
  if (!mimoApiKey) {
    mimoApiKey = readConfiguredProviderApiKey("mimo");
  }
  if (mimoApiKey) {
    registry.register(createMimoApiRuntime({ apiKey: mimoApiKey }));
  }

  // ── Kimi API runtime (Moonshot HTTP direct — no binary needed) ──
  let kimiApiKey = options.env?.KIMI_API_KEY ?? process.env.KIMI_API_KEY;
  if (!kimiApiKey) {
    kimiApiKey = readConfiguredProviderApiKey("kimi");
  }
  if (kimiApiKey) {
    registry.register(createKimiApiRuntime({ apiKey: kimiApiKey }));
  }

  // ── GLM API runtime (Zhipu AI — OpenAI-compatible advisory lane) ──
  const glmKey = options.env?.BIGMODEL_API_KEY
    ?? options.env?.GLM_API_KEY
    ?? process.env.BIGMODEL_API_KEY
    ?? process.env.GLM_API_KEY
    ?? readConfiguredProviderApiKey("glm");
  if (glmKey) {
    registry.register(createGlmApiRuntime({ apiKey: glmKey, env: options.env }));
  }

  // ── codex-cli ──
  const codexBin = options.env?.CODEX_BIN ?? process.env.CODEX_BIN ?? "codex";
  if (await checkCommand(codexBin).catch(() => false)) {
    registry.register(new CodexRuntime({ bin: codexBin, cwd: options.cwd }));
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

function readConfiguredProviderApiKey(providerId: string): string | undefined {
  const configContent = readProviderConfig(".omk");
  if (!configContent) return undefined;

  const match = configContent.match(
    new RegExp(`\\[providers\\.${escapeRegExp(providerId)}\\][\\s\\S]*?api_key\\s*=\\s*"([^"]+)"`)
  );
  return match?.[1];
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



function applyCompactedTextToCapsule(
  capsule: ContextCapsule,
  compactedText: string,
): ContextCapsule {
  const trimmed = compactedText.trim();
  if (trimmed.length === 0) return capsule;
  const originalSize = JSON.stringify(capsule).length;
  if (trimmed.length >= originalSize) return capsule;
  // If compaction stripped required structural context, keep original but note the guard.
  const validation = validateCompactedContext(trimmed, capsule);
  if (!validation.ok) {
    return {
      ...capsule,
      system: [
        capsule.system,
        "",
        "[OMK headroom compacted context]",
        `Headroom compaction removed required sections: ${validation.missing.join(", ")}; using original capsule.`,
      ].filter(Boolean).join("\n"),
      budget: { ...capsule.budget, compression: "summary" },
    };
  }
  return {
    ...capsule,
    system: [
      capsule.system,
      "",
      "[OMK headroom compacted context]",
      "The original context capsule was compacted before runtime dispatch. Preserve task, node routing, evidence requirements, and safety constraints below.",
      trimmed,
    ].filter(Boolean).join("\n"),
    dependencySummaries: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    budget: { ...capsule.budget, compression: "summary" },
  };
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
      const { capsule, headroomDecision } = await contextBroker.buildCapsule(node, runState);
      let effectiveCapsule = capsule;
      let headroomCompaction: { compacted: boolean; via: string } | undefined;
      // CTX guard: compact via headroom before the context window crosses the threshold (~90%).
      if (headroomDecision?.shouldCompact) {
        const compactResult = await maybeCompactWithHeadroom({
          decision: headroomDecision,
          text: JSON.stringify(capsule),
          runHeadroom: options.headroomCompactor,
        }).catch(() => undefined);
        if (compactResult) {
          headroomCompaction = { compacted: compactResult.compacted, via: compactResult.via };
          if (compactResult.compactedText) {
            effectiveCapsule = applyCompactedTextToCapsule(capsule, compactResult.compactedText);
          }
        }
      }
      const routing = effectiveCapsule.node.routing;
      const providerFallbackChain = options.fallbackChain
        ?? (routing?.fallbackProvider ? [routing.fallbackProvider] : []);
      const abortSignal = signal ?? new AbortController().signal;

      const taskEnv = {
        ...(options.env ?? {}),
        ...(env ?? {}),
        ...(runContext ? envFromWorkerManifest(runContext.worker) : {}),
      };
      const baseTask = applyTaskRunContextToAgentTask(await capsuleToTask(effectiveCapsule, {
        signal: abortSignal,
        cwd: options.cwd,
        env: taskEnv,
        fallbackChain: providerFallbackChain,
      }), runContext);
      const task = options.onOutput
        ? { ...baseTask, context: { ...baseTask.context, onOutput: options.onOutput } }
        : baseTask;

      const evidenceRequired = effectiveCapsule.node.routing?.evidenceRequired === true || isHighRiskTask(task);
      const evidenceCheck = checkEvidenceGate(evidenceRequired, effectiveCapsule.node.outputs, null);
      if (evidenceRequired && !evidenceCheck.satisfied) {
        return {
          success: false,
          exitCode: 78,
          stdout: "",
          stderr: `[omk] Evidence gate required but missing: ${evidenceCheck.reason}`,
          metadata: {
            evidenceRequired,
            evidenceCheck,
            fallbackChain: task.providerPolicy.fallbackChain,
          },
        };
      }

      const agentResult: AgentRunResult = await runtimeRouter.executeTask(task, effectiveCapsule, abortSignal);
      const taskResult = toTaskResult(agentResult);

      // Post-execution evidence check for tasks that produced no metadata gate
      if (evidenceRequired && agentResult.success) {
        const postCheck = checkEvidenceGate(true, effectiveCapsule.node.outputs, taskResult.metadata ?? null);
        if (!postCheck.satisfied) {
          return {
            success: false,
            exitCode: 78,
            stdout: taskResult.stdout,
            stderr: `[omk] Evidence gate required but task produced no replayable evidence: ${postCheck.reason}`,
            metadata: {
              ...taskResult.metadata,
              evidenceRequired,
              evidenceCheck: postCheck,
            },
          };
        }
      }

      // Ensure routing metadata is present even if the router failed to attach it
      taskResult.metadata = {
        ...(taskResult.metadata ?? {}),
        fallbackChain: task.providerPolicy.fallbackChain,
        ...(headroomCompaction && { headroomCompaction }),
        ...(runContext && { workerOwner: runContext.worker.owner }),
        ...(evidenceRequired && { evidenceRequired, evidenceCheck: evidenceCheck }),
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

function isHighRiskTask(task: AgentTask): boolean {
  return task.capabilities.write === true || task.capabilities.patch === true || task.capabilities.shell === true || task.capabilities.merge === true;
}
