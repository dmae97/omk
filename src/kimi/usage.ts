/**
 * Kimi CLI OAuth + usage tracker.
 *
 * - Reads ~/.kimi/credentials/kimi-code.json without exposing tokens.
 * - Decodes safe OAuth identity claims into a masked display id.
 * - Fetches Kimi Code /usages quota when possible.
 * - Scans local session traces as a no-network fallback for rolling 5h/week time.
 */

import { createHash } from "crypto";
import { open, readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface UsageStats {
  totalSecondsToday: number;
  sessionCountToday: number;
  totalSecondsLast5Hours: number;
  sessionCountLast5Hours: number;
  totalSecondsWeek: number;
  sessionCountWeek: number;
  oauth: OAuthIdentity;
  quota: KimiQuotaStatus;
}

export interface OAuthIdentity {
  loggedIn: boolean;
  displayId: string;
  tokenStatus: "missing" | "valid" | "expired" | "unknown";
  source: "kimi-code" | "none";
  expiresAt?: string;
}

export interface KimiQuotaRow {
  label: string;
  used: number;
  limit: number;
  remaining: number;
  remainingPercent: number | null;
  resetHint?: string;
  window: "5h" | "weekly" | "other";
}

export interface KimiQuotaStatus {
  fetchedAt?: string;
  error?: string;
  fiveHour?: KimiQuotaRow;
  weekly?: KimiQuotaRow;
  rows: KimiQuotaRow[];
}

export interface GetKimiUsageOptions {
  homeDir?: string;
  nowMs?: number;
  fetchQuota?: boolean;
  fetchImpl?: typeof fetch;
  usageBaseUrl?: string;
}

interface SessionTime {
  start: number;
  end: number;
  date: Date;
}

interface KimiCredentials {
  access_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
}

type JsonObject = Record<string, unknown>;

const SMALL_WIRE_FILE_BYTES = 512 * 1024;
const WIRE_HEAD_BYTES = 64 * 1024;
const WIRE_TAIL_BYTES = 256 * 1024;
const SESSION_LOOKBACK_SECONDS = 8 * 24 * 60 * 60;

interface UsageCache {
  result: UsageStats;
  timestamp: number;
}
let usageCache: UsageCache | null = null;
const USAGE_CACHE_TTL_MS = 60_000; // 60 seconds

interface CredentialCache {
  token: string;
  decoded: unknown;
  timestamp: number;
}
let credentialCache: CredentialCache | null = null;

function getKstDate(ts: number): Date {
  const d = new Date(ts * 1000);
  // KST is UTC+9
  const kstOffset = 9 * 60 * 60 * 1000;
  return new Date(d.getTime() + kstOffset);
}

function isSameKstDay(d1: Date, d2: Date): boolean {
  return (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate()
  );
}

function overlapsWindow(st: SessionTime, windowStartSec: number, windowEndSec: number): boolean {
  return st.end >= windowStartSec && st.start <= windowEndSec;
}

function overlappedSeconds(st: SessionTime, windowStartSec: number, windowEndSec: number): number {
  if (!overlapsWindow(st, windowStartSec, windowEndSec)) return 0;
  return Math.max(0, Math.min(st.end, windowEndSec) - Math.max(st.start, windowStartSec));
}

function timestampFromLine(line: string): number | undefined {
  try {
    const obj = JSON.parse(line) as JsonObject;
    return typeof obj.timestamp === "number" ? obj.timestamp : undefined;
  } catch {
    return undefined;
  }
}

function firstTimestamp(content: string): number | undefined {
  for (const line of content.split(/\r?\n/)) {
    const timestamp = timestampFromLine(line);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
}

function lastTimestamp(content: string): number | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const timestamp = timestampFromLine(lines[i]);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
}

async function readFileSlice(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } finally {
    await handle.close();
  }
}

async function scanWireJsonl(path: string): Promise<SessionTime | null> {
  try {
    let start: number | undefined;
    let end: number | undefined;
    const info = await stat(path);

    if (info.size <= SMALL_WIRE_FILE_BYTES) {
      const content = await readFile(path, "utf-8");
      start = firstTimestamp(content);
      end = lastTimestamp(content);
    } else {
      const head = await readFileSlice(path, 0, Math.min(WIRE_HEAD_BYTES, info.size));
      const tailStart = Math.max(0, info.size - WIRE_TAIL_BYTES);
      const tail = await readFileSlice(path, tailStart, Math.min(WIRE_TAIL_BYTES, info.size));
      start = firstTimestamp(head);
      end = lastTimestamp(tail);
    }

    if (typeof start !== "number" || typeof end !== "number") return null;

    return { start, end, date: getKstDate(start) };
  } catch {
    return null;
  }
}

async function scanRunFallback(runPath: string): Promise<SessionTime | null> {
  // Fallback when wire.jsonl is missing: use filesystem timestamps.
  const candidates = [
    join(runPath, "context.jsonl"),
    join(runPath, "state.json"),
    runPath,
  ];
  for (const p of candidates) {
    try {
      const s = await stat(p);
      const start = Math.floor(s.birthtimeMs / 1000);
      const end = Math.floor(Math.max(s.mtimeMs, s.ctimeMs) / 1000);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        return { start, end, date: getKstDate(start) };
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function shouldScanRun(runPath: string, nowSec: number): Promise<boolean> {
  try {
    const info = await stat(runPath);
    const latestSec = Math.floor(Math.max(info.mtimeMs, info.ctimeMs, info.birthtimeMs) / 1000);
    return latestSec >= nowSec - SESSION_LOOKBACK_SECONDS;
  } catch {
    return false;
  }
}

async function scanSessionTimes(homeDir: string, nowSec: number): Promise<SessionTime[]> {
  const sessionsDir = join(homeDir, ".kimi", "sessions");
  const times: SessionTime[] = [];
  try {
    const sessionIds = await readdir(sessionsDir);
    for (const sessionId of sessionIds) {
      const sessionPath = join(sessionsDir, sessionId);
      const runs = await readdir(sessionPath, { withFileTypes: true })
        .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
        .catch(() => [] as string[]);
      for (const runId of runs) {
        const runPath = join(sessionPath, runId);
        if (!await shouldScanRun(runPath, nowSec)) continue;
        const st = (await scanWireJsonl(join(runPath, "wire.jsonl"))) ??
                   (await scanRunFallback(runPath));
        if (!st) continue;

        const duration = Math.max(0, st.end - st.start);
        if (duration > 3600 * 24) continue; // Ignore sessions > 24h (likely stale)
        times.push(st);
      }
    }
  } catch {
    // ~/.kimi/sessions may not exist on older Kimi versions.
  }
  return times;
}

async function readCredentials(homeDir: string): Promise<KimiCredentials | null> {
  try {
    const raw = await readFile(join(homeDir, ".kimi", "credentials", "kimi-code.json"), "utf-8");
    const parsed = JSON.parse(raw) as Partial<KimiCredentials>;
    return {
      access_token: typeof parsed.access_token === "string" ? parsed.access_token : undefined,
      expires_at: typeof parsed.expires_at === "number" ? parsed.expires_at : undefined,
      token_type: typeof parsed.token_type === "string" ? parsed.token_type : undefined,
      scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
    };
  } catch {
    return null;
  }
}

export async function getKimiUsage(options: GetKimiUsageOptions = {}): Promise<UsageStats> {
  if (usageCache && options.fetchQuota !== false && Date.now() - usageCache.timestamp < USAGE_CACHE_TTL_MS) {
    return usageCache.result;
  }
  const homeDir = options.homeDir ?? homedir();
  const nowMs = options.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowKst = getKstDate(nowSec);
  const last5hStart = nowSec - 5 * 3600;

  let totalSecondsToday = 0;
  let sessionCountToday = 0;
  let totalSecondsLast5Hours = 0;
  let sessionCountLast5Hours = 0;
  let totalSecondsWeek = 0;
  let sessionCountWeek = 0;

  const sessions = await scanSessionTimes(homeDir, nowSec);
  for (const st of sessions) {
    const duration = Math.max(0, st.end - st.start);
    if (isSameKstDay(st.date, nowKst)) {
      totalSecondsToday += duration;
      sessionCountToday++;
    }
    if (overlapsWindow(st, last5hStart, nowSec)) {
      totalSecondsLast5Hours += overlappedSeconds(st, last5hStart, nowSec);
      sessionCountLast5Hours++;
    }
    const weekStart = nowSec - 7 * 24 * 3600;
    if (overlapsWindow(st, weekStart, nowSec)) {
      totalSecondsWeek += overlappedSeconds(st, weekStart, nowSec);
      sessionCountWeek++;
    }
  }

  const credentials = await readCredentials(homeDir);
  const oauth = toOAuthIdentity(credentials, nowSec);
  const quota = options.fetchQuota === false
    ? { rows: [] }
    : await fetchKimiQuota(credentials, oauth, options);

  const result = {
    totalSecondsToday,
    sessionCountToday,
    totalSecondsLast5Hours,
    sessionCountLast5Hours,
    totalSecondsWeek,
    sessionCountWeek,
    oauth,
    quota,
  };

  if (options.fetchQuota !== false) {
    usageCache = { result, timestamp: Date.now() };
  }

  return result;
}

function toOAuthIdentity(credentials: KimiCredentials | null, nowSec: number): OAuthIdentity {
  if (!credentials?.access_token) {
    return { loggedIn: false, displayId: "/login", tokenStatus: "missing", source: "none" };
  }

  if (credentialCache && credentialCache.token === credentials.access_token) {
    const claims = credentialCache.decoded as JsonObject;
    const exp = numberClaim(claims, "exp") ?? credentials.expires_at;
    const tokenStatus = exp ? (exp > nowSec ? "valid" : "expired") : "unknown";
    const displayId = displayIdFromClaims(claims, credentials.access_token);
    return {
      loggedIn: true,
      displayId,
      tokenStatus,
      source: "kimi-code",
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
    };
  }

  const claims = decodeJwtPayload(credentials.access_token);
  credentialCache = { token: credentials.access_token, decoded: claims, timestamp: Date.now() };

  const exp = numberClaim(claims, "exp") ?? credentials.expires_at;
  const tokenStatus = exp ? (exp > nowSec ? "valid" : "expired") : "unknown";
  const displayId = displayIdFromClaims(claims, credentials.access_token);
  return {
    loggedIn: true,
    displayId,
    tokenStatus,
    source: "kimi-code",
    expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
  };
}

async function fetchKimiQuota(
  credentials: KimiCredentials | null,
  oauth: OAuthIdentity,
  options: GetKimiUsageOptions
): Promise<KimiQuotaStatus> {
  if (!credentials?.access_token) return { rows: [], error: "not logged in" };
  if (oauth.tokenStatus === "expired") return { rows: [], error: "oauth token expired" };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return { rows: [], error: "fetch unavailable" };

  const baseUrl = (options.usageBaseUrl ?? process.env.KIMI_CODE_BASE_URL ?? "https://api.kimi.com/coding/v1").replace(/\/$/, "");
  const url = `${baseUrl}/usages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { rows: [], error: `usage endpoint HTTP ${response.status}` };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { rows: [], error: "invalid JSON response" };
    }
    const rows = parseQuotaPayload(payload);
    return {
      fetchedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
      rows,
      fiveHour: rows.find((row) => row.window === "5h"),
      weekly: rows.find((row) => row.window === "weekly"),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { rows: [], error: sanitizeError(message) };
  } finally {
    clearTimeout(timer);
  }
}

function parseQuotaPayload(payload: unknown): KimiQuotaRow[] {
  if (payload == null || typeof payload !== "object") return [];
  if (!isObject(payload)) return [];
  const rows: KimiQuotaRow[] = [];
  if (isObject(payload.usage)) {
    const row = toQuotaRow(payload.usage, "Weekly limit", "weekly");
    if (row) rows.push(row);
  }
  const limits = Array.isArray(payload.limits) ? payload.limits : [];
  for (let index = 0; index < limits.length; index += 1) {
    const item = limits[index];
    if (!isObject(item)) continue;
    const detail = isObject(item.detail) ? item.detail : item;
    const window = isObject(item.window) ? item.window : {};
    const label = limitLabel(item, detail, window, index);
    const row = toQuotaRow(detail, label, classifyWindow(label, item, detail, window));
    if (row) rows.push(row);
  }
  return rows;
}

function toQuotaRow(data: JsonObject, defaultLabel: string, window: KimiQuotaRow["window"]): KimiQuotaRow | null {
  const limit = toInt(data.limit);
  let used = toInt(data.used);
  if (used === undefined) {
    const remaining = toInt(data.remaining);
    if (remaining !== undefined && limit !== undefined) used = limit - remaining;
  }
  if (used === undefined && limit === undefined) return null;
  const safeLimit = Math.max(0, limit ?? 0);
  const safeUsed = Math.max(0, used ?? 0);
  const remaining = safeLimit > 0 ? Math.min(Math.max(safeLimit - safeUsed, 0), safeLimit) : 0;
  const remainingPercent = safeLimit > 0 ? Math.round((remaining / safeLimit) * 100) : null;
  return {
    label: String(data.name ?? data.title ?? defaultLabel),
    used: safeUsed,
    limit: safeLimit,
    remaining,
    remainingPercent,
    resetHint: resetHint(data),
    window,
  };
}

function limitLabel(item: JsonObject, detail: JsonObject, window: JsonObject, index: number): string {
  for (const key of ["name", "title", "scope"] as const) {
    const val = item[key] ?? detail[key];
    if (val) return String(val);
  }
  const duration = toInt(window.duration ?? item.duration ?? detail.duration);
  const timeUnit = String(window.timeUnit ?? item.timeUnit ?? detail.timeUnit ?? "");
  if (duration) {
    if (timeUnit.includes("MINUTE")) return duration >= 60 && duration % 60 === 0 ? `${duration / 60}h limit` : `${duration}m limit`;
    if (timeUnit.includes("HOUR")) return `${duration}h limit`;
    if (timeUnit.includes("DAY")) return `${duration}d limit`;
  }
  return `Limit #${index + 1}`;
}

function classifyWindow(label: string, item: JsonObject, detail: JsonObject, window: JsonObject): KimiQuotaRow["window"] {
  const text = `${label} ${String(item.scope ?? "")} ${String(detail.scope ?? "")}`.toLowerCase();
  const duration = toInt(window.duration ?? item.duration ?? detail.duration);
  const unit = String(window.timeUnit ?? item.timeUnit ?? detail.timeUnit ?? "").toUpperCase();
  if (text.includes("week") || text.includes("weekly") || (duration === 7 && unit.includes("DAY"))) return "weekly";
  if (text.includes("5h") || text.includes("5 hour") || text.includes("5-hour")) return "5h";
  if (duration === 5 && unit.includes("HOUR")) return "5h";
  if (duration === 300 && unit.includes("MINUTE")) return "5h";
  return "other";
}

function resetHint(data: JsonObject): string | undefined {
  for (const key of ["reset_at", "resetAt", "reset_time", "resetTime"] as const) {
    const val = data[key];
    if (typeof val === "string" && val) return `resets at ${val}`;
  }
  for (const key of ["reset_in", "resetIn", "ttl", "window"] as const) {
    const seconds = toInt(data[key]);
    if (seconds) return `resets in ${formatDuration(seconds)}`;
  }
  return undefined;
}

function decodeJwtPayload(token: string): JsonObject {
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const raw = Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function displayIdFromClaims(claims: JsonObject, token: string): string {
  const email = stringClaim(claims, "email") ?? stringClaim(claims, "mail");
  if (email) return maskEmail(email);
  const username = stringClaim(claims, "preferred_username") ?? stringClaim(claims, "username") ?? stringClaim(claims, "name");
  if (username) return maskIdentifier(username);
  const subject = stringClaim(claims, "sub") ?? stringClaim(claims, "user_id") ?? stringClaim(claims, "account_id") ?? token;
  return `oauth:${hashShort(subject)}`;
}

function stringClaim(claims: JsonObject, key: string): string | undefined {
  const value = claims[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberClaim(claims: JsonObject, key: string): number | undefined {
  const value = claims[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return maskIdentifier(email);
  const visible = local.length <= 2 ? local.slice(0, 1) : `${local.slice(0, 2)}…${local.slice(-1)}`;
  return `${visible}@${domain}`;
}

function maskIdentifier(value: string): string {
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}…${value.slice(-2)}`;
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeError(message: string): string {
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]").slice(0, 160);
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatQuota(row: KimiQuotaRow | undefined, fallbackSeconds: number): string {
  if (row && row.remainingPercent !== null) {
    const usedPercent = Math.min(100, Math.max(0, 100 - row.remainingPercent));
    return `${usedPercent}% used`;
  }
  return formatDuration(fallbackSeconds);
}

export function formatKimiUsageInline(stats: UsageStats): string {
  const account = stats.oauth.loggedIn ? stats.oauth.displayId : "/login";
  const fiveHour = formatQuota(stats.quota.fiveHour, stats.totalSecondsLast5Hours);
  const weekly = formatQuota(stats.quota.weekly, stats.totalSecondsWeek);
  const stale = stats.quota.error && stats.quota.rows.length === 0 ? " local" : "";
  return `acct:${account} | 5h:${fiveHour} | wk:${weekly}${stale}`;
}
