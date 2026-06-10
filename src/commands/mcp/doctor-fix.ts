import { chmod, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import {
  collectMcpConfigs,
  diagnoseRuntimeMcpServer,
  getProjectRoot,
  pathExists,
  getUserHome,
  STALE_PACKAGE_NAMES,
} from "../../util/fs.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import { maskSensitiveText } from "../../util/secret-mask.js";
import {
  collectServers,
  isHttpUrl,
  isNpmLauncherCommand,
  resolveAllConfigs,
  sanitizeMcpServerForProject,
  type McpConfig,
  type McpServerConfig,
} from "./shared.js";

interface MutableMcpConfigSource {
  path: string;
  config: McpConfig & Record<string, unknown>;
  originalConfig: McpConfig & Record<string, unknown>;
  changed: boolean;
}

export interface McpDoctorFixReport {
  changed: boolean;
  dryRun: boolean;
  global: boolean;
  actions: string[];
  skipped: string[];
  backups: string[];
}

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

async function ensureMcpConfigFile(
  filePath: string,
  config: McpConfig & Record<string, unknown>,
  actions: string[],
  options: { dryRun?: boolean } = {}
): Promise<void> {
  if (await pathExists(filePath)) return;
  if (options.dryRun) {
    actions.push(`would create MCP config ${filePath}`);
    return;
  }
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
  actions: string[],
  options: { dryRun?: boolean; backups?: string[] } = {}
): Promise<void> {
  const legacyConfig = await readParsedMcpConfig(omkMcpPath);
  if (!hasConfiguredMcpServers(legacyConfig)) return;

  const projectConfig = await readParsedMcpConfig(projectMcpPath);
  if (projectConfig && hasConfiguredMcpServers(projectConfig)) return;

  if (options.dryRun) {
    actions.push(`would migrate legacy MCP servers from ${omkMcpPath} to ${projectMcpPath}`);
    return;
  }

  const migratedConfig: McpConfig & Record<string, unknown> = {
    ...(projectConfig ?? {}),
    _comment: "Project-local MCP config migrated from legacy .omk/mcp.json; review secrets before sharing.",
    mcpServers: { ...(legacyConfig?.mcpServers ?? {}) },
  };
  if (projectConfig) {
    await createSanitizedMcpBackup(projectMcpPath, projectConfig, options.backups ?? [], actions);
  }
  await mkdir(dirname(projectMcpPath), { recursive: true });
  await writeFile(projectMcpPath, JSON.stringify(migratedConfig, null, 2) + "\n", "utf-8");
  actions.push(`migrated legacy MCP servers from ${omkMcpPath} to ${projectMcpPath}`);
}

function cloneMcpConfig(config: McpConfig & Record<string, unknown>): McpConfig & Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as McpConfig & Record<string, unknown>;
}

function timestampForBackup(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function createSanitizedMcpBackup(
  filePath: string,
  config: McpConfig & Record<string, unknown>,
  backups: string[],
  actions: string[]
): Promise<void> {
  if (!(await pathExists(filePath))) return;
  const backupPath = `${filePath}.omk-backup-${timestampForBackup()}-${backups.length + 1}.json`;
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
  await writeFile(
    backupPath,
    JSON.stringify(sanitizeMcpConfigForBackup(config), null, 2) + "\n",
    { encoding: "utf-8", mode: 0o600 }
  );
  await chmod(backupPath, 0o600).catch(() => undefined);
  backups.push(backupPath);
  actions.push(`created sanitized MCP backup ${backupPath}`);
}

function sanitizeMcpConfigForBackup(config: McpConfig & Record<string, unknown>): McpConfig & Record<string, unknown> {
  const cleaned = cloneMcpConfig(config);
  if (cleaned.mcpServers && typeof cleaned.mcpServers === "object") {
    cleaned.mcpServers = Object.fromEntries(
      Object.entries(cleaned.mcpServers).map(([name, server]) => [name, sanitizeMcpServerForProject(server)])
    );
  }
  const disabled = cleaned._omkDisabledMcpServers;
  if (disabled && typeof disabled === "object" && !Array.isArray(disabled)) {
    cleaned._omkDisabledMcpServers = Object.fromEntries(
      Object.entries(disabled as Record<string, unknown>).map(([name, server]) => [
        name,
        server && typeof server === "object" && !Array.isArray(server)
          ? sanitizeMcpServerForProject(server as McpServerConfig)
          : server,
      ])
    );
  }
  return cleaned;
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

export async function repairMcpDoctorIssues(
  options: { dryRun?: boolean; global?: boolean } = {}
): Promise<McpDoctorFixReport> {
  const root = getProjectRoot();
  const projectOmkDir = join(root, ".omk");
  const projectKimiDir = join(root, ".kimi");
  const omkMcpPath = join(projectOmkDir, "mcp.json");
  const projectMcpPath = join(projectKimiDir, "mcp.json");
  const dryRun = Boolean(options.dryRun);
  const includeGlobal = Boolean(options.global);
  const actions: string[] = [];
  const skipped: string[] = [];
  const backups: string[] = [];

  if (!dryRun) {
    await Promise.all([
      mkdir(projectOmkDir, { recursive: true }),
      mkdir(projectKimiDir, { recursive: true }),
    ]);
  }

  await migrateLegacyOmkMcpBeforeEnsure(omkMcpPath, projectMcpPath, actions, { dryRun, backups });
  await ensureMcpConfigFile(omkMcpPath, { mcpServers: {} }, actions, { dryRun });
  await ensureMcpConfigFile(projectMcpPath, {
    _comment: "Project-local MCP config. omk-project is virtual runtime MCP injected; global MCP servers remain in ~/.kimi/mcp.json and must be imported explicitly only after secret review.",
    mcpServers: {},
  }, actions, { dryRun });

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
    const clonedConfig = cloneMcpConfig(source.config as McpConfig & Record<string, unknown>);
    mutableSources.set(source.path, {
      path: source.path,
      config: clonedConfig,
      originalConfig: cloneMcpConfig(source.config as McpConfig & Record<string, unknown>),
      changed: false,
    });
  }

  const writableConfigPaths = new Set([omkMcpPath, projectMcpPath]);
  if (includeGlobal) writableConfigPaths.add(globalMcpPath);

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
      if (!writableConfigPaths.has(sourcePath)) {
        skipped.push(`duplicate MCP "${name}" not modified outside requested repair scope: ${sourcePath}`);
        continue;
      }
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

  for (const source of mutableSources.values()) {
    if (!writableConfigPaths.has(source.path)) continue;
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
    if (dryRun) continue;
    await createSanitizedMcpBackup(source.path, source.originalConfig, backups, actions);
    await writeFile(source.path, JSON.stringify(source.config, null, 2) + "\n", "utf-8");
  }

  return {
    changed: !dryRun && actions.length > 0,
    dryRun,
    global: includeGlobal,
    actions: actions.map(maskSensitiveText),
    skipped: skipped.map(maskSensitiveText),
    backups,
  };
}
