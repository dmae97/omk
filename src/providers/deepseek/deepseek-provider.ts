import type { TaskResult, TaskRunner } from "../../contracts/orchestration.js";
import type { DagNode } from "../../orchestration/dag.js";
import { renderPromptDigest } from "../../goal/prompt-digest.js";
import { inferNodeRisk } from "../router.js";
import { DeepSeekClient, type DeepSeekClientOptions } from "./deepseek-client.js";

export interface DeepSeekReadOnlyRunnerOptions extends DeepSeekClientOptions {
  promptPrefix?: string;
  allowAdvisoryFileNodes?: boolean;
}

export function createDeepSeekReadOnlyTaskRunner(
  options: DeepSeekReadOnlyRunnerOptions = {}
): TaskRunner {
  let currentOnThinking: ((thinking: string) => void) | undefined;

  const runner: TaskRunner = {
    get onThinking() {
      return currentOnThinking;
    },
    set onThinking(fn) {
      currentOnThinking = fn;
    },
    fork(onThinking) {
      const forked = createDeepSeekReadOnlyTaskRunner(options);
      forked.onThinking = onThinking;
      return forked;
    },
    async run(node: DagNode, env: Record<string, string>): Promise<TaskResult> {
      const risk = inferNodeRisk(node);
      const advisoryFileMode = options.allowAdvisoryFileNodes === true &&
        env.OMK_DEEPSEEK_PARTICIPATION === "advisory" &&
        risk === "write";
      if (risk !== "read" && !advisoryFileMode) {
        return deny(node, "DeepSeek runner is read-only; write/shell/merge nodes stay on Kimi");
      }
      if (node.routing?.requiresToolCalling === true || node.routing?.requiresMcp === true) {
        return deny(node, "DeepSeek runner does not receive tool or MCP authority in alpha");
      }

      const model = env.OMK_DEEPSEEK_MODEL || options.model;
      const reasoningEffort = parseDeepSeekReasoningEffort(env.OMK_DEEPSEEK_REASONING_EFFORT) ?? options.reasoningEffort;
      currentOnThinking?.(`DeepSeek ${env.OMK_DEEPSEEK_MODEL_TIER ?? "flash"} ${env.OMK_DEEPSEEK_PARTICIPATION ?? "direct"} worker: ${node.name}`);
      const client = new DeepSeekClient({
        ...options,
        model,
        reasoningEffort,
      });
      try {
        const content = await client.complete({
          messages: [
            {
              role: "system",
              content: [
                "You are a DeepSeek read-only worker inside OMK.",
                "Kimi is the main orchestrator and final reviewer.",
                "Do not claim file writes, shell execution, secret access, MCP access, or merge authority.",
                "Do not echo the original user input or objective; synthesize from digests, node state, and evidence.",
                advisoryFileMode
                  ? "For this file-affecting node, provide advisory patch strategy only; Kimi will perform actual file edits."
                  : "",
                "Return concise findings, evidence, risks, and recommended Kimi follow-up.",
              ].filter(Boolean).join(" ") || "You are a DeepSeek read-only worker. Provide analysis for the given node.",
            },
            { role: "user", content: buildDeepSeekNodePrompt(node, env, options.promptPrefix) },
          ],
          maxTokens: 4096,
          thinking: options.thinking,
          reasoningEffort: options.reasoningEffort,
        });
        return {
          success: true,
          exitCode: 0,
          stdout: `[${node.id}:${node.role}:deepseek] ${content}\n`,
          stderr: "",
        };
      } catch (err) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  return runner;
}

function parseDeepSeekReasoningEffort(value: string | undefined): "high" | "max" | undefined {
  return value === "high" || value === "max" ? value : undefined;
}

function deny(node: DagNode, reason: string): TaskResult {
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: `[${node.id}:${node.role}] ${reason}`,
  };
}

function buildDeepSeekNodePrompt(
  node: DagNode,
  env: Record<string, string>,
  promptPrefix?: string
): string {
  const result = [
    promptPrefix?.trim(),
    `DAG node: ${node.id}`,
    `Name: ${node.name}`,
    `Role: ${node.role}`,
    `Task type: ${env.OMK_TASK_TYPE ?? "general"}`,
    `Complexity: ${env.OMK_COMPLEXITY ?? "moderate"}`,
    `DeepSeek model: ${env.OMK_DEEPSEEK_MODEL ?? "default"}`,
    `DeepSeek participation: ${env.OMK_DEEPSEEK_PARTICIPATION ?? "direct"}`,
    `Provider route confidence: ${env.OMK_PROVIDER_ROUTE_CONFIDENCE ?? "unknown"}`,
    `DeepSeek invocation key: ${env.OMK_DEEPSEEK_INVOCATION_KEY ?? env.OMK_PROVIDER_INVOCATION_KEY ?? "unknown"}`,
    `Provider route reason: ${env.OMK_PROVIDER_ROUTE_REASON ?? ""}`,
    `Routing rationale: ${node.routing?.rationale ?? ""}`,
    renderPromptDigest("Goal context digest from Kimi", env.OMK_GOAL_CONTEXT ?? env.OMK_GOAL, {
      maxKeywords: 18,
      maxPhrases: 3,
    }),
    renderOptionalSection("DeepSeek advisory context", env.OMK_DEEPSEEK_ADVISORY),
    renderList("Inputs", (node.inputs ?? []).map((input) => `${input.name}: ${input.ref}${input.from ? ` from ${input.from}` : ""}`)),
    renderList("Outputs", (node.outputs ?? []).map((output) => `${output.name}${output.gate ? ` (${output.gate})` : ""}${output.ref ? ` -> ${output.ref}` : ""}`)),
    renderList("Skills visible to Kimi", node.routing?.skills ?? []),
    renderList("MCP hints visible to Kimi only", node.routing?.mcpServers ?? [], { showWhenEmpty: true }),
    renderList("Tool hints visible to Kimi only", node.routing?.tools ?? [], { showWhenEmpty: true }),
    "Required output:",
    "- Summary",
    "- Evidence or file/symbol references if known",
    "- Risks/unknowns",
    "- Recommended Kimi follow-up",
    "- Do not echo the original user input; return synthesized findings only",
  ].filter((section): section is string => Boolean(section)).join("\n");

  // Ensure the prompt is never empty — DeepSeek rejects empty content with 400
  return result.trim() || `Analyze DAG node ${node.id} (${node.name}) and provide findings.`;
}

function renderList(title: string, items: string[], options: { showWhenEmpty?: boolean } = {}): string {
  if (items.length === 0) return options.showWhenEmpty === true ? `${title}:\n- none` : "";
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function renderOptionalSection(title: string, value: string | undefined, maxChars = 6_000): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const content = trimmed.length <= maxChars
    ? trimmed
    : `${trimmed.slice(0, maxChars)}\n\n[truncated: ${trimmed.length - maxChars} chars omitted]`;
  return `${title}:\n${content}`;
}
