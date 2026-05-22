import { mkdir, readFile, writeFile } from "fs/promises";

import { dirname, join } from "path";
import { getProjectRoot, getUserHome, pathExists } from "../util/fs.js";
import { DEFAULT_OPENAI_API_KEY_ENV, OPENAI_IMAGE_API_KEY_ACTION } from "../openai/image-client.js";
import { runShell, which } from "../util/shell.js";
import { header, label, status, style } from "../util/theme.js";
import { maskSensitiveText } from "../util/secret-mask.js";

export interface KimiMcpServerConfig {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  http_headers?: Record<string, string>;
  startup_timeout_sec?: number;
  enabled?: boolean;
}

export interface KimiMcpConfig {
  mcpServers: Record<string, KimiMcpServerConfig>;
}

interface CodexMcpServerToml {
  [key: string]: unknown;
  url?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  headers?: unknown;
  http_headers?: unknown;
  env_http_headers?: unknown;
  bearer_token?: unknown;
  startup_timeout_sec?: unknown;
  enabled?: unknown;
}

export interface CodexMcpImportOptions {
  homeDir?: string;
  configPath?: string;
  projectRoot?: string;
  targetPath?: string;
  includeOpenAIDocs?: boolean;
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface McpImportCodexCommandOptions extends CodexMcpImportOptions {
  config?: string;
  openaiDocs?: boolean;
  json?: boolean;
}

export type OpenAiSetupChoice = "plus-pro" | "business-enterprise" | "api-key" | "later";

export interface CodexAuthCommandOptions {
  choice?: string;
  plan?: string;
  run?: boolean;
  json?: boolean;
  apiKeyEnv?: string;
  deviceAuth?: boolean;
}

export interface CodexAuthResult {
  ok: boolean;
  command: "codex auth" | "openai setup";
  choice: OpenAiSetupChoice;
  codexCliAvailable: boolean;
  apiKeyEnv: string;
  apiKeyPresent: boolean;
  authBypass: false;
  authVerified: boolean;
  verifiedBy?: string;
  authJsonRead: false;
  nextActions: string[];
}

export interface CodexMcpImportResult {
  sourcePath: string;
  targetPath: string;
  changed: boolean;
  imported: string[];
  placeholdered: string[];
  skipped: Array<{ name: string; reason: string }>;
  mcpServers: Record<string, KimiMcpServerConfig>;
}

interface ParsedToml {
  values: Record<string, unknown>;
}

interface ConvertResult {
  server?: KimiMcpServerConfig;
  placeholdered: boolean;
  skipReason?: string;
}

export const OPENAI_DOCS_MCP_NAME = "openaiDeveloperDocs";
export const OPENAI_DOCS_MCP_URL = "https://developers.openai.com/mcp";

export function resolveCodexConfigPath(options: Pick<CodexMcpImportOptions, "homeDir" | "configPath"> = {}): string {
  return options.configPath ?? join(options.homeDir ?? getUserHome(), ".codex", "config.toml");
}

export function openAiDocsMcpServer(): KimiMcpServerConfig {
  return { url: OPENAI_DOCS_MCP_URL };
}

export async function readCodexMcpServers(
  options: Pick<CodexMcpImportOptions, "homeDir" | "configPath" | "includeOpenAIDocs"> = {}
): Promise<CodexMcpImportResult> {
  const sourcePath = resolveCodexConfigPath(options);
  const parsed = await readCodexConfigToml(sourcePath);
  return convertCodexMcpConfig(parsed, {
    sourcePath,
    targetPath: "",
    includeOpenAIDocs: options.includeOpenAIDocs,
  });
}

export async function importCodexMcpConfig(options: CodexMcpImportOptions = {}): Promise<CodexMcpImportResult> {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const targetPath = options.targetPath ?? join(projectRoot, ".kimi", "mcp.json");
  const sourcePath = resolveCodexConfigPath(options);
  const parsed = await readCodexConfigToml(sourcePath);
  const converted = convertCodexMcpConfig(parsed, {
    sourcePath,
    targetPath,
    includeOpenAIDocs: options.includeOpenAIDocs,
  });

  const existing = await readKimiMcpConfig(targetPath);
  const importableEntries = Object.entries(converted.mcpServers).filter(([name]) => (
    options.overwrite || !(name in existing.mcpServers)
  ));
  const existingSkips = Object.keys(converted.mcpServers)
    .filter((name) => !options.overwrite && name in existing.mcpServers)
    .map((name) => ({ name, reason: "already exists in target MCP config; pass --overwrite to replace" }));
  const importableServers = Object.fromEntries(importableEntries);
  const importableNames = importableEntries.map(([name]) => name);
  const result: CodexMcpImportResult = {
    ...converted,
    imported: importableNames,
    placeholdered: converted.placeholdered.filter((name) => name in importableServers),
    skipped: [...converted.skipped, ...existingSkips],
    mcpServers: importableServers,
  };

  if (options.dryRun || importableNames.length === 0) return result;

  const nextServers = { ...existing.mcpServers, ...importableServers };
  const changed = JSON.stringify(existing.mcpServers) !== JSON.stringify(nextServers);
  if (changed) {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify({ ...existing, mcpServers: nextServers }, null, 2) + "\n", "utf-8");
  }
  return { ...result, changed };
}

export async function mcpImportCodexCommand(options: McpImportCodexCommandOptions = {}): Promise<void> {
  const result = await importCodexMcpConfig({
    ...options,
    configPath: options.configPath ?? options.config,
    includeOpenAIDocs: Boolean(options.includeOpenAIDocs ?? options.openaiDocs),
    dryRun: Boolean(options.dryRun),
    overwrite: Boolean(options.overwrite),
  });

  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      command: "mcp import-codex",
      dryRun: Boolean(options.dryRun),
      sourcePath: result.sourcePath,
      targetPath: result.targetPath,
      changed: result.changed,
      imported: result.imported,
      placeholdered: result.placeholdered,
      skipped: result.skipped,
      mcpServers: result.mcpServers,
    }, null, 2));
    return;
  }

  console.log(header("MCP Import Codex"));
  console.log(label("Source", result.sourcePath));
  console.log(label("Target", result.targetPath));
  console.log(label("Mode", options.dryRun ? "dry-run" : "write project-local"));
  if (result.imported.length > 0) {
    console.log(status.ok(`${options.dryRun ? "Would import" : "Imported"} ${result.imported.length} server(s): ${result.imported.join(", ")}`));
  } else {
    console.log(style.gray("No importable Codex MCP servers found."));
  }
  if (result.placeholdered.length > 0) {
    console.log(style.skin(`Secret-like fields placeholdered: ${result.placeholdered.join(", ")}`));
  }
  for (const skipped of result.skipped) {
    console.log(style.gray(`Skipped ${skipped.name}: ${skipped.reason}`));
  }
  console.log(style.gray("Secret-bearing values are never copied from Codex config into project MCP config."));
}

export async function codexAuthCommand(options: CodexAuthCommandOptions = {}): Promise<void> {
  const result = await buildCodexAuthResult("codex auth", options);
  emitCodexAuthResult(result, Boolean(options.json));
}

export async function openAiSetupCommand(options: CodexAuthCommandOptions = {}): Promise<void> {
  const result = await buildCodexAuthResult("openai setup", options);
  emitCodexAuthResult(result, Boolean(options.json));
}

async function buildCodexAuthResult(
  command: "codex auth" | "openai setup",
  options: CodexAuthCommandOptions
): Promise<CodexAuthResult> {
  const choice = await resolveSetupChoice(options.choice ?? options.plan);
  const codexCli = await which("codex");
  const codexCliAvailable = !codexCli.failed;
  const apiKeyEnv = options.apiKeyEnv ?? DEFAULT_OPENAI_API_KEY_ENV;
  const apiKeyPresent = Boolean(process.env[apiKeyEnv]?.trim());
  const nextActions = nextAuthActions(choice, { codexCliAvailable, apiKeyEnv, apiKeyPresent, deviceAuth: Boolean(options.deviceAuth) });
  let authVerified = false;
  let verifiedBy: string | undefined;

  if (options.run && (choice === "plus-pro" || choice === "business-enterprise")) {
    if (!codexCliAvailable) {
      nextActions.unshift("Install or expose the official Codex CLI on PATH, then run `codex login`.");
    } else {
      const args = options.deviceAuth ? ["login", "--device-auth"] : ["login"];
      const login = await runShell("codex", args, { stdio: "inherit", timeout: 10 * 60_000, inheritEnv: true });
      authVerified = !login.failed && login.exitCode === 0;
      verifiedBy = authVerified ? `codex ${args.join(" ")}` : undefined;
    }
  }

  return {
    ok: true,
    command,
    choice,
    codexCliAvailable,
    apiKeyEnv,
    apiKeyPresent,
    authBypass: false,
    authVerified,
    verifiedBy,
    authJsonRead: false,
    nextActions,
  };
}

async function resolveSetupChoice(rawChoice: string | undefined): Promise<OpenAiSetupChoice> {
  const normalized = normalizeSetupChoice(rawChoice);
  if (normalized) return normalized;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { select } = await import("@inquirer/prompts");
    return await select<OpenAiSetupChoice>({
      message: "How do you want OMK to guide OpenAI/Codex setup?",
      choices: [
        { name: "Plus/Pro ChatGPT sign-in", value: "plus-pro" },
        { name: "Business/Enterprise ChatGPT sign-in", value: "business-enterprise" },
        { name: "OpenAI API key only", value: "api-key" },
        { name: "Set up later", value: "later" },
      ],
    });
  }
  return "later";
}

function normalizeSetupChoice(rawChoice: string | undefined): OpenAiSetupChoice | undefined {
  const value = rawChoice?.trim().toLowerCase();
  if (!value) return undefined;
  if (["plus", "pro", "plus-pro", "chatgpt", "chatgpt-login"].includes(value)) return "plus-pro";
  if (["business", "enterprise", "business-enterprise", "team"].includes(value)) return "business-enterprise";
  if (["api", "api-key", "apikey", "key"].includes(value)) return "api-key";
  if (["later", "skip", "none"].includes(value)) return "later";
  return undefined;
}

function nextAuthActions(
  choice: OpenAiSetupChoice,
  options: { codexCliAvailable: boolean; apiKeyEnv: string; apiKeyPresent: boolean; deviceAuth: boolean }
): string[] {
  if (choice === "api-key") {
    return options.apiKeyPresent
      ? [
          `${options.apiKeyEnv} is present. Run an actual API call such as \`omk image generate "test" --json\` to verify Images API access, billing, and rate limits.`,
          ...openAiPlatformApiKeyGuidance(options.apiKeyEnv),
        ]
      : [
          ...openAiPlatformApiKeyGuidance(options.apiKeyEnv),
          `Set ${options.apiKeyEnv} only for the one \`omk image generate/edit\` process, then unset it and remove any decrypted temp key.`,
        ];
  }
  if (choice === "later") {
    return [
      "No credentials were configured.",
      `Use \`omk codex auth --choice plus-pro\` for Codex login guidance or provide an OpenAI Platform project API key in ${options.apiKeyEnv} for image API calls.`,
    ];
  }
  const login = options.deviceAuth ? "codex login --device-auth" : "codex login";
  return [
    options.codexCliAvailable
      ? `Run \`${login}\` to complete the official Codex login flow.`
      : "Install or expose the official Codex CLI on PATH, then run `codex login`.",
    "Plan choice is onboarding context only; OMK does not mark auth verified from Plus/Pro/Business/Enterprise selection.",
    "OMK never reads or prints ~/.codex/auth.json tokens.",
    `Codex/ChatGPT OAuth tokens are not Images API credentials; use an OpenAI Platform project API key in ${options.apiKeyEnv} for \`omk image generate/edit\`.`,
  ];
}

function openAiPlatformApiKeyGuidance(apiKeyEnv: string): string[] {
  return [
    OPENAI_IMAGE_API_KEY_ACTION.replace(DEFAULT_OPENAI_API_KEY_ENV, apiKeyEnv),
    "OMK will not parse or reuse Codex/ChatGPT OAuth credentials for OpenAI API calls.",
  ];
}

function emitCodexAuthResult(result: CodexAuthResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(header(result.command === "openai setup" ? "OpenAI Setup" : "Codex Auth"));
  console.log(label("Choice", result.choice));
  console.log(label("Codex CLI", result.codexCliAvailable ? "available" : "not found"));
  console.log(label("API key", result.apiKeyPresent ? `present in ${result.apiKeyEnv}` : `missing from ${result.apiKeyEnv}`));
  console.log(label("Auth verified", result.authVerified ? `yes (${result.verifiedBy ?? "official flow"})` : "no"));
  console.log(label("Auth bypass", "false"));
  for (const action of result.nextActions) {
    console.log(`  ${style.gray("•")} ${action}`);
  }
}

async function readCodexConfigToml(path: string): Promise<ParsedToml> {
  if (!(await pathExists(path))) return { values: {} };
  return parseToml(await readFile(path, "utf-8"));
}

async function readKimiMcpConfig(path: string): Promise<KimiMcpConfig & Record<string, unknown>> {
  if (!(await pathExists(path))) return { mcpServers: {} };
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as { mcpServers?: unknown } & Record<string, unknown>;
    return {
      ...parsed,
      mcpServers: isRecord(parsed.mcpServers) ? normalizeServerMap(parsed.mcpServers) : {},
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Kimi MCP config JSON at ${path}; repair or remove it before importing Codex MCP servers. ${message}`);
  }
}

function convertCodexMcpConfig(
  parsed: ParsedToml,
  options: { sourcePath: string; targetPath: string; includeOpenAIDocs?: boolean }
): CodexMcpImportResult {
  const imported: string[] = [];
  const placeholdered: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const mcpServers: Record<string, KimiMcpServerConfig> = {};
  const codexServers = codexMcpServerTables(parsed.values);

  for (const [name, raw] of Object.entries(codexServers)) {
    const converted = convertCodexMcpServer(raw);
    if (!converted.server) {
      skipped.push({ name, reason: converted.skipReason ?? "unsupported MCP server shape" });
      continue;
    }
    mcpServers[name] = converted.server;
    imported.push(name);
    if (converted.placeholdered) placeholdered.push(name);
  }

  if (options.includeOpenAIDocs && !mcpServers[OPENAI_DOCS_MCP_NAME]) {
    mcpServers[OPENAI_DOCS_MCP_NAME] = openAiDocsMcpServer();
    imported.push(OPENAI_DOCS_MCP_NAME);
  }

  return {
    sourcePath: options.sourcePath,
    targetPath: options.targetPath,
    changed: false,
    imported,
    placeholdered,
    skipped,
    mcpServers,
  };
}

function codexMcpServerTables(values: Record<string, unknown>): Record<string, CodexMcpServerToml> {
  const root = values.mcp_servers;
  if (!isRecord(root)) return {};
  const servers: Record<string, CodexMcpServerToml> = {};
  for (const [name, value] of Object.entries(root)) {
    if (isRecord(value)) servers[name] = value;
  }
  return servers;
}

function convertCodexMcpServer(raw: CodexMcpServerToml): ConvertResult {
  const skipReason = secretBearingCodexServerReason(raw);
  if (skipReason) return { placeholdered: false, skipReason };

  const server: KimiMcpServerConfig = {};
  let placeholdered = false;

  if (typeof raw.url === "string") {
    const sanitizedUrl = sanitizeUrl(raw.url);
    server.url = sanitizedUrl.value;
    placeholdered = placeholdered || sanitizedUrl.placeholdered;
  }
  if (typeof raw.command === "string") {
    const sanitizedCommand = maskSensitiveText(raw.command);
    server.command = sanitizedCommand;
    placeholdered = placeholdered || sanitizedCommand !== raw.command;
  }
  if (Array.isArray(raw.args)) {
    const sanitizedArgs = sanitizeArgs(raw.args);
    server.args = sanitizedArgs.value;
    placeholdered = placeholdered || sanitizedArgs.placeholdered;
  }
  if (isRecord(raw.env)) {
    const sanitizedEnv = sanitizeKeyValueMap(raw.env, isSecretEnvName, "env");
    if (Object.keys(sanitizedEnv.value).length > 0) server.env = sanitizedEnv.value;
    placeholdered = placeholdered || sanitizedEnv.placeholdered;
  }
  if (isRecord(raw.headers)) {
    const sanitizedHeaders = sanitizeKeyValueMap(raw.headers, isSecretHeaderName, "header");
    if (Object.keys(sanitizedHeaders.value).length > 0) server.headers = sanitizedHeaders.value;
    placeholdered = placeholdered || sanitizedHeaders.placeholdered;
  }
  if (isRecord(raw.http_headers)) {
    const sanitizedHeaders = sanitizeKeyValueMap(raw.http_headers, isSecretHeaderName, "header");
    if (Object.keys(sanitizedHeaders.value).length > 0) server.http_headers = sanitizedHeaders.value;
    placeholdered = placeholdered || sanitizedHeaders.placeholdered;
  }
  if (typeof raw.startup_timeout_sec === "number" && Number.isFinite(raw.startup_timeout_sec) && raw.startup_timeout_sec > 0) {
    server.startup_timeout_sec = Math.trunc(raw.startup_timeout_sec);
  }
  if (typeof raw.enabled === "boolean") server.enabled = raw.enabled;

  if (!server.url && !server.command) return { placeholdered, skipReason: "missing url or command" };
  return { server, placeholdered };
}

function secretBearingCodexServerReason(raw: CodexMcpServerToml): string | undefined {
  for (const [key, value] of Object.entries(raw)) {
    if (/^bearer[_-]?token$/i.test(key)) return "secret-bearing bearer_token field";
    if (/(?:^|_)(?:token|key|secret|password|credential|auth)(?:$|_)/i.test(key) && typeof value === "string") {
      return `secret-bearing ${key} field`;
    }
  }
  if (isSecretBearingShellLoader(raw)) return "secret-bearing shell loader";
  return undefined;
}

function isSecretBearingShellLoader(raw: CodexMcpServerToml): boolean {
  const command = typeof raw.command === "string" ? raw.command : "";
  const args = Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : [];
  const commandName = command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  if (!["bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd", "cmd.exe"].includes(commandName)) return false;
  const text = [command, ...args].join(" ");
  return /(?:^|\s)(?:source|\.)\s+[^;&|]*(?:secrets?\.env|\.env)\b/i.test(text);
}

function normalizeServerMap(value: Record<string, unknown>): Record<string, KimiMcpServerConfig> {
  const servers: Record<string, KimiMcpServerConfig> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (isRecord(raw)) servers[name] = raw as KimiMcpServerConfig;
  }
  return servers;
}

function sanitizeArgs(args: unknown[]): { value: string[]; placeholdered: boolean } {
  const value: string[] = [];
  let placeholdered = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (typeof arg !== "string") continue;
    const previousRaw = index > 0 ? args[index - 1] : undefined;
    const previous = typeof previousRaw === "string" ? previousRaw : "";
    if (isSplitSecretCliOption(previous)) {
      value.push("[REDACTED]");
      placeholdered = true;
      continue;
    }
    if (isSecretCliOption(arg)) {
      const eq = arg.indexOf("=");
      value.push(eq > 0 ? `${arg.slice(0, eq + 1)}[REDACTED]` : arg);
      placeholdered = placeholdered || eq > 0;
      continue;
    }
    const sanitized = normalizePersistedPlaceholder(maskSensitiveText(arg));
    value.push(sanitized);
    placeholdered = placeholdered || sanitized !== arg;
  }
  return { value, placeholdered };
}

function sanitizeKeyValueMap(
  raw: Record<string, unknown>,
  isSecretKey: (key: string) => boolean,
  kind: "env" | "header"
): { value: Record<string, string>; placeholdered: boolean } {
  const value: Record<string, string> = {};
  let placeholdered = false;
  for (const [key, rawValue] of Object.entries(raw)) {
    if (typeof rawValue !== "string") continue;
    if (isSecretKey(key)) {
      value[key] = kind === "env" && isEnvReference(rawValue) ? rawValue : kind === "env" ? `\${${key}}` : "[REDACTED]";
      placeholdered = placeholdered || value[key] !== rawValue;
      continue;
    }
    const sanitized = normalizePersistedPlaceholder(maskSensitiveText(rawValue));
    value[key] = sanitized;
    placeholdered = placeholdered || sanitized !== rawValue;
  }
  return { value, placeholdered };
}

function sanitizeUrl(value: string): { value: string; placeholdered: boolean } {
  let placeholdered = false;
  try {
    const url = new URL(value);
    if (url.username) {
      url.username = "[REDACTED]";
      placeholdered = true;
    }
    if (url.password) {
      url.password = "[REDACTED]";
      placeholdered = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretEnvName(key) || isSecretHeaderName(key)) {
        url.searchParams.set(key, "[REDACTED]");
        placeholdered = true;
      }
    }
    const sanitized = normalizePersistedPlaceholder(maskSensitiveText(url.toString()));
    return { value: sanitized, placeholdered: placeholdered || sanitized !== url.toString() };
  } catch {
    const sanitized = normalizePersistedPlaceholder(maskSensitiveText(value));
    return { value: sanitized, placeholdered: sanitized !== value };
  }
}

function normalizePersistedPlaceholder(value: string): string {
  return value.replace(/\*\*\*/g, "[REDACTED]");
}


function parseToml(content: string): ParsedToml {
  const values: Record<string, unknown> = {};
  let section: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = splitTomlPath(sectionMatch[1]);
      ensurePath(values, section);
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const keyPath = [...section, ...splitTomlPath(kv[1])];
    setPath(values, keyPath, parseTomlValue(kv[2].trim()));
  }
  return { values };
}

function splitTomlPath(value: string): string[] {
  return value.split(".").map((part) => unquoteTomlString(part.trim())).filter(Boolean);
}

function parseTomlValue(value: string): unknown {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquoteTomlString(value);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) return parseTomlArray(value.slice(1, -1));
  if (value.startsWith("{") && value.endsWith("}")) return parseTomlInlineTable(value.slice(1, -1));
  return value;
}

function parseTomlArray(value: string): unknown[] {
  return splitTomlCommaList(value).map((item) => parseTomlValue(item.trim()));
}

function parseTomlInlineTable(value: string): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  for (const item of splitTomlCommaList(value)) {
    const kv = item.trim().match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    setPath(table, splitTomlPath(kv[1]), parseTomlValue(kv[2].trim()));
  }
  return table;
}

function splitTomlCommaList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  let quote = "";
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (!inString && (ch === '"' || ch === "'")) {
      inString = true;
      quote = ch;
    } else if (inString && ch === quote && value[index - 1] !== "\\") {
      inString = false;
    } else if (!inString && (ch === "[" || ch === "{")) {
      depth++;
    } else if (!inString && (ch === "]" || ch === "}")) {
      depth--;
    }
    if (!inString && depth === 0 && ch === ",") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function stripComment(line: string): string {
  let inString = false;
  let quote = "";
  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    if (!inString && (ch === '"' || ch === "'")) {
      inString = true;
      quote = ch;
    } else if (inString && ch === quote && line[index - 1] !== "\\") {
      inString = false;
    } else if (!inString && ch === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

function unquoteTomlString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;
  const body = trimmed.slice(1, -1);
  if (quote === "'") return body;
  return body.replace(/\\(["\\bfnrt])/g, (_match: string, escaped: string) => {
    switch (escaped) {
      case "b": return "\b";
      case "f": return "\f";
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      default: return escaped;
    }
  });
}

function ensurePath(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let current = root;
  for (const part of path) {
    const next = current[part];
    if (!isRecord(next)) {
      const created: Record<string, unknown> = {};
      current[part] = created;
      current = created;
    } else {
      current = next;
    }
  }
  return current;
}

function setPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return;
  const parent = ensurePath(root, path.slice(0, -1));
  parent[path[path.length - 1]] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEnvReference(value: string): boolean {
  return /^\$\{?[A-Za-z_][A-Za-z0-9_]*}?$/.test(value.trim());
}

function isSplitSecretCliOption(value: string): boolean {
  return value.indexOf("=") === -1 && isSecretCliOption(value);
}

function isSecretCliOption(value: string): boolean {
  return /^--?(?:api[-_]?key|api[-_]?token|token|key|secret|password|passwd|client[-_]?secret|x[-_]?auth[-_]?token|auth|authorization|credential|cookie|session|jwt|private[-_]?key)(?:=.*)?$/i.test(value);
}

function isSecretEnvName(key: string): boolean {
  return /(?:^|_)(?:api_?key|api_?token|token|secret|password|passwd|credential|credentials|authorization|auth|cookie|session|jwt|private_?key)(?:$|_)/i.test(key);
}

function isSecretHeaderName(key: string): boolean {
  return /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key|api-token|token)$/i.test(key);
}
