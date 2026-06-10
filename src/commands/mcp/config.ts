import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import {
  getProjectRoot,
  pathExists,
  getUserHome,
  STALE_PACKAGE_NAMES,
} from "../../util/fs.js";
import { style, header, status, label } from "../../util/theme.js";
import { maskSensitiveText } from "../../util/secret-mask.js";
import {
  formatArgsForDisplay,
  isHttpUrl,
  isSecretEnvName,
  loadConfig,
  RAILWAY_REMOTE_MCP_URL,
  sanitizeMcpServerForProject,
  sanitizeMcpUrlForDisplay,
  type McpConfig,
  type McpServerConfig,
} from "./shared.js";

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

  const server = sanitizeMcpServerForProject(createInstallServer(name, command, args, options));

  projectMcpServers[name] = server;
  await mkdir(join(root, ".kimi"), { recursive: true });
  await writeFile(projectMcpPath, JSON.stringify({ mcpServers: projectMcpServers }, null, 2) + "\n", "utf-8");

  console.log(header("MCP Install"));
  console.log(status.ok(`Installed "${name}" into ${projectMcpPath}`));
  if (server.url) {
    console.log(label("URL", sanitizeMcpUrlForDisplay(server.url)));
  } else {
    console.log(label("Command", maskSensitiveText(server.command ?? command)));
    if (args.length > 0) console.log(label("Args", formatArgsForDisplay(server.args ?? args)));
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
    return { url: sanitizeMcpUrlForDisplay(command) };
  }

  const server: McpServerConfig = { command, args: [...args] };
  if (options.env) {
    server.env = {};
    if (Array.isArray(options.env)) {
      for (const pair of options.env) {
        const idx = pair.indexOf("=");
        if (idx > 0) {
          const key = pair.slice(0, idx);
          server.env[key] = sanitizeInstallEnvValue(key, pair.slice(idx + 1));
        }
      }
    } else {
      for (const [key, value] of Object.entries(options.env)) {
        server.env[key] = sanitizeInstallEnvValue(key, value);
      }
    }
  }
  if (Number.isFinite(options.startupTimeoutSec) && options.startupTimeoutSec && options.startupTimeoutSec > 0) {
    server.startup_timeout_sec = Math.trunc(options.startupTimeoutSec);
  }
  return server;
}

function sanitizeInstallEnvValue(key: string, value: string): string {
  if (!isSecretEnvName(key)) return value;
  const trimmed = value.trim();
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed)) return trimmed;
  return `\${${key}}`;
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
        const server = sanitizeMcpServerForProject(createInstallServer(entry.name, entry.command, entry.args, {
          env: entry.env,
          startupTimeoutSec: entry.startupTimeoutSec,
        }));
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
    merged[name] = sanitizeMcpServerForProject(server);
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
