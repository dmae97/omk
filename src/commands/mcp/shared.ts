import { readFile } from "fs/promises";
import { join } from "path";
import {
  getProjectRoot,
  pathExists,
  getUserHome,
} from "../../util/fs.js";
import { maskSensitiveText } from "../../util/secret-mask.js";

export interface McpServerConfig {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  http_headers?: Record<string, string>;
  startup_timeout_sec?: number;
  enabled?: boolean;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ConfigSource {
  path: string;
  config: McpConfig;
  exists: boolean;
  parsed: boolean;
  error?: string;
}

export interface CollectedMcpServer {
  server: McpServerConfig;
  sources: string[];
  serversBySource: Map<string, McpServerConfig>;
}

export const RAILWAY_REMOTE_MCP_URL = "https://mcp.railway.com";

export async function loadConfig(filePath: string): Promise<ConfigSource> {
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

export async function resolveAllConfigs(): Promise<ConfigSource[]> {
  const root = getProjectRoot();
  const paths = [
    join(root, ".omk", "mcp.json"),
    join(root, ".kimi", "mcp.json"),
    join(getUserHome(), ".kimi", "mcp.json"),
    join(getUserHome(), ".omk", "mcp.json"),
  ];
  const results: ConfigSource[] = [];
  for (const p of paths) {
    results.push(await loadConfig(p));
  }
  return results;
}

export function collectServers(sources: ConfigSource[]): Map<string, CollectedMcpServer> {
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

export function selectEffectiveServer(info: CollectedMcpServer, activePathOrder: string[]): McpServerConfig {
  for (let index = activePathOrder.length - 1; index >= 0; index--) {
    const server = info.serversBySource.get(activePathOrder[index]);
    if (server) return server;
  }
  return info.server;
}

export function basenameOfCommand(command: string): string {
  return command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
}

export function isNpmLauncherCommand(command: string | undefined): boolean {
  if (!command) return false;
  return ["npm", "npx", "npm.cmd", "npx.cmd", "npm.exe", "npx.exe"].includes(basenameOfCommand(command));
}

export function validateRemoteMcpUrl(url: string): { ok: true } | { ok: false; message: string } {
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

const SECRET_QUERY_KEYS = /^(token|api[-_]?key|key|secret|password|auth|credential|session|bearer|access[-_]?token|refresh[-_]?token|client[-_]?secret|x[-_]?auth[-_]?token|signature|sig|jwt|private[-_]?key|pat|dsn)$/i;

export function sanitizeMcpUrlForDisplay(url: string): string {
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
    if (parsed.hash) {
      parsed.hash = "#***";
      changed = true;
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

export function serverTargetText(server: McpServerConfig): string {
  return [server.url, server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
}

export function isRailwayMcpServer(name: string, server: McpServerConfig): boolean {
  return /railway/i.test(name) || /railway/i.test(serverTargetText(server));
}

export function isSupabaseMcpServer(name: string, server: McpServerConfig): boolean {
  return /supabase/i.test(name) || /supabase/i.test(serverTargetText(server));
}

export function formatArgsForDisplay(args: string[]): string {
  return sanitizeMcpArgsForProject(args).join(" ");
}

export function sanitizeMcpServerForProject(server: McpServerConfig): McpServerConfig {
  const cleaned = JSON.parse(JSON.stringify(server)) as McpServerConfig & Record<string, unknown>;
  if (typeof cleaned.url === "string") {
    cleaned.url = sanitizeMcpUrlForDisplay(cleaned.url);
  }
  if (typeof cleaned.command === "string") {
    cleaned.command = maskSensitiveText(cleaned.command);
  }
  if (Array.isArray(cleaned.args)) {
    cleaned.args = sanitizeMcpArgsForProject(cleaned.args);
  }
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

export function sanitizeMcpArgsForProject(args: string[]): string[] {
  return args.map((arg, index) => {
    if (typeof arg !== "string") return arg;
    const previous = index > 0 ? args[index - 1] : "";
    if (typeof previous === "string" && isSplitSecretCliOption(previous)) return "[REDACTED]";
    if (isSecretCliOption(arg)) {
      const eq = arg.indexOf("=");
      return eq > 0 ? `${arg.slice(0, eq + 1)}[REDACTED]` : arg;
    }
    return maskSensitiveText(arg);
  });
}

function isSplitSecretCliOption(value: string): boolean {
  return value.indexOf("=") === -1 && isSecretCliOption(value);
}

function isSecretCliOption(value: string): boolean {
  return /^--?(?:api[-_]?key|api[-_]?token|token|key|secret|password|passwd|client[-_]?secret|x[-_]?auth[-_]?token|auth|authorization|credential|cookie|session|jwt|private[-_]?key)(?:=.*)?$/i.test(value);
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isSecretEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|DATABASE_URL|DATABASE_URI|CONNECTION_STRING|CONNECTION_URI|MONGO(?:DB)?_URI|REDIS_URL|POSTGRES(?:QL)?_URL|MYSQL_URL|DSN|PAT|JWT|BEARER|OAUTH)/i.test(name);
}

function isSecretHeaderName(name: string): boolean {
  return /authorization|x-api-key|api-key|cookie|set-cookie|x-auth-token|token|secret|signature/i.test(name);
}
