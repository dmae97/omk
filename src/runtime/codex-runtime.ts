/**
 * CodexRuntime — Codex CLI runtime adapter.
 *
 * Spawns the `codex` CLI subprocess and bridges AgentTask / AgentResult.
 */

import type {
  AgentRuntime,
  AgentRunResult,
  AgentResult,
  AgentTask,
  RuntimeCapabilities,
  RuntimeHealth,
} from "./agent-runtime.js";
import type { RuntimeHealthProbeRequest } from "./contracts/shared.js";
import type { ContextCapsule } from "./context-capsule.js";
import { capsuleToTask } from "./context-broker-converter.js";
import { runShell, runShellStreaming, checkCommand } from "../util/shell.js";
import { sanitizeUserVisibleOutput } from "../util/user-visible-output.js";
import { buildChildEnv } from "./child-env.js";
import {
  contextPreflightErrorMessage,
  preflightProviderInput,
} from "../providers/context-preflight.js";
import { createRuntimeSandboxProfile } from "./sandbox-profile.js";
import { staticRuntimeHealth } from "./runtime-health-probes.js";

export interface CodexRuntimeOptions {
  bin?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  contextWindow?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
}

export class CodexRuntime implements AgentRuntime {
  readonly id = "codex-cli";
  readonly providerId = "codex";
  readonly runtimeMode = "cli";
  readonly kind = "cli";
  readonly priority = 60;
  readonly capabilities: RuntimeCapabilities = {
    read: true,
    write: true,
    shell: true,
    mcp: false,
    patch: true,
    review: true,
    merge: false,
    vision: false,
    supportsStreaming: false,
    supportsStructuredOutput: false,
    supportsToolCalling: true,
  };

  private readonly cwd: string;
  private readonly bin: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly contextWindow: number | undefined;
  private readonly reservedOutputTokens: number | undefined;
  private readonly safetyMarginTokens: number | undefined;

  constructor(options: CodexRuntimeOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.bin = options.bin ?? process.env.CODEX_BIN ?? "codex";
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.contextWindow = options.contextWindow;
    this.reservedOutputTokens = options.reservedOutputTokens;
    this.safetyMarginTokens = options.safetyMarginTokens;
  }

  supports(capsule: ContextCapsule): boolean {
    const routing = capsule.node.routing;
    if (routing?.requiresMcp === true) return false;
    if (routing?.requiresToolCalling === true && this.capabilities.supportsToolCalling !== true) return false;

    for (const capability of routing?.assignedProviderCapabilities ?? []) {
      if (capability === "read" && this.capabilities.read !== true) return false;
      if (capability === "write" && this.capabilities.write !== true) return false;
      if (capability === "shell" && this.capabilities.shell !== true) return false;
      if (capability === "mcp" && this.capabilities.mcp !== true) return false;
      if (capability === "patch" && this.capabilities.patch !== true) return false;
      if (capability === "review" && this.capabilities.review !== true) return false;
      if (capability === "merge" && this.capabilities.merge !== true) return false;
      if (capability === "vision" && this.capabilities.vision !== true) return false;
    }

    return true;
  }

  async health(input: RuntimeHealthProbeRequest = { probeKind: "static", highRisk: false }): Promise<RuntimeHealth> {
    const started = Date.now();
    const runtimeOk = input.probeKind === "static"
      ? await checkCommand(this.bin).catch(() => false)
      : (await runShell(this.bin, ["--version"], { cwd: this.cwd, timeout: 5000 }).catch(() => ({ exitCode: 1 }))).exitCode === 0;
    const available = runtimeOk;
    return staticRuntimeHealth({
      runtimeId: this.id,
      available,
      reason: available ? undefined : "codex CLI is not available or failed --version probe",
      runtimeOk,
      authOk: runtimeOk,
      modelOk: true,
      quotaOk: true,
      rateLimitOk: true,
      latencyMs: input.probeKind === "static" ? undefined : Date.now() - started,
      probeKind: input.probeKind,
      ttlMs: input.probeKind === "static" ? 60_000 : 30_000,
    });
  }

  async runNode(capsule: ContextCapsule, signal: AbortSignal): Promise<AgentRunResult> {
    try {
      const task = await capsuleToTask(capsule, signal);
      const result = await this.execute(task);
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.output,
        stderr: "",
        metadata: {
          runtime: this.id,
          ...(result.thinking && { thinking: result.thinking }),
          ...(result.metadata && { ...result.metadata }),
        },
      };
    } catch (err) {
      const errorMsg = String(err);
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: errorMsg,
        metadata: { runtime: this.id, error: errorMsg },
      };
    }
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const prompt = this.buildPrompt(task);
    const model = task.context.providerModel ?? task.context.env?.OMK_PROVIDER_MODEL ?? this.model ?? process.env.OMK_PROVIDER_MODEL;
    const preflight = await preflightProviderInput(prompt, {
      provider: "codex",
      model,
      contextWindow: this.contextWindow,
      reservedOutputTokens: this.reservedOutputTokens,
      safetyMarginTokens: this.safetyMarginTokens,
      runId: task.context.runId,
      nodeId: task.context.nodeId,
      projectRoot: task.context.env?.OMK_PROJECT_ROOT ?? task.context.cwd ?? this.cwd,
    });
    if (!preflight.ok) {
      return {
        output: "",
        exitCode: 1,
        metadata: {
          runtime: this.id,
          error: contextPreflightErrorMessage(preflight.report),
          contextPreflight: preflight.report,
        },
      };
    }
    const providerPrompt = preflight.input;
    const env: Record<string, string> = buildChildEnv({
      overrideEnv: {
        ...(task.context.env ?? {}),
        OMK_RUN_ID: task.context.runId,
        OMK_NODE_ID: task.context.nodeId,
        OMK_ROLE: task.context.role ?? "",
        OMK_GOAL: task.context.goal ?? "",
        OMK_NODE_SKILLS: task.tools.skills?.join(",") ?? "",
        OMK_NODE_MCP_SERVERS: task.tools.mcpServers?.join(",") ?? "",
        OMK_NODE_TOOLS: task.tools.available.map((tool) => tool.name).join(","),
        OMK_NODE_HOOKS: task.tools.hooks?.join(",") ?? "",
        OMK_APPROVAL_POLICY: task.context.approvalPolicy ?? task.context.env?.OMK_APPROVAL_POLICY ?? "",
        OMK_SANDBOX_MODE: task.context.sandboxMode ?? task.context.env?.OMK_SANDBOX_MODE ?? "",
        OMK_TASK_RISK: task.context.risk ?? "",
        ...(model ? { OMK_PROVIDER_MODEL: model } : {}),
      },
    });

    const sandboxMode = resolveCodexSandboxMode(task);
    const approvalPolicy = codexApprovalPolicy(
      task.context.approvalPolicy ?? task.context.env?.OMK_APPROVAL_POLICY,
      sandboxMode
    );
    const sandboxProfile = createRuntimeSandboxProfile({
      cwd: this.cwd,
      mode: sandboxMode,
      enforcement: "provider-native",
      writableRoots: sandboxMode === "workspace-write" ? [this.cwd] : [],
      readableRoots: [this.cwd],
      network: "unspecified",
      secretEnvPolicy: "drop-by-default",
      notes: [
        "OMK sanitizes child env.",
        "Codex CLI receives provider-native sandbox flags.",
        "OMK does not yet enforce OS-level filesystem or network isolation.",
      ],
    });

    const args = [
      "exec",
      "--sandbox", sandboxMode,
      "--ask-for-approval", approvalPolicy,
      "--cd", this.cwd,
      "--color", "never",
      "-",
    ];

    if (model && model !== "codex-cli") {
      args.splice(1, 0, "--model", model);
    }

    try {
      const useStreaming = typeof task.context.onOutput === "function";
      const shellFn = useStreaming ? runShellStreaming : runShell;
      const shellOptions: Parameters<typeof runShellStreaming>[2] = {
        cwd: this.cwd,
        input: providerPrompt,
        timeout: this.timeoutMs,
        signal: task.context.abortSignal,
        inheritEnv: false,
        env,
      };
      if (useStreaming && task.context.onOutput) {
        shellOptions.onStdout = (line: string) => {
          task.context.onOutput?.(sanitizeUserVisibleOutput(line));
        };
      }

      const shellResult = await (shellFn as typeof runShell)(this.bin, args, shellOptions as Parameters<typeof runShell>[2]);

      if (task.context.abortSignal?.aborted) {
        return {
          output: shellResult.stdout,
          exitCode: 130,
          metadata: { error: "Request aborted" },
        };
      }

      return {
        output: shellResult.stdout,
        exitCode: shellResult.exitCode,
        metadata: {
          runtime: this.id,
          sandbox: sandboxMode,
          sandboxProfile,
          approvalPolicy,
          stderr: shellResult.stderr,
          failed: shellResult.failed,
          ...(preflight.report.compacted ? { contextPreflight: preflight.report } : {}),
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          output: "",
          exitCode: 130,
          metadata: { error: "Request aborted" },
        };
      }
      return {
        output: "",
        exitCode: 1,
        metadata: { error: String(err) },
      };
    }
  }

  private buildPrompt(task: AgentTask): string {
    const parts: string[] = [];

    if (task.context.system) {
      parts.push("<system>");
      parts.push(task.context.system);
      parts.push("</system>");
      parts.push("");
    }

    if (task.context.goal) {
      parts.push(`Goal: ${task.context.goal}`);
      parts.push("");
    }

    if (task.context.files && task.context.files.length > 0) {
      parts.push("Relevant files:");
      for (const file of task.context.files) {
        parts.push(`- ${file}`);
      }
      parts.push("");
    }

    parts.push(task.prompt);

    return parts.join("\n");
  }
}

function resolveCodexSandboxMode(task: AgentTask): "read-only" | "workspace-write" {
  if (task.context.sandboxMode === "read-only" || task.context.sandboxMode === "workspace-write") {
    return task.context.sandboxMode;
  }
  // Advisory API runtimes must stay read-only even if capabilities request write.
  if (task.context.env?.OMK_PROVIDER_AUTHORITY === "advisory") return "read-only";
  if (task.capabilities.write || task.capabilities.patch || task.capabilities.shell) {
    return "workspace-write";
  }
  return "read-only";
}

function codexApprovalPolicy(
  value: string | undefined,
  sandboxMode: "read-only" | "workspace-write"
): "on-request" | "never" {
  if (sandboxMode !== "read-only") return "on-request";
  const normalized = value?.trim().toLowerCase();
  // OMK "ask" must never map to provider "never"; only explicit "never"/"yolo" does.
  if (normalized === "never" || normalized === "yolo") return "never";
  return "on-request";
}
