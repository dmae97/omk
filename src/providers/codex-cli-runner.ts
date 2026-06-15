import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";
import { runShell } from "../util/shell.js";
import { buildChildEnv } from "../runtime/child-env.js";
import { inferNodeRisk } from "./router.js";
import {
  contextPreflightErrorMessage,
  preflightProviderInput,
} from "./context-preflight.js";

export interface CodexCliRunnerOptions {
  cwd: string;
  bin?: string;
  model?: string;
  timeoutMs?: number;
  contextWindow?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
}

export function createCodexCliAdvisoryTaskRunner(options: CodexCliRunnerOptions): TaskRunner {
  let currentOnThinking: ((thinking: string) => void) | undefined;
  const runner: TaskRunner = {
    get onThinking() {
      return currentOnThinking;
    },
    set onThinking(fn) {
      currentOnThinking = fn;
    },
    fork(onThinking) {
      const forked = createCodexCliAdvisoryTaskRunner(options);
      forked.onThinking = onThinking;
      return forked;
    },
    async run(node: DagNode, env: Record<string, string>, signal?: AbortSignal): Promise<TaskResult> {
      const risk = inferNodeRisk(node);
      const codexAuthority = env.OMK_PROVIDER_AUTHORITY === "codex" || env.OMK_PROVIDER === "codex";
      const advisoryMode = env.OMK_PROVIDER_AUTHORITY === "advisory" && risk === "write";
      if (risk !== "read" && !advisoryMode && !codexAuthority) {
        return deny(node, "Codex CLI lane is read-only/advisory; write/shell/merge authority stays on the authority provider");
      }
      if (node.routing?.requiresToolCalling === true || node.routing?.requiresMcp === true) {
        return deny(node, "Codex CLI lane does not receive OMK MCP or tool authority");
      }

      currentOnThinking?.(`Codex advisory worker: ${node.name}`);
      const tmp = await mkdtemp(join(tmpdir(), "omk-codex-provider-"));
      const outputPath = join(tmp, "last-message.txt");
      try {
        const rawPrompt = buildCodexPrompt(node, env);
        const model = env.OMK_PROVIDER_MODEL || options.model;
        const preflight = await preflightProviderInput(rawPrompt, {
          provider: "codex",
          model,
          contextWindow: options.contextWindow,
          reservedOutputTokens: options.reservedOutputTokens,
          safetyMarginTokens: options.safetyMarginTokens,
          runId: env.OMK_RUN_ID,
          nodeId: node.id,
          projectRoot: env.OMK_PROJECT_ROOT,
        });
        if (!preflight.ok) {
          return {
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: contextPreflightErrorMessage(preflight.report),
            metadata: { contextPreflight: preflight.report },
          };
        }
        const prompt = preflight.input;
        const sandboxMode = resolveCodexCliSandboxMode(risk, advisoryMode, env);
        const approvalPolicy = codexCliApprovalPolicy(env.OMK_APPROVAL_POLICY ?? env.OMK_EXECUTION, sandboxMode);
        const childEnv = buildChildEnv({
          overrideEnv: {
            ...env,
            OMK_APPROVAL_POLICY: approvalPolicy,
            OMK_SANDBOX_MODE: sandboxMode,
            OMK_TASK_RISK: risk,
          },
        });
        const args = [
          "exec",
          "--sandbox", sandboxMode,
          "--ask-for-approval", approvalPolicy,
          "--cd", options.cwd,
          "--color", "never",
          "--output-last-message", outputPath,
        ];
        if (model && model !== "codex-cli") args.push("--model", model);
        args.push("-");
        const result = await runShell(options.bin ?? "codex", args, {
          cwd: options.cwd,
          input: prompt,
          timeout: options.timeoutMs ?? 120_000,
          signal,
          inheritEnv: false,
          env: childEnv,
        });
        const lastMessage = await readFile(outputPath, "utf-8").catch(() => "");
        return {
          success: !result.failed,
          exitCode: result.exitCode,
          stdout: lastMessage.trim() ? lastMessage : result.stdout,
          stderr: result.stderr,
          metadata: preflight.report.compacted ? { contextPreflight: preflight.report } : undefined,
        };
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
  return runner;
}

function resolveCodexCliSandboxMode(
  risk: string,
  advisoryMode: boolean,
  env: Record<string, string>
): "read-only" | "workspace-write" {
  if (risk === "read" || advisoryMode) return "read-only";
  if (env.OMK_PROVIDER_AUTHORITY === "advisory") return "read-only";
  return "workspace-write";
}

function codexCliApprovalPolicy(
  value: string | undefined,
  sandboxMode: "read-only" | "workspace-write"
): "on-request" | "never" {
  if (sandboxMode !== "read-only") return "on-request";
  const normalized = value?.trim().toLowerCase();
  if (normalized === "never" || normalized === "yolo") return "never";
  return "on-request";
}

function buildCodexPrompt(node: DagNode, env: Record<string, string>): string {
  return [
    "You are a Codex CLI advisory/read-only lane inside OMK.",
    "OMK and the configured authority provider are the root orchestrator and final authority.",
    "Do not modify files, execute writes, access secrets, or use MCP authority.",
    "Return concise findings, evidence, risks, and recommended authority-provider follow-up.",
    "",
    `DAG node: ${node.id}`,
    `Name: ${node.name}`,
    `Role: ${node.role}`,
    `Task type: ${env.OMK_TASK_TYPE ?? "general"}`,
    `Authority: ${env.OMK_PROVIDER_AUTHORITY ?? "advisory"}`,
    renderPromptDigest("Goal context digest from authority provider", env.OMK_GOAL_CONTEXT ?? env.OMK_GOAL, {
      maxKeywords: 18,
      maxPhrases: 3,
    }),
  ].join("\n");
}

function deny(node: DagNode, reason: string): TaskResult {
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: `[${node.id}:${node.role}] ${reason}`,
  };
}
