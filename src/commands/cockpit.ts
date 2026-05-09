/**
 * OMK Chat Cockpit — compact read-only run-state sidecar.
 */

import { readFile, readdir, stat as fsStat } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { getProjectRoot, getUserHome, pathExists, getRunPath, getRunsDir } from "../util/fs.js";
import {
  buildRunViewModel,
  parseRunStateResult,
  type RunViewModel,
  type RunHealth,
  type RunViewModelWorker,
} from "../util/run-view-model.js";
import type { RunState } from "../contracts/orchestration.js";
import {
  style,
  gradient,
  separator,
  sanitizeTerminalText,
  getSystemUsage,
} from "../util/theme.js";
import { getKimiUsage } from "../kimi/usage.js";
import { parseGitStatusPorcelain, listRunCandidates } from "./hud.js";
import { readTodos, deriveTodosFromState } from "../util/todo-sync.js";
import { readSessionMeta, type SessionMeta } from "../util/session.js";
import { enableRawTerminalInput, restoreTerminalInputState, type TerminalInputState } from "../util/terminal-input.js";
import { checkDeepSeekBalance } from "../providers/deepseek/deepseek-balance.js";
import {
  getDeepSeekProviderStatus,
  resolveDeepSeekApiKey,
} from "../providers/deepseek/deepseek-config.js";
import { loadMergedMcpConfig } from "../orchestration/routing.js";

const execFileAsync = promisify(execFile);

export interface CockpitCommandOptions {
  runId?: string;
  watch?: boolean;
  refreshMs?: number;
  height?: number;
}

export interface CockpitRenderOptions {
  runId?: string;
  terminalWidth?: number;
  cache?: CockpitCache;
  quick?: boolean;
  showHistory?: boolean;
  height?: number;
  resourceProvider?: () => Promise<CockpitResourceSnapshot | null>;
  deepSeekProvider?: () => Promise<CockpitDeepSeekSnapshot | null>;
}

// ── Cache types ──

interface CacheEntry<T> {
  value: T;
  ts: number;
}

export interface CockpitCache {
  stateTodos?: CacheEntry<Awaited<ReturnType<typeof readTodos>> | null>;
  gitChanges?: CacheEntry<{ status: string; path: string }[] | null>;
  history?: CacheEntry<string[]>;
  kimiUsage?: CacheEntry<NonNullable<Awaited<ReturnType<typeof getKimiUsage>>> | null>;
  systemUsage?: CacheEntry<ReturnType<typeof getSystemUsage>>;
  resources?: CacheEntry<CockpitResourceSnapshot | null>;
  deepSeek?: CacheEntry<CockpitDeepSeekSnapshot | null>;
}

export interface CockpitResourceEntry {
  name: string;
  source: "project" | "global";
}

export interface CockpitResourceSnapshot {
  scope: "all";
  mcpServers: CockpitResourceEntry[];
  skills: CockpitResourceEntry[];
  hooks: CockpitResourceEntry[];
  checkedAt: number;
}

export interface CockpitDeepSeekBalanceLine {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
}

export interface CockpitDeepSeekSnapshot {
  enabled: boolean;
  apiKeySet: boolean;
  apiKeySource?: string;
  available: boolean;
  reason?: string;
  balances: CockpitDeepSeekBalanceLine[];
  checkedAt: number;
}

interface CockpitDeepSeekRunUsage {
  attempts: number;
  fallbackCount: number;
  directCount: number;
  advisoryCount: number;
  byModel: Record<string, number>;
  byTier: Record<string, number>;
}

// ── Local helpers ──

const ANSI_REGEX = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;
const PANEL_HORIZONTAL_OVERHEAD = 4;
const MIN_COCKPIT_FRAME_WIDTH = 20;
const MAX_COCKPIT_FRAME_WIDTH = 60;

/** Truncate visible text while preserving ANSI escape sequences. */
function truncateLine(line: string, maxWidth: number): string {
  const clean = sanitizeTerminalText(line);
  if (clean.length <= maxWidth) return line;

  let visibleCount = 0;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_REGEX.lastIndex = 0;
  while ((match = ANSI_REGEX.exec(line)) !== null) {
    const textBefore = line.slice(lastIndex, match.index);
    for (const char of textBefore) {
      if (visibleCount >= maxWidth - 1) {
        return result + style.gray("…");
      }
      result += char;
      visibleCount++;
    }
    result += match[0];
    lastIndex = ANSI_REGEX.lastIndex;
  }

  const remaining = line.slice(lastIndex);
  for (const char of remaining) {
    if (visibleCount >= maxWidth - 1) {
      return result + style.gray("…");
    }
    result += char;
    visibleCount++;
  }

  return result;
}

function truncateText(value: string, maxLength: number): string {
  const clean = sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
  if (maxLength <= 0) return "";
  const chars = [...clean];
  if (chars.length <= maxLength) return clean;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function padEndVisible(value: string, targetWidth: number): string {
  return value + " ".repeat(Math.max(0, targetWidth - sanitizeTerminalText(value).length));
}

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

function statusRank(statusValue: string): number {
  const normalized = statusValue.toLowerCase();
  switch (normalized) {
    case "running":
    case "in_progress": return 0;
    case "pending": return 1;
    case "blocked": return 2;
    case "failed": return 3;
    case "skipped": return 4;
    case "done":
    case "completed": return 5;
    default: return 6;
  }
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

function healthColor(health: RunHealth): (s: string) => string {
  switch (health) {
    case "ok": return style.mint;
    case "warn": return style.orange;
    case "blocked": return style.orange;
    case "failed": return style.red;
    default: return style.gray;
  }
}

async function getGitChanges(root: string): Promise<{ status: string; path: string }[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      { cwd: root, timeout: 5000, maxBuffer: 1024 * 1024, encoding: "utf-8" }
    );
    return parseGitStatusPorcelain(String(stdout));
  } catch {
    return null;
  }
}

function normalizeRefreshMs(refreshMs: number | undefined): number {
  if (refreshMs === undefined) return 2_000;
  if (!Number.isFinite(refreshMs)) return 2_000;
  return Math.min(60_000, Math.max(250, Math.round(refreshMs)));
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

function workerStateColor(state: RunViewModelWorker["state"]): (s: string) => string {
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

function formatResourceSummary(resources: CockpitResourceSnapshot | null, maxWidth: number): string {
  if (!resources) return `${style.gray("routes")} ${style.gray("mcp:? skills:? hooks:? all")}`;
  const sample = sampleNames([
    ...resources.mcpServers.slice(0, 2),
    ...resources.skills.slice(0, 2),
    ...resources.hooks.slice(0, 2),
  ], 3);
  const base = `${style.gray("routes")} ` +
    `mcp:${style.mintBold(String(resources.mcpServers.length))} ` +
    `skills:${style.mintBold(String(resources.skills.length))} ` +
    `hooks:${style.mintBold(String(resources.hooks.length))} ` +
    `${style.gray("scope:all")}`;
  return sample ? `${base} ${style.gray(truncateText(sample, maxWidth - 32))}` : base;
}

function formatDeepSeekSummary(
  deepSeek: CockpitDeepSeekSnapshot | null,
  usage: CockpitDeepSeekRunUsage,
  maxWidth: number
): string {
  if (!deepSeek) return `${style.gray("deepseek")} ${style.gray("checking")} use:${usage.attempts} fb:${usage.fallbackCount}`;
  const state = deepSeek.available
    ? style.mintBold("ok")
    : deepSeek.enabled && deepSeek.apiKeySet
      ? style.orange("warn")
      : style.gray("off");
  const balance = formatDeepSeekBalance(deepSeek);
  const modelPart = formatDeepSeekModelUsage(usage);
  const reason = deepSeek.reason ? ` ${style.gray(truncateText(deepSeek.reason, Math.max(8, maxWidth - 56)))}` : "";
  return `${style.gray("DeepSeek")} ${state} bal:${balance} use:${usage.attempts}${modelPart} ` +
    `d:${usage.directCount} a:${usage.advisoryCount} f:${usage.fallbackCount}${reason}`;
}

function sampleNames(entries: CockpitResourceEntry[], limit: number): string {
  const names = [...new Set(entries.map((entry) => entry.name))].slice(0, limit);
  return names.length > 0 ? `[${names.join(",")}]` : "";
}

function formatDeepSeekBalance(snapshot: CockpitDeepSeekSnapshot): string {
  if (!snapshot.apiKeySet) return "key-missing";
  if (snapshot.balances.length === 0) return snapshot.available ? "unknown" : "n/a";
  return snapshot.balances
    .slice(0, 2)
    .map((balance) => `${balance.currency} ${formatBalanceValue(balance.total)}`)
    .join(",");
}

function formatDeepSeekModelUsage(usage: CockpitDeepSeekRunUsage): string {
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

function formatBalanceValue(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return truncateText(value, 10);
  return parsed.toFixed(parsed >= 100 ? 0 : 2);
}

function clearScreen(): void {
  // Clear screen + move cursor home, but PRESERVE scrollback so users can scroll up
  // to see previous code edits and output history.
  process.stdout.write("\x1b[2J\x1b[H");
}

// ── Cache helpers ──

function getCacheEntry<T>(entry: CacheEntry<T> | undefined, ttlMs: number, now: number): T | undefined {
  if (!entry) return undefined;
  if (now - entry.ts > ttlMs) return undefined;
  return entry.value;
}

async function getCockpitResources(root = getProjectRoot()): Promise<CockpitResourceSnapshot> {
  const [mcp, skills, hooks] = await Promise.all([
    loadMergedMcpConfig(root, "all").catch(() => ({ servers: {}, sources: new Map<string, "project" | "global">() })),
    collectSkillEntries(root),
    collectHookEntries(root),
  ]);
  return {
    scope: "all",
    mcpServers: Object.keys(mcp.servers)
      .map((name) => ({ name, source: mcp.sources.get(name) ?? "project" }))
      .sort(compareResourceEntries),
    skills,
    hooks,
    checkedAt: Date.now(),
  };
}

async function collectSkillEntries(root: string): Promise<CockpitResourceEntry[]> {
  return collectNamedDirs([
    { path: join(root, ".agents", "skills"), source: "project" },
    { path: join(root, ".kimi", "skills"), source: "project" },
    { path: join(root, ".omk", "skills"), source: "project" },
    { path: join(getUserHome(), ".codex", "skills"), source: "global" },
    { path: join(getUserHome(), ".agents", "skills"), source: "global" },
    { path: join(getUserHome(), ".kimi", "skills"), source: "global" },
  ], "SKILL.md");
}

async function collectHookEntries(root: string): Promise<CockpitResourceEntry[]> {
  return collectNamedFiles([
    { path: join(root, ".omk", "hooks"), source: "project" },
    { path: join(root, ".kimi", "hooks"), source: "project" },
    { path: join(getUserHome(), ".kimi", "hooks"), source: "global" },
    { path: join(getUserHome(), ".codex", "hooks"), source: "global" },
  ]);
}

async function collectNamedDirs(
  dirs: Array<{ path: string; source: CockpitResourceEntry["source"] }>,
  requiredFile: string
): Promise<CockpitResourceEntry[]> {
  const byName = new Map<string, CockpitResourceEntry>();
  for (const dir of dirs) {
    const entries = await readdir(dir.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!(await pathExists(join(dir.path, entry.name, requiredFile)))) continue;
      upsertResource(byName, { name: entry.name, source: dir.source });
    }
  }
  return [...byName.values()].sort(compareResourceEntries);
}

async function collectNamedFiles(
  dirs: Array<{ path: string; source: CockpitResourceEntry["source"] }>
): Promise<CockpitResourceEntry[]> {
  const byName = new Map<string, CockpitResourceEntry>();
  for (const dir of dirs) {
    const entries = await readdir(dir.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") || entry.name.endsWith(".sample")) continue;
      upsertResource(byName, { name: entry.name, source: dir.source });
    }
  }
  return [...byName.values()].sort(compareResourceEntries);
}

function upsertResource(byName: Map<string, CockpitResourceEntry>, entry: CockpitResourceEntry): void {
  const current = byName.get(entry.name);
  if (!current || (current.source === "global" && entry.source === "project")) {
    byName.set(entry.name, entry);
  }
}

function compareResourceEntries(a: CockpitResourceEntry, b: CockpitResourceEntry): number {
  const sourceRank = (a.source === "project" ? 0 : 1) - (b.source === "project" ? 0 : 1);
  return sourceRank || a.name.localeCompare(b.name);
}

async function getCockpitDeepSeekSnapshot(): Promise<CockpitDeepSeekSnapshot> {
  const [providerStatus, key] = await Promise.all([
    getDeepSeekProviderStatus(),
    resolveDeepSeekApiKey(),
  ]);
  const base = {
    enabled: providerStatus.enabled,
    apiKeySet: providerStatus.apiKeySet,
    apiKeySource: providerStatus.apiKeySource,
    checkedAt: Date.now(),
  };
  if (!providerStatus.enabled) {
    return {
      ...base,
      available: false,
      reason: providerStatus.disabledReason ?? "DeepSeek disabled",
      balances: [],
    };
  }
  if (!key.apiKey) {
    return {
      ...base,
      available: false,
      reason: `${key.apiKeyEnv} is not set`,
      balances: [],
    };
  }
  const balance = await checkDeepSeekBalance({ apiKey: key.apiKey, timeoutMs: 4_000 });
  return {
    ...base,
    available: balance.available,
    reason: balance.reason,
    balances: (balance.balance?.balance_infos ?? []).map((item) => ({
      currency: item.currency,
      total: item.total_balance,
      granted: item.granted_balance,
      toppedUp: item.topped_up_balance,
    })),
    checkedAt: balance.checkedAt,
  };
}

function computeDeepSeekRunUsage(state: RunState | null): CockpitDeepSeekRunUsage {
  const usage: CockpitDeepSeekRunUsage = {
    attempts: 0,
    fallbackCount: 0,
    directCount: 0,
    advisoryCount: 0,
    byModel: {},
    byTier: {},
  };
  for (const node of state?.nodes ?? []) {
    for (const attempt of node.attempts ?? []) {
      const usesDeepSeek =
        attempt.provider === "deepseek" ||
        attempt.requestedProvider === "deepseek" ||
        attempt.fallbackFrom === "deepseek";
      if (!usesDeepSeek) continue;
      usage.attempts += 1;
      if (attempt.fallbackFrom === "deepseek") usage.fallbackCount += 1;
      if (attempt.providerParticipation === "advisory") usage.advisoryCount += 1;
      if (attempt.providerParticipation === "direct" || attempt.provider === "deepseek") usage.directCount += 1;
      if (attempt.providerModel) {
        usage.byModel[attempt.providerModel] = (usage.byModel[attempt.providerModel] ?? 0) + 1;
      }
      if (attempt.providerModelTier) {
        usage.byTier[attempt.providerModelTier] = (usage.byTier[attempt.providerModelTier] ?? 0) + 1;
      }
    }
  }
  return usage;
}

// ── Renderer ──

export type RenderMode = "diff" | "full" | "append";

export class CockpitRenderer {
  private prevLines: string[] = [];
  mode: RenderMode = "diff";
  paused = false;
  refreshMs: number;
  showHistory = true;
  stopped = false;
  resized = false;
  height?: number;
  private keyHandler?: (chunk: Buffer) => void;
  private terminalInputState?: TerminalInputState;

  constructor(refreshMs: number, height?: number) {
    this.refreshMs = refreshMs;
    this.height = normalizeCockpitFrameHeight(height);
  }

  setupKeyboard(): void {
    if (!process.stdin.isTTY || this.keyHandler) return;
    this.terminalInputState = enableRawTerminalInput(process.stdin);
    this.keyHandler = (key: Buffer) => {
      const char = key.toString();
      if (char === "\u0003" || char === "q") {
        this.stopped = true;
      } else if (char === " ") {
        this.paused = !this.paused;
        this.resized = true; // force redraw to show pause state
      } else if (char === "r") {
        this.resized = true;
      } else if (char === "+") {
        this.height = Math.min(MAX_COCKPIT_HEIGHT, (this.height ?? DEFAULT_COCKPIT_HEIGHT) + 1);
        this.resized = true;
      } else if (char === "-") {
        this.height = Math.max(MIN_COCKPIT_HEIGHT, (this.height ?? DEFAULT_COCKPIT_HEIGHT) - 1);
        this.resized = true;
      } else if (char === "a") {
        this.height = undefined;
        this.resized = true;
      } else if (char === "f") {
        this.mode = this.mode === "diff" ? "full" : this.mode === "full" ? "append" : "diff";
        this.resized = true;
      } else if (char === "h") {
        this.showHistory = !this.showHistory;
        this.resized = true;
      }
    };
    process.stdin.on("data", this.keyHandler);
  }

  teardown(): void {
    if (this.keyHandler) {
      process.stdin.off("data", this.keyHandler);
      this.keyHandler = undefined;
      if (this.terminalInputState) {
        restoreTerminalInputState(process.stdin, this.terminalInputState);
        this.terminalInputState = undefined;
      }
    }
  }

  render(frame: string): void {
    const newLines = frame.split("\n");

    if (this.mode === "full") {
      clearScreen();
      process.stdout.write(frame + "\n");
      this.prevLines = [...newLines];
      return;
    }

    if (this.mode === "append") {
      process.stdout.write(frame + "\n");
      this.prevLines = [...newLines];
      return;
    }

    // diff mode
    const parts: string[] = ["\x1b[H"];
    const maxLen = Math.max(newLines.length, this.prevLines.length);

    for (let i = 0; i < maxLen; i++) {
      const newLine = newLines[i] ?? "";
      const oldLine = this.prevLines[i] ?? "";

      if (i < newLines.length) {
        if (newLine !== oldLine) {
          parts.push(newLine + "\x1b[K");
        }
      } else {
        // Extra old line to clear
        parts.push("\x1b[K");
      }

      if (i < maxLen - 1) {
        parts.push("\r\n");
      }
    }

    process.stdout.write(parts.join(""));
    this.prevLines = [...newLines];
  }

}

// ── Core rendering ──

function getTerminalWidth(requested?: number): number {
  if (requested != null && Number.isFinite(requested) && requested > 0) {
    return Math.max(MIN_COCKPIT_FRAME_WIDTH, Math.min(MAX_COCKPIT_FRAME_WIDTH, Math.floor(requested)));
  }
  const cols = process.stdout.columns;
  if (cols && cols > 0) {
    return Math.max(MIN_COCKPIT_FRAME_WIDTH, Math.min(MAX_COCKPIT_FRAME_WIDTH, Math.floor(cols)));
  }
  return 36;
}

const DEFAULT_COCKPIT_HEIGHT = 32;
const MIN_COCKPIT_HEIGHT = 14;
const MAX_COCKPIT_HEIGHT = 96;

function normalizeCockpitFrameHeight(height?: number): number | undefined {
  if (height == null || !Number.isFinite(height)) return undefined;
  return Math.max(MIN_COCKPIT_HEIGHT, Math.min(MAX_COCKPIT_HEIGHT, Math.floor(height)));
}

/** Ensure an array of lines exactly matches a target count (truncate or pad). */
function fitLines(lines: string[], count: number): string[] {
  const result = lines.slice(0, count);
  while (result.length < count) result.push("");
  return result;
}

export async function renderCockpit(options: CockpitRenderOptions = {}) {
  const width = getTerminalWidth(options.terminalWidth);
  const targetWidth = Math.max(1, width - PANEL_HORIZONTAL_OVERHEAD);
  const fixedFrameHeight = normalizeCockpitFrameHeight(options.height);
  const fixedBodyHeight = fixedFrameHeight != null ? fixedFrameHeight - 2 : undefined;
  const root = getProjectRoot();
  const now = Date.now();
  const cache = options.cache;
  const quick = options.quick ?? false;
  const showHistory = options.showHistory ?? true;

  const resourcesPromise = options.resourceProvider
    ? options.resourceProvider()
    : quick
      ? Promise.resolve(cache?.resources?.value ?? null)
      : (async () => {
          const cached = getCacheEntry(cache?.resources, 30_000, now);
          if (cached !== undefined) return cached;
          const value = await getCockpitResources(root).catch(() => null);
          if (cache) cache.resources = { value, ts: now };
          return value;
        })();

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

  if (await pathExists(runsDir)) {
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
        readFile(getRunPath(latestRunName, "state.json"), "utf-8").catch(() => null),
        readSessionMeta(latestRunName).catch(() => null),
      ]);
      stateContent = sc;
      sessionMeta = sm;
    }
  }

  const gitChanges = (await gitChangesPromise) ?? [];

  let vm = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let parsedState: RunState | null = null;

  if (stateContent) {
    const result = parseRunStateResult(stateContent);
    stateError = result.error;
    parsedState = result.state;
    vm = buildRunViewModel(parsedState, { changedFiles: gitChanges.map((c) => c.path) });
  }

  // ── Fetch todos (cached) ──
  const todosPromise = (async () => {
    if (!latestRunName) return null;
    const cached = getCacheEntry(cache?.stateTodos, 750, now);
    if (cached !== undefined) return cached;
    const value = await readTodos(latestRunName).catch(() => null) ?? await deriveTodosFromState(latestRunName).catch(() => null);
    if (cache) cache.stateTodos = { value, ts: now };
    return value;
  })();

  // ── Fetch Kimi usage (cached) ──
  const kimiPromise = quick
    ? Promise.resolve(cache?.kimiUsage?.value ?? null)
    : (async () => {
        const cached = getCacheEntry(cache?.kimiUsage, 60000, now);
        if (cached !== undefined) return cached;
        try {
          const value = await getKimiUsage();
          if (cache) cache.kimiUsage = { value, ts: now };
          return value;
        } catch {
          return null;
        }
      })();

  const [todos, kimiUsage, resources, deepSeek] = await Promise.all([
    todosPromise,
    kimiPromise,
    resourcesPromise,
    deepSeekPromise,
  ]);
  const deepSeekUsage = computeDeepSeekRunUsage(parsedState);

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

  // ── Build sections as separate arrays ──

  // Header (fixed 2 rows)
  const headerLines: string[] = [gradient("OMK Cockpit"), ""];

  // Info section — compact priority-ordered lines
  const infoLines: string[] = [];

  const displayRunId = latestRunName ?? "--";
  const healthStr = vm.health.toUpperCase();
  const progressStr = `${vm.progress.settled}/${vm.progress.total}`;
  infoLines.push(
    `${style.gray("run")} ${style.creamBold(truncateText(displayRunId, targetWidth - 6))}`
  );

  if (kimiUsage) {
    const account = kimiUsage.oauth.loggedIn ? kimiUsage.oauth.displayId : "/login";
    const fiveHourPercent =
      kimiUsage.quota.fiveHour?.remainingPercent != null
        ? Math.min(100, Math.max(0, 100 - kimiUsage.quota.fiveHour.remainingPercent))
        : null;
    const weeklyPercent =
      kimiUsage.quota.weekly?.remainingPercent != null
        ? Math.min(100, Math.max(0, 100 - kimiUsage.quota.weekly.remainingPercent))
        : null;
    const fiveHour =
      fiveHourPercent != null
        ? `${fiveHourPercent}%`
        : `${Math.round(kimiUsage.totalSecondsLast5Hours / 60)}m`;
    const weekly =
      weeklyPercent != null
        ? `${weeklyPercent}%`
        : `${Math.round(kimiUsage.totalSecondsWeek / 60)}m`;
    const sysPart = sysUsage
      ? `${style.gray("sys")} ${style.gray("cpu")}${style.mintBold(`${sysUsage.cpuPercent}%`)} ${style.gray("mem")}${style.mintBold(`${sysUsage.memPercent}%`)}`
      : "";
    infoLines.push(
      `${style.gray("kimi")} ${truncateText(account, 16)} 5h:${fiveHour} wk:${weekly}  ${sysPart}`.trimEnd()
    );
  } else {
    const sysPart = sysUsage
      ? `${style.gray("sys")} ${style.gray("cpu")}${style.mintBold(`${sysUsage.cpuPercent}%`)} ${style.gray("mem")}${style.mintBold(`${sysUsage.memPercent}%`)}`
      : `${style.gray("sys")} ${style.gray("--")}`;
    infoLines.push(`${style.gray("kimi")} ${style.gray("unavailable")}  ${sysPart}`.trimEnd());
  }

  infoLines.push(formatDeepSeekSummary(deepSeek, deepSeekUsage, targetWidth));
  infoLines.push(formatResourceSummary(resources, targetWidth));

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

  // ── Worker / TODO section ──
  const workerLines: string[] = [];
  const sortedNodes = [...(vm.workers ?? [])].sort((a, b) => {
    const rank = statusRank(a.state) - statusRank(b.state);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });

  if (todos && todos.length > 0) {
    const sortedTodos = [...todos].sort(
      (a, b) => statusRank(a.status) - statusRank(b.status)
    );
    const doneCount = sessionMeta?.todoDoneCount ?? sortedTodos.filter((t) => t.status === "done").length;
    const totalCount = sessionMeta?.todoCount ?? sortedTodos.length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const chatPrefix = sessionMeta?.type === "chat" ? "💬 " : "";
    workerLines.push(
      `${style.pinkBold(`${chatPrefix}TODO`)} ${miniProgressBar(doneCount, totalCount)} ${style.creamBold(`${pct}%`)} ` +
        `${style.gray(`(${doneCount}/${totalCount})`)}`
    );

    for (const todo of sortedTodos) {
      const marker = todoMarker(todo.status);
      const elapsed = todo.elapsedMs ? style.gray(formatElapsed(todo.elapsedMs)) : "";
      const agentBadge = todo.agent ? style.gray(`[${truncateText(todo.agent, 8)}]`) : "";
      const base = `${marker} ${agentBadge} ${truncateText(todo.title, targetWidth - 14)} ${elapsed}`.replace(/\s+/g, " ").trim();
      workerLines.push(`  ${base}`);
    }

    if (sortedTodos.length > 0) {
      workerLines.push(`  ${style.gray(`\u2026 ${sortedTodos.length} total`)}`);
    }
  } else if (sortedNodes.length > 0) {
    const { done, total, running, failed, blocked, skipped, settled } = vm.progress;
    const pct = total > 0 ? Math.round((settled / total) * 100) : 0;
    workerLines.push(
      `${style.pinkBold("AGENTS")} ${miniProgressBar(settled, total)} ${style.creamBold(`${pct}%`)} ` +
        `${style.gray(`(${running}▶ ${done}✓ ${failed}✕ ${blocked}■ ${skipped}⊘ / ${total})`)}`
    );

    for (const node of sortedNodes) {
      const stateLabel = workerStateColor(node.state)(node.state.toUpperCase());
      const elapsed = formatElapsed(node.elapsedMs);
      const base = `${stateLabel} ${style.gray(elapsed)} ${truncateText(node.label || node.id, targetWidth - 16)}`;

      if (node.state === "running") {
        workerLines.push(`  ${base}`);
        if (node.phase) {
          workerLines.push(`    ${style.gray("→")} ${truncateText(node.phase, targetWidth - 8)}`);
        } else if (node.currentNode) {
          workerLines.push(`    ${style.gray("→")} ${truncateText(node.currentNode, targetWidth - 8)}`);
        }
        if (node.lastActivityAgeMs != null && node.lastActivityAgeMs > 30_000) {
          const staleText = `stale ${formatElapsed(node.lastActivityAgeMs)}`;
          workerLines.push(`    ${style.orange("⚠")} ${style.orange(staleText)}`);
        }
      } else if ((node.state === "failed" || node.state === "blocked") && node.lastEvidence) {
        const evidence = truncateText(node.lastEvidence.message || node.lastEvidence.gate, targetWidth - 10);
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
  } else {
    workerLines.push(style.gray("No parallel agents active — waiting for work"));
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
    changedLines.push(`${style.gray("hint:")} ${style.cream(recovery)}`);
  }

  if (gitChanges.length > 0) {
    changedLines.push(style.pinkBold(`Changed (${gitChanges.length})`));
    for (const change of gitChanges) {
      changedLines.push(`  ${gitMarker(change.status)} ${truncateText(change.path, targetWidth - 6)}`);
    }
    if (gitChanges.length > 0) {
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
                  const raw = await readFile(getRunPath(c.name, "state.json"), "utf-8");
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
                  const goalRaw = await readFile(getRunPath(c.name, "goal.md"), "utf-8");
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
      changedLines.push(style.pinkBold("History"));
      changedLines.push(...historyLines);
    }
  }

  // ── Assemble responsive rectangle ──
  const sep = separator(targetWidth);
  const heightMode = fixedFrameHeight == null ? "auto" : `${fixedFrameHeight}`;
  const footerLine = `[${style.gray("h")}]istory [${style.gray("+")}/${style.gray("-")}]height [${style.gray("a")}]auto [${style.gray("space")}]pause [${style.gray("q")}]uit ${style.gray(`height:${heightMode}`)}`;

  let body: string[];

  if (fixedBodyHeight != null) {
    const headerRows = 2;
    const footerRows = 1;
    const sepRows = 2;
    const available = Math.max(0, fixedBodyHeight - headerRows - footerRows - sepRows);

    const infoBudget = Math.max(4, Math.round(available * 0.45));
    const todoBudget = Math.max(2, Math.round(available * 0.35));
    const changedBudget = Math.max(2, available - infoBudget - todoBudget);

    body = [
      ...headerLines,
      ...fitLines(infoLines, infoBudget),
      sep,
      ...fitLines(workerLines, todoBudget),
      sep,
      ...fitLines(changedLines, changedBudget),
      footerLine,
    ];

    while (body.length < fixedBodyHeight) body.push("");
    if (body.length > fixedBodyHeight) body.length = fixedBodyHeight;
  } else {
    body = [
      ...headerLines,
      ...infoLines,
      sep,
      ...workerLines,
      sep,
      ...changedLines,
      footerLine,
    ];

    const minimumBodyHeight = DEFAULT_COCKPIT_HEIGHT - 2;
    while (body.length < minimumBodyHeight) body.push("");
  }

  const content = body.map((l) => truncateLine(l, targetWidth));
  return renderCockpitPanel(content, targetWidth);
}
// ── Watch command ──

export async function cockpitCommand(options: CockpitCommandOptions = {}): Promise<void> {
  const refreshMs = normalizeRefreshMs(options.refreshMs);

  if (!options.watch) {
    console.log(await renderCockpit({ runId: options.runId, height: options.height }));
    return;
  }

  const renderer = new CockpitRenderer(refreshMs, options.height);
  const cache: CockpitCache = {};

  const stop = (): void => {
    renderer.stopped = true;
  };
  const onResize = (): void => {
    renderer.resized = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.on("SIGWINCH", onResize);

  renderer.setupKeyboard();

  try {
    // First paint: render immediately from local state without waiting for slow ops
    let firstPaint = true;

    while (!renderer.stopped) {
      const frame = await renderCockpit({
        runId: options.runId,
        terminalWidth: process.stdout.columns,
        cache,
        quick: firstPaint,
        showHistory: renderer.showHistory,
        height: renderer.height,
      });

      if (firstPaint) {
        // Full clear on first paint so subsequent diff frames have a known baseline
        renderer.mode = "full";
        renderer.render(frame);
        renderer.mode = "diff";
        firstPaint = false;
      } else {
        renderer.render(frame);
      }

      if (renderer.stopped) break;

      // Wait for refresh interval or resize/refresh event
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, renderer.refreshMs);
        const interval = setInterval(() => {
          if (renderer.stopped || renderer.resized) {
            clearTimeout(timer);
            clearInterval(interval);
            renderer.resized = false;
            resolve();
          }
        }, 100);
      });

      // When paused, skip timer-based re-renders but keep listening for keys
      while (renderer.paused && !renderer.stopped && !renderer.resized) {
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (renderer.stopped || renderer.resized) {
              clearInterval(interval);
              renderer.resized = false;
              resolve();
            }
          }, 100);
        });
      }
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGWINCH", onResize);
    renderer.teardown();
  }

  process.stdout.write("\n");
}
