import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";
import { runShell } from "../util/shell.js";
import { inferNodeRisk } from "./router.js";

export interface CodexCliRunnerOptions {
  cwd: string;
  model?: string;
  timeoutMs?: number;
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
      const advisoryMode = env.OMK_PROVIDER_AUTHORITY === "advisory" && risk === "write";
      if (risk !== "read" && !advisoryMode) {
        return deny(node, "Codex CLI lane is read-only/advisory; write/shell/merge authority stays on Kimi");
      }
      if (node.routing?.requiresToolCalling === true || node.routing?.requiresMcp === true) {
        return deny(node, "Codex CLI lane does not receive OMK MCP or tool authority");
      }

      currentOnThinking?.(`Codex advisory worker: ${node.name}`);
      const tmp = await mkdtemp(join(tmpdir(), "omk-codex-provider-"));
      const outputPath = join(tmp, "last-message.txt");
      try {
        const prompt = buildCodexPrompt(node, env);
        const args = [
          "exec",
          "--sandbox", "read-only",
          "--ask-for-approval", "never",
          "--cd", options.cwd,
          "--color", "never",
          "--output-last-message", outputPath,
        ];
        const model = env.OMK_PROVIDER_MODEL || options.model;
        if (model && model !== "codex-cli") args.push("--model", model);
        args.push("-");
        const result = await runShell("codex", args, {
          cwd: options.cwd,
          input: prompt,
          timeout: options.timeoutMs ?? 120_000,
          signal,
          inheritEnv: true,
        });
        const lastMessage = await readFile(outputPath, "utf-8").catch(() => "");
        return {
          success: !result.failed,
          exitCode: result.exitCode,
          stdout: lastMessage.trim() ? lastMessage : result.stdout,
          stderr: result.stderr,
        };
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
  return runner;
}

function buildCodexPrompt(node: DagNode, env: Record<string, string>): string {
  return [
    "You are a Codex CLI advisory/read-only lane inside OMK.",
    "Kimi/OMK is the root orchestrator and final authority.",
    "Do not modify files, execute writes, access secrets, or use MCP authority.",
    "Return concise findings, evidence, risks, and recommended Kimi follow-up.",
    "",
    `DAG node: ${node.id}`,
    `Name: ${node.name}`,
    `Role: ${node.role}`,
    `Task type: ${env.OMK_TASK_TYPE ?? "general"}`,
    `Authority: ${env.OMK_PROVIDER_AUTHORITY ?? "advisory"}`,
    renderPromptDigest("Goal context digest from Kimi", env.OMK_GOAL_CONTEXT ?? env.OMK_GOAL, {
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
