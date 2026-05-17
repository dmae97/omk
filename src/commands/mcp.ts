import { mkdir, readFile, writeFile } from "fs/promises";

import { dirname, join, isAbsolute } from "path";
import { runShell, which } from "../util/shell.js";
import { collectMcpConfigs, diagnoseRuntimeMcpServer, getProjectRoot, pathExists, getUserHome, STALE_PACKAGE_NAMES } from "../util/fs.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { style, header, status, bullet, label } from "../util/theme.js";

interface McpServerConfig {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  http_headers?: Record<string, string>;
  startup_timeout_sec?: number;
  enabled?: boolean;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

interface ConfigSource {
  path: string;
  config: McpConfig;
  exists: boolean;
  parsed: boolean;
  error?: string;
}

interface CollectedMcpServer {
  server: McpServerConfig;
  sources: string[];
  serversBySource: Map<string, McpServerConfig>;
}

interface MutableMcpConfigSource {
  path: string;
  config: McpConfig & Record<string, unknown>;
  changed: boolean;
}

export interface McpDoctorOptions {
  json?: boolean;
  fix?: boolean;
}

type McpDoctorSeverity = "ok" | "info" | "warn" | "error";

export interface McpDoctorCheck {
  severity: McpDoctorSeverity;
  kind: string;
  message: string;
}

export interface McpDoctorSourceReport {
  path: string;
  exists: boolean;
  active: boolean;
  parsed: boolean;
  status: "ok" | "empty" | "error";
  serverCount: number;
  error?: string;
}

export interface McpDoctorServerReport {
  name: string;
  status: "ok" | "warn" | "error";
  active: boolean;
  sources: string[];
  activeSources: string[];
  transport: "remote" | "stdio" | "invalid";
  url?: string;
  command?: string;
  resolvedCommand?: string;
  timeoutSec?: number;
  checks: McpDoctorCheck[];
}

export interface McpDoctorReport {
  ok: boolean;
  command: "mcp doctor";
  checkedAt: string;
  activeScope: string;
  issueCount: number;
  errors: string[];
  warnings: string[];
  fixes?: McpDoctorFixReport;
  sources: McpDoctorSourceReport[];
  servers: McpDoctorServerReport[];
  data: {
    activeScope: string;
    sourceCount: number;
    serverCount: number;
  };
}

export interface McpDoctorFixReport {
  changed: boolean;
  actions: string[];
  skipped: string[];
}

const RAILWAY_REMOTE_MCP_URL = "https://mcp.railway.com";
const JSON_RPC_INTERNAL_ERROR_CODE = -32603;
const AUTO_DISABLE_RUNTIME_BLOCKERS = new Set([
  "missing-command",
  "command-path-not-found",
  "arg-path-not-found",
  "shell-builtin-command",
  "windows-set-inline",
  "inline-script-path-not-found",
  "stale-home-reference",
  "stdio-http-transport",
  "invalid-server",
]);

interface JsonRpcProbeResponse {
  id?: string | number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

async function loadConfig(filePath: string): Promise<ConfigSource> {
  if (!(await pathExists(filePath))) {
    return { path: filePath, config: {}, exists: false, parsed: true };
  }
  try {
    const content = await readFile(filePath, "utf-8");
    const config = JSON.parse(content) as McpConfig;
    return { path: filePath, config, exists: true, parsed: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: filePath, config: {}, exists: true, parsed: false, error: `Invalid JSON: ${message}` };
  }
}

async function resolveAllConfigs(): Promise<ConfigSource[]> {
  const root = getProjectRoot();
  const paths = [
    join(root, ".omk", "mcp.json"),
    join(root, ".kimi", "mcp.json"),
    join(getUserHome(), ".kimi", "mcp.json"),
  ];
  const results: ConfigSource[] = [];
  for (const p of paths) {
    results.push(await loadConfig(p));
  }
  return results;
}

async function ensureMcpConfigFile(
  filePath: string,
  config: McpConfig & Record<string, unknown>,
  actions: string[]
): Promise<void> {
  if (await pathExists(filePath)) return;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  actions.push(`created MCP config ${filePath}`);
}

function hasConfiguredMcpServers(config: McpConfig | null | undefined): boolean {
  return Object.keys(config?.mcpServers ?? {}).length > 0;
}

async function readParsedMcpConfig(filePath: string): Promise<(McpConfig & Record<string, unknown>) | null> {
  if (!(await pathExists(filePath))) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf-8")) as McpConfig & Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function migrateLegacyOmkMcpBeforeEnsure(
  omkMcpPath: string,
  projectMcpPath: string,
  actions: string[]
): Promise<void> {
  const legacyConfig = await readParsedMcpConfig(omkMcpPath);
  if (!hasConfiguredMcpServers(legacyConfig)) return;

  const projectConfig = await readParsedMcpConfig(projectMcpPath);
  if (projectConfig && hasConfiguredMcpServers(projectConfig)) return;

  const migratedConfig: McpConfig & Record<string, unknown> = {
    ...(projectConfig ?? {}),
    _comment: "Project-local MCP config migrated from legacy .omk/mcp.json; review secrets before sharing.",
    mcpServers: { ...(legacyConfig?.mcpServers ?? {}) },
  };
  await mkdir(dirname(projectMcpPath), { recursive: true });
  await writeFile(projectMcpPath, JSON.stringify(migratedConfig, null, 2) + "\n", "utf-8");
  actions.push(`migrated legacy MCP servers from ${omkMcpPath} to ${projectMcpPath}`);
}

function repairMcpServerConfig(name: string, server: McpServerConfig): string[] {
  const actions: string[] = [];
  if (server.command && isHttpUrl(server.command) && (!server.args || server.args.length === 0)) {
    server.url = server.command;
    delete server.command;
    delete server.args;
    actions.push(`converted "${name}" command URL to remote url transport`);
  }

  if (!server.url && server.args?.includes("@modelcontextprotocol/server-pdf") && !server.args.includes("--stdio")) {
    server.args = [...server.args, "--stdio"];
    actions.push(`added --stdio to "${name}" PDF MCP server`);
  }

  if (!server.url && server.args) {
    let replaced = false;
    server.args = server.args.map((arg) => {
      const replacement = STALE_PACKAGE_NAMES[arg];
      if (!replacement) return arg;
      replaced = true;
      return replacement;
    });
    if (replaced) actions.push(`replaced stale MCP package argument for "${name}"`);
  }

  if (!server.url && isNpmLauncherCommand(server.command) && !server.startup_timeout_sec) {
    server.startup_timeout_sec = 15;
    actions.push(`set 15s startup timeout for npm-based MCP "${name}"`);
  }

  return actions;
}

function disabledMcpServers(config: McpConfig & Record<string, unknown>): Record<string, unknown> {
  const current = config._omkDisabledMcpServers;
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  config._omkDisabledMcpServers = next;
  return next;
}

function moveMcpServerToDisabled(
  source: MutableMcpConfigSource,
  name: string,
  server: McpServerConfig,
  reason: string
): void {
  const disabled = disabledMcpServers(source.config);
  disabled[name] = {
    ...server,
    _omkDisabledAt: new Date().toISOString(),
    _omkDisabledReason: reason,
  };
  delete source.config.mcpServers?.[name];
  source.changed = true;
}

function collectServers(sources: ConfigSource[]): Map<string, CollectedMcpServer> {
  const map = new Map<string, CollectedMcpServer>();
  for (const src of sources) {
    if (!src.parsed || !src.config.mcpServers) continue;
    for (const [name, server] of Object.entries(src.config.mcpServers)) {
      const existing = map.get(name);
      if (existing) {
        existing.sources.push(src.path);
        existing.serversBySource.set(src.path, server);
      } else {
        map.set(name, { server, sources: [src.path], serversBySource: new Map([[src.path, server]]) });
      }
    }
  }
  return map;
}

function selectEffectiveServer(info: CollectedMcpServer, activePathOrder: string[]): McpServerConfig {
  for (let index = activePathOrder.length - 1; index >= 0; index--) {
    const server = info.serversBySource.get(activePathOrder[index]);
    if (server) return server;
  }
  return info.server;
}

export async function mcpListCommand(): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);
  const resources = await getOmkResourceSettings();
  const activePathOrder = await collectMcpConfigs(resources.mcpScope);
  const activePaths = new Set(activePathOrder);

  console.log(header("MCP Servers"));

  for (const src of sources) {
    const icon = !src.exists ? style.gray("-") : src.parsed ? style.mint("✓") : style.pink("✗");
    const marker = activePaths.has(src.path) ? style.mint(" [active]") : style.gray(" [inactive]");
    const missing = !src.exists ? style.gray(" (not found)") : "";
    console.log(`${icon} ${src.path}${marker}${missing}`);
    if (src.error) console.log(`  ${style.gray(src.error)}`);
  }

  if (servers.size === 0) {
    console.log("\n" + style.gray("No MCP servers configured."));
    return;
  }

  console.log("");
  let duplicateCount = 0;
  for (const [name, info] of servers) {
    const server = selectEffectiveServer(info, activePathOrder);
    const activeSources = info.sources.filter((source) => activePaths.has(source));
    const dup = info.sources.length > 1 ? style.skin(` [duplicate: ${info.sources.length} sources]`) : "";
    if (info.sources.length > 1) duplicateCount++;
    const activeMarker = activeSources.length > 0 ? style.mint(" [active]") : style.gray(" [inactive]");
    console.log(bullet(`${style.purpleBold(name)}${dup}${activeMarker}`, "purple"));
    if (server.url) {
      console.log(`  ${style.gray("url:")} ${sanitizeMcpUrlForDisplay(server.url)}`);
    }
    if (server.command || !server.url) {
      console.log(`  ${style.gray("command:")} ${server.command ?? style.pink("missing")}`);
    }
    if (server.args && server.args.length > 0) {
      console.log(`  ${style.gray("args:")} ${formatArgsForDisplay(server.args)}`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      console.log(`  ${style.gray("env:")} ${Object.keys(server.env).join(", ")}`);
    }
    console.log(`  ${style.gray("from:")} ${info.sources.join(", ")}`);
    if (activeSources.length > 0) {
      console.log(`  ${style.gray("active from:")} ${activeSources.join(", ")}`);
    }
  }

  if (duplicateCount > 0) {
    console.log("");
    console.log(style.skin(`⚠  ${duplicateCount} duplicate server(s) detected. Run \`omk mcp doctor\` for details, or \`omk mcp remove <name>\` to delete a local copy.`));
  }
}

export async function mcpDoctorCommand(options: McpDoctorOptions = {}): Promise<void> {
  const fixes = options.fix ? await repairMcpDoctorIssues() : undefined;
  const report = await buildMcpDoctorReport();
  if (fixes) report.fixes = fixes;

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  emitMcpDoctorText(report);
  if (!report.ok) process.exitCode = 1;
}

export async function repairMcpDoctorIssues(): Promise<McpDoctorFixReport> {
  const root = getProjectRoot();
  const projectOmkDir = join(root, ".omk");
  const projectKimiDir = join(root, ".kimi");
  const omkMcpPath = join(projectOmkDir, "mcp.json");
  const projectMcpPath = join(projectKimiDir, "mcp.json");
  const actions: string[] = [];
  const skipped: string[] = [];

  await Promise.all([
    mkdir(projectOmkDir, { recursive: true }),
    mkdir(projectKimiDir, { recursive: true }),
  ]);

  await migrateLegacyOmkMcpBeforeEnsure(omkMcpPath, projectMcpPath, actions);
  await ensureMcpConfigFile(omkMcpPath, { mcpServers: {} }, actions);
  await ensureMcpConfigFile(projectMcpPath, {
    _comment: "Project-local MCP config. omk-project is virtual runtime MCP injected; global MCP servers remain in ~/.kimi/mcp.json and must be imported explicitly only after secret review.",
    mcpServers: {},
  }, actions);

  const sources = await resolveAllConfigs();
  const resources = await getOmkResourceSettings();
  const activePathOrder = await collectMcpConfigs(resources.mcpScope);
  const activePaths = new Set(activePathOrder);
  const activePreferredPath = activePathOrder.at(-1);
  const globalMcpPath = join(getUserHome(), ".kimi", "mcp.json");
  const mutableSources = new Map<string, MutableMcpConfigSource>();

  for (const source of sources) {
    if (!source.exists) continue;
    if (!source.parsed) {
      skipped.push(`invalid JSON left unchanged: ${source.path}`);
      continue;
    }
    mutableSources.set(source.path, {
      path: source.path,
      config: { ...source.config, mcpServers: { ...(source.config.mcpServers ?? {}) } },
      changed: false,
    });
  }

  const servers = collectServers(sources);
  for (const [name, info] of servers) {
    const activeSources = info.sources.filter((sourcePath) => activePaths.has(sourcePath));
    if (activeSources.length <= 1) continue;

    const projectActiveSources = activeSources.filter((sourcePath) => sourcePath !== globalMcpPath);
    if (activeSources.includes(globalMcpPath) && projectActiveSources.length > 0) {
      skipped.push(`duplicate MCP "${name}" spans global/project; kept project override: ${activeSources.join(", ")}`);
      continue;
    }

    const removableSources = activeSources.includes(globalMcpPath)
      ? activeSources.filter((sourcePath) => sourcePath !== globalMcpPath)
      : activeSources.filter((sourcePath) => sourcePath !== activePreferredPath);
    for (const sourcePath of removableSources) {
      const source = mutableSources.get(sourcePath);
      if (!source?.config.mcpServers?.[name]) continue;
      delete source.config.mcpServers[name];
      source.changed = true;
      actions.push(`removed duplicate MCP "${name}" from ${sourcePath}`);
    }
    if (removableSources.length === 0) {
      skipped.push(`duplicate MCP "${name}" requires manual choice: ${activeSources.join(", ")}`);
    }
  }

  const projectConfigPaths = new Set([omkMcpPath, projectMcpPath]);
  for (const source of mutableSources.values()) {
    if (!projectConfigPaths.has(source.path)) continue;
    const serversByName = source.config.mcpServers ?? {};
    for (const [name, server] of Object.entries(serversByName)) {
      const serverActions = repairMcpServerConfig(name, server);
      if (serverActions.length > 0) {
        source.changed = true;
        actions.push(...serverActions.map((action) => `${source.path}: ${action}`));
      }
      const diagnostics = await diagnoseRuntimeMcpServer(name, server);
      const blockers = diagnostics.filter((diagnostic) => AUTO_DISABLE_RUNTIME_BLOCKERS.has(diagnostic.kind));
      if (blockers.length > 0) {
        const reason = blockers.map((diagnostic) => diagnostic.message).join("; ");
        moveMcpServerToDisabled(source, name, server, reason);
        actions.push(`${source.path}: disabled MCP "${name}" due to runtime startup blocker: ${reason}`);
      }
    }
  }

  for (const source of mutableSources.values()) {
    if (!source.changed) continue;
    await writeFile(source.path, JSON.stringify(source.config, null, 2) + "\n", "utf-8");
  }

  return {
    changed: actions.length > 0,
    actions,
    skipped,
  };
}

export async function buildMcpDoctorReport(): Promise<McpDoctorReport> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);
  const resources = await getOmkResourceSettings();
  const activePathOrder = await collectMcpConfigs(resources.mcpScope);
  const activePaths = new Set(activePathOrder);
  const globalMcpPath = join(getUserHome(), ".kimi", "mcp.json");

  const sourceReports: McpDoctorSourceReport[] = sources.map((src) => {
    const serverCount = src.parsed ? Object.keys(src.config.mcpServers ?? {}).length : 0;
      const sourceReport: McpDoctorSourceReport = {
        path: src.path,
        exists: src.exists,
        active: activePaths.has(src.path),
        parsed: src.parsed,
        status: !src.parsed ? "error" : !src.exists || serverCount === 0 ? "empty" : "ok",
        serverCount,
        error: src.error,
    };
    return sourceReport;
  });

  const serverReports: McpDoctorServerReport[] = [];
  for (const [name, info] of servers) {
    const server = selectEffectiveServer(info, activePathOrder);
    const checks: McpDoctorCheck[] = [];
    const activeSources = info.sources.filter((source) => activePaths.has(source));
    const active = activeSources.length > 0;
    let resolvedCommand: string | undefined;

    if (activeSources.length > 1) {
      if (name === "omk-project") {
        checks.push({
          severity: "info",
          kind: "managed-duplicate",
          message: `managed omk-project mirror duplicate: ${activeSources.join(", ")} (expected; remove one manually if desired)`,
        });
      } else if (activeSources.includes(globalMcpPath) && activeSources.some((source) => source !== globalMcpPath)) {
        checks.push({
          severity: "info",
          kind: "project-overrides-global",
          message: `active duplicate spans global/project; project override is effective: ${activeSources.join(", ")}`,
        });
      } else {
        checks.push({
          severity: "error",
          kind: "active-duplicate",
          message: `active duplicate definition in: ${activeSources.join(", ")} — run \`omk mcp remove ${name}\` to delete the local copy, or edit the files manually`,
        });
      }
    } else if (info.sources.length > 1) {
      checks.push({
        severity: "info",
        kind: "inactive-duplicate",
        message: `duplicate mirror outside active scope: ${info.sources.join(", ")} (only the active scope config is used)`,
      });
    }

    if (!active) {
      serverReports.push({
        name,
        status: "ok",
        active,
        sources: info.sources,
        activeSources,
        transport: server.url ? "remote" : server.command ? "stdio" : "invalid",
        url: server.url ? sanitizeMcpUrlForDisplay(server.url) : undefined,
        command: server.command,
        resolvedCommand,
        timeoutSec: server.startup_timeout_sec,
        checks,
      });
      continue;
    }

    if (server.url) {
      const urlCheck = validateRemoteMcpUrl(server.url);
      if (urlCheck.ok) {
        checks.push({ severity: "ok", kind: "url", message: `url: ${sanitizeMcpUrlForDisplay(server.url)}` });
      } else {
        checks.push({ severity: "error", kind: "invalid-url", message: `invalid url: ${urlCheck.message}` });
      }
    } else if (!server.command) {
      checks.push({ severity: "error", kind: "missing-command", message: "missing command" });
    } else {
      const resolved = await which(server.command);
      if (resolved.failed) {
        checks.push({ severity: "error", kind: "command-not-found", message: `command not found: ${server.command}` });
      } else {
        resolvedCommand = resolved.stdout.trim();
        checks.push({ severity: "ok", kind: "command", message: `command: ${resolvedCommand}` });
      }
    }

    if (!server.url && server.args) {
      for (const [index, arg] of server.args.entries()) {
        if (!shouldValidateArgPath(server, arg, index)) continue;
        if (!isAbsolute(arg) && !arg.includes("/") && !arg.includes("\\")) continue;
        const exists = await pathExists(arg);
        checks.push(exists
          ? { severity: "ok", kind: "arg-path", message: `arg path: ${arg}` }
          : { severity: "error", kind: "arg-path-not-found", message: `arg path not found: ${arg}` });
      }
    }

    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        if (value.startsWith("${") && value.endsWith("}")) {
          const envName = value.slice(2, -1);
          if (!process.env[envName]) {
            checks.push({ severity: "warn", kind: "env-reference-undefined", message: `env reference undefined: ${key} → ${envName}` });
          }
        }
      }
    }

    for (const check of stdioProtocolChecksForServer(server)) {
      checks.push(check);
    }

    const runtimeDiagnostics = await diagnoseRuntimeMcpServer(name, server);
    for (const diagnostic of runtimeDiagnostics) {
      if (["missing-command", "command-path-not-found", "arg-path-not-found"].includes(diagnostic.kind)) continue;
      checks.push({
        severity: diagnostic.kind === "disabled-server" ? "info" : "error",
        kind: `runtime-${diagnostic.kind}`,
        message: `runtime startup blocker: ${diagnostic.message}`,
      });
    }

    const stabilityHints = stabilityHintsForServer(name, server);
    for (const hint of stabilityHints) {
      checks.push({ severity: "info", kind: "stability", message: `stability: ${hint}` });
    }

    const hasError = checks.some((check) => check.severity === "error");
    const hasWarn = checks.some((check) => check.severity === "warn");

    serverReports.push({
      name,
      status: hasError ? "error" : hasWarn ? "warn" : "ok",
      active,
      sources: info.sources,
      activeSources,
      transport: server.url ? "remote" : server.command ? "stdio" : "invalid",
      url: server.url ? sanitizeMcpUrlForDisplay(server.url) : undefined,
      command: server.command,
      resolvedCommand,
      timeoutSec: server.startup_timeout_sec,
      checks,
    });
  }

  if (resources.mcpScope !== "none" && !servers.has("omk-project")) {
    serverReports.push({
      name: "omk-project",
      status: "ok",
      active: true,
      sources: ["runtime:auto-injected"],
      activeSources: ["runtime:auto-injected"],
      transport: "stdio",
      command: "omk mcp serve omk-project",
      checks: [{
        severity: "info",
        kind: "virtual-runtime-injected",
        message: "virtual runtime MCP injected; not stored in .kimi/mcp.json or .omk/mcp.json",
      }],
    });
  }

  const errors = [
    ...sourceReports
      .filter((source) => source.status === "error" && activePaths.has(source.path))
      .map((source) => `${source.path}: ${source.error ?? "invalid MCP config"}`),
    ...serverReports.flatMap((server) =>
      server.checks
        .filter((check) => check.severity === "error")
        .map((check) => `${server.name}: ${check.message}`)
    ),
  ];
  const warnings = serverReports.flatMap((server) =>
    server.checks
      .filter((check) => check.severity === "warn")
      .map((check) => `${server.name}: ${check.message}`)
  );

  return {
    ok: errors.length === 0,
    command: "mcp doctor",
    checkedAt: new Date().toISOString(),
    activeScope: resources.mcpScope,
    issueCount: errors.length,
    errors,
    warnings,
    sources: sourceReports,
    servers: serverReports,
    data: {
      activeScope: resources.mcpScope,
      sourceCount: sourceReports.length,
      serverCount: serverReports.length,
    },
  };
}

function emitMcpDoctorText(report: McpDoctorReport): void {
  console.log(header("MCP Doctor"));
  console.log(style.gray(`Active MCP scope: ${report.activeScope}`));

  for (const src of report.sources) {
    if (src.status === "error") {
      const line = `${src.path}: ${src.error}`;
      console.log(src.active ? status.error(line) : style.gray(`${line} (inactive)`));
    } else if (src.status === "empty") {
      const suffix = !src.exists ? "not found" : "no mcpServers defined";
      console.log(style.gray(`${src.path}: ${suffix}${src.active ? "" : " (inactive)"}`));
    } else {
      console.log(src.active ? status.ok(`${src.path}`) : style.gray(`${src.path} (inactive)`));
    }
  }

  if (report.servers.length === 0) {
    console.log("\n" + style.gray("No servers to diagnose."));
  } else {
    console.log("");
    for (const server of report.servers) {
      console.log(label("Server", server.name));
      for (const check of server.checks) {
        console.log(`  ${formatMcpDoctorCheck(check)}`);
      }
    }
  }

  console.log("");
  if (report.ok) {
    console.log(status.ok("All checks passed"));
  } else {
    console.log(status.error(`${report.issueCount} issue(s) found`));
    console.log(style.gray("To resolve duplicates: run `omk mcp remove <server>` to delete a local copy, or edit the config files directly."));
  }
}

function formatMcpDoctorCheck(check: McpDoctorCheck): string {
  switch (check.severity) {
    case "ok":
      return `${style.mint("✓")} ${check.message}`;
    case "warn":
      return `${style.skin("⚠")} ${check.message}`;
    case "error":
      return `${style.pink("✗")} ${check.message}`;
    default:
      return `${style.gray("ℹ")} ${check.message}`;
  }
}

function stabilityHintsForServer(name: string, server: McpServerConfig): string[] {
  if (!server.command && !server.url) return [];
  const hints: string[] = [];
  const target = serverTargetText(server);
  if ((server.command?.includes("npx") ?? false) || (server.command?.includes("npm") ?? false)) {
    hints.push("npx-based servers may take >10s to start on first run. Consider installing globally or pinning the package.");
  }
  if (isRailwayMcpServer(name, server)) {
    if (server.url?.includes("mcp.railway.com")) {
      hints.push("Railway remote MCP uses OAuth over HTTP and avoids local npx/CLI token files; the first tool call may open browser auth.");
    } else if (target.includes("@jasontanswe/railway-mcp")) {
      hints.push("Unofficial Railway MCP uses RAILWAY_API_TOKEN and calls the GraphQL API directly (no CLI needed). If projects return empty, verify your token has project access at https://railway.app/account/tokens.");
    } else {
      hints.push("Railway CLI tokens expire periodically. Run railway login to refresh before using this server.");
      if (target.includes("@railway/mcp-server")) {
        hints.push(`Railway local MCP depends on Railway CLI auth and npx cold starts. Prefer the remote OAuth preset: omk mcp install railway or Codex: codex mcp add railway --url ${RAILWAY_REMOTE_MCP_URL}.`);
      } else {
        hints.push(`Railway MCP is most stable as a remote OAuth server at ${RAILWAY_REMOTE_MCP_URL}; avoid committing API tokens into MCP JSON.`);
      }
    }
  }
  if (isSupabaseMcpServer(name, server)) {
    hints.push("Supabase MCP requires an access token. Store it in your global MCP env (not committed) and run omk mcp doctor to verify. Tokens expire; refresh them from the Supabase account dashboard.");
  }
  if (name === "promptfoo") {
    hints.push("promptfoo can be slow to initialize. Ensure NODE_OPTIONS does not limit memory, or run 'omk mcp test promptfoo' with a longer timeout.");
  }
  if (name === "obsidian") {
    hints.push("obsidian MCP requires an active Obsidian vault and the Local REST API plugin. If the vault is closed, the server will fail.");
  }
  return hints;
}

function stdioProtocolChecksForServer(server: McpServerConfig): McpDoctorCheck[] {
  if (server.url) return [];
  const args = server.args ?? [];
  if (args.includes("@modelcontextprotocol/server-pdf") && !args.includes("--stdio")) {
    return [{
      severity: "error",
      kind: "stdio-protocol-mismatch",
      message: "@modelcontextprotocol/server-pdf defaults to HTTP and can write 'MCP server listening on .../mcp' to stdout; add --stdio or configure it as a remote URL",
    }];
  }
  return [];
}

function shouldValidateArgPath(server: McpServerConfig, arg: string, index: number): boolean {
  if (typeof arg !== "string" || arg.startsWith("-") || arg.startsWith("$")) return false;
  if (isShellInlineScript(server, index)) return false;
  if (isNpxPackageSpecifier(server, arg)) return false;
  // Shell snippets, inline commands, and arguments with whitespace are not
  // standalone filesystem paths. Validating them as paths creates false MCP
  // doctor failures for commands like `bash -lc "exec node /path/server.js"`.
  if (/[\s;"'|&<>]/.test(arg)) return false;
  return true;
}

function isNpxPackageSpecifier(server: McpServerConfig, arg: string): boolean {
  const command = basenameOfCommand(server.command ?? "");
  if (!["npx", "npm", "pnpm", "yarn", "bun"].includes(command)) return false;
  if (arg.startsWith(".") || arg.startsWith("/") || arg.includes("\\") || arg.includes(":")) return false;
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9._~+-]+)?$/i.test(arg);
}

function isShellInlineScript(server: McpServerConfig, index: number): boolean {
  const command = basenameOfCommand(server.command ?? "");
  if (!["bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd", "cmd.exe"].includes(command)) {
    return false;
  }
  const previous = server.args?.[index - 1];
  return previous === "-c" || previous === "-lc" || previous === "/c" || previous === "--command";
}

function basenameOfCommand(command: string): string {
  return command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
}

function isNpmLauncherCommand(command: string | undefined): boolean {
  if (!command) return false;
  return ["npm", "npx", "npm.cmd", "npx.cmd", "npm.exe", "npx.exe"].includes(basenameOfCommand(command));
}

function validateRemoteMcpUrl(url: string): { ok: true } | { ok: false; message: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, message: "remote MCP URL must use http or https" };
    }
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

const SECRET_QUERY_KEYS = /^(token|api[-_]?key|key|secret|password|auth|credential|session|bearer|access[-_]?token|refresh[-_]?token)$/i;

function sanitizeMcpUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    let changed = false;
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "";
      changed = true;
    }
    for (const [key] of parsed.searchParams) {
      if (SECRET_QUERY_KEYS.test(key)) {
        parsed.searchParams.set(key, "***");
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

function serverTargetText(server: McpServerConfig): string {
  return [server.url, server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
}

function isRailwayMcpServer(name: string, server: McpServerConfig): boolean {
  return /railway/i.test(name) || /railway/i.test(serverTargetText(server));
}

function isSupabaseMcpServer(name: string, server: McpServerConfig): boolean {
  return /supabase/i.test(name) || /supabase/i.test(serverTargetText(server));
}

function formatArgsForDisplay(args: string[]): string {
  return args.map(maskSensitiveText).join(" ");
}

function maskSensitiveText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1***")
    .replace(/(--(?:api-)?token(?:=|\s+))[^"'`\s;]+/gi, "$1***")
    .replace(/([A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*\s*=\s*)[^"'`\s;]+/gi, "$1***");
}

export async function mcpTestCommand(serverName: string): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);
  const info = servers.get(serverName);

  if (!info) {
    console.error(status.error(`Server not found: ${serverName}`));
    console.error(style.gray("Run `omk mcp list` to see available servers."));
    process.exit(1);
  }

  const resources = await getOmkResourceSettings();
  const activePathOrder = await collectMcpConfigs(resources.mcpScope);
  const activeSources = info.sources.filter((source) => activePathOrder.includes(source));
  if (activeSources.length === 0) {
    console.error(status.error(`Server ${serverName} is not active in MCP scope "${resources.mcpScope}".`));
    console.error(style.gray(`Defined in: ${info.sources.join(", ")}`));
    process.exit(1);
  }
  const server = selectEffectiveServer(info, activePathOrder);
  if (!server.url && !server.command) {
    console.error(status.error(`Server ${serverName} has no command`));
    process.exit(1);
  }

  console.log(header(`MCP Test: ${serverName}`));
  if (server.url) {
    console.log(label("URL", sanitizeMcpUrlForDisplay(server.url)));
    await testRemoteMcpServer(serverName, server.url);
    return;
  }

  const command = server.command;
  if (!command) {
    console.error(status.error(`Server ${serverName} has no command`));
    process.exit(1);
  }

  console.log(label("Command", command));
  if (server.args) console.log(label("Args", formatArgsForDisplay(server.args)));
  console.log("");

  // Test 1: executable exists
  const resolved = await which(command);
  if (resolved.failed) {
    console.error(status.error(`Executable not found: ${command}`));
    process.exit(1);
  }
  console.log(status.ok(`Executable: ${resolved.stdout.trim()}`));

  // Test 2: try to run with a 5s timeout as a basic smoke test
  const smokeArgs = [...(server.args ?? [])];
  console.log(style.gray("Smoke test: starting process (5s timeout)..."));
  const smokeResult = await runShell(command, smokeArgs, {
    cwd: getProjectRoot(),
    timeout: 5000,
    env: server.env ? { ...process.env, ...server.env } as Record<string, string> : process.env as Record<string, string>,
  });
  const smokePollution = findNonJsonStdoutLines(smokeResult.stdout);
  if (smokePollution.length > 0) {
    console.error(status.error(`Server wrote non-JSON text to stdout during startup: ${maskSensitiveText(smokePollution[0])}`));
    console.error(style.gray("MCP stdio servers must write only JSON-RPC frames to stdout. Move logs to stderr, remove this server, or configure it as a remote URL if it is an HTTP MCP server."));
    process.exit(1);
  }
  if (!smokeResult.failed) {
    console.log(status.ok(`Process exited with code ${smokeResult.exitCode}`));
  } else if (smokeResult.stderr.includes("timeout") || smokeResult.stderr.includes("ETIMEDOUT")) {
    console.log(style.skin("Process is still running after 5s (expected for stdio MCP servers)"));
  } else if (!smokeResult.stderr.trim()) {
    console.log(status.ok(`Process started and exited without stderr (code ${smokeResult.exitCode})`));
  } else if (smokeResult.stderr.includes("ENOENT")) {
    console.error(status.error(`Failed to start: ${smokeResult.stderr}`));
    process.exit(1);
  } else {
    console.log(style.gray(`Process exited with error (may be OK for stdio servers): ${smokeResult.stderr}`));
  }

  // Test 3: JSON-RPC initialize handshake
  console.log("");
  console.log(style.gray("JSON-RPC handshake test..."));
  const initializePayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "omk-mcp-test",
        version: "0.0.0",
      },
    },
  }) + "\n";
  const handshakeResult = await runShell(command, smokeArgs, {
    cwd: getProjectRoot(),
    timeout: 20000,
    env: server.env ? { ...process.env, ...server.env } as Record<string, string> : process.env as Record<string, string>,
    input: initializePayload,
  });
  const stdoutPollution = findNonJsonStdoutLines(handshakeResult.stdout);
  if (stdoutPollution.length > 0) {
    console.error(status.error(`Server wrote non-JSON text to stdout before/during JSON-RPC: ${maskSensitiveText(stdoutPollution[0])}`));
    console.error(style.gray("MCP stdio servers must write only JSON-RPC frames to stdout. Move logs to stderr, remove this server, or configure it as a remote URL if it is an HTTP MCP server."));
    process.exit(1);
  }
  const handshakeResponses = parseJsonRpcResponses(handshakeResult.stdout);
  const internalHandshakeError = findInternalJsonRpcError(handshakeResponses);
  if (internalHandshakeError) {
    console.error(status.error(`JSON-RPC initialize returned Internal error: ${internalHandshakeError.error?.message ?? "unknown"}`));
    process.exit(1);
  }
  if (!handshakeResult.failed && handshakeResult.stdout.includes("\"serverInfo\"")) {
    console.log(style.mint("JSON-RPC initialize succeeded"));
  } else if (!handshakeResult.failed) {
    console.error(status.error(`Server exited without initialize response (exit code ${handshakeResult.exitCode})`));
    process.exit(1);
  } else if (handshakeResult.stderr.includes("timeout") || handshakeResult.stderr.includes("ETIMEDOUT")) {
    console.log(style.mint("Server stayed alive long enough — stdio MCP server looks healthy"));
  } else {
    console.log(style.gray(`Handshake result: ${handshakeResult.stderr}`));
  }

  if (shouldRunOmkProjectProbe(serverName, server)) {
    await runOmkProjectToolProbe(command, smokeArgs, server.env);
  }
}

export async function mcpPrewarmCommand(serverName: string): Promise<void> {
  console.log(header(`MCP Prewarm: ${serverName}`));
  console.log(style.gray("Runs the MCP startup probe outside chat so package-manager caches warm before Kimi starts."));
  console.log(style.gray("For a zero-global-noise session, run chat/goal/parallel with `--mcp-scope project` or `--mcp-scope none`."));
  await mcpTestCommand(serverName);
}

function shouldRunOmkProjectProbe(serverName: string, server: McpServerConfig): boolean {
  const target = serverTargetText(server);
  return serverName === "omk-project" || /\bomk-project\b/.test(target);
}

async function runOmkProjectToolProbe(
  command: string,
  args: string[],
  env?: Record<string, string>
): Promise<void> {
  console.log("");
  console.log(style.gray("JSON-RPC OMK tools/call id 3 probe..."));
  const payload = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "omk-mcp-test", version: "0.0.0" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "omk_goal_show",
        arguments: { goalId: "missing-goal" },
      },
    },
  ].map((message) => JSON.stringify(message)).join("\n") + "\n";
  const probeResult = await runShell(command, args, {
    cwd: getProjectRoot(),
    timeout: 20000,
    env: env ? { ...process.env, ...env } as Record<string, string> : process.env as Record<string, string>,
    input: payload,
  });
  const responses = parseJsonRpcResponses(probeResult.stdout);
  const internalError = findInternalJsonRpcError(responses);
  if (internalError) {
    console.error(status.error(`JSON-RPC id ${String(internalError.id ?? "?")} returned Internal error: ${internalError.error?.message ?? "unknown"}`));
    if (probeResult.stderr.trim()) console.error(style.gray(probeResult.stderr.trim()));
    process.exit(1);
  }
  const toolResponse = responses.find((response) => response.id === 3);
  if (!toolResponse) {
    const timeoutHint = probeResult.stderr.includes("timeout") || probeResult.stderr.includes("ETIMEDOUT")
      ? " before the probe timeout"
      : "";
    console.error(status.error(`JSON-RPC tools/call id 3 did not return a response${timeoutHint}`));
    if (probeResult.stderr.trim()) console.error(style.gray(probeResult.stderr.trim()));
    process.exit(1);
  }
  if (toolResponse.error) {
    console.error(status.error(`JSON-RPC id 3 returned error ${toolResponse.error.code ?? "unknown"}: ${toolResponse.error.message ?? "unknown"}`));
    process.exit(1);
  }
  const toolText = stringifyToolResultContent(toolResponse.result);
  if (!isRecord(toolResponse.result) || toolResponse.result.isError !== true || !toolText.includes("OMK tool-level failure")) {
    console.error(status.error("JSON-RPC id 3 did not return an OMK tool-level error result"));
    process.exit(1);
  }
  console.log(status.ok("JSON-RPC tools/call id 3 returned OMK tool-level error without -32603"));
}

function findNonJsonStdoutLines(stdout: string): string[] {
  const invalidLines: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isJsonRpcFrame(parsed)) invalidLines.push(trimmed);
    } catch {
      invalidLines.push(trimmed);
    }
  }
  return invalidLines;
}

function isJsonRpcFrame(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return false;
  return "id" in value || "method" in value || "result" in value || "error" in value;
}

function parseJsonRpcResponses(stdout: string): JsonRpcProbeResponse[] {
  const responses: JsonRpcProbeResponse[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isJsonRpcFrame(parsed)) {
        const response: JsonRpcProbeResponse = {};
        if (typeof parsed.id === "string" || typeof parsed.id === "number") response.id = parsed.id;
        if ("result" in parsed) response.result = parsed.result;
        if (isRecord(parsed.error)) {
          response.error = {};
          if (typeof parsed.error.code === "number") response.error.code = parsed.error.code;
          if (typeof parsed.error.message === "string") response.error.message = parsed.error.message;
        }
        responses.push(response);
      }
    } catch {
      // Ignore non-JSON logs from MCP child processes.
    }
  }
  return responses;
}

function findInternalJsonRpcError(responses: JsonRpcProbeResponse[]): JsonRpcProbeResponse | undefined {
  return responses.find((response) =>
    response.error?.code === JSON_RPC_INTERNAL_ERROR_CODE ||
    /internal error/i.test(response.error?.message ?? "")
  );
}

function stringifyToolResultContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content
    .map((item) => {
      if (isRecord(item) && typeof item.text === "string") return item.text;
      return "";
    })
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function testRemoteMcpServer(serverName: string, url: string): Promise<void> {
  console.log("");
  const urlCheck = validateRemoteMcpUrl(url);
  if (!urlCheck.ok) {
    console.error(status.error(`Invalid remote MCP URL for ${serverName}: ${urlCheck.message}`));
    process.exit(1);
  }

  console.log(style.gray("Remote HTTP reachability test (5s timeout)..."));
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(status.ok(`Remote endpoint reachable (HTTP ${response.status})`));
      if (serverName === "railway") {
        console.log(style.gray("Railway may prompt OAuth on first tool call; no API token is required in MCP config."));
      }
      return;
    }

    if (response.status >= 300 && response.status < 400) {
      console.log(status.warn(`Remote endpoint returned redirect (HTTP ${response.status}). Check the configured URL.`));
      return;
    }

    if (response.status === 401) {
      console.log(status.error(`Remote endpoint requires authentication (HTTP 401). Token may be expired or missing.`));
      if (serverName === "railway") {
        console.log(style.gray("Railway OAuth may need re-authentication. Run the server locally or re-authorize via browser."));
      } else if (serverName === "supabase") {
        console.log(style.gray("Supabase token may be expired. Generate a new access token in the Supabase account dashboard and update your global MCP env."));
      } else if (serverName === "github") {
        console.log(style.gray("GitHub token may be expired or lack required scopes. Check your token at https://github.com/settings/tokens."));
      }
      throw new Error(`MCP test failed: ${serverName} returned HTTP 401 (authentication required)`);
    }

    if (response.status === 403) {
      console.log(status.error(`Remote endpoint forbidden (HTTP 403). Check token permissions.`));
      if (serverName === "railway") {
        console.log(style.gray("Railway OAuth may need re-authentication. Run the server locally or re-authorize via browser."));
      } else if (serverName === "supabase") {
        console.log(style.gray("Supabase token may be expired. Generate a new access token in the Supabase account dashboard and update your global MCP env."));
      } else if (serverName === "github") {
        console.log(style.gray("GitHub token may be expired or lack required scopes. Check your token at https://github.com/settings/tokens."));
      }
      throw new Error(`MCP test failed: ${serverName} returned HTTP 403 (forbidden)`);
    }

    if (response.status === 404) {
      console.log(status.warn(`Remote endpoint not found (HTTP 404). Check the configured URL or provider status.`));
      return;
    }

    if (response.status >= 400 && response.status < 500) {
      console.log(status.warn(`Remote endpoint responded with client error (HTTP ${response.status}). Check the configured URL or MCP server health.`));
      return;
    }

    console.log(style.skin(`Remote endpoint responded with HTTP ${response.status}; retry later or check provider status.`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(style.skin(`Remote endpoint reachability inconclusive: ${message}`));
    throw new Error(`MCP test failed: ${message}`);
  }
}

export async function mcpRemoveCommand(serverName: string, options: { global?: boolean } = {}): Promise<void> {
  const root = getProjectRoot();
  const localPath = join(root, ".kimi", "mcp.json");
  const omkPath = join(root, ".omk", "mcp.json");
  const globalPath = join(getUserHome(), ".kimi", "mcp.json");

  const sources: Array<{ path: string; label: string }> = options.global
    ? [{ path: globalPath, label: "global" }]
    : [
        { path: localPath, label: "project-local" },
        { path: omkPath, label: "omk-project" },
      ];

  let removed = false;
  for (const src of sources) {
    const cfg = await loadConfig(src.path);
    if (!cfg.parsed || !cfg.config.mcpServers || !(serverName in cfg.config.mcpServers)) {
      continue;
    }
    const next = { ...cfg.config.mcpServers };
    delete next[serverName];
    await writeFile(src.path, JSON.stringify({ mcpServers: next }, null, 2) + "\n", "utf-8");
    console.log(status.ok(`Removed "${serverName}" from ${src.label} MCP config: ${src.path}`));
    removed = true;
    break;
  }

  if (!removed) {
    console.log(status.error(`Server "${serverName}" not found in ${options.global ? "global" : "project-local"} MCP configs.`));
    console.log(style.gray(`Checked: ${sources.map((s) => s.path).join(", ")}`));
    if (!options.global) {
      console.log(style.gray(`To remove from global config, run \`omk mcp remove ${serverName} --global\`, or edit ~/.kimi/mcp.json manually.`));
    } else {
      console.log(style.gray(`To remove from project-local configs, run \`omk mcp remove ${serverName}\`.`));
    }
    process.exit(1);
  }
}

export async function mcpAddCommand(serverName: string): Promise<void> {
  const root = getProjectRoot();
  const globalPath = join(getUserHome(), ".kimi", "mcp.json");
  const projectMcpPath = join(root, ".kimi", "mcp.json");

  const globalSource = await loadConfig(globalPath);
  if (!globalSource.parsed || !globalSource.config.mcpServers || !(serverName in globalSource.config.mcpServers)) {
    console.log(status.error(`Server "${serverName}" not found in global MCP config: ${globalPath}`));
    process.exit(1);
  }

  const projectMcpSource = await loadConfig(projectMcpPath);
  const projectMcpServers = projectMcpSource.parsed && projectMcpSource.config.mcpServers
    ? { ...projectMcpSource.config.mcpServers }
    : {};

  if (serverName in projectMcpServers) {
    console.log(status.error(`Server "${serverName}" already exists in ${projectMcpPath}`));
    process.exit(1);
  }

  projectMcpServers[serverName] = sanitizeMcpServerForProject(globalSource.config.mcpServers[serverName]);
  await mkdir(join(root, ".kimi"), { recursive: true });
  await writeFile(projectMcpPath, JSON.stringify({ mcpServers: projectMcpServers }, null, 2) + "\n", "utf-8");

  console.log(header("MCP Add"));
  console.log(status.ok(`Added "${serverName}" to ${projectMcpPath}`));
}

export async function mcpInstallCommand(
  name: string,
  command: string,
  args: string[],
  options: { env?: string[]; startupTimeoutSec?: number } = {}
): Promise<void> {
  const root = getProjectRoot();
  const projectMcpPath = join(root, ".kimi", "mcp.json");

  const projectMcpSource = await loadConfig(projectMcpPath);
  const projectMcpServers = projectMcpSource.parsed && projectMcpSource.config.mcpServers
    ? { ...projectMcpSource.config.mcpServers }
    : {};

  if (name in projectMcpServers) {
    console.log(status.error(`Server "${name}" already exists in ${projectMcpPath}`));
    process.exit(1);
  }

  const server = createInstallServer(name, command, args, options);

  projectMcpServers[name] = server;
  await mkdir(join(root, ".kimi"), { recursive: true });
  await writeFile(projectMcpPath, JSON.stringify({ mcpServers: projectMcpServers }, null, 2) + "\n", "utf-8");

  console.log(header("MCP Install"));
  console.log(status.ok(`Installed "${name}" into ${projectMcpPath}`));
  if (server.url) {
    console.log(label("URL", sanitizeMcpUrlForDisplay(server.url)));
  } else {
    console.log(label("Command", command));
    if (args.length > 0) console.log(label("Args", formatArgsForDisplay(args)));
  }
}

function createInstallServer(
  name: string,
  command: string,
  args: string[],
  options: { env?: string[] | Record<string, string>; startupTimeoutSec?: number } = {}
): McpServerConfig {
  if (isRailwayInstallPreset(name, command, args, options)) {
    return { url: RAILWAY_REMOTE_MCP_URL };
  }
  if (isHttpUrl(command) && args.length === 0) {
    return { url: command };
  }

  const server: McpServerConfig = { command, args };
  if (options.env) {
    server.env = {};
    if (Array.isArray(options.env)) {
      for (const pair of options.env) {
        const idx = pair.indexOf("=");
        if (idx > 0) {
          server.env[pair.slice(0, idx)] = pair.slice(idx + 1);
        }
      }
    } else {
      Object.assign(server.env, options.env);
    }
  }
  if (Number.isFinite(options.startupTimeoutSec) && options.startupTimeoutSec && options.startupTimeoutSec > 0) {
    server.startup_timeout_sec = Math.trunc(options.startupTimeoutSec);
  }
  return server;
}

function sanitizeMcpServerForProject(server: McpServerConfig): McpServerConfig {
  const cleaned = JSON.parse(JSON.stringify(server)) as McpServerConfig & Record<string, unknown>;
  if (cleaned.env && typeof cleaned.env === "object") {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(cleaned.env)) {
      env[key] = isSecretEnvName(key) ? `\${${key}}` : value;
    }
    cleaned.env = env;
  }
  if (cleaned.headers && typeof cleaned.headers === "object") {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(cleaned.headers)) {
      headers[key] = isSecretHeaderName(key) ? "[REDACTED]" : value;
    }
    cleaned.headers = headers;
  }
  if (cleaned.http_headers && typeof cleaned.http_headers === "object") {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(cleaned.http_headers)) {
      headers[key] = isSecretHeaderName(key) ? "[REDACTED]" : value;
    }
    cleaned.http_headers = headers;
  }
  const nestedConfig = cleaned.config;
  if (nestedConfig && typeof nestedConfig === "object" && !Array.isArray(nestedConfig)) {
    const config = nestedConfig as Record<string, unknown>;
    if (config.env && typeof config.env === "object" && !Array.isArray(config.env)) {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.env as Record<string, string>)) {
        env[key] = isSecretEnvName(key) ? `\${${key}}` : value;
      }
      config.env = env;
    }
  }
  return cleaned;
}

function isRailwayInstallPreset(
  name: string,
  command: string,
  args: string[],
  options: { env?: string[] | Record<string, string> }
): boolean {
  return name.toLowerCase() === "railway"
    && command === "railway"
    && args.length === 0
    && (!options.env || options.env.length === 0);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export interface BulkInstallEntry {
  name: string;
  command: string;
  args: string[];
  env?: string[] | Record<string, string>;
  startupTimeoutSec?: number;
}

export interface BulkInstallResult {
  installed: string[];
  failed: Array<{ name: string; error: string }>;
  skipped: string[];
}

export async function mcpBulkInstallCommand(entries: BulkInstallEntry[]): Promise<BulkInstallResult> {
  const root = getProjectRoot();
  const projectMcpPath = join(root, ".kimi", "mcp.json");

  const projectMcpSource = await loadConfig(projectMcpPath);
  const projectMcpServers = projectMcpSource.parsed && projectMcpSource.config.mcpServers
    ? { ...projectMcpSource.config.mcpServers }
    : {};

  const results: BulkInstallResult = { installed: [], failed: [], skipped: [] };

  await Promise.all(
    entries.map(async (entry) => {
      try {
        if (entry.name in projectMcpServers) {
          results.skipped.push(entry.name);
          return;
        }
        const server = createInstallServer(entry.name, entry.command, entry.args, {
          env: entry.env,
          startupTimeoutSec: entry.startupTimeoutSec,
        });
        projectMcpServers[entry.name] = server;
        results.installed.push(entry.name);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.failed.push({ name: entry.name, error: message });
      }
    })
  );

  if (results.installed.length > 0 || results.skipped.length > 0) {
    await mkdir(join(root, ".kimi"), { recursive: true });
    await writeFile(projectMcpPath, JSON.stringify({ mcpServers: projectMcpServers }, null, 2) + "\n", "utf-8");
  }

  return results;
}

export async function mcpSyncGlobalCommand(options: { overwrite?: boolean; omk?: boolean }): Promise<void> {
  const root = getProjectRoot();
  const globalPath = join(getUserHome(), ".kimi", "mcp.json");
  const targetPath = options.omk ? join(root, ".omk", "mcp.json") : join(root, ".kimi", "mcp.json");

  const globalSource = await loadConfig(globalPath);
  if (!globalSource.parsed || !globalSource.config.mcpServers) {
    console.log(status.error(`No global MCP config found at ${globalPath}`));
    process.exit(1);
  }

  const targetSource = await loadConfig(targetPath);
  const targetServers = targetSource.parsed && targetSource.config.mcpServers ? targetSource.config.mcpServers : {};

  let imported = 0;
  let skipped = 0;
  const merged: Record<string, McpServerConfig> = options.overwrite ? {} : { ...targetServers };

  for (const [name, server] of Object.entries(globalSource.config.mcpServers)) {
    if (name === "omk-project") {
      skipped++;
      continue;
    }
    if (!options.overwrite && name in merged) {
      skipped++;
      continue;
    }
    let redacted = { ...server };
    if ((server as Record<string, unknown>).env && typeof (server as Record<string, unknown>).env === "object") {
      const env = (server as Record<string, unknown>).env as Record<string, string>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        cleaned[k] = isSecretEnvName(k) ? `\${${k}}` : v;
      }
      redacted = { ...redacted, env: cleaned };
    }
    if ((server as Record<string, unknown>).headers && typeof (server as Record<string, unknown>).headers === "object") {
      const hdr = (server as Record<string, unknown>).headers as Record<string, string>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(hdr)) {
        cleaned[k] = isSecretHeaderName(k) ? "[REDACTED]" : v;
      }
      redacted = { ...redacted, headers: cleaned };
    }
    if ((server as Record<string, unknown>).http_headers && typeof (server as Record<string, unknown>).http_headers === "object") {
      const hdr = (server as Record<string, unknown>).http_headers as Record<string, string>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(hdr)) {
        cleaned[k] = isSecretHeaderName(k) ? "[REDACTED]" : v;
      }
      redacted = { ...redacted, http_headers: cleaned };
    }
    if ((server as Record<string, unknown>).config) {
      const cfg = { ...(server as Record<string, unknown>).config as Record<string, unknown> };
      if (cfg.env && typeof cfg.env === "object") {
        const env = cfg.env as Record<string, string>;
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(env)) {
          cleaned[k] = isSecretEnvName(k) ? `\${${k}}` : v;
        }
        cfg.env = cleaned;
      }
      redacted = { ...(redacted as Record<string, unknown>), config: cfg } as McpServerConfig;
    }
    merged[name] = redacted as McpServerConfig;
    imported++;
  }

  const output: McpConfig = { mcpServers: merged };
  await writeFile(targetPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(header("MCP Sync Global"));
  console.log(status.ok(`Imported ${imported} global MCP server(s)`));
  if (skipped > 0) {
    console.log(style.gray(`Skipped ${skipped} (omk-project or existing local)`));
  }
  console.log(label("Written to", targetPath));
}

export async function mcpMigrateCommand(options: { global?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const root = getProjectRoot();
  const globalPath = join(getUserHome(), ".kimi", "mcp.json");
  const projectPath = join(root, ".kimi", "mcp.json");
  const omkPath = join(root, ".omk", "mcp.json");

  const configs: Array<{ path: string; label: string }> = [];
  if (options.global) {
    configs.push({ path: globalPath, label: "global" });
  } else {
    configs.push({ path: projectPath, label: "project" });
    if (await pathExists(omkPath)) {
      configs.push({ path: omkPath, label: "project-omk" });
    }
  }

  let totalFixed = 0;
  const fixedServers: Array<{ name: string; file: string; from: string; to: string }> = [];

  for (const { path: configPath } of configs) {
    const source = await loadConfig(configPath);
    if (!source.parsed || !source.config.mcpServers) continue;

    const servers = source.config.mcpServers;
    let changed = false;

    for (const [name, server] of Object.entries(servers)) {
      const args = server.args ?? [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (typeof arg !== "string") continue;
        for (const [stale, current] of Object.entries(STALE_PACKAGE_NAMES)) {
          if (arg.includes(stale)) {
            const newArg = arg.replace(stale, current);
            if (!options.dryRun) {
              args[i] = newArg;
              changed = true;
            }
            totalFixed++;
            fixedServers.push({ name, file: configPath, from: stale, to: current });
          }
        }
      }
    }

    if (changed) {
      await writeFile(configPath, JSON.stringify(source.config, null, 2) + "\n", "utf-8");
    }
  }

  console.log(header("MCP Migrate"));
  if (totalFixed === 0) {
    console.log(status.ok("No stale package names found"));
  } else {
    if (options.dryRun) {
      console.log(style.skin(`${totalFixed} stale package reference(s) would be fixed:`));
    } else {
      console.log(status.ok(`Fixed ${totalFixed} stale package reference(s):`));
    }
    for (const entry of fixedServers) {
      console.log(`  ${label(entry.name, `${entry.from} → ${entry.to}`)} (${entry.file})`);
    }
  }
}

function isSecretEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)$/i.test(name);
}

function isSecretHeaderName(name: string): boolean {
  return /authorization|x-api-key|cookie/i.test(name);
}
