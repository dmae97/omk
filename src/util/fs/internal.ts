import { rmSync } from "fs";
import type { RuntimeMcpPreflightFailureReason } from "./preflight.js";

export function isShellInlineMcpArg(server: Record<string, unknown>, index: number): boolean {
  const command = typeof server.command === "string" ? server.command : "";
  const commandName = command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  if (!["bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd", "cmd.exe"].includes(commandName)) {
    return false;
  }
  const args = Array.isArray(server.args) ? server.args : [];
  const previous = args[index - 1];
  return previous === "-c" || previous === "-lc" || previous === "/c" || previous === "--command";
}

const NODE_PACKAGE_MANAGER_COMMANDS = new Set([
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
const PYTHON_PACKAGE_MANAGER_COMMANDS = new Set([
  "uv",
  "uvx",
  "pip",
  "pip3",
  "pipx",
  "poetry",
  "rye",
  "uv.exe",
  "uvx.exe",
  "pip.exe",
  "pip3.exe",
  "pipx.exe",
  "poetry.exe",
  "rye.exe",
]);
export const PACKAGE_MANAGER_COMMANDS = new Set([
  ...NODE_PACKAGE_MANAGER_COMMANDS,
  ...PYTHON_PACKAGE_MANAGER_COMMANDS,
]);
const PYTHON_RUNTIME_COMMANDS = new Set(["python", "python3", "py", "python.exe", "python3.exe", "py.exe"]);
const INLINE_PACKAGE_MANAGER_RE = /(?:^|[\s/])(npm|npx|pnpm|yarn|bun|bunx|uv|uvx|pip|pip3|pipx|poetry|rye)(?:\.(?:cmd|exe))?(?:\s|$)/i;
const INLINE_PYTHON_PACKAGE_MANAGER_RE = /(?:^|[\s/])(?:python(?:3)?|py)(?:\.exe)?\s+-m\s+(?:pip|pip3|uv)(?:\s|$)/i;
const STDIO_INCOMPATIBLE_HTTP_MCP_COMMANDS = new Set(["page-design-guide", "mcp-pdf-server"]);
export const PDF_MCP_SERVER_RE = /(?:^|\s)(?:@modelcontextprotocol\/server-pdf|mcp-pdf-server)(?:\s|$)/i;
const EXPLICIT_STDIO_TRANSPORT_RE = /(?:^|\s)(?:--stdio|--transport(?:=|\s+)stdio)(?:\s|$)/i;
const EXPLICIT_HTTP_TRANSPORT_RE = /(?:^|\s)--transport(?:=|\s+)(?:http|sse|streamable-http)(?:\s|$)/i;

export const QUIET_PACKAGE_MANAGER_ENV: Record<string, string> = {
  npm_config_loglevel: "error",
  NPM_CONFIG_LOGLEVEL: "error",
  npm_config_progress: "false",
  NPM_CONFIG_PROGRESS: "false",
  npm_config_audit: "false",
  NPM_CONFIG_AUDIT: "false",
  npm_config_fund: "false",
  NPM_CONFIG_FUND: "false",
  npm_config_prefer_offline: "true",
  NPM_CONFIG_PREFER_OFFLINE: "true",
  npm_config_fetch_retries: "0",
  NPM_CONFIG_FETCH_RETRIES: "0",
  npm_config_fetch_retry_mintimeout: "1000",
  NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: "1000",
  npm_config_fetch_retry_maxtimeout: "1000",
  NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: "1000",
  npm_config_maxsockets: "3",
  NPM_CONFIG_MAXSOCKETS: "3",
  npm_config_update_notifier: "false",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  NO_UPDATE_NOTIFIER: "1",
  NODE_NO_WARNINGS: "1",
  UV_NO_PROGRESS: "1",
  PIP_DISABLE_PIP_VERSION_CHECK: "1",
  PIP_NO_INPUT: "1",
  PIP_NO_PYTHON_VERSION_WARNING: "1",
  PIP_PROGRESS_BAR: "off",
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function basenameOfRuntimeCommand(command: string): string {
  return command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
}

export function runtimeShellInlineScripts(server: Record<string, unknown>): string[] {
  const args = Array.isArray(server.args) ? server.args : [];
  return args.filter((arg, index): arg is string => typeof arg === "string" && isShellInlineMcpArg(server, index));
}

export function runtimeCommandText(server: Record<string, unknown>): string {
  const command = typeof server.command === "string" ? server.command : "";
  const args = Array.isArray(server.args)
    ? server.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  return [command, ...args, ...runtimeShellInlineScripts(server)].join(" ");
}

function hasExplicitStdioTransport(server: Record<string, unknown>): boolean {
  return EXPLICIT_STDIO_TRANSPORT_RE.test(runtimeCommandText(server));
}

export function hasHttpTransportMismatch(name: string, server: Record<string, unknown>): boolean {
  if (hasExplicitStdioTransport(server)) return false;
  const command = typeof server.command === "string" ? basenameOfRuntimeCommand(server.command) : "";
  const targetText = runtimeCommandText(server);
  if (PDF_MCP_SERVER_RE.test(targetText)) return true;
  if (STDIO_INCOMPATIBLE_HTTP_MCP_COMMANDS.has(command) || STDIO_INCOMPATIBLE_HTTP_MCP_COMMANDS.has(name)) {
    return true;
  }
  return EXPLICIT_HTTP_TRANSPORT_RE.test(targetText);
}

export function isPackageManagerRuntimeServer(server: Record<string, unknown>): boolean {
  const command = typeof server.command === "string" ? basenameOfRuntimeCommand(server.command) : "";
  if (PACKAGE_MANAGER_COMMANDS.has(command)) return true;
  if (PYTHON_RUNTIME_COMMANDS.has(command)) {
    const args = Array.isArray(server.args)
      ? server.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    for (let index = 0; index < args.length - 1; index += 1) {
      if (args[index] === "-m" && PYTHON_PACKAGE_MANAGER_COMMANDS.has(basenameOfRuntimeCommand(args[index + 1]))) {
        return true;
      }
    }
  }
  return runtimeShellInlineScripts(server).some((script) => {
    const normalized = script.replace(/\\/g, "/");
    return INLINE_PACKAGE_MANAGER_RE.test(normalized) || INLINE_PYTHON_PACKAGE_MANAGER_RE.test(normalized);
  });
}

export function sanitizeRuntimeMcpPreflightText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
    .replace(/(--(?:api-)?(?:token|key|secret|password)(?:=|\s+))[^"'`\s;]+/gi, "$1***")
    .replace(/([A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH)[A-Za-z0-9_]*\s*=\s*)[^"'`\s;]+/gi, "$1***")
    .replace(/([?&](?:token|api[-_]?key|key|secret|password|auth|credential|session|bearer|access[-_]?token|refresh[-_]?token|client[-_]?secret|x[-_]?auth[-_]?token|signature|sig)=)[^&#\s]+/gi, "$1***");
}

export function formatPreflightFailureDetail(
  reason: RuntimeMcpPreflightFailureReason | undefined,
  detail: string | undefined
): string {
  if (reason === "timeout") return "timeout";
  return sanitizeRuntimeMcpPreflightText(detail ?? "failed");
}

const runtimeMcpCleanupPaths = new Set<string>();
let runtimeMcpCleanupRegistered = false;

function cleanupRuntimeMcpFiles(): void {
  for (const path of runtimeMcpCleanupPaths) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Best-effort cleanup for a local runtime cache that may contain MCP env.
    }
  }
}

export function registerRuntimeMcpCleanupPath(runtimeConfigPath: string): void {
  runtimeMcpCleanupPaths.add(runtimeConfigPath);
  if (!runtimeMcpCleanupRegistered) {
    runtimeMcpCleanupRegistered = true;
    process.once("exit", cleanupRuntimeMcpFiles);
  }
}
