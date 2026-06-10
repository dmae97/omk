import { chmod, readdir, readFile, realpath, rm, stat, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { getOmkResourceSettings, type OmkRuntimeScope } from "../resource-profile.js";
import { resolveRuntimeProfile, buildProfileArgs } from "../runtime-profile.js";
import { ensureDir, pathExists } from "./core.js";
import {
  getKimiDefaultModel,
  getKimiSkillsDir,
  getProjectRoot,
  getProjectRootAsync,
  getUserHome,
} from "./paths.js";
import {
  collectMcpConfigs,
  diagnoseRuntimeMcpServer,
  type RuntimeMcpNormalization,
  type RuntimeMcpPruneDiagnostic,
} from "./mcp-diagnose.js";
import {
  preflightRuntimeMcpServers,
  resolveRuntimeMcpPreflightOptions,
  type RuntimeMcpPreflightResult,
} from "./preflight.js";
import {
  formatPreflightFailureDetail,
  hasHttpTransportMismatch,
  isPackageManagerRuntimeServer,
  isRecord,
  isShellInlineMcpArg,
  PDF_MCP_SERVER_RE,
  QUIET_PACKAGE_MANAGER_ENV,
  registerRuntimeMcpCleanupPath,
  runtimeCommandText,
  sanitizeRuntimeMcpPreflightText,
} from "./internal.js";

async function readMcpServersForRuntime(configPath: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as { mcpServers?: unknown; mcp_servers?: unknown };
    const servers = parsed.mcpServers ?? parsed.mcp_servers;
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      return normalizeRuntimeMcpRelativePaths(servers as Record<string, unknown>, configPath);
    }
  } catch {
    // Existing doctor/preflight paths report invalid config details. Runtime merge
    // skips unreadable files so Kimi does not receive partial/broken JSON.
  }
  return {};
}

function normalizeRuntimeMcpRelativePaths(servers: Record<string, unknown>, configPath: string): Record<string, unknown> {
  const baseDir = runtimeMcpPathBase(configPath);
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, normalizeRuntimeMcpRelativePathServer(server, baseDir)])
  );
}

function runtimeMcpPathBase(configPath: string): string {
  const root = resolve(getProjectRoot());
  const resolvedConfig = resolve(configPath);
  const relativeToRoot = relative(root, resolvedConfig);
  if (relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !isAbsolute(relativeToRoot))) {
    return root;
  }
  return dirname(resolvedConfig);
}

function normalizeRuntimeMcpRelativePathServer(server: unknown, baseDir: string): unknown {
  if (!isRecord(server) || typeof server.url === "string") return server;
  let changed = false;
  const next: Record<string, unknown> = { ...server };
  if (typeof next.command === "string" && isRelativeRuntimeMcpPathLike(next.command)) {
    next.command = resolve(baseDir, next.command);
    changed = true;
  }
  if (Array.isArray(next.args)) {
    const args = next.args.map((arg, index) => {
      if (typeof arg === "string" && isShellInlineMcpArg(server, index)) {
        const normalized = normalizeRuntimeMcpInlineScript(arg, baseDir);
        if (normalized.changed) changed = true;
        return normalized.script;
      }
      if (!shouldNormalizeRuntimeMcpRelativeArg(server, arg, index)) return arg;
      changed = true;
      return resolve(baseDir, arg);
    });
    next.args = args;
  }
  return changed ? next : server;
}

function isRelativeRuntimeMcpPathLike(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || value.startsWith(".\\") || value.startsWith("..\\");
}

function shouldNormalizeRuntimeMcpRelativeArg(server: Record<string, unknown>, arg: unknown, index: number): arg is string {
  if (typeof arg !== "string" || !isRelativeRuntimeMcpPathLike(arg)) return false;
  if (isShellInlineMcpArg(server, index)) return false;
  if (/[ \t\r\n;"'|&<>]/.test(arg)) return false;
  return true;
}

function normalizeRuntimeMcpInlineScript(script: string, baseDir: string): { script: string; changed: boolean } {
  let changed = false;
  const nextScript = script.replace(
    /(^|[\s"'`=:(])((?:\.{1,2}[\\/])[^ \t\r\n"'`|&;<>:)]+)/g,
    (match, prefix: string, relativePath: string) => {
      if (/[$*?[\]{}]/.test(relativePath)) return match;
      const absolutePath = resolve(baseDir, relativePath);
      if (/[ \t\r\n"'`]/.test(absolutePath)) return match;
      changed = true;
      return `${prefix}${absolutePath}`;
    }
  );
  return { script: nextScript, changed };
}

function emitPreflightSummary(result: RuntimeMcpPreflightResult, removedNames: Set<string> = result.failed): void {
  if (result.failed.size === 0 || process.env.OMK_MCP_SUPPRESS_PRUNE_WARNINGS === "1") return;
  const parts: string[] = [];
  for (const name of result.failed) {
    const detail = result.details.get(name);
    if (detail) {
      parts.push(`${sanitizeRuntimeMcpPreflightText(name)} (${formatPreflightFailureDetail(detail.reason, detail.detail)})`);
    } else {
      parts.push(sanitizeRuntimeMcpPreflightText(name));
    }
  }
  const shown = parts.slice(0, 5).join(", ");
  const suffix = parts.length > 5 ? `, +${parts.length - 5} more` : "";
  const removedCount = removedNames.size;
  const keptCount = Math.max(0, result.failed.size - removedCount);
  const action = removedCount > 0
    ? `Removed ${removedCount} failed server(s)`
    : "No servers were removed";
  const kept = keptCount > 0
    ? ` Kept ${keptCount} timeout server(s) as prewarm-needed.`
    : "";
  console.warn(
    `[omk] MCP preflight found ${result.failed.size} issue(s) in npm-family servers: ${shown}${suffix}. ` +
    `${action}.${kept} Run \`omk mcp check --all\` (or \`omk mcp prewarm --all\`) to check caches, ` +
    "or `omk mcp doctor --fix` for durable repairs."
  );
}

function normalizeRuntimeMcpServer(
  name: string,
  server: unknown
): { server: unknown; normalizations: RuntimeMcpNormalization[] } {
  if (!isRecord(server) || typeof server.url === "string" || !hasHttpTransportMismatch(name, server)) {
    return { server, normalizations: [] };
  }
  const args = Array.isArray(server.args) ? [...server.args] : [];
  let changed = false;
  for (const [index, arg] of args.entries()) {
    if (typeof arg !== "string" || !isShellInlineMcpArg(server, index) || !PDF_MCP_SERVER_RE.test(arg)) continue;
    args[index] = `${arg.trimEnd()} --stdio`;
    changed = true;
  }
  if (!changed && PDF_MCP_SERVER_RE.test(runtimeCommandText(server))) {
    args.push("--stdio");
    changed = true;
  }
  if (!changed) return { server, normalizations: [] };
  return {
    server: { ...server, args },
    normalizations: [{
      name,
      kind: "runtime-stdio-normalized",
      message: "runtime MCP config was normalized to stdio transport before startup; run `omk mcp doctor --fix` to persist the repair",
    }],
  };
}

function prepareRuntimeMcpServer(server: unknown): unknown {
  if (!isRecord(server) || typeof server.url === "string" || !isPackageManagerRuntimeServer(server)) {
    return server;
  }
  const existingEnv = isRecord(server.env) ? server.env : {};
  const env = { ...QUIET_PACKAGE_MANAGER_ENV, ...existingEnv };
  return { ...server, env };
}

export async function pruneRuntimeMcpServers(
  servers: Record<string, unknown>
): Promise<{
  servers: Record<string, unknown>;
  diagnostics: RuntimeMcpPruneDiagnostic[];
  normalizations: RuntimeMcpNormalization[];
}> {
  const pruned: Record<string, unknown> = {};
  const diagnostics: RuntimeMcpPruneDiagnostic[] = [];
  const normalizations: RuntimeMcpNormalization[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const normalized = normalizeRuntimeMcpServer(name, server);
    const normalizedServer = normalized.server;
    const serverDiagnostics = await diagnoseRuntimeMcpServer(name, normalizedServer);
    if (serverDiagnostics.length > 0) {
      diagnostics.push(...serverDiagnostics);
      continue;
    }
    normalizations.push(...normalized.normalizations);
    pruned[name] = prepareRuntimeMcpServer(normalizedServer);
  }
  return { servers: pruned, diagnostics, normalizations };
}

function emitRuntimeMcpNormalizationNotice(normalizations: RuntimeMcpNormalization[]): void {
  if (normalizations.length === 0 || process.env.OMK_MCP_SUPPRESS_PRUNE_WARNINGS === "1") return;
  const names = [...new Set(normalizations.map((diagnostic) => diagnostic.name))];
  const shown = names.slice(0, 5).join(", ");
  const suffix = names.length > 5 ? `, +${names.length - 5} more` : "";
  console.warn(
    `[omk] normalized ${names.length} MCP server(s) for Kimi startup: ${shown}${suffix}. `
    + "Run `omk mcp doctor --fix` to persist the repair."
  );
}

function emitRuntimeMcpPruneWarning(diagnostics: RuntimeMcpPruneDiagnostic[]): void {
  if (diagnostics.length === 0 || process.env.OMK_MCP_SUPPRESS_PRUNE_WARNINGS === "1") return;
  const names = [...new Set(diagnostics.map((diagnostic) => diagnostic.name))];
  const shown = names.slice(0, 5).join(", ");
  const suffix = names.length > 5 ? `, +${names.length - 5} more` : "";
  console.warn(
    `[omk] skipped ${names.length} broken MCP server(s) before Kimi startup: ${shown}${suffix}. `
    + "Run `omk mcp doctor` to repair stale global MCP config."
  );
}

export async function writeRuntimeMcpConfig(
  configPaths: string[],
  allowlist?: readonly string[]
): Promise<string | null> {
  const uniquePaths = [...new Set(configPaths)];
  const mergedServers: Record<string, unknown> = {};
  for (const configPath of uniquePaths) {
    Object.assign(mergedServers, await readMcpServersForRuntime(configPath));
  }
  let targetServers = mergedServers;
  if (allowlist !== undefined && allowlist.length === 0) {
    targetServers = {};
  } else if (allowlist && allowlist.length > 0) {
    const allowed = new Set(allowlist);
    const missing = allowlist.filter((name) => !mergedServers[name]);
    if (missing.length > 0) {
      console.warn(`[omk] MCP allowlist contains servers not found in config: ${missing.join(", ")}`);
    }
    targetServers = Object.fromEntries(
      Object.entries(mergedServers).filter(([name]) => allowed.has(name))
    );
  }
  const { servers: runtimeServers, diagnostics, normalizations } = await pruneRuntimeMcpServers(targetServers);
  emitRuntimeMcpPruneWarning(diagnostics);
  emitRuntimeMcpNormalizationNotice(normalizations);

  const preflightOptions = resolveRuntimeMcpPreflightOptions();
  const preflightMode = preflightOptions.mode;
  if (preflightMode !== "off") {
    const preflightResult = await preflightRuntimeMcpServers(runtimeServers, preflightOptions);
    const removedByPreflight = new Set<string>();
    for (const name of Object.keys(runtimeServers)) {
      if (preflightResult.failed.has(name)) {
        if (preflightMode === "strict") {
          const parts: string[] = [];
          for (const failedName of preflightResult.failed) {
            const detail = preflightResult.details.get(failedName);
            parts.push(
              `${sanitizeRuntimeMcpPreflightText(failedName)} (${formatPreflightFailureDetail(detail?.reason, detail?.detail)})`
            );
          }
          throw new Error(
            `[omk] MCP preflight strict mode: server "${name}" failed probe. ` +
            parts.join(", ")
          );
        }
        const detail = preflightResult.details.get(name);
        if (detail?.reason === "timeout") {
          // Timeout-only failures are kept as prewarm-needed; do not delete.
          continue;
        }
        delete runtimeServers[name];
        removedByPreflight.add(name);
      }
    }
    if (preflightResult.failed.size > 0) {
      emitPreflightSummary(preflightResult, removedByPreflight);
    }
  }

  if (Object.keys(runtimeServers).length === 0) return null;

  const root = await getProjectRootAsync();
  const cacheDir = join(root, ".omk", "cache");
  await ensureDir(cacheDir);
  await chmod(cacheDir, 0o700).catch(() => undefined);

  // Eagerly remove stale runtime configs left by prior crashed/killed processes
  await cleanupStaleRuntimeMcpConfigs(cacheDir);

  const runtimeConfigPath = join(cacheDir, `mcp-runtime-merged-${process.pid}-${Date.now()}.json`);
  await writeFile(runtimeConfigPath, JSON.stringify({ mcpServers: runtimeServers }, null, 2) + "\n", { mode: 0o600 });
  registerRuntimeMcpCleanupPath(runtimeConfigPath);
  return runtimeConfigPath;
}

async function cleanupStaleRuntimeMcpConfigs(cacheDir: string): Promise<void> {
  const now = Date.now();
  try {
    const entries = await readdir(cacheDir);
    const stale = entries.filter((name) => name.startsWith("mcp-runtime-merged-") && name.endsWith(".json"));
    for (const name of stale) {
      const fullPath = join(cacheDir, name);
      if (!(await shouldCleanupRuntimeMcpConfig(fullPath, name, now))) continue;
      try {
        await rm(fullPath, { force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  } catch {
    // Directory may not exist or be unreadable
  }
}

async function shouldCleanupRuntimeMcpConfig(fullPath: string, fileName: string, now: number): Promise<boolean> {
  const match = /^mcp-runtime-merged-(\d+)-(\d+)\.json$/.exec(fileName);
  if (match) {
    const ownerPid = Number.parseInt(match[1], 10);
    if (Number.isFinite(ownerPid) && ownerPid > 0 && isProcessAlive(ownerPid)) {
      return false;
    }
    return true;
  }

  try {
    const info = await stat(fullPath);
    return now - info.mtimeMs > 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Auto-generate a built-in omk-project MCP config so users never need to
 * define it manually in ~/.kimi/mcp.json or .kimi/mcp.json.
 * The config uses the currently-running omk CLI path and sets OMK_PROJECT_ROOT
 * to the current project root.
 */
export async function writeBuiltinMcpConfig(): Promise<string | null> {
  const root = getProjectRoot();
  const cacheDir = join(root, ".omk", "cache");
  await ensureDir(cacheDir);
  await chmod(cacheDir, 0o700).catch(() => undefined);

  let omkCliPath: string;
  try {
    omkCliPath = await realpath(process.argv[1] ?? "");
  } catch {
    omkCliPath = process.argv[1] ?? "omk";
  }

  const autoConfigPath = join(cacheDir, `mcp-auto-omk-project-${process.pid}-${Date.now()}.json`);
  const config = {
    mcpServers: {
      "omk-project": {
        command: process.argv[0] || "node",
        args: [omkCliPath, "mcp", "serve", "omk-project"],
        env: {
          OMK_PROJECT_ROOT: root,
          npm_config_loglevel: "error",
          NODE_NO_WARNINGS: "1",
        },
      },
    },
  };

  await writeFile(autoConfigPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  registerRuntimeMcpCleanupPath(autoConfigPath);
  return autoConfigPath;
}

/** Kimi CLI 실행 인자에 model + MCP + Skills 주입 (전역 동기화는 별도) */
export async function injectKimiGlobals(
  args: string[],
  options: {
    mcpScope?: OmkRuntimeScope;
    skillsScope?: OmkRuntimeScope;
    hooksScope?: OmkRuntimeScope;
    role?: string;
    mcpAllowlist?: readonly string[];
  } = {}
): Promise<void> {
  const resources = await getOmkResourceSettings();
  const mcpScope = options.mcpScope ?? resources.mcpScope;
  const skillsScope = options.skillsScope ?? resources.skillsScope;
  const hooksScope = options.hooksScope ?? resources.hooksScope;

  // Resolve role-based runtime profile and inject supported flags
  let injectedModel: string | undefined;
  if (options.role) {
    const profile = await resolveRuntimeProfile(options.role);
    const { getKimiCapabilities } = await import("../../kimi/capability.js");
    const caps = getKimiCapabilities();
    const profileArgs = buildProfileArgs(profile, caps);
    args.push(...profileArgs);
    injectedModel = profile.model;

    // maxOutputMb is not a native CLI flag; map to env hint if present
    if (profile.maxOutputMb !== undefined && !process.env.OMK_MAX_OUTPUT_MB) {
      // Handled downstream by resource-profile.ts / shell runners
    }
  }

  // default_model이 있으면 주입 (agent-file 사용 시 model이 unset 될 수 있음)
  // Profile model takes precedence; skip duplicate injection.
  if (!injectedModel) {
    const defaultModel = await getKimiDefaultModel();
    if (defaultModel) {
      args.push("--model", defaultModel);
    }
  }

  if (mcpScope !== "none") {
    const mcpConfigs = await collectMcpConfigs(mcpScope);
    // Auto-inject built-in omk-project MCP server so it never needs user config.
    // Merge runtime configs before passing them to Kimi: Kimi warns on duplicate
    // server names across multiple --mcp-config-file values and then overrides
    // silently. A single merged config preserves the same precedence (global first,
    // project second, built-in omk-project last) without duplicate startup noise.
    const builtinMcp = await writeBuiltinMcpConfig();
    const allowlist = options.mcpAllowlist !== undefined
      ? [...new Set([...options.mcpAllowlist, "omk-project"].map((name) => name.trim()).filter(Boolean))]
      : undefined;
    const runtimeMcp = await writeRuntimeMcpConfig(
      builtinMcp ? [...mcpConfigs, builtinMcp] : mcpConfigs,
      allowlist
    );
    if (runtimeMcp) {
      args.push("--mcp-config-file", runtimeMcp);
    } else if (allowlist && allowlist.length > 0) {
      console.warn(
        `[omk] MCP allowlist resulted in zero available servers. ` +
          `Allowed: ${allowlist.join(", ")}. ` +
          `Check that the allowlist matches actual MCP server names in your config. ` +
          `MCP config will not be passed to Kimi.`
      );
    }
  }

  const globalSkillsDir = join(getUserHome(), ".kimi", "skills");
  const projectSkillsDir = getKimiSkillsDir();
  const [globalSkillsExists, projectSkillsExists] = await Promise.all([
    skillsScope === "all" ? pathExists(globalSkillsDir) : Promise.resolve(false),
    skillsScope !== "none" ? pathExists(projectSkillsDir) : Promise.resolve(false),
  ]);
  if (globalSkillsExists) args.push("--skills-dir", globalSkillsDir);
  if (projectSkillsExists) args.push("--skills-dir", projectSkillsDir);

  if (process.env.OMK_DEBUG === "1") {
    const mcpFiles = await collectMcpConfigs(mcpScope);
    const skillDirs: string[] = [];
    if (globalSkillsExists) skillDirs.push(globalSkillsDir);
    if (projectSkillsExists) skillDirs.push(projectSkillsDir);
    const modelIdx = args.indexOf("--model");
    const effectiveModel = modelIdx >= 0 ? args[modelIdx + 1] : null;
    console.error("[OMK_DEBUG] injectKimiGlobals:", {
      role: options.role ?? null,
      model: effectiveModel,
      mcpFiles,
      skillDirs,
      mcpScope,
      skillsScope,
      hooksScope,
      mcpAllowlist: options.mcpAllowlist ?? null,
    });
  }
}
