import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";
import { inferNodeRisk } from "./router.js";
import type { ProviderId } from "./types.js";
import {
  contextPreflightErrorMessage,
  preflightProviderMessages,
} from "./context-preflight.js";

export interface OpenAICompatibleRunnerOptions {
  provider: ProviderId;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model: string;
  promptPrefix?: string;
  headers?: Record<string, string | undefined>;
  maxTokens?: number;
  contextWindow?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
  fetchImpl?: typeof fetch;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function createOpenAICompatibleReadOnlyTaskRunner(
  options: OpenAICompatibleRunnerOptions
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
      const forked = createOpenAICompatibleReadOnlyTaskRunner(options);
      forked.onThinking = onThinking;
      return forked;
    },
    async run(node: DagNode, env: Record<string, string>, signal?: AbortSignal): Promise<TaskResult> {
      const risk = inferNodeRisk(node);
      const advisoryMode = env.OMK_PROVIDER_AUTHORITY === "advisory" && risk === "write";
      if (risk !== "read" && !advisoryMode) {
        return deny(node, `${options.provider} runner is read-only/advisory; write/shell/merge authority stays on the authority provider`);
      }
      if (node.routing?.requiresToolCalling === true || node.routing?.requiresMcp === true) {
        return deny(node, `${options.provider} runner does not receive tool or MCP authority`);
      }
      if (!options.apiKey) {
        return deny(node, `${options.provider} API key is missing (${options.apiKeyEnv ?? "provider env"}); provider-neutral authority fallback is required`);
      }

      const model = env.OMK_PROVIDER_MODEL || options.model;
      currentOnThinking?.(`${options.provider} ${env.OMK_PROVIDER_AUTHORITY ?? "direct"} worker: ${node.name}`);
      try {
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: [
              `You are a ${options.provider} read-only/advisory worker inside OMK.`,
              "OMK and the configured authority provider are the root orchestrator and final authority.",
              "Do not claim file writes, shell execution, secret access, MCP access, or merge authority.",
              advisoryMode ? "For this file-affecting node, provide advisory strategy only." : "",
              "Return concise findings, evidence, risks, and recommended authority-provider follow-up.",
            ].filter(Boolean).join(" "),
          },
          { role: "user", content: buildNodePrompt(node, env, options) },
        ];
        const preflight = await preflightProviderMessages(messages, {
          provider: options.provider,
          model,
          contextWindow: options.contextWindow,
          reservedOutputTokens: options.reservedOutputTokens ?? options.maxTokens ?? 4096,
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
        const content = await completeChat({
          ...options,
          model,
          messages: preflight.messages as ChatMessage[],
          signal,
        });
        return {
          success: true,
          exitCode: 0,
          stdout: `[${node.id}:${node.role}:${options.provider}] ${content}\n`,
          stderr: "",
          metadata: preflight.report.compacted ? { contextPreflight: preflight.report } : undefined,
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

async function completeChat(options: OpenAICompatibleRunnerOptions & {
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const credential = options.apiKey?.trim();
  if (!credential) throw new Error(`${options.provider} API key is missing`);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential}`,
      ...safeExtraHeaders(options.headers),
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 4096,
    }),
    signal: options.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.provider} HTTP ${response.status}: ${sanitizeProviderErrorText(text, credential)}`);
  }
  const parsed = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`${options.provider} response missing assistant content`);
  return content;
}

function buildNodePrompt(
  node: DagNode,
  env: Record<string, string>,
  options: OpenAICompatibleRunnerOptions
): string {
  return [
    options.promptPrefix?.trim(),
    `DAG node: ${node.id}`,
    `Name: ${node.name}`,
    `Role: ${node.role}`,
    `Task type: ${env.OMK_TASK_TYPE ?? "general"}`,
    `Complexity: ${env.OMK_COMPLEXITY ?? "moderate"}`,
    `Provider: ${options.provider}`,
    `Model: ${env.OMK_PROVIDER_MODEL ?? options.model}`,
    `Authority: ${env.OMK_PROVIDER_AUTHORITY ?? "direct"}`,
    `Provider route reason: ${env.OMK_PROVIDER_ROUTE_REASON ?? ""}`,
    `Routing rationale: ${node.routing?.rationale ?? ""}`,
    renderPromptDigest("Goal context digest from authority provider", env.OMK_GOAL_CONTEXT ?? env.OMK_GOAL, {
      maxKeywords: 18,
      maxPhrases: 3,
    }),
    renderList("Skills visible to authority provider", node.routing?.skills ?? []),
    renderList("MCP hints visible to authority provider only", node.routing?.mcpServers ?? [], { showWhenEmpty: true }),
    renderList("Tool hints visible to authority provider only", node.routing?.tools ?? [], { showWhenEmpty: true }),
    "Required output:",
    "- Summary",
    "- Evidence or file/symbol references if known",
    "- Risks/unknowns",
    "- Recommended authority-provider follow-up",
  ].filter((section): section is string => Boolean(section)).join("\n").trim() || `Analyze DAG node ${node.id}.`;
}

function renderList(title: string, items: string[], options: { showWhenEmpty?: boolean } = {}): string {
  if (items.length === 0) return options.showWhenEmpty === true ? `${title}:\n- none` : "";
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function safeExtraHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.trim();
    const lower = normalized.toLowerCase();
    const trimmedValue = value?.trim();
    if (!normalized || !trimmedValue) continue;
    if (lower === "authorization" || lower === "content-type") continue;
    safe[normalized] = trimmedValue;
  }
  return safe;
}

function sanitizeProviderErrorText(text: string, credential: string): string {
  return text
    .replaceAll(credential, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .slice(0, 500);
}

function deny(node: DagNode, reason: string): TaskResult {
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: `[${node.id}:${node.role}] ${reason}`,
  };
}
