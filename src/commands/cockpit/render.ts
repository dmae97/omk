/**
 * OMK Chat Cockpit — terminal rendering and layout.
 */

import { readFile, readdir, stat as fsStat } from "fs/promises";
import { getGitNumstat, getGitBranch } from "../../cockpit/git-numstat.js";
import { getLspStatus } from "../../cockpit/lsp-status.js";
import { renderRailView } from "../../cockpit/views/rail-view.js";
import {
  getProjectRootAsync,
  pathExists,
  getRunPath,
  getRunsDir,
} from "../../util/fs.js";
import {
  buildRunViewModel,
  parseRunStateResult,
  sanitizeForDisplay,
  type RunViewModel,
} from "../../util/run-view-model.js";
import {
  style,
  sanitizeTerminalText,
  getSystemUsage,
} from "../../util/theme.js";
import { renderMatrixRain } from "../../brand/matrix-rain.js";
import { BRAND_HEX, setBrandPaletteTheme } from "../../brand/palette.js";
import {
  getActiveBrandCockpitDetail,
  getActiveBrandCockpitSubtitle,
} from "../../brand/theme-compiled.js";
import {
  visibleTerminalWidth,
  truncateLine,
  padEndVisible,
  panel as layoutPanel,
  fitLines,
  sectionHeader,
} from "../../util/terminal-layout.js";
import { getKimiUsage } from "../../kimi/usage.js";
import { listRunCandidates } from "../hud.js";
import { loadTodos } from "../../util/todo-sync.js";
import { readSessionMeta, type SessionMeta } from "../../util/session.js";
import { readEvents, type TelemetryEvent } from "../../util/events-logger.js";
import type { RunState } from "../../contracts/orchestration.js";
import {
  type CockpitRenderOptions,
  type CockpitResourceSnapshot,
  type CockpitDeepSeekSnapshot,
  type CockpitDashboardSnapshot,
  PANEL_HORIZONTAL_OVERHEAD,
  withTimeout,
  truncateText,
  statusRank,
  formatElapsed,
  getCacheEntry,
  getGitChanges,
  getCockpitResources,
  getCockpitDeepSeekSnapshot,
  formatDeepSeekBalance,
  computeCockpitLayout,
} from "./utils.js";
import {
  buildCockpitSnapshot,
  buildRailModel,
  computeDeepSeekRunUsage,
  computeDeepSeekRequests,
} from "./telemetry.js";
import {
  getTerminalWidth,
  normalizeCockpitFrameHeight,
  DEFAULT_COCKPIT_HEIGHT,
} from "./update-loop.js";
import {
  renderWorkingHud,
  renderSweepRule,
  type WorkingState,
} from "../../ui/omk-working-sweep.js";
import { sliceFromBottom } from "./scroll.js";
import { renderOmkSparkleText } from "../../ui/omk-sigil.js";

function renderCockpitPanel(lines: string[], innerWidth: number): string {
  const safeInnerWidth = Math.max(1, innerWidth);
  const horizontal = "━".repeat(safeInnerWidth + 2);
  const top = style.darkPurple(`┏${horizontal}┓`);
  const bottom = style.darkPurple(`┗${horizontal}┛`);
  const body = lines.map((line) =>
    style.darkPurple("┃ ") + padEndVisible(truncateLine(line, safeInnerWidth), safeInnerWidth) + style.darkPurple(" ┃")
  );
  return [top, ...body, bottom].join("\n");
}

function updateRendererScrollState(args: {
  renderer: NonNullable<CockpitRenderOptions["renderer"]>;
  width: number;
  frameHeight: number;
  bodyHeight: number;
  viewportHeight: number;
  lineCount: number;
  stickyTopRows: number;
  workingRows: number;
  composerRows: number;
}): void {
  const layout = computeCockpitLayout({
    cols: args.width,
    rows: args.frameHeight,
    rightRailPinned: false,
    composerHeight: Math.max(2, args.composerRows || 2),
    workingHeight: args.workingRows,
    composerLiftRows: 0,
  });

  const viewportHeight = Math.max(1, args.viewportHeight);
  const leftWidth = Math.max(1, args.width - PANEL_HORIZONTAL_OVERHEAD);
  const previousLineCount = args.renderer.lastLeftLineCount;
  const contentY = 2;
  const transcriptY = contentY + args.stickyTopRows;
  const workingY = transcriptY + viewportHeight;
  const composerY = workingY + args.workingRows;

  args.renderer.currentLayout = {
    ...layout,
    leftPane: {
      x: 1,
      y: contentY,
      w: leftWidth,
      h: Math.max(1, args.bodyHeight),
    },
    transcript: {
      x: 1,
      y: transcriptY,
      w: leftWidth,
      h: viewportHeight,
    },
    working: {
      x: 1,
      y: workingY,
      w: leftWidth,
      h: args.workingRows,
    },
    composer: {
      x: 1,
      y: composerY,
      w: leftWidth,
      h: args.composerRows,
    },
    rightRail: null,
    footer: {
      x: 1,
      y: Math.max(1, args.frameHeight - 1),
      w: args.width,
      h: 1,
    },
  };

  args.renderer.leftTranscriptLineCount = args.lineCount;
  args.renderer.leftTranscriptHeight = viewportHeight;
  args.renderer.lastLeftLineCount = args.lineCount;
  args.renderer.lastTranscriptHeight = viewportHeight;
  if (!args.renderer.followTail && args.lineCount > previousLineCount) {
    args.renderer.leftScrollFromBottom += args.lineCount - previousLineCount;
  }
  args.renderer.onLeftContentChanged();
}

function renderStickyComposer(text: string | undefined, width: number): string[] {
  if (text === undefined) return [];
  const safe = sanitizeTerminalText(text).replace(/\s+/g, " ").trim();
  const body = safe.length > 0 ? truncateText(safe, Math.max(1, width - 14)) : "ready";
  return [`${style.gray("composer")} ${style.cream("›")} ${style.cream(body)}`];
}

function todoMarker(statusValue: string): string {
  const normalized = statusValue.toLowerCase();
  switch (normalized) {
    case "running":
    case "in_progress": return style.purpleBold("▶");
    case "done":
    case "completed": return style.mintBold("✓");
    case "failed": return style.red("✕");
    case "blocked": return style.orange("■");
    case "skipped": return style.gray("⊘");
    default: return style.gray("□");
  }
}

function gitMarker(changeStatus: string): string {
  const normalized = changeStatus.replace(/\s/g, "");
  if (normalized === "??") return style.blue("?");
  if (normalized.includes("D")) return style.red("D");
  if (normalized.includes("A")) return style.mint("A");
  if (normalized.includes("R")) return style.purple("R");
  return style.orange("M");
}

function healthColor(health: CockpitDashboardSnapshot["pulse"]["health"]): (s: string) => string {
  switch (health) {
    case "ok": return style.mint;
    case "warn": return style.orange;
    case "blocked": return style.orange;
    case "failed": return style.red;
    default: return style.gray;
  }
}

function workerStateColor(state: "running" | "done" | "failed" | "blocked" | "skipped" | string): (s: string) => string {
  switch (state) {
    case "running": return style.purpleBold;
    case "done": return style.mint;
    case "failed": return style.red;
    case "blocked": return style.orange;
    case "skipped": return style.gray;
    default: return style.gray;
  }
}

function miniProgressBar(done: number, total: number, width = 8): string {
  if (total <= 0 || !Number.isFinite(total)) return style.gray("░".repeat(width));
  const safeDone = Number.isNaN(done) ? 0 : Math.min(Math.max(0, done), total);
  const filled = Math.round((safeDone / total) * width);
  const empty = Math.max(0, width - filled);
  return style.mint("█".repeat(filled)) + style.gray("░".repeat(empty));
}

function looksLikeSecret(value: string): boolean {
  if (/\b[a-f0-9]{16,}\b/i.test(value)) return true;
  if (/(?:https?:\/\/|@)[^/\s:]+:[^/\s@]+@/.test(value)) return true;
  if (/\bghp_[A-Za-z0-9]{36}\b/.test(value)) return true;
  if (/\brw_[A-Za-z0-9]+\b/.test(value)) return true;
  return false;
}

function redactResourceName(name: string): string {
  return looksLikeSecret(name) ? "***REDACTED***" : name;
}

function formatMcpHealth(resources: CockpitResourceSnapshot | null, maxWidth: number): string {
  if (!resources || resources.mcpServers.length === 0) {
    return `${style.gray("MCP")} ${style.gray("no servers")}`;
  }
  const ok = resources.mcpServers.filter((r) => r.status === "connected" || r.status == null).length;
  const degraded = resources.mcpServers.filter((r) => r.status === "connecting").length;
  const down = resources.mcpServers.filter((r) => r.status === "failed").length;
  const total = resources.mcpServers.length;
  const offenders = resources.mcpServers
    .filter((r) => r.status === "failed")
    .slice(0, 3)
    .map((r) => redactResourceName(r.name))
    .join(", ");
  const summary = `${style.gray("MCP")} ${style.mint("●")}${style.mintBold(String(ok))} ${style.orange("◐")}${style.orangeBold(String(degraded))} ${style.red("✕")}${style.redBold(String(down))} ${style.gray(`/${total}`)}`;
  const topOffenders = offenders ? ` ${style.gray("fail:")} ${style.red(offenders)}` : "";
  const result = summary + topOffenders;
  return visibleTerminalWidth(result) > maxWidth ? truncateLine(result, maxWidth) : result;
}

function formatEvidenceGate(vm: RunViewModel, snapshot: CockpitDashboardSnapshot, maxWidth: number): string[] {
  const workers = vm.workers ?? [];
  if (workers.length === 0) return [];
  const passed = workers.filter((w) => w.lastEvidence?.passed).length;
  const failed = snapshot.evidence.failedGates;
  const pending = workers.length - passed - failed;
  const lines: string[] = [];
  const tally = `${style.gray("evidence")} ${style.mint("✓")}${style.mintBold(String(passed))} ${style.red("✗")}${style.redBold(String(failed))} ${style.orange("◐")}${style.orangeBold(String(pending))} ${style.gray(`of ${workers.length}`)}`;
  lines.push(visibleTerminalWidth(tally) > maxWidth ? truncateLine(tally, maxWidth) : tally);
  if (snapshot.evidence.latestVerification) {
    const latest = `  ${style.gray("latest")} ${truncateText(sanitizeForDisplay(snapshot.evidence.latestVerification), Math.max(8, maxWidth - 12))}`;
    lines.push(latest);
  }
  return lines;
}

function buildTeamRuntimeLines(vm: RunViewModel, maxWidth: number): string[] {
  if (!vm.teamRuntime) return [];
  const team = vm.teamRuntime;
  const presentWindows = team.windows.filter((w) => w.status === "present").length;
  const missingWindows = team.windows.filter((w) => w.status === "missing").length;
  const lines: string[] = [];
  lines.push(`${style.pinkBold("Team Runtime")}`);
  lines.push(`  ${style.gray("session")} ${style.cream(team.session)} ${style.gray("status")} ${healthColor(missingWindows > 0 ? "warn" : "ok")(team.status)}`);
  lines.push(`  ${style.gray("windows")} ${style.mintBold(`${presentWindows}/${team.windows.length}`)} ${style.gray(`present · workers ${team.workerCount} · reviewer ${team.reviewerCount}`)}`);
  if (team.coordinatorPanes > 0) {
    lines.push(`  ${style.gray("coordinator panes")} ${style.mint(String(team.coordinatorPanes))}`);
  }
  if (missingWindows > 0) {
    lines.push(`  ${style.orange(`${missingWindows} expected window(s) missing`)}`);
  }
  return lines.map((l) => (visibleTerminalWidth(l) > maxWidth ? truncateLine(l, maxWidth) : l));
}

function formatRuntimeContract(contract: CockpitDashboardSnapshot["runtimeContract"], maxWidth: number): string {
  if (!contract) return `${style.gray("contract")} ${style.gray("--")}`;
  const base = `${style.gray("contract")} ` +
    `mcp:${style.mintBold(String(contract.mcpCount))} ` +
    `skills:${style.mintBold(String(contract.skillCount))} ` +
    `hooks:${style.mintBold(String(contract.hookCount))} ` +
    `${style.gray(`scope:${contract.scope}`)}`;
  const workerPart = contract.workerCap != null ? ` workers:${style.mintBold(String(contract.workerCap))}` : "";
  const stepsPart = contract.maxStepsPerTurn != null ? ` steps:${style.mintBold(String(contract.maxStepsPerTurn))}` : "";
  const gatesPart = contract.gateCount > 0 ? ` gates:${style.mintBold(String(contract.gateCount))}` : "";
  const result = base + workerPart + stepsPart + gatesPart;
  if (visibleTerminalWidth(result) > maxWidth) {
    return truncateLine(result, maxWidth);
  }
  return result;
}

function formatDeepSeekSummary(
  deepSeek: CockpitDeepSeekSnapshot | null,
  usage: CockpitDashboardSnapshot["deepSeekUsage"],
  requests: CockpitDashboardSnapshot["deepSeekRequests"],
  maxWidth: number
): string {
  if (!deepSeek) return `${style.gray("deepseek")} ${style.gray("checking")} use:${usage.attempts} fb:${usage.fallbackCount}`;
  const state = deepSeek.available
    ? style.mintBold("ok")
    : deepSeek.enabled && deepSeek.apiKeySet
      ? style.orange("warn")
      : style.gray("off");
  const balance = deepSeek ? formatDeepSeekBalance(deepSeek) : "n/a";
  const modelPart = formatDeepSeekModelUsage(usage);
  const reason = deepSeek.reason ? ` ${style.gray(truncateText(sanitizeForDisplay(deepSeek.reason), Math.max(8, maxWidth - 56)))}` : "";
  const running = requests.filter((r) => r.status === "running").length;
  const completed = requests.filter((r) => r.status === "completed").length;
  const failed = requests.filter((r) => r.status === "failed").length;
  const liveParts: string[] = [];
  if (running > 0) liveParts.push(`▶${running} running`);
  if (completed > 0) liveParts.push(`${completed} completed`);
  if (failed > 0) liveParts.push(`${failed} failed`);
  const livePart = liveParts.length > 0 ? ` ${liveParts.join(" · ")}` : "";
  return `${style.gray("DeepSeek")} ${state}${livePart} bal:${balance} use:${usage.attempts}${modelPart} ` +
    `d:${usage.directCount} a:${usage.advisoryCount} f:${usage.fallbackCount}${reason}`;
}

function formatDeepSeekModelUsage(usage: CockpitDashboardSnapshot["deepSeekUsage"]): string {
  const tiers = Object.entries(usage.byTier)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tier, count]) => `${tier}:${count}`);
  if (tiers.length > 0) return ` ${style.gray(tiers.join(","))}`;
  const models = Object.entries(usage.byModel)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 2)
    .map(([model, count]) => `${model.replace(/^deepseek-v4-/, "")}:${count}`);
  return models.length > 0 ? ` ${style.gray(models.join(","))}` : "";
}

function buildFooter(targetWidth: number, heightMode: string): string {
  if (targetWidth < 40) {
    return `[${style.gray("q")}]uit`;
  }
  if (targetWidth < 60) {
    return `[${style.gray("q")}]uit [${style.gray("sp")}]ause ${style.gray(`h:${heightMode}`)}`;
  }
  return `[${style.gray("h")}]istory [${style.gray("+")}/${style.gray("-")}]height [${style.gray("a")}]auto [${style.gray("space")}]pause [${style.gray("q")}]uit ${style.gray(`height:${heightMode}`)}`;
}

export async function renderCockpit(options: CockpitRenderOptions = {}) {
  const requestedBrandTheme = options.theme ?? process.env.OMK_THEME;
  if (requestedBrandTheme !== undefined) {
    setBrandPaletteTheme(requestedBrandTheme);
  }

  const width = getTerminalWidth(options.terminalWidth);
  const targetWidth = Math.max(1, width - PANEL_HORIZONTAL_OVERHEAD);
  const fixedFrameHeight = normalizeCockpitFrameHeight(options.height);
  const fixedBodyHeight = fixedFrameHeight != null ? Math.max(0, fixedFrameHeight - 2) : undefined;
  const root = await getProjectRootAsync();
  const now = Date.now();
  const cache = options.cache;
  const quick = options.quick ?? false;
  const showHistory = options.showHistory ?? true;
  const section = options.section ?? "all";
  const useEvents = options.events !== "off";

  const deepSeekPromise = options.deepSeekProvider
    ? options.deepSeekProvider()
    : quick
      ? Promise.resolve(cache?.deepSeek?.value ?? null)
      : (async () => {
          const cached = getCacheEntry(cache?.deepSeek, 60_000, now);
          if (cached !== undefined) return cached;
          const value = await getCockpitDeepSeekSnapshot().catch(() => null);
          if (cache) cache.deepSeek = { value, ts: now };
          return value;
        })();

  // ── Fetch git changes (cached) ──
  const gitChangesPromise = quick
    ? Promise.resolve(cache?.gitChanges?.value ?? [])
    : (async () => {
        const cached = getCacheEntry(cache?.gitChanges, 5000, now);
        if (cached !== undefined) return cached;
        const result = await getGitChanges(root);
        const value = result ?? [];
        if (cache) cache.gitChanges = { value, ts: now };
        return value;
      })();

  // ── Resolve latest run + state (always fast, uncached) ──
  const runsDir = getRunsDir();
  let latestRunName: string | null = options.runId ?? null;
  let stateContent: string | null = null;
  let sessionMeta: SessionMeta | null = null;

  const shouldLoadRunState = !quick || Boolean(latestRunName);
  if (shouldLoadRunState && await pathExists(runsDir)) {
    if (!latestRunName) {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      const stats = await Promise.all(
        dirs.map(async (d) => {
          const statePath = getRunPath(d.name, "state.json");
          const [hasState, s] = await Promise.all([
            pathExists(statePath),
            fsStat(statePath).catch(() => null),
          ]);
          if (!hasState) return null;
          return s ? { name: d.name, mtime: s.mtimeMs } : null;
        })
      );
      const best = stats
        .filter((s): s is { name: string; mtime: number } => s !== null)
        .sort((a, b) => b.mtime - a.mtime)[0];
      latestRunName = best?.name ?? null;
    }
    if (latestRunName) {
      const [sc, sm] = await Promise.all([
        withTimeout(readFile(getRunPath(latestRunName, "state.json"), "utf-8"), 10000).catch(() => null),
        withTimeout(readSessionMeta(latestRunName), 10000).catch(() => null),
      ]);
      stateContent = sc;
      sessionMeta = sm;
    }
  }

  const eventsPromise = (async () => {
    if (!latestRunName || !useEvents) return [] as TelemetryEvent[];
    const cached = getCacheEntry(cache?.events, 750, now);
    if (cached !== undefined) return cached;
    const value = await readEvents(getRunPath(latestRunName)).catch(() => [] as TelemetryEvent[]);
    if (cache) cache.events = { value, ts: now };
    return value;
  })();

  const resourcesPromise = options.resourceProvider
    ? options.resourceProvider()
    : quick
      ? Promise.resolve(cache?.resources?.value ?? null)
      : (async () => {
          const cached = getCacheEntry(cache?.resources, 30_000, now);
          if (cached !== undefined) return cached;
          const value = await getCockpitResources(root, latestRunName).catch(() => null);
          if (cache) cache.resources = { value, ts: now };
          return value;
        })();

  const gitChanges = (await gitChangesPromise) ?? [];
  const events = await eventsPromise;

  let vm = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let parsedState: RunState | null = null;

  if (stateContent) {
    const result = parseRunStateResult(stateContent);
    stateError = result.error;
    parsedState = result.state;
    vm = buildRunViewModel(parsedState, { changedFiles: gitChanges.map((c) => c.path), telemetry: events });
  }

  // ── Fetch todos (cached) ──
  const todosPromise = (async () => {
    if (!latestRunName) return null;
    const cached = getCacheEntry(cache?.stateTodos, 750, now);
    if (cached !== undefined) return cached;
    const value = await loadTodos(latestRunName).catch(() => null);
    if (cache) cache.stateTodos = { value, ts: now };
    return value;
  })();

  // ── Fetch Kimi usage (cached) ──
  const primaryPromise = quick
    ? Promise.resolve(cache?.primaryUsage?.value ?? null)
    : (async () => {
        const cached = getCacheEntry(cache?.primaryUsage, 60000, now);
        if (cached !== undefined) return cached;
        try {
          const value = await getKimiUsage();
          if (cache) cache.primaryUsage = { value, ts: now };
          return value;
        } catch {
          return null;
        }
      })();

  const [todos, primaryUsage, resources, deepSeek] = await Promise.all([
    todosPromise,
    primaryPromise,
    resourcesPromise,
    deepSeekPromise,
  ]);
  const deepSeekUsage = computeDeepSeekRunUsage(parsedState);
  const deepSeekRequests = computeDeepSeekRequests(events);

  // ── System usage (cached) ──
  let sysUsage: ReturnType<typeof getSystemUsage> | null = null;
  if (!quick) {
    const cached = getCacheEntry(cache?.systemUsage, 3000, now);
    if (cached !== undefined) {
      sysUsage = cached;
    } else {
      try {
        sysUsage = getSystemUsage();
        if (cache) cache.systemUsage = { value: sysUsage, ts: now };
      } catch { /* ignore */ }
    }
  } else {
    sysUsage = cache?.systemUsage?.value ?? null;
  }

  // ── Normalize into snapshot ──
  const snapshot = await buildCockpitSnapshot(
    vm,
    todos,
    primaryUsage,
    resources,
    deepSeek,
    deepSeekUsage,
    deepSeekRequests,
    sysUsage,
    gitChanges,
    sessionMeta,
    stateError,
    latestRunName
  );

  // ── View branch ──
  const view = options.view ?? "panel";
  if (view === "rail") {
    const [numstat, branch, lspEntries] = await Promise.all([
      getGitNumstat(root),
      getGitBranch(root),
      getLspStatus(root),
    ]);
    const railModel = buildRailModel(snapshot, numstat, lspEntries, branch, root, primaryUsage);
    const railWidth = Math.max(28, Math.min(options.terminalWidth ?? 36, 56));
    return renderRailView(railModel, { width: railWidth, height: options.height });
  }
  if (view === "json") {
    return JSON.stringify(snapshot, null, 2);
  }

  // ── Build sections as separate arrays ──
  const animFrame = options.animFrame ?? 0;

  // Header (Green Rain signal + OMK control title)
  const rainWidth = Math.min(targetWidth, 60);
  const rain = renderMatrixRain(latestRunName ?? "omk", rainWidth, 3);
  const rainLines = process.stdout.isTTY
    ? rain.split("\n").map((l: string) => style.phosphor(l))
    : [];
  const headerLines: string[] = [
    "",
    ...rainLines,
    renderOmkSparkleText("◢█ OMK//CONTROL COCKPIT · ROOT ORCHESTRATOR █◣", {
      frame: animFrame,
      colors: [BRAND_HEX.cyan, BRAND_HEX.sparkleWhite, BRAND_HEX.sparkleGold, BRAND_HEX.magenta, BRAND_HEX.mint],
    }),
    style.gray(getActiveBrandCockpitSubtitle()),
    style.gray(getActiveBrandCockpitDetail()),
    "",
  ];

  // ── Sweep animation line ──
  let sweepLine = "";
  if (animFrame > 0 || process.env.OMK_ANIM !== "0") {
    const activeNode = vm.activeNode;
    const sweepState: WorkingState = activeNode
      ? {
          kind: vm.progress.running > 0 ? "loop" : "idle",
          label: activeNode.role || "working",
          detail: activeNode.thinking || activeNode.name || "running",
          startedAtMs: Date.now(),
        }
      : {
          kind: "idle",
          label: "idle",
          detail: "waiting for instruction",
          startedAtMs: Date.now(),
        };
    const sweepHud = renderWorkingHud({
      state: sweepState,
      frame: animFrame,
      width: Math.max(24, targetWidth),
      compact: false,
    });
    sweepLine = sweepHud;
  }

  // Info section — compact priority-ordered lines
  const infoLines: string[] = [];

  const displayRunId = latestRunName ?? "--";
  const healthStr = vm.health.toUpperCase();
  const progressStr = `${vm.progress.settled}/${vm.progress.total}`;
  infoLines.push(
    `${style.gray("run")} ${style.creamBold(truncateText(displayRunId, targetWidth - 6))}`
  );

  if (primaryUsage) {
    const account = primaryUsage.oauth.loggedIn ? primaryUsage.oauth.displayId : "/login";
    const fiveHourPercent =
      primaryUsage.quota.fiveHour?.remainingPercent != null
        ? Math.min(100, Math.max(0, 100 - primaryUsage.quota.fiveHour.remainingPercent))
        : null;
    const weeklyPercent =
      primaryUsage.quota.weekly?.remainingPercent != null
        ? Math.min(100, Math.max(0, 100 - primaryUsage.quota.weekly.remainingPercent))
        : null;
    const fiveHour =
      fiveHourPercent != null
        ? `${fiveHourPercent}%`
        : `${Math.round(primaryUsage.totalSecondsLast5Hours / 60)}m`;
    const weekly =
      weeklyPercent != null
        ? `${weeklyPercent}%`
        : `${Math.round(primaryUsage.totalSecondsWeek / 60)}m`;
    const sysPart = sysUsage
      ? `${style.gray("sys")} ${style.gray("cpu")}${style.mintBold(`${sysUsage.cpuPercent}%`)} ${style.gray("mem")}${style.mintBold(`${sysUsage.memPercent}%`)}`
      : "";
    infoLines.push(
      `${style.gray("primary")} ${truncateText(account, 16)} 5h:${fiveHour} wk:${weekly}  ${sysPart}`.trimEnd()
    );
  } else {
    const sysPart = sysUsage
      ? `${style.gray("sys")} ${style.gray("cpu")}${style.mintBold(`${sysUsage.cpuPercent}%`)} ${style.gray("mem")}${style.mintBold(`${sysUsage.memPercent}%`)}`
      : `${style.gray("sys")} ${style.gray("--")}`;
    infoLines.push(`${style.gray("primary")} ${style.gray("unavailable")}  ${sysPart}`.trimEnd());
  }

  infoLines.push(formatDeepSeekSummary(deepSeek, deepSeekUsage, snapshot.deepSeekRequests, targetWidth));
  const mcpLines: string[] = [];
  mcpLines.push(formatMcpHealth(resources, targetWidth));
  if (snapshot.runtimeContract) {
    mcpLines.push(formatRuntimeContract(snapshot.runtimeContract, targetWidth));
  }

  const evidenceLines = formatEvidenceGate(vm, snapshot, targetWidth);

  const goalLineParts: string[] = [];
  if (sessionMeta?.type === "chat") {
    goalLineParts.push(`${style.gray("type")} ${style.purpleBold("💬 Chat")}`);
  }
  if (vm.goalTitle) {
    const scoreBadge = vm.goalScore != null ? style.creamBold(` ${vm.goalScore}%`) : "";
    goalLineParts.push(`${style.gray("goal")} ${truncateText(vm.goalTitle, targetWidth - 10 - sanitizeTerminalText(scoreBadge).length)}${scoreBadge}`);
  }
  if (vm.startedAt) {
    const startedMs = Date.parse(vm.startedAt);
    if (!Number.isNaN(startedMs)) {
      const duration = formatElapsed(Date.now() - startedMs);
      goalLineParts.push(`${style.gray("dur")} ${style.gray(duration)}`);
    }
  }
  if (goalLineParts.length > 0) {
    infoLines.push(goalLineParts.join("  "));
  }

  const statusParts: string[] = [];
  statusParts.push(`${style.gray("health")} ${healthColor(vm.health)(healthStr)}`);
  statusParts.push(`${style.gray("progress")} ${style.mintBold(progressStr)} ${style.gray(`settled, ${vm.progress.running} active`)}`);
  if (vm.activeNode) {
    const activeName = truncateText(vm.activeNode.name, targetWidth - 20);
    statusParts.push(`${style.gray("active")} ${style.purpleBold("▶")} ${activeName}`);
  }
  if (statusParts.length > 0) {
    infoLines.push(statusParts.join("  "));
  }

  const extraParts: string[] = [];
  if (vm.nextAction && vm.nextAction !== "Run complete" && vm.nextAction !== "Ready") {
    extraParts.push(`${style.gray("next")} ${style.cream(truncateText(vm.nextAction, targetWidth - 8))}`);
  }
  if (vm.eta) {
    const confBadge = vm.etaConfidence ? style.gray(` (${vm.etaConfidence})`) : "";
    extraParts.push(`${style.gray("ETA")} ${style.cream(vm.eta)}${confBadge}`);
  }
  if (vm.blocker) {
    const blockerText = truncateText(`${vm.blocker.reason} (${vm.blocker.nodeId})`, targetWidth - 12);
    extraParts.push(`${style.gray("blocker")} ${style.red("■")} ${blockerText}`);
  }
  if (extraParts.length > 0) {
    infoLines.push(extraParts.join("  "));
  }

  const selectedRuntime = (snapshot.pulse as Record<string, unknown>).selectedRuntime;
  if (selectedRuntime) {
    infoLines.push(`${style.gray("runtime")} ${style.creamBold(String(selectedRuntime))}`);
  }

  // ── Worker / TODO section ──
  const workerLines: string[] = [];
  const teamRuntimeLines = buildTeamRuntimeLines(vm, targetWidth);
  if (teamRuntimeLines.length > 0) {
    workerLines.push(...teamRuntimeLines, "");
  }
  const sortedNodes = [...(vm.workers ?? [])].sort((a, b) => {
    const rank = statusRank(a.state) - statusRank(b.state);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });

  const sortedTodos = todos
    ? [...todos].sort((a, b) => statusRank(a.status) - statusRank(b.status))
    : null;
  const chatPrefix = sessionMeta?.type === "chat" ? "💬 " : "";
  if (sortedTodos) {
    const doneCount = sortedTodos.filter((t) => t.status === "done").length;
    const totalCount = sortedTodos.length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    workerLines.push(
      `${sectionHeader(`${chatPrefix}TODO`)} ${miniProgressBar(doneCount, totalCount)} ${style.creamBold(`${pct}%`)} ` +
        `${style.gray(`(${doneCount}/${totalCount})`)}`
    );

    if (sortedTodos.length === 0) {
      workerLines.push(`  ${style.gray("TODO 없음")}`);
    } else {
      for (const todo of sortedTodos.slice(0, 6)) {
        const marker = todoMarker(todo.status);
        const elapsed = todo.elapsedMs ? style.gray(formatElapsed(todo.elapsedMs)) : "";
        const agentBadge = todo.agent ? style.gray(`[${truncateText(sanitizeForDisplay(todo.agent), 8)}]`) : "";
        const idleBadge = todo.agent === "chat" && todo.status === "in_progress"
          ? style.gray("idle / waiting for input")
          : "";
        const base = `${marker} ${agentBadge} ${truncateText(sanitizeForDisplay(todo.title), targetWidth - 14)} ${idleBadge} ${elapsed}`.replace(/\s+/g, " ").trim();
        workerLines.push(`  ${base}`);
      }
      if (sortedTodos.length > 6) {
        workerLines.push(`  ${style.gray(`… ${sortedTodos.length} total`)}`);
      }
    }
  } else {
    workerLines.push(`${sectionHeader(`${chatPrefix}TODO`)} ${style.gray("not recorded")}`);
  }

  if (todos && todos.length > 0) {
    workerLines.push("");
  }

  if (sortedNodes.length > 0) {
    const { done, total, running, failed, blocked, skipped, settled } = vm.progress;
    const pct = total > 0 ? Math.round((settled / total) * 100) : 0;
    workerLines.push(
      `${sectionHeader("AGENTS")} ${miniProgressBar(settled, total)} ${style.creamBold(`${pct}%`)} ` +
        `${style.gray(`(${running}▶ ${done}✓ ${failed}✕ ${blocked}■ ${skipped}⊘ / ${total})`)}`
    );

    for (const node of sortedNodes) {
      const stateLabel = workerStateColor(node.state)(node.state.toUpperCase());
      const liveBadge = node.liveStatus && node.liveStatus !== node.state
        ? style.gray(` ${node.liveStatus}`)
        : "";
      const elapsed = formatElapsed(node.elapsedMs);
      const nodeRuntime = (node as { selectedRuntime?: string }).selectedRuntime;
      const runtimeBadge = nodeRuntime ? style.gray(`[${truncateText(nodeRuntime, 12)}]`) : "";
      const base = `${stateLabel}${liveBadge} ${style.gray(elapsed)} ${truncateText(sanitizeForDisplay(node.label || node.id), targetWidth - 22)}${runtimeBadge ? " " + runtimeBadge : ""}`;

      if (node.state === "running") {
        const isChatInputWait = node.liveStatus === "waiting-input" || (node.id === "chat" && !node.phase && !node.thinking);
        workerLines.push(`  ${base}`);
        if (isChatInputWait) {
          workerLines.push(`    ${style.gray("→")} ${style.gray("idle / waiting for input")}`);
        } else if (node.phase) {
          const cleanPhase = sanitizeTerminalText(sanitizeForDisplay(node.phase));
          workerLines.push(`    ${style.gray("→")} ${truncateText(cleanPhase, targetWidth - 8)}`);
        } else if (node.currentNode) {
          const cleanNode = sanitizeTerminalText(sanitizeForDisplay(node.currentNode));
          workerLines.push(`    ${style.gray("→")} ${truncateText(cleanNode, targetWidth - 8)}`);
        }
        if (!isChatInputWait && node.liveStatus === "stalled") {
          const staleText = `stalled ${formatElapsed(node.lastHeartbeatAgeMs ?? node.lastActivityAgeMs ?? 0)}`;
          workerLines.push(`    ${style.orange("⚠")} ${style.orange(staleText)}`);
        } else if (!isChatInputWait && node.lastActivityAgeMs != null && node.lastActivityAgeMs > 30_000) {
          const staleText = `silent ${formatElapsed(node.lastActivityAgeMs)}`;
          workerLines.push(`    ${style.orange("⚠")} ${style.orange(staleText)}`);
        }
      } else if ((node.state === "failed" || node.state === "blocked") && node.lastEvidence) {
        const evidence = truncateText(sanitizeForDisplay(node.lastEvidence.message || node.lastEvidence.gate), targetWidth - 10);
        const retryBadge = node.retryCount > 0 ? style.orange(` [retry ${node.retryCount}]`) : "";
        workerLines.push(`  ${base}${retryBadge}`);
        workerLines.push(`    ${style.red("→")} ${evidence}`);
      } else {
        workerLines.push(`  ${base}`);
      }
    }

    if (sortedNodes.length > 0) {
      workerLines.push(`  ${style.gray(`\u2026 ${sortedNodes.length} total`)}`);
    }
  }

  if (sortedNodes.length === 0) {
    workerLines.push("", `${sectionHeader("AGENTS")} ${style.gray("No parallel agents active — waiting for work")}`);
  }

  // ── Changed / History / State section ──
  const changedLines: string[] = [];

  if (stateError !== "ok") {
    changedLines.push(`${style.orangeBold("⚠ state")} ${style.orange(stateError)}`);
    const isChatRun = (latestRunName ?? "").startsWith("chat-");
    const recovery =
      stateError === "missing"
        ? isChatRun
          ? `omk chat --run-id ${latestRunName ?? "<id>"}`
          : `omk run --run-id ${latestRunName ?? "<id>"}`
        : stateError === "corrupt"
          ? `omk run --run-id ${latestRunName ?? "<run-id>"}`
          : `omk verify --run ${latestRunName ?? "<run-id>"}`;
    changedLines.push(`${style.gray("hint:")} ${style.cream(sanitizeForDisplay(recovery))}`);
  }

  if (gitChanges.length > 0) {
    const counts = snapshot.worktree.counts;
    const countParts = [
      counts.M > 0 ? `M:${counts.M}` : "",
      counts.A > 0 ? `A:${counts.A}` : "",
      counts.D > 0 ? `D:${counts.D}` : "",
      counts["?"] > 0 ? `?:${counts["?"]}` : "",
      counts.R > 0 ? `R:${counts.R}` : "",
    ].filter(Boolean);
    const countStr = countParts.join(" ");
    changedLines.push(sectionHeader(`Changed (${gitChanges.length})`) + (countStr ? ` ${style.gray(countStr)}` : ""));

    const maxPaths = targetWidth >= 80 && fixedBodyHeight != null && fixedBodyHeight > 24 ? 8 : 5;
    for (const path of snapshot.worktree.topPaths.slice(0, maxPaths)) {
      const change = gitChanges.find((c) => c.path === path);
      if (change) {
        changedLines.push(`  ${gitMarker(change.status)} ${truncateText(sanitizeForDisplay(change.path), targetWidth - 6)}`);
      }
    }
    if (gitChanges.length > maxPaths) {
      changedLines.push(`  ${style.gray(`\u2026 ${gitChanges.length} total`)}`);
    }
  } else if (stateError === "ok") {
    changedLines.push(style.mint("✓ clean worktree"));
  }

  if (!quick && showHistory && stateError === "ok") {
    const cached = getCacheEntry(cache?.history, 10000, now);
    let historyLines: string[] = [];
    if (cached !== undefined) {
      historyLines = cached;
    } else {
      try {
        if (await pathExists(runsDir)) {
          const candidates = await listRunCandidates(runsDir);
          const sorted = candidates
            .filter((c) => c.name !== latestRunName)
            .sort((a, b) => b.stateUpdatedAtMs - a.stateUpdatedAtMs)
            .slice(0, 5);
          if (sorted.length > 0) {
            historyLines = await Promise.all(
              sorted.map(async (c) => {
                let st = style.gray("?");
                try {
                  const raw = await withTimeout(readFile(getRunPath(c.name, "state.json"), "utf-8"), 10000);
                  const parsed = parseRunStateResult(raw);
                  if (parsed.state) {
                    const stateVm = buildRunViewModel(parsed.state);
                    if (stateVm.health === "ok" && stateVm.progress.settled === stateVm.progress.total && stateVm.progress.total > 0) {
                      st = style.mint("✓");
                    } else if (stateVm.health === "failed") {
                      st = style.red("✕");
                    } else if (stateVm.health === "blocked") {
                      st = style.orange("■");
                    } else if (stateVm.progress.running > 0) {
                      st = style.purple("▶");
                    } else {
                      st = style.gray("?");
                    }
                  }
                } catch { /* ignore */ }
                let goalTitle = "";
                try {
                  const goalRaw = await withTimeout(readFile(getRunPath(c.name, "goal.md"), "utf-8"), 10000);
                  const firstLine = goalRaw.split(/\r?\n/)[0]?.trim() ?? "";
                  goalTitle = firstLine.replace(/^#+\s*/, "").slice(0, 24);
                } catch { /* ignore */ }
                const date = new Date(c.stateUpdatedAtMs);
                const dateStr = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
                const name = truncateText(c.name, targetWidth - 20);
                const titlePart = goalTitle ? style.gray(`  → ${goalTitle}`) : "";
                return `  ${st} ${name} ${style.gray(dateStr)}${titlePart}`;
              })
            );
          }
        }
      } catch { /* ignore */ }
      if (cache) cache.history = { value: historyLines, ts: now };
    }

    if (historyLines.length > 0) {
      changedLines.push(sectionHeader("History"));
      changedLines.push(...historyLines);
    }
  }

  // ── Assemble responsive rectangle ──
  const heightMode = options.height == null || fixedFrameHeight == null ? "auto" : `${fixedFrameHeight}`;
  const footerLine = buildFooter(targetWidth, heightMode);
  const agentHeaderIndex = workerLines.findIndex((line) => sanitizeTerminalText(line).includes("AGENTS"));
  const selectedWorkerLines = section === "todos"
    ? (agentHeaderIndex >= 0 ? workerLines.slice(0, agentHeaderIndex).filter((line) => line.trim() !== "") : workerLines)
    : section === "agents"
      ? (agentHeaderIndex >= 0 ? workerLines.slice(agentHeaderIndex) : workerLines)
      : section === "mcp"
        ? []
        : workerLines;
  const selectedInfoLines = section === "all" ? infoLines : [];
  const selectedMcpLines = section === "all" || section === "mcp"
    ? (resources ? mcpLines : mcpLines.slice(1))
    : [];
  const selectedEvidenceLines = section === "all" ? evidenceLines : [];
  const selectedChangedLines = section === "all" ? changedLines : [];

  const activePanels: Array<{ title: string; lines: string[]; key: string }> = [];
  if (selectedInfoLines.length > 0) activePanels.push({ title: "Run", lines: selectedInfoLines, key: "info" });
  if (selectedMcpLines.length > 0) activePanels.push({ title: "Resources", lines: selectedMcpLines, key: "mcp" });
  if (selectedEvidenceLines.length > 0) activePanels.push({ title: "Evidence", lines: selectedEvidenceLines, key: "evidence" });
  if (selectedWorkerLines.length > 0) activePanels.push({ title: "Workers & TODO", lines: selectedWorkerLines, key: "worker" });
  if (selectedChangedLines.length > 0) activePanels.push({ title: "Changes & History", lines: selectedChangedLines, key: "changed" });

  const stickyHeaderLines = [...headerLines];
  const stickyWorkingLines = sweepLine ? [sweepLine, renderSweepRule(targetWidth, animFrame + 7)] : [];
  const stickyComposerLines = renderStickyComposer(options.composerText, targetWidth);
  const transcriptLines = activePanels.flatMap((p) => layoutPanel(p.title, p.lines, targetWidth).split("\n"));
  const scrollableLeftLines = transcriptLines;
  const fullLeftLines = [
    ...stickyHeaderLines,
    ...scrollableLeftLines,
    ...stickyWorkingLines,
    ...stickyComposerLines,
    footerLine,
  ];

  const renderer = options.renderer;
  let body: string[];

  if (renderer) {
    const bodyHeight = fixedBodyHeight ?? DEFAULT_COCKPIT_HEIGHT - 2;
    const frameHeight = fixedFrameHeight ?? bodyHeight + 2;
    const stickyBottomLines = [
      ...stickyWorkingLines,
      ...stickyComposerLines,
      footerLine,
    ];
    const viewportHeight = Math.max(1, bodyHeight - stickyHeaderLines.length - stickyBottomLines.length);

    updateRendererScrollState({
      renderer,
      width,
      frameHeight,
      bodyHeight,
      viewportHeight,
      lineCount: transcriptLines.length,
      stickyTopRows: stickyHeaderLines.length,
      workingRows: stickyWorkingLines.length,
      composerRows: stickyComposerLines.length,
    });

    body = [
      ...stickyHeaderLines,
      ...sliceFromBottom({
        lines: transcriptLines,
        viewportHeight,
        scrollFromBottom: renderer.leftScrollFromBottom,
      }),
      ...stickyBottomLines,
    ];

    // Pad the body to the target height in a single splice. The previous
    // per-iteration `body.splice(h, 0, "")` loop was O(n^2): each insertion
    // shifted the entire tail. Inserting N empty strings at the same index in
    // one call yields a byte-identical array (same elements, same order).
    if (body.length < bodyHeight) {
      const padCount = bodyHeight - body.length;
      body.splice(stickyHeaderLines.length, 0, ...Array<string>(padCount).fill(""));
    }
    if (body.length > bodyHeight) body.length = bodyHeight;
  } else if (fixedBodyHeight != null) {
    const headerRows = headerLines.length + (sweepLine ? 2 : 0);
    const footerRows = 1;
    const panelOverheadRows = activePanels.length * 2;
    const available = Math.max(0, fixedBodyHeight - headerRows - footerRows - panelOverheadRows);

    // Priority-based budget: critical info > resources > evidence > active agents/TODO > changed/history
    const infoMin = Math.min(selectedInfoLines.length, 3);
    const workerMin = Math.min(selectedWorkerLines.length, section === "all" ? 5 : 8);
    const mcpMin = Math.min(selectedMcpLines.length, 1);
    const evidenceMin = Math.min(selectedEvidenceLines.length, 1);
    const changedMin = Math.min(selectedChangedLines.length, 1);

    let infoBudget = infoMin;
    let workerBudget = workerMin;
    let mcpBudget = mcpMin;
    let evidenceBudget = evidenceMin;
    let changedBudget = changedMin;

    let remaining = available - (infoBudget + workerBudget + mcpBudget + evidenceBudget + changedBudget);

    if (remaining < 0) {
      // Emergency shrink from lowest priority upward, preserving a compact row when possible.
      changedBudget = Math.max(0, changedBudget + remaining);
      remaining = available - (infoBudget + workerBudget + mcpBudget + evidenceBudget + changedBudget);
      if (remaining < 0) {
        workerBudget = Math.max(0, workerBudget + remaining);
        remaining = available - (infoBudget + workerBudget + mcpBudget + evidenceBudget + changedBudget);
        if (remaining < 0) {
          evidenceBudget = Math.max(0, evidenceBudget + remaining);
          remaining = available - (infoBudget + workerBudget + mcpBudget + evidenceBudget + changedBudget);
          if (remaining < 0) {
            infoBudget = Math.max(selectedInfoLines.length > 0 ? 1 : 0, infoBudget + remaining);
            remaining = available - (infoBudget + workerBudget + mcpBudget + evidenceBudget + changedBudget);
            if (remaining < 0) {
              mcpBudget = Math.max(0, mcpBudget + remaining);
              remaining = 0;
            }
          }
        }
      }
    }

    // Distribute surplus to higher priorities
    if (remaining > 0) {
      const extraInfo = Math.min(remaining, selectedInfoLines.length - infoBudget);
      infoBudget += extraInfo;
      remaining -= extraInfo;
    }
    if (remaining > 0) {
      const extraWorker = Math.min(remaining, selectedWorkerLines.length - workerBudget);
      workerBudget += extraWorker;
      remaining -= extraWorker;
    }
    if (remaining > 0) {
      const extraMcp = Math.min(remaining, selectedMcpLines.length - mcpBudget);
      mcpBudget += extraMcp;
      remaining -= extraMcp;
    }
    if (remaining > 0) {
      const extraEvidence = Math.min(remaining, selectedEvidenceLines.length - evidenceBudget);
      evidenceBudget += extraEvidence;
      remaining -= extraEvidence;
    }
    if (remaining > 0) {
      changedBudget += remaining;
    }

    const panelContents = activePanels
      .map((p) => {
        const budget = p.key === "info" ? infoBudget
          : p.key === "worker" ? workerBudget
          : p.key === "mcp" ? mcpBudget
          : p.key === "evidence" ? evidenceBudget
          : changedBudget;
        return { title: p.title, lines: fitLines(p.lines, budget) };
      })
      .filter((p) => p.lines.length > 0);

    body = [
      ...headerLines,
      ...(sweepLine ? [sweepLine, renderSweepRule(targetWidth, animFrame + 7)] : []),
      ...panelContents.flatMap((p) => layoutPanel(p.title, p.lines, targetWidth).split("\n")),
      footerLine,
    ];

    while (body.length < fixedBodyHeight) body.push("");
    if (body.length > fixedBodyHeight) body.length = fixedBodyHeight;
  } else {
    body = [...fullLeftLines];

    const minimumBodyHeight = DEFAULT_COCKPIT_HEIGHT - 2;
    while (body.length < minimumBodyHeight) body.push("");
  }

  const content = body.map((l) => truncateLine(l, targetWidth));
  return renderCockpitPanel(content, targetWidth);
}
