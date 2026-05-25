import type { TaskResult, TaskRunner } from "../../contracts/orchestration.js";
import type { RuntimeBootstrap } from "../../runtime/runtime-bootstrap.js";
import type { ChatLayout } from "./utils.js";
import { style } from "../../util/theme.js";
import { runShell } from "../../util/shell.js";
import type { DagNode } from "../../orchestration/dag.js";
import { applyCapabilityInjectionToRouting, buildCapabilityInjection } from "../../runtime/capability-injection.js";
import { buildPromptEnvelope, renderPromptEnvelope } from "../../runtime/prompt-envelope.js";
import { resolveRuntimeBootstrap } from "../../runtime/runtime-bootstrap.js";
import { TerminalOwner } from "../../util/terminal-owner.js";
import type { CliRenderer } from "../../cli/ui/renderer.js";

export interface NativeRootLoopInput {
  bootstrap: RuntimeBootstrap;
  taskRunner: TaskRunner;
  runId: string;
  root: string;
  env: Record<string, string>;
  layout: ChatLayout;
  agentFile: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  executionPrompt?: string;
  renderer?: CliRenderer;
  onData?: (data: string) => void;
  onTodoSync?: (output: string) => void;
}

interface SlashCommand {
  name: string;
  aliases: string[];
  help: string;
  handler: (args: string) => void | Promise<void>;
}

export interface NativeRootSessionState {
  bootstrap: RuntimeBootstrap;
  provider: string;
  model?: string;
  approvalPolicy?: string;
  updatedAt?: string;
}

function splitSlashArgs(args: string): string[] {
  return args.split(/\s+/).map((arg) => arg.trim()).filter(Boolean);
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
  handler: SlashCommand,
  args: string,
  renderer?: CliRenderer
): Promise<void> {
  if (!renderer) {
    await handler.handler(args);
    return;
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
    await handler.handler(args);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
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

function buildSlashCommands(input: NativeRootLoopInput, state: NativeRootSessionState): SlashCommand[] {
  return [
    { name: "/exit", aliases: ["/quit", ":q"], help: "Exit chat session", handler: () => {} },
    { name: "/help", aliases: ["/h", "/?"], help: "Show this help", handler: () => {
      console.log(style.phosphorBold("\n  Slash Commands:"));
      console.log(style.phosphorDim("  ─────────────────────────────────────────────"));
      console.log(`  ${style.phosphor("/exit")} ${style.phosphorDim("/quit :q")}   — Exit chat session`);
      console.log(`  ${style.phosphor("/help")} ${style.phosphorDim("/h /?")}     — Show this help`);
      console.log(`  ${style.phosphor("/auth")}                — Show provider auth status`);
      console.log(`  ${style.phosphor("/providers")}            — List providers`);
      console.log(`  ${style.phosphor("/provider")} ${style.phosphorDim("<name>")}  — Switch provider for this session`);
      console.log(`  ${style.phosphor("/models")}               — List model aliases`);
      console.log(`  ${style.phosphor("/model")} ${style.phosphorDim("<name>")}    — Set session model`);
      console.log(`  ${style.phosphor("/use")} ${style.phosphorDim("<ref>")}       — Switch provider/model from a ref`);
      console.log(`  ${style.phosphor("/mcp")} ${style.phosphorDim("[--all]")}     — Show MCP Tool Plane status`);
      console.log(`  ${style.phosphor("/tools")}              — Show scoped MCP/skills/hooks`);
      console.log(`  ${style.phosphor("/status")}              — Show session status`);
      console.log(`  ${style.phosphor("/clear")} ${style.phosphorDim("/cls")}    — Clear screen`);
      console.log(`  ${style.phosphor("/runs")}                — List recent runs`);
      console.log(`  ${style.phosphor("/doctor")}              — Run omk doctor`);
      console.log(`  ${style.phosphor("/parallel")} ${style.phosphorDim("<prompt>")} — Run parallel orchestrator`);
      console.log(style.phosphorDim("  ─────────────────────────────────────────────\n"));
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
    { name: "/status", aliases: ["/s"], help: "Show session status", handler: () => {
      const uptime = process.uptime();
      const mem = process.memoryUsage();
      console.log(style.phosphorBold(`\n  Session: ${input.runId}`));
      console.log(`  Provider: ${style.phosphor(state.provider)} | Model: ${style.phosphorDim(state.model ?? "auto")}`);
      console.log(`  Uptime: ${style.phosphorDim(Math.floor(uptime / 60) + "m " + Math.floor(uptime % 60) + "s")}`);
      console.log(`  Heap: ${style.phosphorDim((mem.heapUsed / 1024 / 1024).toFixed(1) + "M")} / ${style.phosphorDim((mem.heapTotal / 1024 / 1024).toFixed(1) + "M")}`);
      console.log(`  Layout: ${style.phosphorDim(input.layout)} | Root: ${style.phosphorDim(input.root)}\n`);
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
      console.log(style.phosphorDim(`\n  Spawning parallel: "${prompt}"\n`));
      const result = await runShell(process.execPath, ["dist/cli.js", "parallel", prompt], {
        cwd: input.root,
        env: input.env,
        stdio: "inherit",
        timeout: 300000,
      });
      if (result.failed) {
        console.log(style.metricsRed(`Parallel exited with code ${result.exitCode}`));
      }
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
  return {
    id,
    name: renderPromptEnvelope(envelope),
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
      executionPrompt: input.executionPrompt,
      approvalPolicy: input.executionPrompt,
      sandboxMode: routingPolicy.sandboxMode,
      rationale: "native-root-loop turn; OMK retains root orchestration and passes scoped MCP/skills/hooks metadata to the selected runtime",
    }, capabilityInjection),
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
}): Promise<TaskResult> {
  const startedAt = Date.now();
  const routing = input.node.routing;
  if (input.heartbeatEnabled) {
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
    } else {
      process.stderr.write(style.phosphorDim(
        `  routing: provider=${routing?.provider ?? "auto"} model=${routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL ?? "auto"} risk=${routing?.risk ?? "read"} sandbox=${routing?.sandboxMode ?? "auto"}\n`
      ));
    }
  }

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
    const result = await input.taskRunner.run(input.node, input.env, input.signal);
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

export async function runNativeOmkRootLoop(input: NativeRootLoopInput): Promise<number> {
  const { taskRunner, layout, onData } = input;
  const renderer = input.renderer;
  const turnTimeoutMs = Number.parseInt(input.env.OMK_TURN_TIMEOUT_MS ?? "120000", 10);
  const safeTurnTimeoutMs = Number.isFinite(turnTimeoutMs) && turnTimeoutMs > 0 ? turnTimeoutMs : 120_000;
  const state = createNativeRootSessionState({ bootstrap: input.bootstrap, executionPrompt: input.executionPrompt });
  const commands = buildSlashCommands(input, state);

  await renderer?.start();
  renderer?.emit({
    type: "session:start",
    runId: input.runId,
    provider: state.provider,
    model: state.model,
    layout,
  });

  if (layout !== "plain") {
    console.log(style.phosphor("Entering interactive mode. Type /help for commands.\n"));
  }

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

    if (line.startsWith("/") || line.startsWith(":")) {
      const spaceIdx = line.indexOf(" ");
      const cmd = spaceIdx > 0 ? line.slice(0, spaceIdx) : line;
      const args = spaceIdx > 0 ? line.slice(spaceIdx + 1) : "";
      const handler = commands.find((c) => c.name === cmd || c.aliases.includes(cmd));

      if (handler) {
        if (handler.name === "/exit") {
          running = false;
          break;
        }
        try {
          await terminalOwner.withChildProcess(rl, async () => {
            await runSlashHandler(handler, args, renderer);
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
      const message = `Unknown command: ${cmd}. Type /help for commands.`;
      if (renderer) {
        renderer.emit({ type: "turn:error", message });
      } else {
        console.log(style.phosphorDim(message));
      }
      continue;
    }

    const abort = new AbortController();
    activeTurnAbort = abort;
    const timeout = setTimeout(() => abort.abort(), safeTurnTimeoutMs);

    try {
      const node = buildNativeRootLoopTurnNode({
        bootstrap: state.bootstrap,
        prompt: line,
        mcpAllowlist: input.mcpAllowlist,
        skillNames: input.skillNames,
        hookNames: input.hookNames,
        executionPrompt: state.approvalPolicy,
      });

      const turnStartedAt = Date.now();
      const result = await terminalOwner.withChildProcess(rl, () => executeNativeRootTurn({
        taskRunner,
        node,
        env: input.env,
        signal: abort.signal,
        heartbeatEnabled: !isDisabledEnvValue(input.env.OMK_TURN_HEARTBEAT),
        renderer,
        mcpAllowlist: input.mcpAllowlist,
        skillNames: input.skillNames,
        hookNames: input.hookNames,
      }));

      if (result.stdout) {
        if (renderer) {
          renderer.emit({ type: "assistant:final", text: result.stdout });
        } else {
          process.stdout.write(result.stdout + "\n");
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
        const message = `Turn exited with code ${result.exitCode}`;
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
    console.log(style.phosphorDim("\nSession ended."));
  }
  return 0;
}
