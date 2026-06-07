#!/usr/bin/env node
import { createInterface } from "readline";
import { readdir, readFile, realpath, stat } from "fs/promises";
import { createReadStream, writeSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { getOmkVersionSync } from "../util/version.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const PROJECT_ROOT = resolve(process.env.OMK_PROJECT_ROOT || process.cwd());
let PROJECT_ROOT_REAL = PROJECT_ROOT;
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "filesystem-readonly";
const SERVER_VERSION = getOmkVersionSync();
const MAX_READ_BYTES = 256_000;
const MAX_SEARCH_RESULTS = 200;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".omk/cache", ".pi", ".", ".."]);

/** Secret-bearing file patterns that must not be read even if inside the project root. */
const SECRET_SUFFIXES = [".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der"];
const SECRET_BASENAMES = new Set([
  "id_rsa", "id_rsa.pub", "id_ed25519", "id_ed25519.pub", "id_ecdsa", "id_ecdsa.pub",
  "id_dsa", "id_dsa.pub", "known_hosts", "authorized_keys",
  "credentials.json", "service-account.json", "service-account-key.json",
  "auth.json", "oauth.json", "session.json", "tokens.json",
  ".npmrc", ".pypirc", ".netrc", ".dockercfg", ".git-credentials",
  "token", "tokens", "secret", "secrets", "password", "passwords",
]);
const SECRET_DIR_PATTERNS = [".omk/cache", ".pi", ".kimi", ".codex", ".ssh", ".aws", ".kube"];

function isSecretPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").pop() ?? "";
  // Exact basename match
  if (SECRET_BASENAMES.has(basename)) return true;
  if (SECRET_BASENAMES.has(basename.replace(/\.json$/, ""))) return true;
  // Suffix match
  for (const suffix of SECRET_SUFFIXES) {
    if (basename.endsWith(suffix)) return true;
  }
  // Prefix match for env files
  if (basename.startsWith(".env")) return true;
  // Directory segment match
  for (const dirPattern of SECRET_DIR_PATTERNS) {
    if (
      normalized === dirPattern
      || normalized.startsWith(`${dirPattern}/`)
      || normalized.endsWith(`/${dirPattern}`)
      || normalized.includes(`/${dirPattern}/`)
    ) {
      return true;
    }
  }
  return false;
}

const TOOLS: readonly Tool[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file under the project root. Read-only; writes are not supported.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative or absolute path inside the project root" },
        maxBytes: { type: "number", description: "Optional byte limit; defaults to 256000" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List directory entries under the project root. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative or absolute directory path; defaults to project root" },
      },
    },
  },
  {
    name: "get_file_info",
    description: "Return size, mtime, and type for a path under the project root. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative or absolute path inside the project root" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Search file paths by substring or regular expression under the project root. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative or absolute directory path; defaults to project root" },
        pattern: { type: "string", description: "Substring or JavaScript regular expression source" },
        maxResults: { type: "number", description: "Maximum matches; defaults to 200" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_allowed_directories",
    description: "Return the single project root exposed by this read-only server.",
    inputSchema: { type: "object", properties: {} },
  },
];

function sendResult(id: string | number, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number, code: number, message: string, data?: unknown): void {
  send({ jsonrpc: "2.0", id, error: { code, message, data } });
}

function send(response: JsonRpcResponse): void {
  writeSync(process.stdout.fd, `${JSON.stringify(response)}\n`);
}

function textResult(text: string, isError = false): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function objectArg(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
}

function stringArg(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isInsideProject(path: string): boolean {
  const rel = relative(PROJECT_ROOT_REAL, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function resolveInsideProject(inputPath: string): Promise<string> {
  const target = resolve(PROJECT_ROOT, inputPath || ".");
  const actual = await realpath(target);
  if (!isInsideProject(actual)) {
    throw new Error(`Path is outside the read-only project root: ${inputPath}`);
  }
  return actual;
}

function relativeProjectPath(path: string): string {
  const rel = relative(PROJECT_ROOT_REAL, path);
  return rel || ".";
}

async function handleToolCall(name: string, rawArgs: unknown): Promise<unknown> {
  const args = objectArg(rawArgs);
  switch (name) {
    case "read_file": {
      const filePath = await resolveInsideProject(stringArg(args, "path"));
      const relPath = relativeProjectPath(filePath);
      if (isSecretPath(relPath)) {
        throw new Error(`read_file refused: path matches secret-bearing file pattern (${relPath})`);
      }
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("read_file requires a regular file");
      const maxBytes = Math.max(1, Math.min(numberArg(args, "maxBytes", MAX_READ_BYTES), MAX_READ_BYTES));
      if (info.size > maxBytes) {
        const chunks: Buffer[] = [];
        for await (const chunk of createReadStream(filePath, { end: maxBytes - 1 })) {
          chunks.push(chunk as Buffer);
        }
        const text = Buffer.concat(chunks).toString("utf-8");
        return textResult(`${text}\n[truncated]`);
      }
      const text = await readFile(filePath, "utf-8");
      return textResult(text);
    }
    case "list_directory": {
      const directory = await resolveInsideProject(stringArg(args, "path", "."));
      const relDir = relativeProjectPath(directory);
      if (isSecretPath(relDir)) {
        throw new Error(`list_directory refused: path matches secret-bearing directory pattern (${relDir})`);
      }
      const entries = await readdir(directory, { withFileTypes: true });
      const lines = entries
        .filter((entry) => {
          const entryRel = join(relDir, entry.name).replace(/\\/g, "/");
          return !isSecretPath(entryRel);
        })
        .map((entry) => `${entry.isDirectory() ? "dir " : entry.isFile() ? "file" : "other"}\t${entry.name}`)
        .sort();
      return textResult(lines.join("\n"));
    }
    case "get_file_info": {
      const filePath = await resolveInsideProject(stringArg(args, "path"));
      const relPath = relativeProjectPath(filePath);
      if (isSecretPath(relPath)) {
        throw new Error(`get_file_info refused: path matches secret-bearing file pattern (${relPath})`);
      }
      const info = await stat(filePath);
      return textResult(JSON.stringify({
        path: relPath,
        size: info.size,
        mtimeMs: info.mtimeMs,
        type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      }, null, 2));
    }
    case "search_files": {
      const root = await resolveInsideProject(stringArg(args, "path", "."));
      const pattern = stringArg(args, "pattern");
      if (!pattern) throw new Error("search_files requires a non-empty pattern");
      const maxResults = Math.max(1, Math.min(numberArg(args, "maxResults", MAX_SEARCH_RESULTS), MAX_SEARCH_RESULTS));
      const matcher = toMatcher(pattern);
      const matches: string[] = [];
      await walk(root, matcher, matches, maxResults);
      return textResult(matches.join("\n"));
    }
    case "list_allowed_directories":
      return textResult(PROJECT_ROOT_REAL);
    default:
      throw new Error(`Tool not found or not read-only: ${name}`);
  }
}

type Matcher = (text: string) => boolean;

function isSafeRegex(inner: string): boolean {
  // Reject patterns with nested quantifiers or excessive repetition
  if (/\(\?[:=!]|\(\*|\(\+|\(\?\{|\*\*|\+\+|\?\?|\{[0-9]+,/.test(inner)) return false;
  // Reject very long patterns
  if (inner.length > 200) return false;
  return true;
}

function toMatcher(pattern: string): Matcher {
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length >= 2) {
    const inner = pattern.slice(1, -1);
    if (!isSafeRegex(inner)) {
      // fall through to literal
    } else {
      try {
        const regex = new RegExp(inner, "i");
        return (text: string) => regex.test(text);
      } catch {
        // fall through to literal
      }
    }
  }
  const literal = pattern.toLowerCase();
  return (text: string) => text.toLowerCase().includes(literal);
}

async function walk(directory: string, matcher: Matcher, matches: string[], maxResults: number): Promise<void> {
  if (matches.length >= maxResults) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= maxResults) return;
    const fullPath = join(directory, entry.name);
    if (!isInsideProject(fullPath)) continue;
    const rel = relativeProjectPath(fullPath);
    if (isSecretPath(rel)) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry.name)) continue;
      await walk(fullPath, matcher, matches, maxResults);
    } else if (matcher(rel)) {
      matches.push(rel);
    }
  }
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  if (req.id === undefined) return;
  switch (req.method) {
    case "initialize":
      sendResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    case "tools/list":
      sendResult(req.id, { tools: TOOLS });
      return;
    case "tools/call": {
      const params = objectArg(req.params);
      const toolName = stringArg(params, "name");
      if (!toolName) {
        sendError(req.id, -32602, "Invalid params: missing 'name'");
        return;
      }
      try {
        sendResult(req.id, await handleToolCall(toolName, params.arguments));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendResult(req.id, textResult(message, true));
      }
      return;
    }
    default:
      sendError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

async function main(): Promise<void> {
  PROJECT_ROOT_REAL = await realpath(PROJECT_ROOT).catch(() => PROJECT_ROOT);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      await handleRequest(JSON.parse(line) as JsonRpcRequest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeSync(process.stderr.fd, `[filesystem-readonly-mcp] ${message}\n`);
    }
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  writeSync(process.stderr.fd, `[filesystem-readonly-mcp] fatal: ${message}\n`);
  process.exit(1);
});
