import { getOmkPath, getProjectRoot, pathExists, injectKimiGlobals, collectMcpConfigs, getKimiSkillsDir, getRunPath, getUserHome } from "../util/fs.js";
import { style, status, box, label, separator } from "../util/theme.js";
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
    chatNode.completedAt = new Date().toISOString();
    const started = Date.parse(chatNode.startedAt);
    chatNode.durationMs = Date.now() - (Number.isNaN(started) ? Date.now() : started);
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
import { t } from "../util/i18n.js";
import { detectTmux, launchChatCockpit, isCockpitChild, ensureChatRunState } from "../util/chat-cockpit.js";
import { ensureChatStartupArtifacts } from "../util/chat-startup.js";
import { prepareChatAgentModeAgent } from "../util/chat-agent-mode.js";
import {
  queueChatStatePatch,
  updateChatHeartbeat as enqueueChatHeartbeat,
  updateChatActivity,
  finalizeChatState,
} from "../util/chat-state.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";

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

type ChatLayout = "auto" | "tmux" | "inline" | "plain";
type ChatBrand = "kimicat" | "minimal" | "plain";

function resolveLayout(requested: ChatLayout | undefined): ChatLayout {
  if (requested && requested !== "auto") return requested;
  // Already inside a tmux cockpit pane — never launch tmux again
  if (isCockpitChild()) return "inline";
  return "auto";
}

function renderChatIntro(
  brand: ChatBrand,
  meta: { agent: string; runId?: string; layout: ChatLayout; trust: string; mode?: string }
): string {
  const titleKey: Record<ChatBrand, string> = {
    kimicat: "chat.intro.kimichan",
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
  cockpitRefresh?: string;
  cockpitRedraw?: "diff" | "full" | "append";
  cockpitHistory?: "off" | "static" | "watch";
  cockpitSideWidth?: string;
  cockpitHeight?: string;
}): Promise<void> {
  const root = getProjectRoot();
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
  if (!options.agentFile) {
    try {
      const resources = await getOmkResourceSettings();
      const [mcpNames, skillNames, hookNames] = await Promise.all([
        getActiveMcpNames(resources.mcpScope),
        getActiveSkillNames(resources.skillsScope),
        getActiveHookNames(root),
      ]);
      const prepared = await prepareChatAgentModeAgent({
        root,
        runId: effectiveRunId,
        baseAgentFile: agentFile,
        basePromptPath: getOmkPath("prompts/root.md"),
        mode: currentMode,
        resources: {
          workers: options.workers ?? resources.maxWorkers.toString(),
          maxStepsPerTurn: options.maxStepsPerTurn,
          resourceProfile: resources.profile,
          approvalPolicy: "interactive",
          providerPolicy: "auto",
          ensembleDefaultEnabled: resources.ensembleDefaultEnabled,
          mcpScope: resources.mcpScope,
          skillsScope: resources.skillsScope,
          hooksScope: process.env.OMK_HOOKS_SCOPE ?? resources.skillsScope,
          mcpNames,
          skillNames,
          hookNames,
        },
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
    await launchChatCockpit({ runId: effectiveRunId, brand, cwd: root, agentFile: effectiveAgentFile, workers: options.workers, maxStepsPerTurn: options.maxStepsPerTurn, cockpitRefresh: options.cockpitRefresh, cockpitRedraw: options.cockpitRedraw, cockpitHistory: options.cockpitHistory, cockpitSideWidth: options.cockpitSideWidth, cockpitHeight: options.cockpitHeight });
    return;
  }

  // ── auto layout: tmux if available and TTY, else inline ──
  if (layout === "auto") {
    const hasTmux = await detectTmux();
    if (hasTmux && process.stdout.isTTY) {
      await launchChatCockpit({ runId: effectiveRunId, brand, cwd: root, agentFile: effectiveAgentFile, workers: options.workers, maxStepsPerTurn: options.maxStepsPerTurn, cockpitRefresh: options.cockpitRefresh, cockpitRedraw: options.cockpitRedraw, cockpitHistory: options.cockpitHistory, cockpitSideWidth: options.cockpitSideWidth, cockpitHeight: options.cockpitHeight });
      return;
    }
    // fall through to inline
  }

  // ── plain / inline: run Kimi directly ──
  const isPlain = layout === "plain";

  if (!isPlain && !isCockpitChild()) {
    const resources = await getOmkResourceSettings();
    const trust = `${resources.mcpScope} MCP / ${resources.skillsScope} skills`;
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
      const hud = await renderHudDashboard({ runId: effectiveRunId, terminalWidth: process.stdout.columns });
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
    await injectKimiGlobals(args);
    if (process.env.OMK_DEBUG === "1") {
      console.error("[OMK_DEBUG] chat args:", args);
    }

    const env = createOmkSessionEnv(root, sessionId);
    if (options.workers) {
      env.OMK_WORKERS = options.workers;
    }
    if (options.maxStepsPerTurn) {
      args.push("--max-steps-per-turn", options.maxStepsPerTurn);
    }

    env.OMK_RUN_ID = effectiveRunId;
    env.OMK_MODE = currentMode;

    let lastThinking = "";
    let exitCode = 0;
    let pendingOutput = ""; // buffer for chunk-boundary todo parsing

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
        onData: (data) => {
          // Lightweight activity sampling: extract short tool/thinking snippets
          const lines = data.split("\n");
          for (const raw of lines) {
            const line = raw.trim();
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
          pendingOutput += data;
          if (pendingOutput.length > 8192) {
            pendingOutput = pendingOutput.slice(-4096);
          }
          const newTodos = parseSetTodoListFromOutput(pendingOutput);
          if (newTodos && newTodos.length > 0) {
            scheduleTodoSync(newTodos);
          }
        },
      });
    } catch {
      exitCode = 1;
    } finally {
      clearInterval(heartbeat);
      flushTodoSync();
      if (pendingTodoSync) {
        pendingUpdates.add(pendingTodoSync);
      }
      await Promise.all(pendingUpdates);
      await finalizeChatState(effectiveRunId, exitCode === 0);
      // Update session.json
      try {
        const meta = await readSessionMeta(effectiveRunId).catch(() => null);
        const now = new Date().toISOString();
        if (meta) {
          meta.status = exitCode === 0 ? "completed" : "failed";
          meta.endedAt = now;
          meta.updatedAt = now;
          await writeSessionMeta(effectiveRunId, meta);
        } else {
          await writeSessionMeta(effectiveRunId, { runId: effectiveRunId, type: "chat", status: exitCode === 0 ? "completed" : "failed", startedAt: now, updatedAt: now, todoCount: 0, todoDoneCount: 0 });
        }
      } catch {
        // ignore session finalize failures
      }
      await printChatExitBanner({
        runId: effectiveRunId,
        sessionId,
        workers: options.workers,
        root,
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
  workers?: string;
  root: string;
}): Promise<void> {
  const { runId, sessionId, workers } = options;
  const { getOmkResourceSettings } = await import("../util/resource-profile.js");
  const resources = await getOmkResourceSettings();

  // Parallel discovery of MCP + skills
  const [mcpNames, skillNames] = await Promise.all([
    getActiveMcpNames(resources.mcpScope),
    getActiveSkillNames(resources.skillsScope),
  ]);

  const mcpText = mcpNames.length > 0 ? mcpNames.join(", ") : style.gray("none");
  const skillText = skillNames.length > 0 ? skillNames.join(", ") : style.gray("none");
  const workersText = workers ?? resources.maxWorkers.toString();

  const lines: string[] = [
    "",
    style.purpleBold("  🌸 Session Ended"),
    separator(50),
    label("Run ID", runId),
    label("Session", sessionId),
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
