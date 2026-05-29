import type { ApprovalPolicy, ExecutionStrategy, TaskResult, TaskRunner } from "../../contracts/orchestration.js";
import type { RuntimeBootstrap } from "../../runtime/runtime-bootstrap.js";
import type { ChatLayout } from "./utils.js";
import { style } from "../../util/theme.js";
import { runShell } from "../../util/shell.js";
import { createDag, type Dag, type DagNode } from "../../orchestration/dag.js";
import { applyCapabilityInjectionToRouting, buildCapabilityInjection } from "../../runtime/capability-injection.js";
import { compileBloatToNlp, type DebloatRisk } from "../../runtime/debloat-nlp.js";
import { buildPromptEnvelope, renderPromptEnvelope } from "../../runtime/prompt-envelope.js";
import { resolveRuntimeBootstrap } from "../../runtime/runtime-bootstrap.js";
import { buildTaskRunContext } from "../../runtime/worker-manifest.js";
import { TerminalOwner } from "../../util/terminal-owner.js";
import type { CliRenderer } from "../../cli/ui/renderer.js";
import type { TaskRunContext } from "../../contracts/worker-context.js";
import { executeHarnessRun } from "../../harness/execute-harness-run.js";
import type { ProviderPolicy } from "../../providers/types.js";
import { buildChatTurnDag } from "./chat-turn-dag.js";
import { createSlashCommandContext } from "./slash/context.js";
import { parseSlashArgs, parseSlashInput, type ParsedSlashInput } from "./slash/parser.js";
import { createSlashCommandRegistry, type SlashCommandRegistry } from "./slash/registry.js";
import { emitSlashResult, okSlashResult } from "./slash/result.js";
import type {
  LegacySlashCommandSpec,
  RegisteredSlashCommandSpec,
  SlashCommandContext,
  SlashCommandResult,
} from "./slash/types.js";

export interface NativeRootLoopInput {
  bootstrap: RuntimeBootstrap;
  taskRunner: TaskRunner;
  runId: string;
  root: string;
  rootSource?: string;
  activeCwd?: string;
  env: Record<string, string>;
  layout: ChatLayout;
  agentFile: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  workers?: number;
  executionPrompt?: string;
  renderer?: CliRenderer;
  onData?: (data: string) => void;
  onTodoSync?: (output: string) => void;
}

export interface NativeRootSessionState {
  bootstrap: RuntimeBootstrap;
  provider: string;
  model?: string;
  approvalPolicy?: string;
  updatedAt?: string;
}

function splitSlashArgs(args: string): string[] {
  return [...parseSlashArgs(args).argv];
}

function formatConsoleArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

async function runSlashHandler(
  handler: RegisteredSlashCommandSpec,
  parsed: ParsedSlashInput,
  ctx: SlashCommandContext
): Promise<SlashCommandResult> {
  const renderer = ctx.renderer;
  if (!renderer) {
    const result = await runRegisteredSlashCommand(handler, parsed, ctx);
    const normalized = result ?? okSlashResult();
    if (normalized.json !== undefined) {
      console.log(JSON.stringify(normalized.json, null, 2));
    } else if (normalized.text) {
      if (normalized.ok) console.log(normalized.text);
      else console.error(normalized.text);
    }
    return normalized;
  }
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const emitLine = (...values: unknown[]): void => {
    renderer.emit({ type: "control:output", text: `${values.map(formatConsoleArg).join(" ")}\n` });
  };
  console.log = emitLine;
  console.warn = emitLine;
  console.error = emitLine;
  try {
    const result = await runRegisteredSlashCommand(handler, parsed, ctx);
    const normalized = result ?? okSlashResult();
    emitSlashResult(normalized, renderer);
    return normalized;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function isLegacySlashCommand(handler: RegisteredSlashCommandSpec): handler is LegacySlashCommandSpec {
  return "help" in handler;
}

async function runRegisteredSlashCommand(
  handler: RegisteredSlashCommandSpec,
  parsed: ParsedSlashInput,
  ctx: SlashCommandContext
): Promise<void | SlashCommandResult> {
  if (isLegacySlashCommand(handler)) {
    await handler.handler(parsed.args.raw);
    return okSlashResult();
  }
  return handler.handler(ctx, parsed.args);
}

function formatScopedNames(names: readonly string[] | undefined, empty = "none"): string {
  if (!names || names.length === 0) return empty;
  const preview = names.slice(0, 8).join(", ");
  return names.length > 8 ? `${preview}, … +${names.length - 8}` : preview;
}

function isDisabledEnvValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off";
}

export function shouldRunNativeParallelTurn(executionPrompt: string | undefined): boolean {
  return executionPrompt?.trim().toLowerCase() === "parallel";
}

async function runNativeParallelTurn(
  input: NativeRootLoopInput,
  prompt: string,
  renderer?: CliRenderer
): Promise<number> {
  const normalizedPrompt = prompt.trim();
  const message = `\n  Spawning parallel: "${normalizedPrompt}"\n`;
  if (renderer) {
    renderer.emit({ type: "control:output", text: message });
  } else {
    console.log(style.phosphorDim(message));
  }
  const result = await runShell(process.execPath, ["dist/cli.js", "parallel", normalizedPrompt], {
    cwd: input.root,
    env: input.env,
    stdio: "inherit",
    timeout: 300000,
  });
  if (result.failed) {
    const errorMessage = `Parallel exited with code ${result.exitCode}`;
    if (renderer) {
      renderer.emit({ type: "turn:error", message: errorMessage });
    } else {
      console.log(style.metricsRed(errorMessage));
    }
  }
  return result.exitCode ?? (result.failed ? 1 : 0);
}

function nativeApprovalPolicy(executionPrompt: string | undefined): ApprovalPolicy {
  const normalized = executionPrompt?.trim().toLowerCase();
  switch (normalized) {
    case "block":
      return "block";
    case "yolo":
      return "yolo";
    case "auto":
    case "parallel":
    case "sequential":
      return "auto";
    case "ask":
    default:
      return "interactive";
  }
}

function nativeExecutionStrategy(executionPrompt: string | undefined): ExecutionStrategy | undefined {
  const normalized = executionPrompt?.trim().toLowerCase();
  if (normalized === "sequential" || normalized === "parallel") return normalized;
  return undefined;
}

function bootstrapProviderPolicy(bootstrap: RuntimeBootstrap): ProviderPolicy {
  const raw = (bootstrap.providerPolicy || bootstrap.provider || "auto").trim().toLowerCase();
  switch (raw) {
    case "auto":
    case "authority":
    case "codex":
    case "commandcode":
    case "deepseek":
    case "kimi":
    case "local-llm":
    case "mimo":
    case "opencode":
    case "openrouter":
    case "qwen":
      return raw;
    case "local":
    case "llama":
      return "local-llm";
    default:
      return "auto";
  }
}

function emitNativeTurnRoute(input: {
  node: DagNode;
  env: Record<string, string>;
  heartbeatEnabled: boolean;
  renderer?: CliRenderer;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
}): void {
  if (!input.heartbeatEnabled) return;
  const routing = input.node.routing;
  if (input.renderer) {
    input.renderer.emit({
      type: "turn:route",
      provider: routing?.provider ?? "auto",
      model: routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL,
      risk: String(routing?.risk ?? "read"),
      sandbox: String(routing?.sandboxMode ?? "auto"),
      mcp: input.mcpAllowlist,
      skills: input.skillNames,
      hooks: input.hookNames,
    });
    return;
  }
  process.stderr.write(style.phosphorDim(
    `  routing: provider=${routing?.provider ?? "auto"} model=${routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL ?? "auto"} risk=${routing?.risk ?? "read"} sandbox=${routing?.sandboxMode ?? "auto"}\n`
  ));
}

export function createNativeRootSessionState(input: {
  bootstrap: RuntimeBootstrap;
  executionPrompt?: string;
}): NativeRootSessionState {
  return {
    bootstrap: input.bootstrap,
    provider: input.bootstrap.provider,
    model: input.bootstrap.selectedModel,
    approvalPolicy: input.executionPrompt,
  };
}

function buildSlashCommands(input: NativeRootLoopInput, state: NativeRootSessionState): RegisteredSlashCommandSpec[] {
  return [
    { name: "/exit", aliases: ["/quit", ":q"], help: "Exit chat session", handler: () => {} },
    { name: "/help", aliases: ["/h", "/?"], help: "Show this help", handler: () => {
      console.log(style.phosphorBold("\n  OMK Slash Commands:"));
      console.log(style.phosphorDim("  ─────────────────────────────────────────────"));
      console.log(`  ${style.phosphor("/exit")} ${style.phosphorDim("/quit :q")}     — Exit chat session`);
      console.log(`  ${style.phosphor("/help")} ${style.phosphorDim("/h /?")}       — Show this help`);
      console.log(`  ${style.phosphor("/auth")}                  — Show provider auth status`);
      console.log(`  ${style.phosphor("/providers")}              — List available providers`);
      console.log(`  ${style.phosphor("/provider")} ${style.phosphorDim("<name>")}    — Switch provider`);
      console.log(`  ${style.phosphor("/model")} ${style.phosphorDim("<name>")}       — Set session model`);
      console.log(`  ${style.phosphor("/use")} ${style.phosphorDim("<ref>")}          — Provider/model alias`);
      console.log(`  ${style.phosphor("/mcp")} ${style.phosphorDim("[--all]")}        — MCP Tool Plane status`);
      console.log(`  ${style.phosphor("/tools")}                 — Scoped MCP/skills/hooks`);
      console.log(`  ${style.phosphor("/status")}                 — Session status`);
      console.log(`  ${style.phosphor("/clear")} ${style.phosphorDim("/cls")}       — Clear screen`);
      console.log(`  ${style.phosphor("/runs")}                   — Recent run history`);
      console.log(`  ${style.phosphor("/doctor")}                 — Run omk doctor`);
      console.log(`  ${style.phosphor("/parallel")} ${style.phosphorDim("<prompt>")}   — Parallel orchestrator`);
      console.log(style.phosphorDim("\n  Any other input is routed to the AI agent.\n"));
    }},
    { name: "/auth", aliases: ["/login"], help: "Show auth status", handler: async (args) => {
      const tokens = splitSlashArgs(args);
      const target = tokens.find((token) => !token.startsWith("-"));
      const { authCommand } = await import("../auth.js");
      await authCommand(target, { setup: tokens.includes("--setup"), doctor: tokens.includes("--doctor"), soft: true });
    }},
    { name: "/providers", aliases: [":providers"], help: "List providers", handler: async () => {
      const { readProviderRegistry } = await import("../../providers/model-registry.js");
      const providers = await readProviderRegistry({ env: input.env });
      console.log(style.phosphorBold("\n  Providers:"));
      for (const provider of providers) {
        const current = provider.id === state.provider ? "*" : " ";
        console.log(style.phosphorDim(`  ${current} ${provider.id.padEnd(12)} ${provider.enabled ? "enabled" : "disabled"} ${provider.defaultModel}`));
      }
      console.log("");
    }},
    { name: "/provider", aliases: ["/p"], help: "Switch provider", handler: async (args) => {
      const p = args.trim().toLowerCase();
      const { KNOWN_PROVIDER_IDS, normalizeProviderId } = await import("../../providers/model-registry.js");
      const valid = ["auto", ...KNOWN_PROVIDER_IDS];
      const normalized = normalizeProviderId(p);
      if (!p || !valid.includes(normalized)) {
        console.log(style.phosphorDim(`\n  Available: ${valid.join(", ")}`));
        console.log(style.phosphorDim("  Usage: /provider codex\n"));
        return;
      }
      await applyProviderOverride(state, normalized, input);
    }},
    { name: "/models", aliases: [":models"], help: "List model aliases", handler: async () => {
      const { listUserModelAliases } = await import("../../providers/model-registry.js");
      const aliases = await listUserModelAliases({ env: input.env });
      console.log(style.phosphorBold("\n  User Model Aliases:"));
      const entries = Object.entries(aliases);
      if (entries.length === 0) console.log(style.phosphorDim("    (none)"));
      for (const [alias, target] of entries) console.log(style.phosphorDim(`    ${alias} -> ${target}`));
      console.log(style.phosphorDim("  Use `omk model alias add fast deepseek/flash` to persist aliases.\n"));
    }},
    { name: "/model", aliases: ["/m"], help: "Set model", handler: async (args) => {
      const m = args.trim();
      if (m) {
        await applyModelOverride(state, m, input);
      } else {
        console.log(style.phosphorDim(`\n  Current model: ${state.model ?? "auto"}`));
        console.log(style.phosphorDim("  Usage: /model codex/codex-cli\n"));
      }
    }},
    { name: "/use", aliases: [":use"], help: "Switch provider/model", handler: async (args) => {
      const ref = args.trim();
      if (!ref) {
        console.log(style.phosphorDim("\n  Usage: /use codex/codex-cli or /use fast\n"));
        return;
      }
      await applyModelOverride(state, ref, input);
    }},
    { name: "/mcp", aliases: [":mcp"], help: "Show MCP Tool Plane status", handler: async (args) => {
      const tokens = splitSlashArgs(args);
      const wantsFullPreflight = tokens.includes("--all");
      const wantsFix = tokens.includes("--fix") || tokens.includes("fix") || tokens.includes("repair");
      const { runMcpAutoConnect, renderMcpAutoConnectBanner } = await import("../../mcp/autoconnect.js");
      const report = await runMcpAutoConnect({
        preflight: wantsFullPreflight ? "full" : "fast",
        env: {
          ...input.env,
          OMK_MCP_PREFLIGHT: wantsFullPreflight ? input.env.OMK_MCP_PREFLIGHT : "off",
        },
      });
      console.log("\n" + renderMcpAutoConnectBanner(report) + "\n");
      if (wantsFix) {
        console.log(style.phosphorDim("  Repairs are explicit CLI actions: omk mcp connect --fix\n"));
      }
    }},
    { name: "/tools", aliases: [":tools"], help: "Show scoped MCP/skills/hooks", handler: () => {
      console.log(style.phosphorBold("\n  Scoped Tool Plane:"));
      console.log(`  MCP:    ${style.phosphorDim(formatScopedNames(input.mcpAllowlist))}`);
      console.log(`  Skills: ${style.phosphorDim(formatScopedNames(input.skillNames))}`);
      console.log(`  Hooks:  ${style.phosphorDim(formatScopedNames(input.hookNames))}`);
      console.log(`  Runtime: ${style.phosphorDim(state.bootstrap.selectedRuntimeId ?? "none")} (${state.provider})`);
      console.log(`  Safety: ${style.phosphorDim(`execution=${input.executionPrompt ?? "auto"}; provider metadata is scoped per turn`)}`);
      console.log(style.phosphorDim("  Use /mcp for MCP status or `omk mcp connect --json` for the full contract.\n"));
    }},
    { name: "/status", aliases: ["/s"], help: "Show session status", handler: async () => {
      const uptime = process.uptime();
      const mem = process.memoryUsage();
      console.log(style.phosphorBold(`\n  Session: ${input.runId}`));
      console.log(`  Provider: ${style.phosphor(state.provider)} | Model: ${style.phosphorDim(state.model ?? "auto")}`);
      console.log(`  Uptime: ${style.phosphorDim(Math.floor(uptime / 60) + "m " + Math.floor(uptime % 60) + "s")}`);
      console.log(`  Heap: ${style.phosphorDim((mem.heapUsed / 1024 / 1024).toFixed(1) + "M")} / ${style.phosphorDim((mem.heapTotal / 1024 / 1024).toFixed(1) + "M")}`);
      console.log(`  Layout: ${style.phosphorDim(input.layout)} | Root: ${style.phosphorDim(input.root)}`);
      console.log(`  CWD: ${style.phosphorDim(input.activeCwd ?? process.cwd())} | Source: ${style.phosphorDim(input.rootSource ?? "unknown")}`);
      console.log(`  MCP: ${style.phosphorDim(formatScopedNames(input.mcpAllowlist, "none"))}`);
      console.log(`  Skills: ${style.phosphorDim(formatScopedNames(input.skillNames, "none"))}`);
      console.log(`  Hooks: ${style.phosphorDim(formatScopedNames(input.hookNames, "none"))}`);
      try {
        const { readTodos } = await import("../../util/todo-sync.js");
        const todos = await readTodos(input.runId).catch(() => null);
        if (todos && todos.length > 0) {
          const counts: Record<string, number> = { pending: 0, in_progress: 0, done: 0, failed: 0, blocked: 0, skipped: 0 };
          for (const t of todos) counts[t.status] = (counts[t.status] ?? 0) + 1;
          console.log(`  TODOs: ${style.mint(String(counts.in_progress))} active · ${style.phosphorDim(String(counts.pending))} pending · ${style.phosphorDim(String(counts.done))} done`);
          for (const t of todos.filter(t => t.status === "in_progress").slice(0, 3)) {
            console.log(style.phosphorDim(`    ▶ ${t.title.slice(0, 60)}`));
          }
        }
      } catch { /* ignore */ }
      console.log("");
    }},
    { name: "/clear", aliases: ["/cls"], help: "Clear screen", handler: () => {
      (input.renderer ? process.stderr : process.stdout).write("\x1b[2J\x1b[H");
    }},
    { name: "/runs", aliases: ["/history"], help: "List recent runs", handler: async () => {
      try {
        const { readdir } = await import("fs/promises");
        const { join } = await import("path");
        const runsDir = join(input.root, ".omk", "runs");
        const entries = await readdir(runsDir, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const recent = dirs.filter((d) => d.startsWith("chat-")).sort().reverse().slice(0, 10);
        console.log(style.phosphorBold("\n  Recent Chats:"));
        for (const r of recent) {
          console.log(style.phosphorDim(`    • ${r}`));
        }
        if (recent.length === 0) console.log(style.phosphorDim("    (none)"));
        console.log("");
      } catch {
        console.log(style.phosphorDim("\n  No runs found.\n"));
      }
    }},
    { name: "/doctor", aliases: [], help: "Run omk doctor", handler: async () => {
      console.log(style.phosphorDim("\n  Running doctor...\n"));
      try {
        const result = await runShell(process.execPath, ["dist/cli.js", "doctor", "--json"], {
          cwd: input.root,
          env: input.env,
          timeout: 30000,
        });
        const output = result.stdout || result.stderr || `doctor exited with code ${result.exitCode}`;
        console.log(output.slice(0, 2000));
        if (result.failed) {
          console.log(style.metricsRed(`Doctor exited with code ${result.exitCode}`));
        }
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : String(err);
        console.log(style.metricsRed(`Doctor failed: ${m}`));
      }
    }},
    { name: "/parallel", aliases: ["/pa"], help: "Run parallel orchestrator with prompt", handler: async (args) => {
      const prompt = args.trim();
      if (!prompt) {
        console.log(style.phosphorDim("\n  Usage: /parallel <prompt>\n"));
        return;
      }
      await runNativeParallelTurn(input, prompt);
    }},
  ];
}

async function applyProviderOverride(
  state: NativeRootSessionState,
  provider: string,
  input: NativeRootLoopInput,
  model?: string
): Promise<void> {
  const bootstrap = await resolveRuntimeBootstrap({
    provider,
    model: model ?? state.model,
    cwd: input.root,
    env: input.env,
  });
  if (!bootstrap.ok) {
    console.log(style.metricsRed(`\n  Provider not ready: ${provider}`));
    if (bootstrap.reason) console.log(style.phosphorDim(`  ${bootstrap.reason}`));
    for (const hint of bootstrap.setupHints.slice(0, 3)) console.log(style.phosphorDim(`  - ${hint}`));
    console.log(style.phosphorDim(`  Restart/setup: omk auth ${provider} --setup\n`));
    return;
  }
  state.bootstrap = bootstrap;
  state.provider = bootstrap.provider;
  state.model = bootstrap.selectedModel;
  if (bootstrap.selectedModel) {
    input.env.OMK_PROVIDER_MODEL = bootstrap.selectedModel;
  } else {
    delete input.env.OMK_PROVIDER_MODEL;
  }
  state.updatedAt = new Date().toISOString();
  console.log(style.phosphor(`\n  Provider switched for this session: ${bootstrap.provider}`));
  console.log(style.phosphorDim(`  Runtime: ${bootstrap.selectedRuntimeId ?? "auto"} | Model: ${bootstrap.selectedModel ?? "auto"}`));
  console.log(style.phosphorDim("  Persistent default unchanged; use `omk provider use` to persist.\n"));
}

async function applyModelOverride(
  state: NativeRootSessionState,
  ref: string,
  input: NativeRootLoopInput
): Promise<void> {
  const { resolveUserModelAlias } = await import("../../providers/model-registry.js");
  const resolved = await resolveUserModelAlias(ref, { env: input.env });
  if (resolved.provider && resolved.provider !== state.provider) {
    await applyProviderOverride(state, resolved.provider, input, resolved.model);
    if (state.provider !== resolved.provider) return;
  } else {
    state.bootstrap = {
      ...state.bootstrap,
      selectedModel: resolved.model,
    };
    state.model = resolved.model;
    input.env.OMK_PROVIDER_MODEL = resolved.model;
    state.updatedAt = new Date().toISOString();
  }
  console.log(style.phosphor(`\n  Model override for this session: ${ref} → ${resolved.model}`));
  if (resolved.provider) console.log(style.phosphorDim(`  Provider: ${resolved.provider}`));
  console.log(style.phosphorDim("  Persistent default unchanged; use `omk model use` to persist.\n"));
}

export type NativeTurnRisk = "read" | "write" | "shell" | "merge";

function hasExplicitReadOnlyIntent(text: string): boolean {
  return /\b(read|inspect|look|show|list|summarize|explain|describe|review|audit|status|diagnose)\b/.test(text)
    || /\b(without changing|without editing|do not change|don't change|do not edit|don't edit|no edits?|no file changes?)\b/.test(text)
    || /읽기\s*전용|수정하지\s*말|변경하지\s*말|파일\s*(수정|변경)\s*(없이|하지\s*말)|요약|설명|상태|검토만|분석만|읽어|살펴/.test(text);
}

export function inferNativeTurnRisk(prompt: string): NativeTurnRisk {
  const text = prompt.toLowerCase();
  if (/\b(push|publish|release|merge|tag|deploy)\b|푸시|퍼블리시|릴리즈|머지|배포/.test(text)) return "merge";
  if (/\b(run|test|build|exec|execute|shell|terminal|command|npm|pnpm|yarn|bun|pytest|cargo|go test|tsc|lint|verify|check)\b|테스트|빌드|실행|검증|쉘|터미널/.test(text)) return "shell";
  if (/\b(fix|edit|write|implement|modify|patch|refactor|add|create|delete|update|change)\b|수정|구현|패치|리팩터|추가|삭제|변경/.test(text)) return "write";
  if (hasExplicitReadOnlyIntent(text)) return "read";
  return "write";
}

function nativeTurnRoutingPolicy(provider: string, risk: NativeTurnRisk): {
  capabilities: string[];
  readOnly: boolean;
  sandboxMode: "read-only" | "workspace-write";
  providerReasonSuffix?: string;
} {
  if (provider === "deepseek" && risk !== "read") {
    return {
      capabilities: ["read", "review"],
      readOnly: true,
      sandboxMode: "read-only",
      providerReasonSuffix: `; DeepSeek is advisory/read-only for ${risk} intent`,
    };
  }
  if (risk === "read") {
    return { capabilities: ["read"], readOnly: true, sandboxMode: "read-only" };
  }
  if (risk === "write") {
    return { capabilities: ["write", "patch"], readOnly: false, sandboxMode: "workspace-write" };
  }
  if (risk === "merge") {
    return { capabilities: ["write", "patch", "shell", "merge"], readOnly: false, sandboxMode: "workspace-write" };
  }
  return { capabilities: ["write", "patch", "shell"], readOnly: false, sandboxMode: "workspace-write" };
}

function debloatRiskFromNativeTurnRisk(risk: NativeTurnRisk): DebloatRisk {
  if (risk === "read") return "read";
  if (risk === "write") return "write";
  return "dangerous";
}

export function buildNativeRootLoopTurnNode(input: {
  bootstrap: RuntimeBootstrap;
  prompt: string;
  nodeId?: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  executionPrompt?: string;
}): DagNode {
  const id = input.nodeId ?? `turn-${Date.now()}`;
  const turnRisk = inferNativeTurnRisk(input.prompt);
  const routingPolicy = nativeTurnRoutingPolicy(input.bootstrap.provider, turnRisk);
  const capabilityInjection = buildCapabilityInjection({
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
  });
  const envelope = buildPromptEnvelope({
    bootstrap: input.bootstrap,
    prompt: input.prompt,
    capabilities: capabilityInjection,
    role: "root-coordinator",
    nodeId: id,
    executionPrompt: input.executionPrompt,
    turnRisk,
    sandboxMode: routingPolicy.sandboxMode,
  });
  const rawEnvelope = renderPromptEnvelope(envelope);
  const compiled = compileBloatToNlp({
    rawText: rawEnvelope,
    provider: input.bootstrap.provider,
    model: input.bootstrap.selectedModel ?? "auto",
    userPayload: input.prompt,
    risk: debloatRiskFromNativeTurnRisk(turnRisk),
    sandbox: routingPolicy.sandboxMode,
    executionSelection: input.executionPrompt,
    role: "coordinator",
    evidenceRequired: false,
    capabilityEnvelope: {
      mcpEnabled: capabilityInjection.mcpServers,
      skillsEnabled: capabilityInjection.skills,
      toolsEnabled: capabilityInjection.tools.length > 0,
      liveRequired: capabilityInjection.requiresMcp,
    },
  });
  const selectedMcp = [
    ...compiled.runtimeSidecar.requiredMcp,
    ...compiled.runtimeSidecar.optionalMcp,
  ];
  const selectedCapabilityInjection = buildCapabilityInjection({
    mcpAllowlist: selectedMcp,
    skillNames: compiled.runtimeSidecar.selectedSkills,
    hookNames: input.hookNames,
    tools: capabilityInjection.tools,
    requireMcp: compiled.runtimeSidecar.requiredMcp.length > 0,
    requiresToolCalling: capabilityInjection.requiresToolCalling,
  });
  return {
    id,
    name: compiled.modelPrompt,
    role: "coordinator",
    dependsOn: [],
    status: "running",
    retries: 0,
    maxRetries: 1,
    routing: applyCapabilityInjectionToRouting({
      provider: input.bootstrap.provider,
      providerModel: input.bootstrap.selectedModel,
      providerReason: `native-root-loop selected ${input.bootstrap.selectedRuntimeId ?? input.bootstrap.sessionMode}${routingPolicy.providerReasonSuffix ?? ""}`,
      assignedProviderCapabilities: routingPolicy.capabilities,
      contextBudget: "normal",
      readOnly: routingPolicy.readOnly,
      risk: turnRisk,
      promptMode: "dnc-nlp",
      runtimeSidecar: {
        ...compiled.runtimeSidecar,
        requiredMcp: [...compiled.runtimeSidecar.requiredMcp],
        optionalMcp: [...compiled.runtimeSidecar.optionalMcp],
        disabledMcp: [...compiled.runtimeSidecar.disabledMcp],
        selectedSkills: [...compiled.runtimeSidecar.selectedSkills],
      },
      executionPrompt: input.executionPrompt,
      approvalPolicy: input.executionPrompt,
      sandboxMode: routingPolicy.sandboxMode,
      rationale: `native-root-loop DNC intent=${compiled.runtimeSidecar.intent}; selected MCP=${selectedMcp.length}; selected skills=${compiled.runtimeSidecar.selectedSkills.length}; optional failures follow required-only policy`,
    }, selectedCapabilityInjection),
  };
}

async function executeNativeRootTurn(input: {
  taskRunner: TaskRunner;
  node: DagNode;
  env: Record<string, string>;
  signal: AbortSignal;
  heartbeatEnabled: boolean;
  renderer?: CliRenderer;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  runContext?: TaskRunContext;
}): Promise<TaskResult> {
  const startedAt = Date.now();
  const routing = input.node.routing;
  emitNativeTurnRoute(input);

  let heartbeatPrinted = false;
  let heartbeatLineClosed = false;
  const heartbeat = input.heartbeatEnabled
    ? setInterval(() => {
        heartbeatPrinted = true;
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        if (input.renderer) {
          input.renderer.emit({
            type: "turn:heartbeat",
            elapsedMs: sec * 1000,
            provider: routing?.provider ?? "auto",
            model: routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL,
          });
        } else {
          process.stderr.write(style.phosphorDim(
            `\r  running ${sec}s · provider=${routing?.provider ?? "auto"} · model=${routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL ?? "auto"}   `
          ));
        }
      }, 3000)
    : undefined;
  heartbeat?.unref?.();

  try {
    const result = await input.taskRunner.run(input.node, input.env, input.signal, input.runContext);
    if (input.heartbeatEnabled) {
      const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (input.renderer) {
        heartbeatLineClosed = true;
      } else {
        if (heartbeatPrinted) {
          process.stderr.write("\n");
          heartbeatLineClosed = true;
        }
        process.stderr.write(style.phosphorDim(`  finished in ${sec}s · exit=${result.exitCode}\n`));
      }
    }
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (heartbeatPrinted && !heartbeatLineClosed && !input.renderer) process.stderr.write("\n");
  }
}

async function buildNativeRootLoopTurnDag(input: {
  bootstrap: RuntimeBootstrap;
  prompt: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  executionPrompt?: string;
  workers?: number;
}): Promise<Dag> {
  const dag = await buildChatTurnDag({
    prompt: input.prompt,
    runId: "native-chat-turn",
    providerPolicy: bootstrapProviderPolicy(input.bootstrap),
    providerModel: input.bootstrap.selectedModel,
    workerCount: input.workers,
    executionStrategy: nativeExecutionStrategy(input.executionPrompt),
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
  });

  if (dag.nodes.length !== 1) return dag;

  const node = buildNativeRootLoopTurnNode({
    bootstrap: input.bootstrap,
    prompt: input.prompt,
    nodeId: dag.nodes[0]?.id,
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
    executionPrompt: input.executionPrompt,
  });
  return createDag({ nodes: [node] });
}

function combineNativeHarnessResults(
  success: boolean,
  completed: Array<{ node: DagNode; result: TaskResult }>
): TaskResult {
  const last = completed.at(-1)?.result;
  const stdout = completed
    .map(({ result }) => result.stdout)
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
  const stderr = completed
    .map(({ result }) => result.stderr)
    .filter((text): text is string => Boolean(text))
    .join("\n");
  return {
    success,
    exitCode: success ? 0 : last?.exitCode ?? 1,
    stdout,
    stderr,
    metadata: {
      ...(last?.metadata ?? {}),
      harness: "dag-executor",
      completedNodes: completed.length,
    },
  };
}

async function executeNativeRootHarnessTurn(input: {
  taskRunner: TaskRunner;
  bootstrap: RuntimeBootstrap;
  prompt: string;
  runId: string;
  root: string;
  env: Record<string, string>;
  signal: AbortSignal;
  heartbeatEnabled: boolean;
  renderer?: CliRenderer;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  workers?: number;
  executionPrompt?: string;
}): Promise<TaskResult> {
  const dag = await buildNativeRootLoopTurnDag({
    bootstrap: input.bootstrap,
    prompt: input.prompt,
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
    executionPrompt: input.executionPrompt,
    workers: input.workers,
  });
  const completed: Array<{ node: DagNode; result: TaskResult }> = [];

  const run = await executeHarnessRun({
    root: input.root,
    runId: input.runId,
    dag,
    runner: input.taskRunner,
    env: input.env,
    workers: Math.max(1, input.workers ?? 1),
    approvalPolicy: nativeApprovalPolicy(input.executionPrompt),
    signal: input.signal,
    onNodeStart: (node) => {
      emitNativeTurnRoute({
        node,
        env: input.env,
        heartbeatEnabled: input.heartbeatEnabled,
        renderer: input.renderer,
        mcpAllowlist: node.routing?.mcpServers ?? input.mcpAllowlist,
        skillNames: node.routing?.skills ?? input.skillNames,
        hookNames: node.routing?.hooks ?? input.hookNames,
      });
    },
    onNodeComplete: (node, result) => {
      completed.push({ node, result });
    },
  });

  const result = combineNativeHarnessResults(run.success, completed);
  result.metadata = {
    ...(result.metadata ?? {}),
    runId: run.state.runId,
    nodeCount: run.state.nodes.length,
    failedNodes: run.state.nodes.filter((node) => node.status === "failed" || node.status === "blocked").length,
  };
  return result;
}

export async function runNativeOmkRootLoop(input: NativeRootLoopInput): Promise<number> {
  const { taskRunner, layout, onData } = input;
  const renderer = input.renderer;
  const turnTimeoutMs = Number.parseInt(input.env.OMK_TURN_TIMEOUT_MS ?? "120000", 10);
  const safeTurnTimeoutMs = Number.isFinite(turnTimeoutMs) && turnTimeoutMs > 0 ? turnTimeoutMs : 120_000;
  const state = createNativeRootSessionState({ bootstrap: input.bootstrap, executionPrompt: input.executionPrompt });
  const slashRegistry: SlashCommandRegistry = createSlashCommandRegistry(buildSlashCommands(input, state));
  const slashContext = createSlashCommandContext(input, state);

  await renderer?.start();
  renderer?.emit({
    type: "session:start",
    runId: input.runId,
    provider: state.provider,
    model: state.model,
    layout,
    root: input.root,
    cwd: input.activeCwd,
    rootSource: input.rootSource,
  });

  // opencode-style: banner handled by PlainModernRenderer session:start event

  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: renderer ? process.stderr : process.stdout });
  const terminalOwner = new TerminalOwner(process.stdin);
  const releaseReadlineOwner = terminalOwner.claimReadline();

  let running = true;
  let readlineClosed = false;
  let activeTurnAbort: AbortController | undefined;
  const queuedLines: string[] = [];
  let pendingLineResolve: ((value: string | undefined) => void) | undefined;
  const resolveNextLine = (value: string | undefined): void => {
    const resolve = pendingLineResolve;
    pendingLineResolve = undefined;
    resolve?.(value);
  };
  rl.on("line", (line) => {
    rl.pause();
    if (pendingLineResolve) {
      resolveNextLine(line);
    } else {
      queuedLines.push(line);
    }
  });
  rl.once("close", () => {
    readlineClosed = true;
    if (queuedLines.length === 0) resolveNextLine(undefined);
  });
  const onSigint = (): void => {
    if (activeTurnAbort && !activeTurnAbort.signal.aborted) {
      activeTurnAbort.abort();
      process.stderr.write(style.phosphorDim("\nTurn cancelled. Press Ctrl+C again to exit.\n"));
      return;
    }
    running = false;
    rl.close();
  };
  process.on("SIGINT", onSigint);

  const readPromptLine = async (): Promise<string | undefined> => {
    if (readlineClosed && queuedLines.length === 0) return undefined;
    if (renderer) {
      renderer.emit({ type: "prompt:ready" });
    } else {
      process.stdout.write(style.phosphorDim("omk> "));
    }
    const queued = queuedLines.shift();
    if (queued !== undefined) return queued;
    rl.resume();
    return new Promise<string | undefined>((resolve) => {
      pendingLineResolve = resolve;
      if (readlineClosed) resolveNextLine(undefined);
    });
  };

  while (running) {
    const userInput = await readPromptLine();
    if (userInput === undefined) break;

    const line = userInput.trim();
    if (!line) continue;
    renderer?.emit({ type: "input:submitted", text: line });

    if (["exit", "quit", ":q", "/exit", "/quit"].includes(line.toLowerCase())) {
      running = false;
      break;
    }

    const parsedSlash = parseSlashInput(line);
    if (parsedSlash) {
      const handler = slashRegistry.resolve(parsedSlash);

      if (handler) {
        if (handler.name === "/exit") {
          running = false;
          break;
        }
        try {
          await terminalOwner.withChildProcess(rl, async () => {
            const result = await runSlashHandler(handler, parsedSlash, slashContext);
            if (result.exit) running = false;
          });
        } catch (err: unknown) {
          const m = err instanceof Error ? err.message : String(err);
          if (renderer) {
            renderer.emit({ type: "turn:error", message: `Command error: ${m}` });
          } else {
            console.error(style.metricsRed(`Command error: ${m}`));
          }
        }
        continue;
      }
      const message = `Unknown command: ${parsedSlash.command}. Type /help for commands.`;
      if (renderer) {
        renderer.emit({ type: "turn:error", message });
      } else {
        console.log(style.phosphorDim(message));
      }
      continue;
    }

    if (shouldRunNativeParallelTurn(state.approvalPolicy)) {
      const turnStartedAt = Date.now();
      try {
        const exitCode = await terminalOwner.withChildProcess(rl, () => runNativeParallelTurn(input, line, renderer));
        renderer?.emit({ type: "turn:finish", durationMs: Date.now() - turnStartedAt, exitCode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (renderer) {
          renderer.emit({ type: "turn:error", message: msg });
        } else {
          console.error(style.metricsRed(`Error: ${msg}`));
        }
      }
      continue;
    }

    const abort = new AbortController();
    activeTurnAbort = abort;
    const timeout = setTimeout(() => abort.abort(), safeTurnTimeoutMs);

    try {
      const turnStartedAt = Date.now();
      let result: TaskResult;
      if (isDisabledEnvValue(input.env.OMK_CHAT_HARNESS_TURN)) {
        const node = buildNativeRootLoopTurnNode({
          bootstrap: state.bootstrap,
          prompt: line,
          mcpAllowlist: input.mcpAllowlist,
          skillNames: input.skillNames,
          hookNames: input.hookNames,
          executionPrompt: state.approvalPolicy,
        });
        const turnMcpAllowlist = node.routing?.mcpServers ?? input.mcpAllowlist;
        const turnSkillNames = node.routing?.skills ?? input.skillNames;
        const turnHookNames = node.routing?.hooks ?? input.hookNames;
        const runContext = buildTaskRunContext({
          runId: input.runId,
          root: input.root,
          node,
          objective: line,
          toolPlane: {
            mcpServers: turnMcpAllowlist,
            mcpConfigFile: input.env.OMK_MCP_CONFIG_FILE,
            skills: turnSkillNames,
            hooks: turnHookNames,
            tools: node.routing?.tools,
            requiresRuntimeMcp: node.routing?.requiresMcp,
          },
          selectedRuntimeId: state.bootstrap.selectedRuntimeId,
          model: state.bootstrap.selectedModel,
        });
        result = await terminalOwner.withChildProcess(rl, () => executeNativeRootTurn({
          taskRunner,
          node,
          env: input.env,
          signal: abort.signal,
          heartbeatEnabled: !isDisabledEnvValue(input.env.OMK_TURN_HEARTBEAT),
          renderer,
          mcpAllowlist: turnMcpAllowlist,
          skillNames: turnSkillNames,
          hookNames: turnHookNames,
          runContext,
        }));
      } else {
        result = await terminalOwner.withChildProcess(rl, () => executeNativeRootHarnessTurn({
          taskRunner,
          bootstrap: state.bootstrap,
          prompt: line,
          runId: input.runId,
          root: input.root,
          env: input.env,
          signal: abort.signal,
          heartbeatEnabled: !isDisabledEnvValue(input.env.OMK_TURN_HEARTBEAT),
          renderer,
          mcpAllowlist: input.mcpAllowlist,
          skillNames: input.skillNames,
          hookNames: input.hookNames,
          workers: input.workers,
          executionPrompt: state.approvalPolicy,
        }));
      }

      if (result.stdout) {
        if (renderer) {
          renderer.emit({ type: "assistant:final", text: result.stdout });
        } else {
          const toolSummary = result.metadata?.harness === "dag-executor"
            ? `dag ${String(result.metadata.nodeCount ?? 1)} nodes`
            : "native turn";
          process.stdout.write(style.phosphorDim(`\n  ✓ Done · ${toolSummary}\n`));
        }
        onData?.(result.stdout);
      }
      if (result.stderr && result.exitCode !== 0) {
        if (renderer) {
          renderer.emit({ type: "turn:error", message: result.stderr });
        } else {
          process.stderr.write(style.metricsRed(result.stderr) + "\n");
        }
      }
      if (!result.stdout && result.exitCode !== 0) {
        const metaError = result.metadata && typeof result.metadata === "object" && "error" in result.metadata
          ? String((result.metadata as Record<string, unknown>).error)
          : undefined;
        const message = metaError
          ? `Turn exited with code ${result.exitCode}: ${metaError}`
          : `Turn exited with code ${result.exitCode}`;
        if (renderer) {
          renderer.emit({ type: "turn:error", message });
        } else {
          process.stderr.write(style.metricsRed(message) + "\n");
        }
      }
      if (input.onTodoSync && result.stdout) {
        input.onTodoSync(result.stdout);
      }
      renderer?.emit({ type: "turn:finish", durationMs: Date.now() - turnStartedAt, exitCode: result.exitCode ?? 0 });
    } catch (err) {
      const msg = abort.signal.aborted
        ? `Turn timed out after ${safeTurnTimeoutMs}ms`
        : err instanceof Error
        ? err.message
        : String(err);
      if (renderer) {
        renderer.emit({ type: "turn:error", message: msg });
      } else {
        console.error(style.metricsRed(`Error: ${msg}`));
      }
    } finally {
      activeTurnAbort = undefined;
      clearTimeout(timeout);
    }
  }

  process.off("SIGINT", onSigint);
  releaseReadlineOwner();
  if (!readlineClosed) rl.close();
  if (renderer) {
    renderer.emit({ type: "session:stop", exitCode: 0 });
    await renderer.stop();
  } else {
    console.log(style.phosphorDim(`\n  Session ended. Run ${style.cream("omk runs")} to see history.\n`));
  }
  return 0;
}
