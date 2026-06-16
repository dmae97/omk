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
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunResult, AgentTask } from "./agent-runtime.js";
import { toTaskResult } from "./agent-runtime.js";
import { checkEvidenceGate, hasDeclaredEvidenceRequirement } from "./contracts/evidence.js";
import { capsuleToTask } from "./context-broker-converter.js";
import { applyTaskRunContextToAgentTask, envFromWorkerManifest } from "./worker-manifest.js";
import { createRuntimeRegistry, type RuntimeRegistry } from "./runtime-registry.js";
import { createRuntimeRouter } from "./runtime-router.js";
import { createContextBroker } from "./context-broker.js";
import { estimateCapsuleTokens, type ContextCapsule } from "./context-capsule.js";
import { maybeCompactWithHeadroom } from "./headroom-policy.js";
import {
  DEFAULT_STRUCTURED_COMPACTION_CONTRACT,
  buildStructuredCompactionText,
  estimateTextTokens,
  structuredCompactionGuardNote,
  structuredCompactionInstruction,
  validateStructuredCompaction,
} from "./structured-compaction.js";
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



interface HeadroomApplyDiagnostics {
  readonly beforeChars: number;
  readonly afterChars: number | null;
  readonly beforeTokens: number;
  readonly afterTokens: number | null;
  readonly compactedTextProduced: boolean;
  readonly validated: boolean;
  readonly applied: boolean;
  readonly missingSections: readonly string[];
  readonly contract?: string;
  readonly reason: string;
}

function applyCompactedTextToCapsule(
  capsule: ContextCapsule,
  compactedText: string,
): { capsule: ContextCapsule; diagnostics: HeadroomApplyDiagnostics } {
  const trimmed = compactedText.trim();
  const beforeChars = JSON.stringify(capsule).length;
  const beforeTokens = estimateCapsuleTokens(capsule);
  const baseDiagnostics = {
    beforeChars,
    beforeTokens,
    compactedTextProduced: trimmed.length > 0,
  };

  if (trimmed.length === 0) {
    return {
      capsule,
      diagnostics: {
        ...baseDiagnostics,
        afterChars: 0,
        afterTokens: 0,
        validated: false,
        applied: false,
        missingSections: [],
        reason: "empty compacted text",
      },
    };
  }

  const afterChars = trimmed.length;
  const afterTokens = estimateTextTokens(trimmed);
  if (afterChars >= beforeChars) {
    return {
      capsule,
      diagnostics: {
        ...baseDiagnostics,
        afterChars,
        afterTokens,
        validated: false,
        applied: false,
        missingSections: [],
        reason: "compacted text is not smaller than original capsule",
      },
    };
  }

  // If compaction stripped required structural context, keep original but note the guard.
  const validation = validateStructuredCompaction(trimmed, capsule);
  if (!validation.ok) {
    return {
      capsule: {
        ...capsule,
        system: [
          capsule.system,
          "",
          "[OMK headroom compacted context]",
          structuredCompactionGuardNote(validation),
        ].filter(Boolean).join("\n"),
        budget: { ...capsule.budget, compression: "summary" },
      },
      diagnostics: {
        ...baseDiagnostics,
        afterChars,
        afterTokens,
        validated: false,
        applied: false,
        missingSections: validation.missing,
        contract: validation.contract.schemaVersion,
        reason: "structured compaction contract validation failed",
      },
    };
  }

  return {
    capsule: {
      ...capsule,
      system: [
        capsule.system,
        "",
        "[OMK headroom compacted context]",
        structuredCompactionInstruction(validation.contract),
        trimmed,
      ].filter(Boolean).join("\n"),
      dependencySummaries: [],
      relevantFiles: [],
      graphMemory: [],
      priorAttempts: [],
      budget: { ...capsule.budget, compression: "summary" },
    },
    diagnostics: {
      ...baseDiagnostics,
      afterChars,
      afterTokens,
      validated: true,
      applied: true,
      missingSections: [],
      contract: validation.contract.schemaVersion,
      reason: "compaction applied",
    },
  };
}

interface HeadroomCompactionMetadata extends Record<string, unknown> {
  readonly attempted: boolean;
  readonly compacted: boolean;
  readonly via: string;
  readonly backend: string;
  readonly compactedTextProduced: boolean;
  readonly validated: boolean;
  readonly applied: boolean;
  readonly beforeChars?: number;
  readonly afterChars?: number | null;
  readonly beforeTokens?: number;
  readonly afterTokens?: number | null;
  readonly threshold?: number;
  readonly utilization?: number;
  readonly contract?: string;
  readonly missingSections?: readonly string[];
  readonly reason?: string;
  readonly artifactRef?: string;
}

function persistHeadroomDecisionArtifact(input: {
  cwd: string;
  runId: string | undefined;
  nodeId: string;
  metadata: HeadroomCompactionMetadata;
}): string | undefined {
  const rawRunId = input.runId?.trim() || "runtime-backed-task-runner";
  const runId = sanitizeArtifactSegment(rawRunId);
  const nodeId = sanitizeArtifactSegment(input.nodeId || "node");
  const relativePath = `.omk/runs/${runId}/headroom-decisions.jsonl`;
  try {
    const dir = join(input.cwd, ".omk", "runs", runId);
    mkdirSync(dir, { recursive: true });
    const record = {
      schemaVersion: "omk.headroom-decision.v1",
      runId,
      nodeId,
      timestamp: new Date().toISOString(),
      ...input.metadata,
      artifactRef: undefined,
    };
    appendFileSync(join(input.cwd, relativePath), `${JSON.stringify(record)}\n`, "utf-8");
    return relativePath;
  } catch {
    return undefined;
  }
}

function sanitizeArtifactSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128) || "unknown";
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
      let headroomCompaction: HeadroomCompactionMetadata | undefined;
      // CTX guard: compact via headroom before the context window crosses the threshold (~90%).
      if (headroomDecision?.shouldCompact) {
        const compactResult = await maybeCompactWithHeadroom({
          decision: headroomDecision,
          text: JSON.stringify(capsule),
          runHeadroom: options.headroomCompactor,
          fallbackText: () => buildStructuredCompactionText(capsule),
        }).catch(() => undefined);
        if (compactResult) {
          let applyDiagnostics: HeadroomApplyDiagnostics | undefined;
          if (compactResult.compactedText) {
            const applied = applyCompactedTextToCapsule(capsule, compactResult.compactedText);
            effectiveCapsule = applied.capsule;
            applyDiagnostics = applied.diagnostics;
          }
          headroomCompaction = {
            attempted: compactResult.attempted,
            compacted: compactResult.compacted,
            via: compactResult.via,
            backend: compactResult.backend,
            compactedTextProduced: compactResult.compactedTextProduced,
            validated: applyDiagnostics?.validated ?? false,
            applied: applyDiagnostics?.applied ?? false,
            beforeChars: applyDiagnostics?.beforeChars,
            afterChars: applyDiagnostics?.afterChars,
            beforeTokens: applyDiagnostics?.beforeTokens,
            afterTokens: applyDiagnostics?.afterTokens,
            threshold: headroomDecision.threshold,
            utilization: headroomDecision.utilization,
            contract: applyDiagnostics?.contract ?? DEFAULT_STRUCTURED_COMPACTION_CONTRACT.schemaVersion,
            missingSections: applyDiagnostics?.missingSections ?? [],
            reason: applyDiagnostics?.reason ?? compactResult.reason,
          };
          const artifactRef = persistHeadroomDecisionArtifact({
            cwd: options.cwd,
            runId: options.runId ?? capsule.runId,
            nodeId: capsule.nodeId,
            metadata: headroomCompaction,
          });
          if (artifactRef) headroomCompaction = { ...headroomCompaction, artifactRef };
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

      const evidenceRequired = task.safety.evidenceRequired || effectiveCapsule.node.routing?.evidenceRequired === true || isHighRiskTask(task);
      const declaredEvidenceOk = !evidenceRequired || hasDeclaredEvidenceRequirement(effectiveCapsule.node.outputs);
      if (evidenceRequired && !declaredEvidenceOk) {
        return {
          success: false,
          exitCode: 78,
          stdout: "",
          stderr: "[omk] Evidence gate required but missing: high-risk task declares no required evidence output gate",
          metadata: {
            evidenceRequired,
            evidenceDeclarationMissing: true,
            fallbackChain: task.providerPolicy.fallbackChain,
          },
        };
      }

      const agentResult: AgentRunResult = await runtimeRouter.executeTask(task, effectiveCapsule, abortSignal);
      const taskResult = toTaskResult(agentResult);

      // Post-execution evidence check for tasks that produced no metadata gate
      if (evidenceRequired && agentResult.success) {
        const postCheck = checkEvidenceGate(true, effectiveCapsule.node.outputs, taskResult.metadata ?? null, taskResult.stdout);
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
        ...(evidenceRequired && { evidenceRequired }),
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
