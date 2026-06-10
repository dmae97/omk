import { runShell, which } from "../../util/shell.js";
import {
  collectMcpConfigs,
  getProjectRoot,
  preflightRuntimeMcpServers,
  resolveRuntimeMcpPreflightOptions,
} from "../../util/fs.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import { style, header, status, label } from "../../util/theme.js";
import { maskSensitiveText } from "../../util/secret-mask.js";
import { buildSubprocessEnv } from "../../mcp/transports/stdio.js";
import { McpClientSession } from "../../mcp/client.js";
import {
  collectServers,
  formatArgsForDisplay,
  resolveAllConfigs,
  sanitizeMcpUrlForDisplay,
  selectEffectiveServer,
  serverTargetText,
  validateRemoteMcpUrl,
  type McpServerConfig,
} from "./shared.js";

const JSON_RPC_INTERNAL_ERROR_CODE = -32603;

interface JsonRpcProbeResponse {
  id?: string | number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
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
    await testRemoteMcpServer(serverName, server);
    return;
  }

  const command = server.command;
  if (!command) {
    console.error(status.error(`Server ${serverName} has no command`));
    process.exit(1);
  }

  console.log(label("Command", maskSensitiveText(command)));
  if (server.args) console.log(label("Args", formatArgsForDisplay(server.args)));
  console.log("");
  const testEnv = buildSubprocessEnv(process.env, server.env ?? {});

  // Test 1: executable exists
  const resolved = await which(command);
  if (resolved.failed) {
    console.error(status.error(`Executable not found: ${maskSensitiveText(command)}`));
    process.exit(1);
  }
  console.log(status.ok(`Executable: ${maskSensitiveText(resolved.stdout.trim())}`));

  // Test 2: try to run with a 5s timeout as a basic smoke test
  const smokeArgs = [...(server.args ?? [])];
  console.log(style.gray("Smoke test: starting process (5s timeout)..."));
  const smokeResult = await runShell(command, smokeArgs, {
    cwd: getProjectRoot(),
    timeout: 5000,
    env: testEnv,
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
    console.error(status.error(`Failed to start: ${maskSensitiveText(smokeResult.stderr)}`));
    process.exit(1);
  } else {
    console.log(style.gray(`Process exited with error (may be OK for stdio servers): ${maskSensitiveText(smokeResult.stderr)}`));
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
  const handshakeTimeoutMs = Math.max(1000, Math.min((server.startup_timeout_sec ?? 20) * 1000, 20_000));
  const handshakeResult = await runShell(command, smokeArgs, {
    cwd: getProjectRoot(),
    timeout: handshakeTimeoutMs,
    env: testEnv,
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
    console.error(status.error(`JSON-RPC initialize returned Internal error: ${maskSensitiveText(internalHandshakeError.error?.message ?? "unknown")}`));
    process.exit(1);
  }
  const initializeResponse = findJsonRpcResponseById(handshakeResponses, 1);
  const serverInfo = extractInitializeServerInfo(initializeResponse);
  if (serverInfo) {
    console.log(style.mint("JSON-RPC initialize succeeded"));
  } else if (!handshakeResult.failed) {
    const detail = initializeResponse ? "initialize response missing serverInfo" : `server exited without initialize response (exit code ${handshakeResult.exitCode})`;
    console.error(status.error(`JSON-RPC initialize failed: ${detail}`));
    process.exit(1);
  } else if (/timed?\s*out|timeout|ETIMEDOUT/i.test(handshakeResult.stderr)) {
    console.error(status.error("JSON-RPC initialize timed out before serverInfo was received"));
    if (handshakeResult.stderr.trim()) console.error(style.gray(maskSensitiveText(handshakeResult.stderr.trim())));
    process.exit(1);
  } else {
    console.error(status.error(`JSON-RPC initialize failed: ${maskSensitiveText(handshakeResult.stderr || "unknown error")}`));
    process.exit(1);
  }

  if (shouldRunOmkProjectProbe(serverName, server)) {
    await runOmkProjectToolProbe(command, smokeArgs, server.env);
  }
}

export async function mcpPrewarmCommand(
  serverName: string | undefined,
  options: { all?: boolean; label?: "prewarm" | "check" } = {}
): Promise<void> {
  const isCheck = options.label === "check";
  if (options.all) {
    console.log(header(isCheck ? "MCP Check All" : "MCP Preflight Check All"));
    console.log(style.gray("Bounded npm-family dependency-resolution check for active MCP servers; this does not force-install packages."));

    const resources = await getOmkResourceSettings();
    const activePathOrder = await collectMcpConfigs(resources.mcpScope);
    const activePaths = new Set(activePathOrder);

    const sources = await resolveAllConfigs();
    const servers = collectServers(sources);

    if (servers.size === 0) {
      console.log(style.gray("No MCP servers configured."));
      return;
    }

    const activeServers: Record<string, unknown> = {};
    const inactive = new Set<string>();
    for (const [name, info] of servers) {
      const activeSources = info.sources.filter((source) => activePaths.has(source));
      if (activeSources.length === 0) {
        inactive.add(name);
        continue;
      }
      activeServers[name] = selectEffectiveServer(info, activePathOrder);
    }

    const preflightOptions = resolveRuntimeMcpPreflightOptions();
    const preflight = await preflightRuntimeMcpServers(activeServers, preflightOptions);
    const entriesByName = new Map(preflight.entries.map((entry) => [entry.name, entry]));

    let okCount = 0;
    let failCount = 0;
    let checkedCount = 0;
    let skipCount = inactive.size;

    for (const [name] of servers) {
      if (inactive.has(name)) {
        console.log(`${style.gray("-")} ${style.gray(name)} ${style.gray("[inactive]")}`);
        continue;
      }
      checkedCount++;

      const entry = entriesByName.get(name);
      if (!entry || entry.status === "skipped") {
        skipCount++;
        const reason = entry?.reason === "no-package-spec" ? "no package spec" : "not npm-family";
        console.log(`${style.gray("-")} ${name} ${style.gray(`[skipped: ${reason}]`)}`);
        continue;
      }
      if (entry.status === "ok") {
        okCount++;
        const packageNote = entry.packageSpec ? ` (${entry.packageSpec})` : "";
        console.log(`${style.mint("✓")} ${name}${style.gray(packageNote)}`);
        continue;
      }

      failCount++;
      console.log(`${style.pink("✗")} ${name}: ${maskSensitiveText(entry.detail ?? "failed")}`);
    }

    console.log("");
    if (failCount === 0) {
      console.log(status.ok(`Checked ${checkedCount} server(s); ${skipCount} skipped`));
    } else {
      process.exitCode = 1;
      console.log(status.error(`${failCount} failure(s), ${okCount} ok, ${skipCount} skipped`));
    }
    return;
  }

  if (!serverName) {
    console.error(status.error("Provide a server name or use --all"));
    process.exit(1);
  }

  console.log(header(`${isCheck ? "MCP Check" : "MCP Prewarm/Check"}: ${serverName}`));
  console.log(style.gray("Runs the MCP startup probe outside chat; package-manager caches may warm as a side effect."));
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
    env: buildSubprocessEnv(process.env, env ?? {}),
    input: payload,
  });
  const responses = parseJsonRpcResponses(probeResult.stdout);
  const internalError = findInternalJsonRpcError(responses);
  if (internalError) {
    console.error(status.error(`JSON-RPC id ${String(internalError.id ?? "?")} returned Internal error: ${internalError.error?.message ?? "unknown"}`));
    if (probeResult.stderr.trim()) console.error(style.gray(maskSensitiveText(probeResult.stderr.trim())));
    process.exit(1);
  }
  const toolResponse = responses.find((response) => response.id === 3);
  if (!toolResponse) {
    const timeoutHint = probeResult.stderr.includes("timeout") || probeResult.stderr.includes("ETIMEDOUT")
      ? " before the probe timeout"
      : "";
    console.error(status.error(`JSON-RPC tools/call id 3 did not return a response${timeoutHint}`));
    if (probeResult.stderr.trim()) console.error(style.gray(maskSensitiveText(probeResult.stderr.trim())));
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

function findJsonRpcResponseById(responses: JsonRpcProbeResponse[], id: string | number): JsonRpcProbeResponse | undefined {
  return responses.find((response) => response.id === id);
}

function extractInitializeServerInfo(response: JsonRpcProbeResponse | undefined): { name: string; version: string } | undefined {
  if (!response || !isRecord(response.result)) return undefined;
  const serverInfo = response.result.serverInfo;
  if (!isRecord(serverInfo)) return undefined;
  return typeof serverInfo.name === "string" && serverInfo.name.trim().length > 0
    && typeof serverInfo.version === "string" && serverInfo.version.trim().length > 0
    ? { name: serverInfo.name, version: serverInfo.version }
    : undefined;
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

async function testRemoteMcpServer(serverName: string, server: McpServerConfig): Promise<void> {
  console.log("");
  const url = server.url;
  if (!url) {
    console.error(status.error(`Remote MCP server ${serverName} has no URL`));
    process.exit(1);
  }
  const urlCheck = validateRemoteMcpUrl(url);
  if (!urlCheck.ok) {
    console.error(status.error(`Invalid remote MCP URL for ${serverName}: ${urlCheck.message}`));
    process.exit(1);
  }

  const timeoutMs = Math.max(1000, Math.min((server.startup_timeout_sec ?? 20) * 1000, 20_000));
  console.log(style.gray(`Remote MCP JSON-RPC initialize test (${timeoutMs}ms timeout)...`));
  const session = new McpClientSession({
    name: serverName,
    transport: "streamable-http",
    url,
    headers: server.headers,
    http_headers: server.http_headers,
    startupTimeoutMs: timeoutMs,
    requestTimeoutMs: timeoutMs,
  });
  try {
    await session.connect();
    const result = await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "omk-mcp-test",
        version: "0.0.0",
      },
    });
    console.log(status.ok(`Remote MCP initialize succeeded: ${maskSensitiveText(result.serverInfo?.name ?? "unknown")} ${maskSensitiveText(result.serverInfo?.version ?? "")}`.trim()));
    if (serverName === "railway") {
      console.log(style.gray("Railway may prompt OAuth on first tool call; no API token is required in MCP config."));
    }
  } catch (err: unknown) {
    const message = maskSensitiveText(err instanceof Error ? err.message : String(err));
    if (/HTTP\s*401|unauthorized/i.test(message)) {
      console.error(status.error("Remote MCP initialize failed: authentication required (HTTP 401)."));
      if (serverName === "railway") {
        console.error(style.gray("Railway OAuth may need re-authentication. Run the server locally or re-authorize via browser."));
      } else if (serverName === "supabase") {
        console.error(style.gray("Supabase token may be expired. Generate a new access token in the Supabase account dashboard and update your global MCP env."));
      } else if (serverName === "github") {
        console.error(style.gray("GitHub token may be expired or lack required scopes. Check your token at https://github.com/settings/tokens."));
      }
      process.exit(1);
    }
    if (/HTTP\s*403|forbidden/i.test(message)) {
      console.error(status.error("Remote MCP initialize failed: forbidden (HTTP 403). Check token permissions."));
      if (serverName === "railway") {
        console.error(style.gray("Railway OAuth may need re-authentication. Run the server locally or re-authorize via browser."));
      } else if (serverName === "supabase") {
        console.error(style.gray("Supabase token may be expired. Generate a new access token in the Supabase account dashboard and update your global MCP env."));
      } else if (serverName === "github") {
        console.error(style.gray("GitHub token may be expired or lack required scopes. Check your token at https://github.com/settings/tokens."));
      }
      process.exit(1);
    }
    if (/HTTP\s*404|not found/i.test(message)) {
      console.error(status.error("Remote MCP initialize failed: endpoint not found (HTTP 404)."));
      process.exit(1);
    }
    if (/HTTP\s*405|method not allowed/i.test(message)) {
      console.error(status.error("Remote MCP initialize failed: method not allowed (HTTP 405). The endpoint may not support MCP over HTTP."));
      process.exit(1);
    }
    if (/HTTP\s*400|bad request/i.test(message)) {
      console.error(status.error("Remote MCP initialize failed: bad request (HTTP 400). Check URL and headers."));
      process.exit(1);
    }
    if (/timed?\s*out|timeout|ETIMEDOUT|MCP request timed out|MCP transport send timed out|MCP initialize response missing serverInfo/i.test(message)) {
      console.error(status.error(`Remote MCP initialize failed: ${message}`));
      console.error(style.gray("The endpoint may not be an MCP server, or it may require different headers or a different URL path."));
      process.exit(1);
    }
    console.error(status.error(`Remote MCP initialize failed: ${message}`));
    process.exit(1);
  } finally {
    await session.close().catch(() => {});
  }
}
