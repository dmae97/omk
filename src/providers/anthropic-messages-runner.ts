import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";
import { inferNodeRisk } from "./router.js";
import type { ProviderId } from "./types.js";
import {
  contextPreflightErrorMessage,
  preflightProviderMessages,
} from "./context-preflight.js";

export interface AnthropicMessagesRunnerOptions {
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

export function createAnthropicMessagesReadOnlyTaskRunner(
  options: AnthropicMessagesRunnerOptions
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
      const forked = createAnthropicMessagesReadOnlyTaskRunner(options);
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
        const content = await completeMessages({
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

async function completeMessages(options: AnthropicMessagesRunnerOptions & {
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const credential = options.apiKey?.trim();
  if (!credential) throw new Error(`${options.provider} API key is missing`);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  // Anthropic Messages API separates system messages from the messages array
  const systemMessages: string[] = [];
  const chatMessages = options.messages
    .filter((m) => {
      if (m.role === "system") {
        systemMessages.push(m.content);
        return false;
      }
      return true;
    })
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxTokens ?? 4096,
    messages: chatMessages,
  };
  if (systemMessages.length > 0) {
    body.system = systemMessages.join("\n");
  }

  const response = await fetchImpl(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": credential,
      "anthropic-version": "2023-06-01",
      ...safeExtraHeaders(options.headers),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.provider} HTTP ${response.status}: ${sanitizeProviderErrorText(text, credential)}`);
  }
  const parsed = JSON.parse(text) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const contentBlock = parsed.content?.find((c) => c.type === "text" || typeof c.text === "string");
  const content = contentBlock?.text;
  if (typeof content !== "string") throw new Error(`${options.provider} response missing assistant content`);
  return content;
}

function buildNodePrompt(
  node: DagNode,
  env: Record<string, string>,
  options: AnthropicMessagesRunnerOptions
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
    if (lower === "x-api-key" || lower === "content-type" || lower === "anthropic-version") continue;
    safe[normalized] = trimmedValue;
  }
  return safe;
}

function sanitizeProviderErrorText(text: string, credential: string): string {
  return text
    .replaceAll(credential, "[redacted]")
    .replace(/x-api-key\s+\S+/g, "x-api-key [redacted]")
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
