import { getOmkPath, getProjectRootDiagnostics, displayProjectRootPath } from "../../util/fs.js";
import { style, status, header } from "../../util/theme.js";
import { t } from "../../util/i18n.js";
import { createOmkSessionId } from "../../util/session.js";
import type { OmkMode } from "../../util/mode-preset.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import { parseExecutionPromptPolicy } from "../../util/execution-selection.js";
import { normalizeProviderPolicy, parseProviderModelArg } from "../../providers/model-registry.js";
import { validateAgentYamlFile, formatAgentYamlIssues } from "../../util/agent-schema.js";
import { ensureChatStartupArtifacts } from "../../util/chat-startup.js";
import { ensureChatRunState, detectTmux, launchChatCockpit, isCockpitChild } from "../../util/chat-cockpit.js";
import { buildChatAgentRuntimeMcpAllowlist, prepareChatAgentModeAgent, type ChatAgentModeResources } from "../../util/chat-agent-mode.js";
import { parseRuntimeScopeOption } from "../../util/runtime-scope.js";
import { queueChatStatePatch } from "../../util/chat-state.js";
import { initCommand } from "../init.js";
import { checkCommand, resolveKimiBin } from "../../util/shell.js";
import { readTodos } from "../../util/todo-sync.js";
import { relative, join } from "path";
import { readFile } from "fs/promises";

import {
  type ChatLayout,
  type ChatBrand,
  resolveLayout,
  resolveChatWorkerCount,
  renderChatIntro,
  getActiveMcpNames,
  getActiveSkillNames,
  getActiveHookNames,
  verifyAgentPrompt,
} from "./utils.js";
import { buildChatSmokeReport, failChatBeforeLaunch } from "./startup.js";
import { runChatRuntime } from "./runtime.js";

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
  const { getCurrentMode, isValidMode } = await import("../../util/mode-preset.js");
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
  const brand = options.brand ?? "minimal";
  const resources = await getOmkResourceSettings();
  const modelArg = parseProviderModelArg(options.model);
  const providerPolicy = normalizeProviderPolicy(options.provider ?? modelArg.provider);
  const mcpScope = parseRuntimeScopeOption(options.mcpScope, resources.mcpScope, "--mcp-scope");
  const effectiveResources = { ...resources, mcpScope };
  const effectiveWorkers = resolveChatWorkerCount(options.workers, resources.maxWorkers);
  const executionPrompt = parseExecutionPromptPolicy(options.execution, "--execution") ?? resources.executionPrompt;

  // Dependency preflight: the Kimi binary + node-pty are required only when the
  // Kimi adapter is explicitly selected. Provider-neutral auto mode can route to
  // non-Kimi runtimes, so it must not fail before OMK runtime routing runs.
  const kimiBin = resolveKimiBin();
  const needsKimi = providerPolicy === "kimi";
  if (needsKimi) {
    const kimiAvailable = await checkCommand(kimiBin);
    if (!kimiAvailable) {
      console.error(
        status.error(
          `[omk] \`${kimiBin}\` command not found in PATH. ` +
            "Install the primary CLI first: npm i -g @anthropic-ai/kimi-code\n" +
            "If already installed, check your PATH or set KIMI_BIN env var.\n" +
            "To use a non-Kimi provider: omk chat --provider deepseek (or codex, openrouter, qwen)"
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
            "Fix: npm rebuild -g open-multi-agent-kit\n" +
            "Or reinstall: npm uninstall -g open-multi-agent-kit && npm install -g open-multi-agent-kit"
        )
      );
      process.exit(1);
    }
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
      const { maybeAskForGitHubStarAtChatStart } = await import("../../util/first-run-star.js");
      const { getOmkVersionSync } = await import("../../util/version.js");
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
        authorityProvider: process.env.OMK_AUTHORITY_PROVIDER,
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
    const okabeYamlPath = join(root, ".omk", "agents", "okabe.yaml");
    let okabeOk = true;
    try {
      const okabeContent = await readFile(okabeYamlPath, "utf8");
      okabeOk = okabeContent.trim().length > 0;
    } catch {
      okabeOk = false;
    }
    const repairHint = okabeOk
      ? "Fix: run `omk doctor --fix`, then retry `omk chat`."
      : "Fix: run `omk init` to regenerate agents, then retry `omk chat`.";
    await failChatBeforeLaunch({
      root,
      runId: effectiveRunId,
      agentFile: effectiveAgentFile,
      resources: effectiveResources,
      message: `invalid agent YAML schema for ${relative(root, effectiveAgentFile)}: ${formatAgentYamlIssues(agentSchema, 4)}\n${repairHint}`,
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
      const { maybePromptForOmkUpdate } = await import("../../util/update-check.js");
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
    await launchChatCockpit({
      runId: effectiveRunId,
      brand,
      cwd: root,
      agentFile: effectiveAgentFile,
      workers: options.workers ? effectiveWorkers : undefined,
      maxStepsPerTurn: options.maxStepsPerTurn,
      mcpScope,
      provider: providerPolicy,
      model: options.model,
      execution: executionPrompt,
      cockpitRefresh: options.cockpitRefresh,
      cockpitRedraw: options.cockpitRedraw,
      cockpitHistory: options.cockpitHistory,
      cockpitSideWidth: options.cockpitSideWidth,
      cockpitHeight: options.cockpitHeight,
    });
    return;
  }

  // ── auto layout: tmux if available and TTY, else inline ──
  if (layout === "auto") {
    const hasTmux = await detectTmux();
    if (hasTmux && process.stdout.isTTY) {
      await launchChatCockpit({
        runId: effectiveRunId,
        brand,
        cwd: root,
        agentFile: effectiveAgentFile,
        workers: options.workers ? effectiveWorkers : undefined,
        maxStepsPerTurn: options.maxStepsPerTurn,
        mcpScope,
        provider: providerPolicy,
        model: options.model,
        execution: executionPrompt,
        cockpitRefresh: options.cockpitRefresh,
        cockpitRedraw: options.cockpitRedraw,
        cockpitHistory: options.cockpitHistory,
        cockpitSideWidth: options.cockpitSideWidth,
        cockpitHeight: options.cockpitHeight,
      });
      return;
    }
    // fall through to inline
  }

  // ── plain / inline: run Kimi directly ──
  const isPlain = layout === "plain";

  if (!isPlain && !isCockpitChild()) {
    const trust = `${effectiveResources.mcpScope} MCP / ${effectiveResources.skillsScope} skills`;
    const agentDisplay = relative(root, effectiveAgentFile);
    const { getModePreset } = await import("../../util/mode-preset.js");
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
      const { renderHudDashboard } = await import("../hud.js");
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
      const { listRunCandidates } = await import("../hud.js");
      const { pathExists, getRunsDir, getRunPath } = await import("../../util/fs.js");
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

  const exitCode = await runChatRuntime(options, {
    root,
    effectiveRunId,
    effectiveAgentFile,
    sessionId,
    layout,
    brand,
    currentMode,
    providerPolicy,
    modelArg,
    mcpScope,
    effectiveResources,
    effectiveWorkers,
    executionPrompt,
    chatRuntimeMcpAllowlist,
  });

  if (exitCode !== 0) process.exitCode = exitCode;
  return;
}
