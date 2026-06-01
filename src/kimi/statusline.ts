import { style } from "../util/theme.js";
import { formatKimiUsageInline, getKimiUsage, type UsageStats } from "./usage.js";
import { buildUsageViewModel } from "../util/usage-view-model.js";

function miniGauge(percent: number, width = 6): string {
  const safePercent = Math.min(100, Math.max(0, percent));
  const filled = Math.round((safePercent / 100) * width);
  const empty = width - filled;
  let color = style.mint;
  if (safePercent > 50) color = style.orange;
  if (safePercent > 80) color = style.red;
  return color("█".repeat(filled)) + style.gray("░".repeat(empty)) + " " + style.creamBold(`${safePercent}%`);
}

export function formatKimiUsageGauges(stats: UsageStats): string {
  const LIMIT_HOURS = 5;
  const limitSeconds = LIMIT_HOURS * 3600;
  const vm = buildUsageViewModel(stats);

  if (vm.source === "missingAuth") {
    return "login required";
  }

  // Convert remaining percent to used percent to match Kimi console style.
  const fiveHourPercent = vm.fiveHour.percent !== null
    ? Math.min(100, Math.max(0, 100 - vm.fiveHour.percent))
    : Math.min(100, Math.round((stats.totalSecondsLast5Hours / limitSeconds) * 100));
  const weekPercent = vm.weekly.percent !== null
    ? Math.min(100, Math.max(0, 100 - vm.weekly.percent))
    : Math.min(100, Math.round((stats.totalSecondsWeek / (limitSeconds * 7)) * 100));
  const fiveHint = vm.fiveHour.resetHint
    ? style.gray(` ↻${vm.fiveHour.resetHint.replace(/^resets\s+/, "")}`)
    : "";
  const weekHint = vm.weekly.resetHint
    ? style.gray(` ↻${vm.weekly.resetHint.replace(/^resets\s+/, "")}`)
    : "";
  return `5h[${miniGauge(fiveHourPercent)}${fiveHint}] wk[${miniGauge(weekPercent)}${weekHint}]`;
}

const STATUS_VALUE = String.raw`[^\s|\r\n]+`;
const CONTEXT_BASE = String.raw`context:\s*\d+(?:\.\d+)?%\s*(?:\([^\r\n)]*\))?`;
const CONTEXT_WITH_TOKENS_RE = new RegExp(String.raw`${CONTEXT_BASE}\s*\|\s*in:${STATUS_VALUE}\s+out:${STATUS_VALUE}`, "g");
const CONTEXT_BASE_ONLY_RE = new RegExp(String.raw`${CONTEXT_BASE}(?!\s*(?:\(|\|\s*(?:in:|context:)))`, "g");

export interface KimiStatusLineEnhancerOptions {
  refreshMs?: number;
  initialUsage?: UsageStats;
  disabled?: boolean;
  usageProvider?: () => Promise<UsageStats | undefined>;
}

export function enhanceKimiContextStatusLine(data: string, inlineUsage: string, colorize = true): string {
  if (!inlineUsage || !data.includes("context:")) return data;
  const segment = colorize ? style.mint(`context:${inlineUsage}`) + style.gray(" | ") : `context:${inlineUsage} | `;
  const appendOnce = (match: string, offset: number, full: string): string => {
    const lineStart = full.lastIndexOf("\n", offset - 1) + 1;
    const lineHead = full.slice(lineStart, offset);
    return /context:/.test(lineHead) ? match : `${segment}${match}`;
  };
  return data
    .replace(CONTEXT_WITH_TOKENS_RE, appendOnce)
    .replace(CONTEXT_BASE_ONLY_RE, appendOnce);
}

export function enhanceKimiContextStatusLineWithGauges(data: string, gauges: string, colorize = true): string {
  if (!gauges || !data.includes("context:")) return data;
  const segment = colorize ? style.mint(`context:${gauges}`) + style.gray(" | ") : `context:${gauges} | `;
  const appendOnce = (match: string, offset: number, full: string): string => {
    const lineStart = full.lastIndexOf("\n", offset - 1) + 1;
    const lineHead = full.slice(lineStart, offset);
    return /context:/.test(lineHead) ? match : `${segment}${match}`;
  };
  return data
    .replace(CONTEXT_WITH_TOKENS_RE, appendOnce)
    .replace(CONTEXT_BASE_ONLY_RE, appendOnce);
}

export class KimiStatusLineEnhancer {
  private usage?: UsageStats;
  private refreshPromise?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private lastRefreshMs = 0;
  private readonly refreshMs: number;
  private readonly disabled: boolean;
  private readonly usageProvider: () => Promise<UsageStats | undefined>;

  constructor(options: KimiStatusLineEnhancerOptions = {}) {
    this.usage = options.initialUsage;
    this.refreshMs = options.refreshMs ?? 60_000;
    this.disabled = options.disabled ?? isDisabledByEnv();
    this.usageProvider = options.usageProvider ?? (() => getKimiUsage().catch(() => undefined));
  }

  static async create(options: KimiStatusLineEnhancerOptions = {}): Promise<KimiStatusLineEnhancer> {
    if (options.disabled ?? isDisabledByEnv()) return new KimiStatusLineEnhancer({ ...options, disabled: true });
    const enhancer = new KimiStatusLineEnhancer(options);
    const initialUsage = options.initialUsage;
    if (initialUsage) enhancer.lastRefreshMs = Date.now();
    if (!initialUsage) {
      enhancer.refreshPromise = enhancer.refresh().finally(() => {
        enhancer.refreshPromise = undefined;
      });
    }
    enhancer.startBackgroundRefresh();
    return enhancer;
  }

  process(data: string): string {
    if (this.disabled || !data.includes("context:")) return data;
    this.refreshIfNeeded();
    if (!this.usage) return data;
    const useGauges = process.env.OMK_KIMI_STATUS_GAUGES !== "0" && process.env.OMK_KIMI_STATUS_GAUGES !== "false";
    if (useGauges) {
      return enhanceKimiContextStatusLineWithGauges(data, formatKimiUsageGauges(this.usage));
    }
    return enhanceKimiContextStatusLine(data, formatKimiUsageInline(this.usage));
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private startBackgroundRefresh(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.refreshMs);
    this.timer.unref?.();
  }

  private refreshIfNeeded(): void {
    if (this.disabled || this.refreshPromise) return;
    if (Date.now() - this.lastRefreshMs < this.refreshMs) return;
    // Opportunistic refresh keeps the status line current even if the interval was delayed.
    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = undefined;
    });
  }

  private async refresh(): Promise<void> {
    const next = await this.usageProvider().catch(() => undefined);
    if (next) {
      this.usage = next;
    }
    this.lastRefreshMs = Date.now();
  }
}

function isDisabledByEnv(): boolean {
  const value = process.env.OMK_KIMI_STATUS_USAGE;
  return value === "0" || value === "false" || value === "off" || value === "no";
}
