import { execa } from "execa";
import {
  basenameOfRuntimeCommand,
  formatPreflightFailureDetail,
  isRecord,
  QUIET_PACKAGE_MANAGER_ENV,
  runtimeShellInlineScripts,
} from "./internal.js";

export type RuntimeMcpPreflightMode = "warn-skip" | "strict" | "off";
export type RuntimeMcpPreflightFailureReason = "timeout" | "exit";
export type RuntimeMcpPreflightEntryStatus = "ok" | "failed" | "skipped";

export interface RuntimeMcpPreflightOptions {
  timeoutMs: number;
  concurrency: number;
}

export interface RuntimeMcpPreflightEntry {
  name: string;
  status: RuntimeMcpPreflightEntryStatus;
  reason?: RuntimeMcpPreflightFailureReason | "not-npm-family" | "no-package-spec";
  detail?: string;
  packageSpec?: string;
}

export interface RuntimeMcpPreflightResult {
  failed: Set<string>;
  details: Map<string, { reason: RuntimeMcpPreflightFailureReason; detail: string }>;
  entries: RuntimeMcpPreflightEntry[];
}

export function resolveRuntimeMcpPreflightMode(
  env: Record<string, string | undefined> = process.env
): RuntimeMcpPreflightMode {
  const raw = env.OMK_MCP_PREFLIGHT?.trim();
  if (!raw) return "warn-skip";
  if (raw === "strict" || raw === "warn-skip") return raw;
  return "off";
}

function resolvePreflightTimeout(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OMK_MCP_PREFLIGHT_TIMEOUT_MS;
  if (!raw) return 5000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

function resolvePreflightConcurrency(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OMK_MCP_PREFLIGHT_CONCURRENCY;
  if (!raw) return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function resolveRuntimeMcpPreflightOptions(
  env: Record<string, string | undefined> = process.env
): RuntimeMcpPreflightOptions & { mode: RuntimeMcpPreflightMode } {
  return {
    mode: resolveRuntimeMcpPreflightMode(env),
    timeoutMs: resolvePreflightTimeout(env),
    concurrency: resolvePreflightConcurrency(env),
  };
}

interface PreflightProbe {
  command: string;
  args: string[];
  env: Record<string, string>;
  packageSpec: string;
}

const NPM_FAMILY_RUNTIME_COMMANDS = new Set([
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "bunx",
  "npm.cmd",
  "npx.cmd",
  "pnpm.cmd",
  "yarn.cmd",
  "bun.cmd",
  "bunx.cmd",
  "npm.exe",
  "npx.exe",
  "pnpm.exe",
  "yarn.exe",
  "bun.exe",
  "bunx.exe",
]);

const PACKAGE_ARG_OPTIONS_WITH_VALUE = new Set([
  "-p",
  "--package",
  "--package-name",
  "--registry",
  "--cache",
  "--userconfig",
  "--prefix",
]);

const PACKAGE_ARG_FLAGS = new Set([
  "-y",
  "--yes",
  "--quiet",
  "--silent",
  "--no",
  "--no-install",
  "--ignore-existing",
  "--prefer-offline",
  "--offline",
]);

function isRuntimePackageSpecifier(value: string): boolean {
  if (!value || value.startsWith("-") || value === "--") return false;
  if (/^(?:https?|git\+ssh|git\+https?):/i.test(value)) return false;
  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("~") || value.includes("\\") || value.includes(":")) return false;
  return /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+(?:@[a-z0-9._~+-]+)?$/i.test(value);
}

function findPackageSpecifier(args: string[], commandName: string): string | null {
  let start = 0;
  if (commandName === "npm" && ["exec", "x", "dlx"].includes(args[0] ?? "")) start = 1;
  if (commandName === "pnpm" && ["dlx", "exec"].includes(args[0] ?? "")) start = 1;
  if (commandName === "yarn" && ["dlx", "exec"].includes(args[0] ?? "")) start = 1;
  if (commandName === "bun" && ["x", "runx"].includes(args[0] ?? "")) start = 1;

  for (let i = start; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg || arg === "--") break;
    if (arg.startsWith("--package=")) {
      const value = arg.slice("--package=".length);
      return isRuntimePackageSpecifier(value) ? value : null;
    }
    if (PACKAGE_ARG_OPTIONS_WITH_VALUE.has(arg)) {
      const value = args[i + 1];
      if (arg === "-p" || arg === "--package" || arg === "--package-name") {
        return value && isRuntimePackageSpecifier(value) ? value : null;
      }
      i += 1;
      continue;
    }
    if (PACKAGE_ARG_FLAGS.has(arg)) continue;
    if (arg.startsWith("-")) continue;
    return isRuntimePackageSpecifier(arg) ? arg : null;
  }

  return null;
}

function runtimeNpmPreflightEnv(concurrency: number): Record<string, string> {
  const maxSockets = String(Math.max(1, Math.min(16, concurrency)));
  return {
    ...QUIET_PACKAGE_MANAGER_ENV,
    npm_config_maxsockets: maxSockets,
    NPM_CONFIG_MAXSOCKETS: maxSockets,
  };
}

function isSafeNpmPreflightEnvKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (/(?:token|secret|password|passwd|credential|auth|cookie|key)/i.test(key)) return false;
  if (["http_proxy", "https_proxy", "no_proxy"].includes(lower)) return true;
  if (!lower.startsWith("npm_config_")) return false;
  const npmKey = lower.slice("npm_config_".length).replace(/-/g, "_");
  return [
    "registry",
    "proxy",
    "https_proxy",
    "http_proxy",
    "noproxy",
    "no_proxy",
    "strict_ssl",
    "cafile",
    "userconfig",
    "cache",
  ].includes(npmKey);
}

function runtimeNpmPreflightServerEnv(server: Record<string, unknown>): Record<string, string> {
  const env = isRecord(server.env) ? server.env : {};
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isSafeNpmPreflightEnvKey(key)) continue;
    if (typeof value === "string") {
      safe[key] = value;
    }
  }
  return safe;
}

function isNpmFamilyRuntimeServer(server: Record<string, unknown>): boolean {
  const command = typeof server.command === "string" ? basenameOfRuntimeCommand(server.command) : "";
  return NPM_FAMILY_RUNTIME_COMMANDS.has(command);
}

function buildPreflightProbeCommand(server: Record<string, unknown>, concurrency: number): PreflightProbe | null {
  const command = typeof server.command === "string" ? server.command : "";
  if (!command) return null;
  const commandName = basenameOfRuntimeCommand(command);
  if (!NPM_FAMILY_RUNTIME_COMMANDS.has(commandName)) return null;
  if (runtimeShellInlineScripts(server).length > 0) return null;

  const args = Array.isArray(server.args)
    ? server.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const packageSpec = findPackageSpecifier(args, commandName);
  if (!packageSpec) return null;

  return {
    command: "npm",
    args: [
      "view",
      packageSpec,
      "version",
      "--json",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--progress=false",
      "--loglevel=error",
      "--fetch-retries=0",
      "--fetch-retry-mintimeout=1000",
      "--fetch-retry-maxtimeout=1000",
      `--maxsockets=${Math.max(1, Math.min(16, concurrency))}`,
    ],
    env: {
      ...runtimeNpmPreflightEnv(concurrency),
      ...runtimeNpmPreflightServerEnv(server),
    },
    packageSpec,
  };
}

function safePreflightProcessEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "TMP", "TMPDIR", "TEMP", "SystemRoot", "ComSpec"]) {
    const value = process.env[key];
    if (value !== undefined) safe[key] = value;
  }
  return safe;
}

async function runPreflightProbe(
  probe: PreflightProbe,
  timeoutMs: number
): Promise<{ failed: boolean; reason?: RuntimeMcpPreflightFailureReason; detail?: string }> {
  try {
    const result = await execa(probe.command, probe.args, {
      env: { ...safePreflightProcessEnv(), ...probe.env },
      extendEnv: false,
      timeout: timeoutMs,
      reject: false,
      stdio: "pipe",
    });
    if (result.timedOut) {
      return { failed: true, reason: "timeout", detail: `timeout after ${timeoutMs}ms` };
    }
    if (result.exitCode !== 0) {
      return { failed: true, reason: "exit", detail: `exit ${result.exitCode}` };
    }
    return { failed: false };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    return { failed: true, reason: "exit", detail: code ? `spawn failed (${code})` : "spawn failed" };
  }
}

export async function preflightRuntimeMcpServers(
  servers: Record<string, unknown>,
  options: RuntimeMcpPreflightOptions
): Promise<RuntimeMcpPreflightResult> {
  const entries = Object.entries(servers);
  const failed = new Set<string>();
  const details = new Map<string, { reason: RuntimeMcpPreflightFailureReason; detail: string }>();
  const results: RuntimeMcpPreflightEntry[] = [];

  async function probeOne([name, server]: [string, unknown]): Promise<void> {
    if (!isRecord(server) || typeof server.url === "string" || !isNpmFamilyRuntimeServer(server)) {
      results.push({ name, status: "skipped", reason: "not-npm-family" });
      return;
    }
    const probe = buildPreflightProbeCommand(server, options.concurrency);
    if (!probe) {
      results.push({ name, status: "skipped", reason: "no-package-spec" });
      return;
    }
    const result = await runPreflightProbe(probe, options.timeoutMs);
    if (result.failed) {
      failed.add(name);
      if (result.reason && result.detail) {
        details.set(name, { reason: result.reason, detail: result.detail });
      }
      results.push({
        name,
        status: "failed",
        reason: result.reason ?? "exit",
        detail: formatPreflightFailureDetail(result.reason, result.detail),
        packageSpec: probe.packageSpec,
      });
      return;
    }
    results.push({ name, status: "ok", packageSpec: probe.packageSpec });
  }

  const concurrency = Math.max(1, options.concurrency);
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    await Promise.all(batch.map(probeOne));
  }

  const order = new Map(entries.map(([name], index) => [name, index]));
  results.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  return { failed, details, entries: results };
}
