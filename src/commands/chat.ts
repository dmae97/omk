import { getOmkPath, getProjectRootDiagnostics, pathExists, injectKimiGlobals, collectMcpConfigs, getKimiSkillsDir, getRunPath, getUserHome, displayProjectRootPath } from "../util/fs.js";
import { style, status, box, label, separator, header } from "../util/theme.js";
import { runShell } from "../util/shell.js";
import { readFile, writeFile, readdir } from "fs/promises";
import { dirname, join, isAbsolute, relative } from "path";
import { writeTodos, readTodos, parseSetTodoListFromOutput, type TodoItem } from "../util/todo-sync.js";
import { writeSessionMeta, readSessionMeta, createOmkSessionEnv, createOmkSessionId } from "../util/session.js";
import type { OmkMode } from "../util/mode-preset.js";

export async function updateChatHeartbeat(root: string, runId: string): Promise<void> {
  const statePath = getRunPath(runId, "state.json", root);
  try {
    const raw = await readFile(statePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(raw) as any;
    if (!state.nodes?.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatNode = state.nodes.find((n: any) => n.id === "chat");
    if (!chatNode) return;
    const started = Date.parse(chatNode.startedAt);
    chatNode.durationMs = Date.now() - (Number.isNaN(started) ? Date.now() : started);
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore heartbeat failures
  }
}

export async function updateChatThinking(root: string, runId: string, thinking: string): Promise<void> {
  const statePath = getRunPath(runId, "state.json", root);
  try {
    const raw = await readFile(statePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(raw) as any;
    if (!state.nodes?.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatNode = state.nodes.find((n: any) => n.id === "chat");
    if (!chatNode) return;
    chatNode.thinking = thinking;
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore
  }
}

export async function finalizeChatRunState(root: string, runId: string, success: boolean): Promise<void> {
  const statePath = getRunPath(runId, "state.json", root);
  try {
    const raw = await readFile(statePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(raw) as any;
    if (!state.nodes?.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatNode = state.nodes.find((n: any) => n.id === "chat");
    if (!chatNode) return;
    chatNode.status = success ? "done" : "failed";
    const completedAt = new Date();
    chatNode.completedAt = completedAt.toISOString();
    const started = Date.parse(chatNode.startedAt);
    const durationMs = completedAt.getTime() - (Number.isNaN(started) ? completedAt.getTime() : started);
    chatNode.durationMs = Math.max(1, durationMs);
    state.status = success ? "done" : "failed";
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore finalize failures
  }
  // Update session.json
  try {
    const meta = await readSessionMeta(runId).catch(() => null);
    const now = new Date().toISOString();
    if (meta) {
      meta.status = success ? "completed" : "failed";
      meta.endedAt = now;
      meta.updatedAt = now;
      await writeSessionMeta(runId, meta);
    } else {
      await writeSessionMeta(runId, { runId, type: "chat", status: success ? "completed" : "failed", startedAt: now, updatedAt: now, todoCount: 0, todoDoneCount: 0 });
    }
  } catch {
    // ignore session finalize failures
  }
}

function mergeTodos(existing: TodoItem[], incoming: TodoItem[]): TodoItem[] {
  const map = new Map<string, TodoItem>();
  for (const t of existing) {
    map.set(t.title, t);
  }
  for (const t of incoming) {
    const current = map.get(t.title);
    if (current) {
      map.set(t.title, { ...current, status: t.status });
    } else {
      map.set(t.title, t);
    }
  }
  return Array.from(map.values());
}

import YAML from "yaml";
import { initCommand } from "./init.js";
import { runKimiInteractive } from "../kimi/runner.js";
import { checkCommand, resolveKimiBin } from "../util/shell.js";
import { t } from "../util/i18n.js";
import { detectTmux, launchChatCockpit, isCockpitChild, ensureChatRunState } from "../util/chat-cockpit.js";
import { ensureChatStartupArtifacts } from "../util/chat-startup.js";
import { buildChatAgentRuntimeMcpAllowlist, prepareChatAgentModeAgent, type ChatAgentModeResources } from "../util/chat-agent-mode.js";
import { parseRuntimeScopeOption } from "../util/runtime-scope.js";
import { formatAgentYamlIssues, validateAgentYamlFile } from "../util/agent-schema.js";
import {
  queueChatStatePatch,
  updateChatHeartbeat as enqueueChatHeartbeat,
  updateChatActivity,
  finalizeChatState,
} from "../util/chat-state.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { parseExecutionPromptPolicy } from "../util/execution-selection.js";
import { normalizeProviderPolicy, parseProviderModelArg } from "../providers/model-registry.js";

async function verifyAgentPrompt(agentFile: string): Promise<boolean> {
  if (!(await pathExists(agentFile))) return false;
  try {
    const raw = await readFile(agentFile, "utf8");
    const parsed = YAML.parse(raw);
    const promptPath = parsed?.agent?.system_prompt_path as string | undefined;
    if (!promptPath) return true;
    const resolved = isAbsolute(promptPath)
      ? promptPath
      : join(dirname(agentFile), promptPath);
    return await pathExists(resolved);
  } catch {
    return false;
  }
}

const CHAT_STARTUP_FAILURE_OUTPUT_LIMIT = 4000;

function appendRecentChatOutput(current: string, data: string): string {
  const next = current + data;
  return next.length > CHAT_STARTUP_FAILURE_OUTPUT_LIMIT
    ? next.slice(-CHAT_STARTUP_FAILURE_OUTPUT_LIMIT)
    : next;
}

function sanitizeChatStartupFailureOutput(output: string): string {
  return output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s"'`]+/gi, "$1=***")
    .replace(/bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer ***");
}

function isKimiPromptReadyLine(line: string): boolean {
  return /(?:^|\s)(?:waiting for input|ready for input|enter your prompt|prompt ready)(?:\s|$)/i.test(line)
    || /^[>›]\s*$/.test(line.trim());
}

async function writeChatStartupFailureArtifact(options: {
  root: string;
  runId: string;
  exitCode: number;
  agentFile: string;
  recentOutput: string;
  resources: Awaited<ReturnType<typeof getOmkResourceSettings>>;
  reason?: string;
  schemaIssues?: string[];
}): Promise<void> {
  const artifactPath = getRunPath(options.runId, "chat-startup-failure.json", options.root);
  const artifact = {
    runId: options.runId,
    exitCode: options.exitCode,
    capturedAt: new Date().toISOString(),
    agentFile: relative(options.root, options.agentFile),
    mcpScope: options.resources.mcpScope,
    skillsScope: options.resources.skillsScope,
    hooksScope: options.resources.hooksScope,
    reason: options.reason,
    schemaIssues: options.schemaIssues ?? [],
    recentOutput: sanitizeChatStartupFailureOutput(options.recentOutput).slice(-CHAT_STARTUP_FAILURE_OUTPUT_LIMIT),
  };
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n", "utf-8");
}

async function failChatBeforeLaunch(options: {
  root: string;
  runId: string;
  agentFile: string;
  resources: Awaited<ReturnType<typeof getOmkResourceSettings>>;
  message: string;
  schemaIssues?: string[];
}): Promise<never> {
  const detail = options.schemaIssues?.length ? `\n${options.schemaIssues.slice(0, 8).map((item) => `  - ${item}`).join("\n")}` : "";
  console.error(status.error(`[omk] ${options.message}`));
  if (detail) console.error(detail);
  console.error(style.gray("Fix: run `omk doctor --fix`, then retry `omk chat`."));
  await writeChatStartupFailureArtifact({
    root: options.root,
    runId: options.runId,
    exitCode: 1,
    agentFile: options.agentFile,
    recentOutput: `${options.message}${detail}`,
    resources: options.resources,
    reason: options.message,
    schemaIssues: options.schemaIssues,
  }).catch(() => {});
  await finalizeChatState(options.runId, false).catch(() => {});
  const now = new Date().toISOString();
  await writeSessionMeta(options.runId, {
    runId: options.runId,
    type: "chat",
    status: "failed",
    startedAt: now,
    endedAt: now,
    updatedAt: now,
    todoCount: 0,
    todoDoneCount: 0,
  }).catch(() => {});
  process.exit(1);
}

interface ChatSmokeReport {
  ok: boolean;
  command: "chat smoke";
  runId: string;
  agentFile: string;
  schemaOk: boolean;
  mcpScope: "all" | "project" | "none";
  skillsScope: "all" | "project" | "none";
  hooksScope: "all" | "project" | "none";
  runtimeMcpConfig: {
    injected: boolean;
    path: string | null;
    exists: boolean;
  };
  startupFailureArtifactExists: boolean;
  checks: Array<{ name: string; status: "ok" | "fail"; message: string }>;
}

async function buildChatSmokeReport(options: {
  root: string;
  runId: string;
  agentFile: string;
  schemaOk: boolean;
  resources: Awaited<ReturnType<typeof getOmkResourceSettings>>;
  mcpScope: "all" | "project" | "none";
  mcpAllowlist?: string[];
}): Promise<ChatSmokeReport> {
  const args: string[] = ["--agent-file", options.agentFile];
  await injectKimiGlobals(args, { role: "coordinator", mcpScope: options.mcpScope, mcpAllowlist: options.mcpAllowlist });
  const mcpArgIndex = args.indexOf("--mcp-config-file");
  const runtimeMcpPath = mcpArgIndex >= 0 ? args[mcpArgIndex + 1] ?? null : null;
  const runtimeMcpExists = runtimeMcpPath ? await pathExists(runtimeMcpPath) : false;
  const failurePath = getRunPath(options.runId, "chat-startup-failure.json", options.root);
  const startupFailureArtifactExists = await pathExists(failurePath);
  const checks: ChatSmokeReport["checks"] = [
    {
      name: "agent schema",
      status: options.schemaOk ? "ok" : "fail",
      message: options.schemaOk ? "agent YAML schema is valid" : "agent YAML schema is invalid",
    },
    {
      name: "runtime MCP merge",
      status: options.mcpScope === "none" || runtimeMcpExists ? "ok" : "fail",
      message: runtimeMcpPath
        ? `runtime MCP config: ${relative(options.root, runtimeMcpPath)}`
        : options.mcpScope === "none"
          ? "MCP disabled by scope none"
          : "runtime MCP config was not generated",
    },
    {
      name: "startup failure artifact",
      status: startupFailureArtifactExists ? "fail" : "ok",
      message: startupFailureArtifactExists ? "chat-startup-failure.json exists" : "no startup failure artifact",
    },
  ];
  return {
    ok: checks.every((check) => check.status === "ok"),
    command: "chat smoke",
    runId: options.runId,
    agentFile: relative(options.root, options.agentFile),
    schemaOk: options.schemaOk,
    mcpScope: options.mcpScope,
    skillsScope: options.resources.skillsScope,
    hooksScope: options.resources.hooksScope,
    runtimeMcpConfig: {
      injected: Boolean(runtimeMcpPath),
      path: runtimeMcpPath ? relative(options.root, runtimeMcpPath) : null,
      exists: runtimeMcpExists,
    },
    startupFailureArtifactExists,
    checks,
  };
}

type ChatLayout = "auto" | "tmux" | "inline" | "plain";
type ChatBrand = "kimicat" | "minimal" | "plain";

function resolveLayout(requested: ChatLayout | undefined): ChatLayout {
  if (requested && requested !== "auto") return requested;
  // Already inside a tmux cockpit pane — never launch tmux again
  if (isCockpitChild()) return "inline";
  return "auto";
}

function resolveChatWorkerCount(requested: string | undefined, fallback: number): string {
  const trimmed = requested?.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") {
    return String(Math.max(1, fallback));
  }
  return trimmed;
}

function renderChatIntro(
  brand: ChatBrand,
  meta: { agent: string; runId?: string; layout: ChatLayout; trust: string; mode?: string }
): string {
  const titleKey: Record<ChatBrand, string> = {
    kimicat: "chat.intro.kimicat",
    minimal: "chat.intro.minimal",
    plain: "chat.intro.plain",
  };
  const title = t(titleKey[brand] ?? titleKey.kimicat);
  const lines: string[] = [style.purpleBold(`🌸 ${title}`)];
  if (brand !== "plain") {
    lines.push(
      `  ${style.gray(t("chat.intro.agent") + ":")} ${style.cream(meta.agent)}`
    );
    if (meta.runId) {
      lines.push(
        `  ${style.gray(t("chat.intro.run") + ":")} ${style.cream(meta.runId)}`
      );
    }
    lines.push(
      `  ${style.gray(t("chat.intro.layout") + ":")} ${style.cream(meta.layout)}`
    );
    lines.push(
      `  ${style.gray(t("chat.intro.trust") + ":")} ${style.cream(meta.trust)}`
    );
    if (meta.mode) {
      lines.push(
        `  ${style.gray("Mode:")} ${style.cream(meta.mode)}`
      );
    }
  }
  return lines.join("\n");
}


export async function chatCommand(options: {
  agentFile?: string;
  runId?: string;
  workers?: string;
  maxStepsPerTurn?: string;
  layout?: ChatLayout;
  brand?: ChatBrand;
  mode?: string;
  execution?: string;
  provider?: string;
  model?: string;
  cockpitRefresh?: string;
  cockpitRedraw?: "diff" | "full" | "append";
  cockpitHistory?: "off" | "static" | "watch";
  cockpitSideWidth?: string;
  cockpitHeight?: string;
  mcpScope?: string;
  smoke?: boolean;
  json?: boolean;
}): Promise<void> {
  const rootResolution = getProjectRootDiagnostics();
  const root = rootResolution.root;
  process.env.OMK_PROJECT_ROOT ??= root;
  if (rootResolution.isHomeRoot && rootResolution.warning) {
    const message = `Project root resolved to HOME (${displayProjectRootPath(root) ?? root}). ${rootResolution.recommendation ?? "Set OMK_PROJECT_ROOT or OMK_DEFAULT_PROJECT_ROOT."}`;
    if (process.env.OMK_ALLOW_HOME_PROJECT_ROOT !== "1") {
      const error = `${message} Refusing to start chat from HOME without an explicit project root.`;
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error }, null, 2));
      } else {
        console.error(status.error(error));
      }
      process.exit(1);
    }
    if (!options.json) console.error(status.warn(message));
  }
  const { getCurrentMode, isValidMode } = await import("../util/mode-preset.js");
  let currentMode: OmkMode = "agent";
  if (options.mode) {
    const m: string = options.mode.toLowerCase().trim();
    if (m === "default") {
      currentMode = "agent";
    } else if (isValidMode(m)) {
      currentMode = m as OmkMode;
    } else {
      console.log(status.warn(`Invalid mode: ${options.mode}. Falling back to current mode.`));
      currentMode = await getCurrentMode();
    }
  } else {
    currentMode = await getCurrentMode();
  }
  const agentFile = options.agentFile ?? getOmkPath("agents/root.yaml");
  const sessionId = createOmkSessionId("chat");
  const runId = options.runId;
  const effectiveRunId = runId ?? sessionId;
  const layout = resolveLayout(options.layout);
  const brand = options.brand ?? "kimicat";
  const resources = await getOmkResourceSettings();
  const modelArg = parseProviderModelArg(options.model);
  const providerPolicy = normalizeProviderPolicy(options.provider ?? modelArg.provider);
  const mcpScope = parseRuntimeScopeOption(options.mcpScope, resources.mcpScope, "--mcp-scope");
  const effectiveResources = { ...resources, mcpScope };
  const effectiveWorkers = resolveChatWorkerCount(options.workers, resources.maxWorkers);
  const executionPrompt = parseExecutionPromptPolicy(options.execution, "--execution") ?? resources.executionPrompt;

  // Dependency preflight: fail-fast before project auto-init if primary CLI or node-pty is missing
  const kimiBin = resolveKimiBin();
  const kimiAvailable = await checkCommand(kimiBin);
  if (!kimiAvailable) {
    console.error(
      status.error(
        `[omk] \`${kimiBin}\` command not found in PATH. ` +
          "Install the primary CLI first: npm i -g @anthropic-ai/kimi-code\n" +
          "If already installed, check your PATH or set KIMI_BIN env var."
      )
    );
    process.exit(1);
  }
  try {
    await import("node-pty");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      status.error(
        `[omk] Failed to load node-pty native module. (${message})\n` +
          "This usually happens when installed with --ignore-scripts.\n" +
          "Fix: npm rebuild -g @oh-my-kimi/cli\n" +
          "Or reinstall: npm uninstall -g @oh-my-kimi/cli && npm install -g @oh-my-kimi/cli"
      )
    );
    process.exit(1);
  }

  const promptOk = await verifyAgentPrompt(agentFile);
  if (!promptOk) {
    console.log(status.warn(t("chat.notInitialized")));
    await initCommand({ profile: "default" });
    console.log(status.ok(t("chat.autoInitComplete")));
  }

  try {
    const bootstrap = await ensureChatStartupArtifacts({ root, runId: effectiveRunId });
    if (!isCockpitChild() && layout !== "plain" && bootstrap.created.length > 0) {
      console.log(status.ok(t("chat.bootstrapReady", bootstrap.date, bootstrap.created.length)));
    }
  } catch (err) {
    if (!isCockpitChild() && layout !== "plain") {
      const message = err instanceof Error ? err.message : String(err);
      console.log(status.warn(t("chat.bootstrapWarning", message)));
    }
  }

  // ── Star prompt at chat start (parent only, skipped in cockpit child) ──
  if (!isCockpitChild()) {
    try {
      const { maybeAskForGitHubStarAtChatStart } = await import("../util/first-run-star.js");
      const { getOmkVersionSync } = await import("../util/version.js");
      await maybeAskForGitHubStarAtChatStart({ version: getOmkVersionSync() });
    } catch {
      // Swallow star prompt errors so chat entry is preserved.
    }
  }

  // Ensure run state exists before launching cockpit so right pane can read it
  await ensureChatRunState(root, effectiveRunId);

  let effectiveAgentFile = agentFile;
  let chatRuntimeMcpAllowlist: string[] | undefined;
  if (!options.agentFile) {
    try {
      const [mcpNames, skillNames, hookNames] = await Promise.all([
        getActiveMcpNames(effectiveResources.mcpScope),
        getActiveSkillNames(resources.skillsScope),
        getActiveHookNames(root),
      ]);
      const chatAgentResources: ChatAgentModeResources = {
        workers: effectiveWorkers,
        maxStepsPerTurn: options.maxStepsPerTurn,
        resourceProfile: effectiveResources.profile,
        approvalPolicy: "interactive",
        providerPolicy,
        providerModel: modelArg.model,
        ensembleDefaultEnabled: effectiveResources.ensembleDefaultEnabled,
        executionPrompt,
        executionPromptSource: options.execution ? "cli" : "config",
        mcpScope: effectiveResources.mcpScope,
        skillsScope: effectiveResources.skillsScope,
        hooksScope: effectiveResources.hooksScope,
        mcpNames,
        skillNames,
        hookNames,
      };
      chatRuntimeMcpAllowlist = buildChatAgentRuntimeMcpAllowlist({
        mode: currentMode,
        resources: chatAgentResources,
      });
      const prepared = await prepareChatAgentModeAgent({
        root,
        runId: effectiveRunId,
        baseAgentFile: agentFile,
        basePromptPath: getOmkPath("prompts/root.md"),
        mode: currentMode,
        resources: chatAgentResources,
      });
      effectiveAgentFile = prepared.agentFile;
      await queueChatStatePatch(effectiveRunId, {
        lastActivityAt: new Date().toISOString(),
      }).catch(() => {});
    } catch (err) {
      effectiveAgentFile = agentFile;
      if (!isCockpitChild() && layout !== "plain") {
        const detail = process.env.OMK_DEBUG === "1" && err instanceof Error ? `: ${err.name}` : "";
        console.log(status.warn(`Chat agent harness unavailable; using base agent${detail}`));
      }
    }
  }

  const agentSchema = await validateAgentYamlFile(effectiveAgentFile, root);
  if (!agentSchema.ok) {
    const schemaIssues = agentSchema.issues.map((item) => `${item.file}: ${item.message}`);
    await failChatBeforeLaunch({
      root,
      runId: effectiveRunId,
      agentFile: effectiveAgentFile,
      resources: effectiveResources,
      message: `invalid agent YAML schema for ${relative(root, effectiveAgentFile)}: ${formatAgentYamlIssues(agentSchema, 4)}`,
      schemaIssues,
    });
  }

  if (options.smoke) {
    const report = await buildChatSmokeReport({
      root,
      runId: effectiveRunId,
      agentFile: effectiveAgentFile,
      schemaOk: agentSchema.ok,
      resources: effectiveResources,
      mcpScope,
      mcpAllowlist: chatRuntimeMcpAllowlist,
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(header("OMK Chat Smoke"));
      for (const check of report.checks) {
        const line = `${check.name}: ${check.message}`;
        console.log(check.status === "ok" ? status.ok(line) : status.error(line));
      }
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (!options.json && !isCockpitChild()) {
    try {
      const { maybePromptForOmkUpdate } = await import("../util/update-check.js");
      const updatePrompt = await maybePromptForOmkUpdate({ source: "chat" });
      if (updatePrompt.shouldExit) process.exit(updatePrompt.exitCode ?? 0);
    } catch {
      // Update prompts are advisory and must not block chat startup.
    }
  }

  // ── tmux layout: delegate to cockpit launcher ──
  if (layout === "tmux") {
    const hasTmux = await detectTmux();
    if (!hasTmux) {
      console.error(status.error(t("chat.cockpitTmuxNotFound")));
      console.error(style.gray(t("chat.cockpitTmuxInstallHint")));
      process.exit(1);
    }
    if (!process.stdout.isTTY) {
      console.error(status.error("tmux layout requires a TTY"));
      process.exit(1);
    }
    await launchChatCockpit({ runId: effectiveRunId, brand, cwd: root, agentFile: effectiveAgentFile, workers: options.workers ? effectiveWorkers : undefined, maxStepsPerTurn: options.maxStepsPerTurn, mcpScope, cockpitRefresh: options.cockpitRefresh, cockpitRedraw: options.cockpitRedraw, cockpitHistory: options.cockpitHistory, cockpitSideWidth: options.cockpitSideWidth, cockpitHeight: options.cockpitHeight });
    return;
  }

  // ── auto layout: tmux if available and TTY, else inline ──
  if (layout === "auto") {
    const hasTmux = await detectTmux();
    if (hasTmux && process.stdout.isTTY) {
      await launchChatCockpit({ runId: effectiveRunId, brand, cwd: root, agentFile: effectiveAgentFile, workers: options.workers ? effectiveWorkers : undefined, maxStepsPerTurn: options.maxStepsPerTurn, mcpScope, cockpitRefresh: options.cockpitRefresh, cockpitRedraw: options.cockpitRedraw, cockpitHistory: options.cockpitHistory, cockpitSideWidth: options.cockpitSideWidth, cockpitHeight: options.cockpitHeight });
      return;
    }
    // fall through to inline
  }

  // ── plain / inline: run Kimi directly ──
  const isPlain = layout === "plain";

  if (!isPlain && !isCockpitChild()) {
    const trust = `${effectiveResources.mcpScope} MCP / ${effectiveResources.skillsScope} skills`;
    const agentDisplay = relative(root, effectiveAgentFile);
    const { getModePreset } = await import("../util/mode-preset.js");
    const modePreset = getModePreset(currentMode);
    const modeDisplay = modePreset ? `${modePreset.icon} ${modePreset.label}` : currentMode;
    console.log(
      renderChatIntro(brand, {
        agent: agentDisplay,
        runId: effectiveRunId,
        layout: isPlain ? "plain" : "inline",
        trust,
        mode: modeDisplay,
      }) + "\n"
    );
  }

  // ── Print OMK status summary (HUD/TODO preview before entering chat) ──
  if (!isPlain && !isCockpitChild()) {
    try {
      const { renderHudDashboard } = await import("./hud.js");
      const hud = await renderHudDashboard({ runId: effectiveRunId, terminalWidth: process.stdout.columns, fetchQuota: false });
      const lines = hud.split("\n");
      // Use terminal height to show as much HUD as possible (reserve 4 lines for prompt)
      const termRows = process.stdout.rows || 24;
      const maxLines = Math.max(20, termRows - 4);
      const summary = lines.slice(0, Math.min(lines.length, maxLines)).join("\n");
      console.log(summary);
      console.log(style.gray(t("chat.scrollUpForHud")));
    } catch {
      // Ignore HUD failure
    }
  }

  // ── Print recent run history so users can scroll back to see past work ──
  // PERF: consider deferring to after Kimi spawn
  if (!isPlain && !isCockpitChild()) {
    try {
      const { listRunCandidates } = await import("./hud.js");
      const { pathExists, getRunsDir, getRunPath } = await import("../util/fs.js");
      const { readFile } = await import("fs/promises");
      const runsDir = getRunsDir();
      if (await pathExists(runsDir)) {
        const candidates = await listRunCandidates(runsDir);
        const sorted = candidates
          .filter((c) => c.name !== effectiveRunId)
          .sort((a, b) => b.stateUpdatedAtMs - a.stateUpdatedAtMs)
          .slice(0, 5);
        if (sorted.length > 0) {
          console.log("");
          console.log(style.purpleBold("📜 Recent Work History"));
          for (const c of sorted) {
            let statusStr = style.gray("unknown");
            try {
              const statePath = getRunPath(c.name, "state.json");
              const raw = await readFile(statePath, "utf-8");
              const state = JSON.parse(raw) as Record<string, unknown>;
              const st = String(state.status ?? "unknown");
              if (st === "done") statusStr = style.mint(st);
              else if (st === "running") statusStr = style.purple(st);
              else if (st === "failed") statusStr = style.red(st);
              else statusStr = style.gray(st);
            } catch { /* ignore */ }
            let goalTitle = "";
            try {
              const goalRaw = await readFile(getRunPath(c.name, "goal.md"), "utf-8");
              const firstLine = goalRaw.split(/\r?\n/)[0]?.trim() ?? "";
              goalTitle = firstLine.replace(/^#+\s*/, "").slice(0, 30);
            } catch { /* ignore */ }
            const date = new Date(c.stateUpdatedAtMs);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
            const markers = [c.hasGoal ? "📝" : "", c.hasPlan ? "📐" : ""].join("");
            const name = c.name.length > 34 ? c.name.slice(0, 31) + "…" : c.name;
            const titlePart = goalTitle ? style.gray(` → ${goalTitle}`) : "";
            console.log(`  ${style.gray("•")} ${style.cream(name)} ${statusStr} ${style.gray(dateStr)} ${markers}${titlePart}`);
          }
          console.log(style.gray(`  Run ${style.cream("omk runs")} for full history`));
        }
      }
    } catch {
      // Ignore recent-run rendering failure
    }
  }

  // ── Resume: show existing TODO summary if resuming ──
  if (!isPlain && !isCockpitChild()) {
    try {
      const existingTodos = await readTodos(effectiveRunId).catch(() => null);
      if (existingTodos && existingTodos.length > 0) {
        const doneCount = existingTodos.filter((t) => t.status === "done").length;
        console.log(style.gray(`📋 Resuming with ${existingTodos.length} todos (${doneCount} done)`));
      }
    } catch {
      // ignore resume check failures
    }
  }

  // ── Live heartbeat: keep state.json fresh while chat is active ──
  const HEARTBEAT_MS = 2000;
  const pendingUpdates = new Set<Promise<void>>();
  function track(p: Promise<void>): void {
    pendingUpdates.add(p);
    p.then(() => pendingUpdates.delete(p), () => pendingUpdates.delete(p));
  }
  const heartbeat = setInterval(() => {
    track(enqueueChatHeartbeat(effectiveRunId).catch(() => {}));
  }, HEARTBEAT_MS);

    // ── Fallback: direct Kimi interactive session ──
    const args: string[] = [];
    args.push("--agent-file", effectiveAgentFile);
    await injectKimiGlobals(args, {
      role: "coordinator",
      mcpScope,
      skillsScope: effectiveResources.skillsScope,
      hooksScope: effectiveResources.hooksScope,
      mcpAllowlist: chatRuntimeMcpAllowlist,
    });
    if (process.env.OMK_DEBUG === "1") {
      console.error("[OMK_DEBUG] chat args:", args);
    }

    const env = createOmkSessionEnv(root, sessionId);
    env.OMK_WORKERS = effectiveWorkers;
    if (options.maxStepsPerTurn) {
      args.push("--max-steps-per-turn", options.maxStepsPerTurn);
    }

    env.OMK_RUN_ID = effectiveRunId;
    env.OMK_MODE = currentMode;
    env.OMK_MCP_SCOPE = mcpScope;
    env.OMK_SKILLS_SCOPE = effectiveResources.skillsScope;
    env.OMK_HOOKS_SCOPE = effectiveResources.hooksScope;

    let lastThinking = "";
    let exitCode = 0;
    let recentChatOutput = "";
    let observedKimiSessionId: string | undefined;
    // Chunk-array buffer to avoid repeated large string copies during todo parsing
    const pendingChunks: string[] = [];
    let pendingLength = 0;

    // ── Debounced TODO sync ──
    let pendingTodoSync: Promise<void> | null = null;
    let todoSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let accumulatedTodos: TodoItem[] = [];

    function flushTodoSync(): void {
      if (todoSyncTimer) {
        clearTimeout(todoSyncTimer);
        todoSyncTimer = null;
      }
      if (accumulatedTodos.length === 0) return;
      const todosToSync = accumulatedTodos;
      accumulatedTodos = [];
      const p = (async () => {
        const existing = await readTodos(effectiveRunId).catch(() => [] as TodoItem[]) ?? [];
        const merged = mergeTodos(existing, todosToSync);
        await writeTodos(effectiveRunId, merged);
        const doneCount = merged.filter((t) => t.status === "done").length;
        const now2 = new Date().toISOString();
        const meta = await readSessionMeta(effectiveRunId).catch(() => null);
        const startedAt = meta?.startedAt ?? now2;
        await writeSessionMeta(effectiveRunId, {
          runId: effectiveRunId,
          type: "chat",
          status: "active",
          startedAt,
          updatedAt: now2,
          todoCount: merged.length,
          todoDoneCount: doneCount,
        });
        // Mark real activity in state.json via the queued writer
        await queueChatStatePatch(effectiveRunId, { lastActivityAt: now2 });
      })().catch(() => {});
      track(p);
      pendingTodoSync = p;
    }

    function scheduleTodoSync(newTodos: TodoItem[]): void {
      accumulatedTodos = mergeTodos(accumulatedTodos, newTodos);
      if (todoSyncTimer) clearTimeout(todoSyncTimer);
      todoSyncTimer = setTimeout(flushTodoSync, 500); // 500ms debounce
    }

    try {
      exitCode = await runKimiInteractive(args, {
        cwd: root,
        env,
        onKimiMeta: (meta) => {
          const kimiSessionId = meta.session?.trim();
          if (!kimiSessionId || kimiSessionId === observedKimiSessionId) return;
          observedKimiSessionId = kimiSessionId;
          track((async () => {
            const existing = await readSessionMeta(effectiveRunId).catch(() => null);
            const now = new Date().toISOString();
            await writeSessionMeta(effectiveRunId, {
              runId: effectiveRunId,
              type: "chat",
              status: existing?.status ?? "active",
              startedAt: existing?.startedAt ?? now,
              updatedAt: now,
              endedAt: existing?.endedAt,
              goalTitle: existing?.goalTitle,
              omkSessionId: sessionId,
              kimiSessionId,
              todoCount: existing?.todoCount ?? 0,
              todoDoneCount: existing?.todoDoneCount ?? 0,
            });
          })().catch(() => {}));
        },
        onData: (data) => {
          recentChatOutput = appendRecentChatOutput(recentChatOutput, data);
          // Lightweight activity sampling: extract short tool/thinking snippets
          const lines = data.split("\n");
          for (const raw of lines) {
            const line = raw.trim();
            if (isKimiPromptReadyLine(line)) {
              lastThinking = "";
              track(updateChatActivity(effectiveRunId, "").catch(() => {}));
              continue;
            }
            if (!line || line.length < 3) continue;
            if (/read_file|write_file|edit_file|search_files|glob|grep|ctx_read/i.test(line)) {
              const m = line.match(/["']([^"']{1,60})["']/);
              lastThinking = m ? `📄 ${m[1].split("/").pop() ?? m[1]}` : `🔧 ${line.slice(0, 60)}`;
              track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
              continue;
            }
            const explicit = line.match(/^<think(?:ing)?>[\s:]*(.+?)(?:<\/think(?:ing)?>)?$/i);
            if (explicit) {
              lastThinking = `🧠 ${explicit[1].trim().slice(0, 100)}`;
              track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
              continue;
            }
          }

          // Parse SetTodoList from output with chunk-boundary buffering
          pendingChunks.push(data);
          pendingLength += data.length;
          // Trim from front to keep last ~4096-8192 chars without massive string copies
          while (pendingLength > 8192 && pendingChunks.length > 1) {
            const removed = pendingChunks.shift()!;
            pendingLength -= removed.length;
          }
          if (pendingLength > 8192 && pendingChunks.length === 1) {
            pendingChunks[0] = pendingChunks[0].slice(-4096);
            pendingLength = pendingChunks[0].length;
          }
          const pendingOutput = pendingChunks.join("");
          const newTodos = parseSetTodoListFromOutput(pendingOutput);
          if (newTodos && newTodos.length > 0) {
            scheduleTodoSync(newTodos);
          }
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recentChatOutput = appendRecentChatOutput(recentChatOutput, `\n[omk] chat failed: ${message}\n`);
      console.error(`\n[omk] chat failed: ${message}\n`);
      exitCode = 1;
    } finally {
      clearInterval(heartbeat);
      flushTodoSync();
      if (pendingTodoSync) {
        pendingUpdates.add(pendingTodoSync);
      }
      await Promise.all(pendingUpdates);
      if (exitCode !== 0) {
        await writeChatStartupFailureArtifact({
          root,
          runId: effectiveRunId,
          exitCode,
          agentFile: effectiveAgentFile,
          recentOutput: recentChatOutput,
          resources: effectiveResources,
        }).catch(() => {});
      }
      await finalizeChatState(effectiveRunId, exitCode === 0);
      // Update session.json
      try {
        const meta = await readSessionMeta(effectiveRunId).catch(() => null);
        const now = new Date().toISOString();
        if (meta) {
          meta.status = exitCode === 0 ? "completed" : "failed";
          meta.endedAt = now;
          meta.updatedAt = now;
          meta.omkSessionId ??= sessionId;
          if (observedKimiSessionId) meta.kimiSessionId = observedKimiSessionId;
          await writeSessionMeta(effectiveRunId, meta);
        } else {
          await writeSessionMeta(effectiveRunId, { runId: effectiveRunId, type: "chat", status: exitCode === 0 ? "completed" : "failed", startedAt: now, updatedAt: now, omkSessionId: sessionId, kimiSessionId: observedKimiSessionId, todoCount: 0, todoDoneCount: 0 });
        }
      } catch {
        // ignore session finalize failures
      }
      await printChatExitBanner({
        runId: effectiveRunId,
        sessionId,
        kimiSessionId: observedKimiSessionId,
        workers: options.workers,
        root,
        mcpScope,
      });
      if (isCockpitChild()) {
        const sanitized = effectiveRunId.replace(/[^a-zA-Z0-9]/g, "-");
        const session = `omk-chat-${sanitized}`;
        await runShell("tmux", ["kill-session", "-t", session], { cwd: root, timeout: 5000 }).catch(() => {});
      }
    }
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
}

async function getActiveMcpNames(scope: "all" | "project" | "none"): Promise<string[]> {
  if (scope === "none") return [];
  const configs = await collectMcpConfigs(scope);
  const results = await Promise.all(
    configs.map(async (cfg) => {
      try {
        const raw = await readFile(cfg, "utf-8");
        const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
        return parsed.mcpServers ? Object.keys(parsed.mcpServers) : [];
      } catch {
        return [];
      }
    })
  );
  return [...new Set(results.flat())];
}

async function getActiveSkillNames(skillsScope: "all" | "project" | "none"): Promise<string[]> {
  if (skillsScope === "none") return [];
  const dirs: string[] = [];
  const projectDir = getKimiSkillsDir();
  if (await pathExists(projectDir)) dirs.push(projectDir);
  if (skillsScope === "all") {
    const globalDir = join(getUserHome(), ".kimi", "skills");
    if (await pathExists(globalDir)) dirs.push(globalDir);
  }
  const results = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    })
  );
  return [...new Set(results.flat())];
}

async function getActiveHookNames(root: string): Promise<string[]> {
  try {
    const { discoverRoutingInventory } = await import("../orchestration/routing.js");
    return [...discoverRoutingInventory(root).hooks.keys()];
  } catch {
    return [];
  }
}

async function printChatExitBanner(options: {
  runId: string;
  sessionId: string;
  kimiSessionId?: string;
  workers?: string;
  root: string;
  mcpScope?: "all" | "project" | "none";
}): Promise<void> {
  const { runId, sessionId, kimiSessionId, workers } = options;
  const { getOmkResourceSettings } = await import("../util/resource-profile.js");
  const resources = await getOmkResourceSettings();
  const mcpScope = options.mcpScope ?? resources.mcpScope;

  // Parallel discovery of MCP + skills
  const [mcpNames, skillNames] = await Promise.all([
    getActiveMcpNames(mcpScope),
    getActiveSkillNames(resources.skillsScope),
  ]);

  const mcpText = formatResourceCount(mcpNames.length, mcpScope);
  const skillText = formatResourceCount(skillNames.length, resources.skillsScope);
  const workersText = workers ?? resources.maxWorkers.toString();

  const lines: string[] = [
    "",
    style.purpleBold("  🌸 Session Ended"),
    separator(50),
    label("Run ID", runId),
    label("OMK Session", sessionId),
    ...(kimiSessionId ? [label("Primary Session", kimiSessionId)] : []),
    label("Resume", `omk runs`),
    label("Workers", workersText),
    label("MCP", mcpText),
    label("Skills", skillText),
    separator(50),
    style.gray(`  Run ${style.cream("omk hud")} for dashboard, ${style.cream("omk runs")} for history.`),
    "",
  ];

  console.log(box(lines));
}

function formatResourceCount(count: number, scope: string): string {
  return count > 0 ? `${count} active (${scope})` : style.gray(`none (${scope})`);
}
