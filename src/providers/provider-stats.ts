import { readFileSync, existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DEFAULT_AUTHORITY_PROVIDER, type ProviderId, type ProviderComplexity, type ProviderRisk } from "./types.js";

export interface ProviderStats {
  provider: ProviderId;
  attempts: number;
  passes: number;
  failures: number;
  fallbacks: number;
  timeouts: number;
  meanLatencyMs: number;
  lastAttemptAt: number;
}

export interface ProviderModelStatsEntry {
  provider: ProviderId;
  tier: string;
  role: string;
  taskType: string;
  complexity: string;
  attempts: number;
  passes: number;
  failures: number;
  fallbacks: number;
  timeouts: number;
  meanLatencyMs: number;
  lastAttemptAt: number;
  evidencePassRate: number;
  fallbackRate: number;
  timeoutRate: number;
}

export interface ProviderModelStats {
  version: number;
  entries: Record<string, ProviderModelStatsEntry>;
  updatedAt: number;
}

export interface ProviderRouteScoreInput {
  role: string;
  risk: ProviderRisk;
  complexity: ProviderComplexity;
  estimatedTokens: number;
  needsMcp: boolean;
  needsToolCalling: boolean;
  readOnly: boolean;
  providerStats?: Record<string, ProviderStats>;
  providerModelStats?: Record<string, ProviderModelStatsEntry>;
  authorityProvider?: ProviderId;
}

const READ_ONLY_ROLES = new Set([
  "explorer",
  "researcher",
  "reviewer",
  "qa",
  "tester",
  "documenter",
  "writer",
  "planner",
  "analyst",
  "auditor",
]);

const AUTHORITY_ROLES = new Set([
  "orchestrator",
  "coordinator",
  "merger",
  "integrator",
  "security",
]);

const FILE_AFFECTING_ROLES = new Set([
  "coder",
  "executor",
  "refactorer",
]);

const CONTEXT_WINDOWS: Record<string, number> = {
  kimi: 2_000_000,
  deepseek: 128_000,
  qwen: 128_000,
  codex: 128_000,
  openrouter: 128_000,
};
const DEFAULT_LATENCY_BUDGET = 0.75;
const DEFAULT_COST_BUDGET = 0.8;

export function buildProviderStatsKey(
  tier: string,
  role: string,
  taskType: string,
  complexity: string
): string {
  return `${tier}:${role}:${taskType || "unknown"}:${complexity || "unknown"}`;
}

const DEFAULT_STATS_PATH = join(process.cwd(), ".omk", "memory", "provider-model-stats.json");

let pendingSaveTimer: NodeJS.Timeout | null = null;
let pendingSavePath: string | null = null;
let pendingSaveStats: ProviderModelStats | null = null;
const SAVE_DEBOUNCE_MS = 100;

export function loadProviderModelStats(filePath = DEFAULT_STATS_PATH): ProviderModelStats {
  if (!existsSync(filePath)) {
    return { version: 2, entries: {}, updatedAt: Date.now() };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isProviderModelStats(parsed)) {
      const migrated = migrateProviderModelStats(parsed);
      if (migrated) return migrated;
      return { version: 2, entries: {}, updatedAt: Date.now() };
    }
    return parsed;
  } catch {
    return { version: 2, entries: {}, updatedAt: Date.now() };
  }
}

export function saveProviderModelStats(
  stats: ProviderModelStats,
  filePath = DEFAULT_STATS_PATH
): void {
  // Store latest stats and path
  pendingSaveStats = stats;
  pendingSavePath = filePath;

  // Clear existing timer
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }

  // Schedule new write
  pendingSaveTimer = setTimeout(() => {
    flushProviderModelStats();
  }, SAVE_DEBOUNCE_MS);
}

export async function flushProviderModelStats(): Promise<void> {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  if (!pendingSaveStats || !pendingSavePath) return;

  const dir = dirname(pendingSavePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    await writeFile(
      pendingSavePath,
      JSON.stringify({ ...pendingSaveStats, updatedAt: Date.now() }, null, 2),
      "utf-8"
    );
  } catch {
    // Silently fail — telemetry is best-effort
  }

  pendingSaveStats = null;
  pendingSavePath = null;
}

function isProviderModelStats(value: unknown): value is ProviderModelStats {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "number" &&
    record.version >= 2 &&
    typeof record.entries === "object" &&
    record.entries !== null &&
    !Array.isArray(record.entries)
  );
}

function migrateProviderModelStats(value: unknown): ProviderModelStats | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  // v1: flat Record<string, ProviderStats> without version field
  if (
    record.version === undefined &&
    typeof record.entries !== "object" &&
    Object.keys(record).length > 0
  ) {
    const entries: Record<string, ProviderModelStatsEntry> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const attempts = typeof e.attempts === "number" ? e.attempts : 0;
      const passes = typeof e.passes === "number" ? e.passes : 0;
      const fallbacks = typeof e.fallbacks === "number" ? e.fallbacks : 0;
      const timeouts = typeof e.timeouts === "number" ? e.timeouts : 0;
      const failures = typeof e.failures === "number" ? e.failures : 0;
      const meanLatencyMs = typeof e.meanLatencyMs === "number" ? e.meanLatencyMs : 0;
      const lastAttemptAt = typeof e.lastAttemptAt === "number" ? e.lastAttemptAt : Date.now();
      const provider = typeof e.provider === "string" ? (e.provider as ProviderId) : "unknown";

      // Old v1 keys were `${tier}:${role}` — migrate to `${tier}:${role}:unknown:unknown`
      const newKey = key.includes(":") && key.split(":").length === 2
        ? `${key}:unknown:unknown`
        : key;

      entries[newKey] = {
        provider,
        tier: newKey.split(":")[0] ?? "unknown",
        role: newKey.split(":")[1] ?? "unknown",
        taskType: "unknown",
        complexity: "unknown",
        attempts,
        passes,
        failures,
        fallbacks,
        timeouts,
        meanLatencyMs,
        lastAttemptAt,
        evidencePassRate: attempts > 0 ? passes / attempts : 0.5,
        fallbackRate: attempts > 0 ? fallbacks / attempts : 0,
        timeoutRate: attempts > 0 ? timeouts / attempts : 0,
      };
    }
    return { version: 2, entries, updatedAt: Date.now() };
  }

  return null;
}

export function updateProviderModelStats(
  stats: ProviderModelStats,
  key: string,
  patch: Partial<Omit<ProviderModelStatsEntry, "provider" | "tier" | "role" | "taskType" | "complexity">>
): ProviderModelStats {
  const existing = stats.entries[key];
  const segments = key.split(":");
  const attempts = Math.max(0, (patch.attempts ?? existing?.attempts ?? 0));
  const passes = Math.max(0, (patch.passes ?? existing?.passes ?? 0));
  const failures = Math.max(0, (patch.failures ?? existing?.failures ?? 0));
  const fallbacks = Math.max(0, (patch.fallbacks ?? existing?.fallbacks ?? 0));
  const timeouts = Math.max(0, (patch.timeouts ?? existing?.timeouts ?? 0));
  const meanLatencyMs = patch.meanLatencyMs ?? existing?.meanLatencyMs ?? 0;
  const lastAttemptAt = patch.lastAttemptAt ?? existing?.lastAttemptAt ?? Date.now();

  const entry: ProviderModelStatsEntry = {
    provider: existing?.provider ?? (segments[0] as ProviderId) ?? "unknown",
    tier: segments[0] ?? "unknown",
    role: segments[1] ?? "unknown",
    taskType: segments[2] ?? "unknown",
    complexity: segments[3] ?? "unknown",
    attempts,
    passes,
    failures,
    fallbacks,
    timeouts,
    meanLatencyMs,
    lastAttemptAt,
    evidencePassRate: attempts > 0 ? passes / attempts : 0.5,
    fallbackRate: attempts > 0 ? fallbacks / attempts : 0,
    timeoutRate: attempts > 0 ? timeouts / attempts : 0,
  };

  return {
    ...stats,
    entries: { ...stats.entries, [key]: entry },
    updatedAt: Date.now(),
  };
}

export function computeProviderRouteScore(
  provider: ProviderId,
  input: ProviderRouteScoreInput
): { score: number; reason: string; confidence: number } {
  const authority = input.authorityProvider ?? DEFAULT_AUTHORITY_PROVIDER;
  const stats = input.providerStats?.[provider];
  const granularStats = selectProviderModelStats(provider, input);

  // readOnlySafety (0.25): read-only tasks score higher for external providers
  const isReadOnlyTask = input.risk === "read" && !input.needsMcp && !input.needsToolCalling;
  const isSafeForExternal = isReadOnlyTask && (input.readOnly || READ_ONLY_ROLES.has(input.role));
  const readOnlySafety = provider === authority
    ? (isReadOnlyTask ? 0.8 : 1.0)
    : (isSafeForExternal ? 1.0 : 0.2);

  // expectedUtility (0.20): role-based expected fit
  const expectedUtility = computeExpectedUtility(provider, input.role, authority);

  // contextFit (0.15): token count fit for provider context window
  const window = CONTEXT_WINDOWS[provider] ?? 128_000;
  const ratio = input.estimatedTokens / window;
  let contextFit: number;
  if (ratio < 0.1) contextFit = 1.0;
  else if (ratio < 0.5) contextFit = 0.9;
  else if (ratio < 0.8) contextFit = 0.7;
  else contextFit = 0.4;

  // historicalPassRate (0.15): providerStats[provider].passes / attempts
  let historicalPassRate = 0.75;
  if (stats && stats.attempts > 0) {
    historicalPassRate = Math.max(0, Math.min(1, stats.passes / stats.attempts));
  }

  // Prefer granular stats when available
  if (granularStats && granularStats.attempts > 0) {
    historicalPassRate = Math.max(0, Math.min(1, granularStats.evidencePassRate));
  }

  // latencyBudget (0.10): inverse of meanLatencyMs
  let latencyBudget = DEFAULT_LATENCY_BUDGET;
  if (stats && stats.meanLatencyMs > 0) {
    latencyBudget = Math.max(0, Math.min(1, 1 - stats.meanLatencyMs / 10000));
  }

  if (granularStats && granularStats.meanLatencyMs > 0) {
    latencyBudget = Math.max(0, Math.min(1, 1 - granularStats.meanLatencyMs / 10000));
  }

  // costBudget (0.10): neutral until explicit normalized cost metadata exists
  const costBudget = DEFAULT_COST_BUDGET;

  // fallbackReliability (0.05): 1 - fallback rate
  let fallbackReliability = 0.9;
  if (stats && stats.attempts > 0) {
    fallbackReliability = Math.max(0, 1 - stats.fallbacks / stats.attempts);
  }
  if (granularStats && granularStats.attempts > 0) {
    fallbackReliability = Math.max(0, 1 - granularStats.fallbackRate);
  }

  let score =
    readOnlySafety * 0.25 +
    expectedUtility * 0.20 +
    contextFit * 0.15 +
    historicalPassRate * 0.15 +
    latencyBudget * 0.10 +
    costBudget * 0.10 +
    fallbackReliability * 0.05;

  // riskPenalty: subtract if risk === "write" and provider is not authority
  if (input.risk === "write" && provider !== authority) {
    score -= 0.35;
  }

  // complexity penalty for external providers on complex tasks
  if (provider !== authority && input.complexity === "complex") {
    score -= 0.20;
  }

  score = Math.max(0, Math.min(1, score));

  const reason = `${providerLabel(provider)} scored highest (${clampScore(score)}) for ${input.risk}-risk ${input.role} task (${input.complexity})`;

  return {
    score: clampScore(score),
    reason,
    confidence: clampScore(score),
  };
}

function selectProviderModelStats(
  provider: ProviderId,
  input: ProviderRouteScoreInput
): ProviderModelStatsEntry | undefined {
  const entries = input.providerModelStats;
  if (!entries) return undefined;

  const providerKey = buildProviderStatsKey(provider, input.role, "unknown", input.complexity);
  const keyedEntry = entries[providerKey];
  if (keyedEntry) return keyedEntry;

  const matches = Object.values(entries).filter((entry) =>
    entry.provider === provider &&
    entry.role === input.role &&
    (entry.complexity === input.complexity || entry.complexity === "unknown")
  );
  return matches.find((entry) => entry.taskType === "unknown") ?? matches[0];
}

function computeExpectedUtility(provider: ProviderId, role: string, authority: ProviderId): number {
  if (AUTHORITY_ROLES.has(role)) {
    return provider === authority ? 1.0 : 0.1;
  }
  if (READ_ONLY_ROLES.has(role)) {
    return provider === authority ? 0.7 : 0.85;
  }
  if (FILE_AFFECTING_ROLES.has(role)) {
    return provider === authority ? 0.95 : 0.4;
  }
  // Generic fallback for unknown roles
  return provider === authority ? 0.7 : 0.75;
}

function providerLabel(provider: ProviderId): string {
  if (provider === "qwen") return "Qwen";
  if (provider === "codex") return "Codex";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "kimi") return "Kimi";
  return provider;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
