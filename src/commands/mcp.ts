import { mkdir, readFile, writeFile } from "fs/promises";

import { join, isAbsolute } from "path";
import { runShell, which } from "../util/shell.js";
import { collectMcpConfigs, getProjectRoot, pathExists, getUserHome } from "../util/fs.js";
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
  parsed: boolean;
  error?: string;
}

const RAILWAY_REMOTE_MCP_URL = "https://mcp.railway.com";
const JSON_RPC_INTERNAL_ERROR_CODE = -32603;

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
    return { path: filePath, config: {}, parsed: false, error: "File not found" };
  }
  try {
    const content = await readFile(filePath, "utf-8");
    const config = JSON.parse(content) as McpConfig;
    return { path: filePath, config, parsed: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: filePath, config: {}, parsed: false, error: `Invalid JSON: ${message}` };
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

function collectServers(sources: ConfigSource[]): Map<string, { server: McpServerConfig; sources: string[] }> {
  const map = new Map<string, { server: McpServerConfig; sources: string[] }>();
  for (const src of sources) {
    if (!src.parsed || !src.config.mcpServers) continue;
    for (const [name, server] of Object.entries(src.config.mcpServers)) {
      const existing = map.get(name);
      if (existing) {
        existing.sources.push(src.path);
      } else {
        map.set(name, { server, sources: [src.path] });
      }
    }
  }
  return map;
}

export async function mcpListCommand(): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);

  console.log(header("MCP Servers"));

  for (const src of sources) {
    const icon = src.parsed ? style.mint("✓") : style.pink("✗");
    console.log(`${icon} ${src.path}`);
    if (src.error) console.log(`  ${style.gray(src.error)}`);
  }

  if (servers.size === 0) {
    console.log("\n" + style.gray("No MCP servers configured."));
    return;
  }

  console.log("");
  for (const [name, info] of servers) {
    const dup = info.sources.length > 1 ? style.skin(` [duplicate: ${info.sources.length} sources]`) : "";
    console.log(bullet(`${style.purpleBold(name)}${dup}`, "purple"));
    if (info.server.url) {
      console.log(`  ${style.gray("url:")} ${info.server.url}`);
    }
    if (info.server.command || !info.server.url) {
      console.log(`  ${style.gray("command:")} ${info.server.command ?? style.pink("missing")}`);
    }
    if (info.server.args && info.server.args.length > 0) {
      console.log(`  ${style.gray("args:")} ${formatArgsForDisplay(info.server.args)}`);
    }
    if (info.server.env && Object.keys(info.server.env).length > 0) {
      console.log(`  ${style.gray("env:")} ${Object.keys(info.server.env).join(", ")}`);
    }
    console.log(`  ${style.gray("from:")} ${info.sources.join(", ")}`);
  }
}

export async function mcpDoctorCommand(): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);
  const resources = await getOmkResourceSettings();
  const activePaths = new Set(await collectMcpConfigs(resources.mcpScope));

  console.log(header("MCP Doctor"));
  console.log(style.gray(`Active MCP scope: ${resources.mcpScope}`));

  let issues = 0;

  // Config file checks
  for (const src of sources) {
    if (!src.parsed) {
      console.log(status.error(`${src.path}: ${src.error}`));
      issues++;
    } else if (!src.config.mcpServers || Object.keys(src.config.mcpServers).length === 0) {
      console.log(style.gray(`${src.path}: no mcpServers defined`));
    } else {
      console.log(status.ok(`${src.path}`));
    }
  }

  if (servers.size === 0) {
    console.log("\n" + style.gray("No servers to diagnose."));
    process.exitCode = issues > 0 ? 1 : 0;
    return;
  }

  // Server checks
  console.log("");
  for (const [name, info] of servers) {
    console.log(label("Server", name));
    const activeDuplicateSources = info.sources.filter((source) => activePaths.has(source));

    if (activeDuplicateSources.length > 1) {
      if (name === "omk-project") {
        console.log(`  ${style.gray("ℹ managed omk-project mirror duplicate:")} ${activeDuplicateSources.join(", ")}`);
      } else {
        console.log(`  ${style.skin("⚠ active duplicate definition in:")} ${activeDuplicateSources.join(", ")}`);
        issues++;
      }
    } else if (info.sources.length > 1) {
      console.log(`  ${style.gray("ℹ duplicate mirror outside active scope:")} ${info.sources.join(", ")}`);
    }

    const server = info.server;

    // Transport check
    if (server.url) {
      const urlCheck = validateRemoteMcpUrl(server.url);
      if (urlCheck.ok) {
        console.log(`  ${style.mint("✓ url:")} ${server.url}`);
      } else {
        console.log(`  ${style.pink("✗ invalid url:")} ${urlCheck.message}`);
        issues++;
      }
    } else if (!server.command) {
      console.log(`  ${style.pink("✗ missing command")}`);
      issues++;
    } else {
      const resolved = await which(server.command);
      if (resolved.failed) {
        console.log(`  ${style.pink("✗ command not found:")} ${server.command}`);
        issues++;
      } else {
        console.log(`  ${style.mint("✓ command:")} ${resolved.stdout.trim()}`);
      }
    }

    // args check
    if (!server.url && server.args) {
      for (const [index, arg] of server.args.entries()) {
        // Check if arg looks like a file path and exists
        if (shouldValidateArgPath(server, arg, index)) {
          if (isAbsolute(arg) || arg.includes("/") || arg.includes("\\")) {
            const exists = await pathExists(arg);
            if (!exists) {
              console.log(`  ${style.pink("✗ arg path not found:")} ${arg}`);
              issues++;
            } else {
              console.log(`  ${style.mint("✓ arg path:")} ${arg}`);
            }
          }
        }
      }
    }

    // env check (static — flag if referenced env vars are empty in current process)
    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        if (value.startsWith("${") && value.endsWith("}")) {
          const envName = value.slice(2, -1);
          if (!process.env[envName]) {
            console.log(`  ${style.skin("⚠ env reference undefined:")} ${key} → ${envName}`);
          }
        }
      }
    }

    // Stability hints for slow-starting or failed servers
    if (server.command || server.url) {
      const stabilityHints: string[] = [];
      const target = serverTargetText(server);
      if ((server.command?.includes("npx") ?? false) || (server.command?.includes("npm") ?? false)) {
        stabilityHints.push("npx-based servers may take >10s to start on first run. Consider installing globally or pinning the package.");
      }
      if (isRailwayMcpServer(name, server)) {
        if (server.url?.includes("mcp.railway.com")) {
          stabilityHints.push("Railway remote MCP uses OAuth over HTTP and avoids local npx/CLI token files; the first tool call may open browser auth.");
        } else if (target.includes("@railway/mcp-server")) {
          stabilityHints.push(`Railway local MCP depends on Railway CLI auth and npx cold starts. Prefer the remote OAuth preset: omk mcp install railway or Codex: codex mcp add railway --url ${RAILWAY_REMOTE_MCP_URL}.`);
        } else {
          stabilityHints.push(`Railway MCP is most stable as a remote OAuth server at ${RAILWAY_REMOTE_MCP_URL}; avoid committing API tokens into MCP JSON.`);
        }
      }
      if (name === "promptfoo") {
        stabilityHints.push("promptfoo can be slow to initialize. Ensure NODE_OPTIONS does not limit memory, or run 'omk mcp test promptfoo' with a longer timeout.");
      }
      if (name === "obsidian") {
        stabilityHints.push("obsidian MCP requires an active Obsidian vault and the Local REST API plugin. If the vault is closed, the server will fail.");
      }
      if (stabilityHints.length > 0) {
        console.log(`  ${style.skin("ℹ stability:")} ${stabilityHints.join(" ")}`);
      }
    }
  }

  console.log("");
  if (issues === 0) {
    console.log(status.ok("All checks passed"));
  } else {
    console.log(status.error(`${issues} issue(s) found`));
    process.exitCode = 1;
  }
}

function shouldValidateArgPath(server: McpServerConfig, arg: string, index: number): boolean {
  if (typeof arg !== "string" || arg.startsWith("-") || arg.startsWith("$")) return false;
  if (isShellInlineScript(server, index)) return false;
  // Shell snippets, inline commands, and arguments with whitespace are not
  // standalone filesystem paths. Validating them as paths creates false MCP
  // doctor failures for commands like `bash -lc "exec node /path/server.js"`.
  if (/[\s;"'|&<>]/.test(arg)) return false;
  return true;
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

function serverTargetText(server: McpServerConfig): string {
  return [server.url, server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
}

function isRailwayMcpServer(name: string, server: McpServerConfig): boolean {
  return /railway/i.test(name) || /railway/i.test(serverTargetText(server));
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

  const server = info.server;
  if (!server.url && !server.command) {
    console.error(status.error(`Server ${serverName} has no command`));
    process.exit(1);
  }

  console.log(header(`MCP Test: ${serverName}`));
  if (server.url) {
    console.log(label("URL", server.url));
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
    timeout: 5000,
    env: server.env ? { ...process.env, ...server.env } as Record<string, string> : process.env as Record<string, string>,
  });
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
    timeout: 8000,
    env: server.env ? { ...process.env, ...server.env } as Record<string, string> : process.env as Record<string, string>,
    input: initializePayload,
  });
  const handshakeResponses = parseJsonRpcResponses(handshakeResult.stdout);
  const internalHandshakeError = findInternalJsonRpcError(handshakeResponses);
  if (internalHandshakeError) {
    console.error(status.error(`JSON-RPC initialize returned Internal error: ${internalHandshakeError.error?.message ?? "unknown"}`));
    process.exit(1);
  }
  if (!handshakeResult.failed && handshakeResult.stdout.includes("\"serverInfo\"")) {
    console.log(style.mint("JSON-RPC initialize succeeded"));
  } else if (!handshakeResult.failed) {
    console.log(style.gray(`Server exited without initialize response (exit code ${handshakeResult.exitCode})`));
  } else if (handshakeResult.stderr.includes("timeout") || handshakeResult.stderr.includes("ETIMEDOUT")) {
    console.log(style.mint("Server stayed alive long enough — stdio MCP server looks healthy"));
  } else {
    console.log(style.gray(`Handshake result: ${handshakeResult.stderr}`));
  }

  if (shouldRunOmkProjectProbe(serverName, server)) {
    await runOmkProjectToolProbe(command, smokeArgs, server.env);
  }
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
    timeout: 10000,
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
    console.error(status.error("JSON-RPC tools/call id 3 did not return a response"));
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

function parseJsonRpcResponses(stdout: string): JsonRpcProbeResponse[] {
  const responses: JsonRpcProbeResponse[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) {
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
    if (response.status < 500) {
      console.log(status.ok(`Remote endpoint reachable (HTTP ${response.status})`));
      if (serverName === "railway") {
        console.log(style.gray("Railway may prompt OAuth on first tool call; no API token is required in MCP config."));
      }
      return;
    }
    console.log(style.skin(`Remote endpoint responded with HTTP ${response.status}; retry later or check provider status.`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(style.skin(`Remote endpoint reachability inconclusive: ${message}`));
  }
}

export async function mcpRemoveCommand(serverName: string): Promise<void> {
  const root = getProjectRoot();
  const localPath = join(root, ".kimi", "mcp.json");
  const omkPath = join(root, ".omk", "mcp.json");

  const sources: Array<{ path: string; label: string }> = [
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
    console.log(status.error(`Server "${serverName}" not found in project-local MCP configs.`));
    console.log(style.gray(`Checked: ${sources.map((s) => s.path).join(", ")}`));
    console.log(style.gray(`To remove a global server, edit ~/.kimi/mcp.json manually.`));
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

  projectMcpServers[serverName] = globalSource.config.mcpServers[serverName];
  await mkdir(join(root, ".kimi"), { recursive: true });
  await writeFile(projectMcpPath, JSON.stringify({ mcpServers: projectMcpServers }, null, 2) + "\n", "utf-8");

  console.log(header("MCP Add"));
  console.log(status.ok(`Added "${serverName}" to ${projectMcpPath}`));
}

export async function mcpInstallCommand(
  name: string,
  command: string,
  args: string[],
  options: { env?: string[] } = {}
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
    console.log(label("URL", server.url));
  } else {
    console.log(label("Command", command));
    if (args.length > 0) console.log(label("Args", formatArgsForDisplay(args)));
  }
}

function createInstallServer(
  name: string,
  command: string,
  args: string[],
  options: { env?: string[] } = {}
): McpServerConfig {
  if (isRailwayInstallPreset(name, command, args, options)) {
    return { url: RAILWAY_REMOTE_MCP_URL };
  }
  if (isHttpUrl(command) && args.length === 0) {
    return { url: command };
  }

  const server: McpServerConfig = { command, args };
  if (options.env && options.env.length > 0) {
    server.env = {};
    for (const pair of options.env) {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        server.env[pair.slice(0, idx)] = pair.slice(idx + 1);
      }
    }
  }
  return server;
}

function isRailwayInstallPreset(
  name: string,
  command: string,
  args: string[],
  options: { env?: string[] }
): boolean {
  return name.toLowerCase() === "railway"
    && command === "railway"
    && args.length === 0
    && (!options.env || options.env.length === 0);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
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

function isSecretEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)$/i.test(name);
}
