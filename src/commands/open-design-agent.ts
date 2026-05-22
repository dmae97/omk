import { lstat, mkdir, readdir, realpath, stat } from "fs/promises";
import { tmpdir } from "os";
import { delimiter, isAbsolute, join, relative, resolve } from "path";

import { getProjectRoot, injectKimiGlobals, pathExists } from "../util/fs.js";
import { runShellStreaming, resolveKimiBin } from "../util/shell.js";
import { cleanupIsolatedKimiHome, prepareIsolatedKimiHome, resolveOriginalHome } from "../kimi/isolated-home.js";

const OPEN_DESIGN_SMOKE_PROMPT = "Reply with only: ok";
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_STDIN_IDLE_MS = 3_000;
const DEFAULT_STDIN_TIMEOUT_MS = 30_000;
const DEFAULT_STDIN_MAX_BYTES = 512 * 1024;
const DEFAULT_ARTIFACT_SETTLE_MS = 5 * 1000;
const ARTIFACT_SCAN_DEPTH = 3;
const ARTIFACT_SCAN_IGNORES = new Set([".git", "node_modules", ".next", "dist", "build"]);

export interface OpenDesignGeneratedArtifact {
  path: string;
  size: number;
  modifiedAt: number;
}

export interface OpenDesignAgentOptions {
  artifactDir?: string;
  cwd?: string;
  diagnose?: boolean;
  image?: string | string[];
  json?: boolean;
  model?: string;
  runId?: string;
  smoke?: boolean;
  stdio?: boolean;
  stdinIdleMs?: string | number;
  stdinMaxBytes?: string | number;
  stdinTimeoutMs?: string | number;
  timeoutMs?: string | number;
}

export type OpenDesignAgentStatus =
  | "ok"
  | "artifact_ok"
  | "timeout_artifact_ok"
  | "timeout_no_artifact"
  | "fatal";

interface BridgePromptOptions {
  artifactDir?: string;
  imagePaths?: string[];
}

export function isOpenDesignSmokePrompt(prompt: string): boolean {
  return prompt.trim() === OPEN_DESIGN_SMOKE_PROMPT;
}

function parseTimeoutMs(value: string | number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, 60 * 60 * 1000);
}

function parseBoundedMs(value: string | number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function parseBoundedBytes(value: string | number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

async function readStdinText(options: {
  idleMs?: string | number;
  maxBytes?: string | number;
  timeoutMs?: string | number;
} = {}): Promise<string> {
  const idleMs = parseBoundedMs(options.idleMs ?? process.env.OMK_OPEN_DESIGN_STDIN_IDLE_MS, DEFAULT_STDIN_IDLE_MS, 100, 60_000);
  const timeoutMs = parseBoundedMs(options.timeoutMs ?? process.env.OMK_OPEN_DESIGN_STDIN_TIMEOUT_MS, DEFAULT_STDIN_TIMEOUT_MS, 1_000, 5 * 60_000);
  const maxBytes = parseBoundedBytes(options.maxBytes ?? process.env.OMK_OPEN_DESIGN_STDIN_MAX_BYTES, DEFAULT_STDIN_MAX_BYTES, 1, 10 * 1024 * 1024);
  const chunks: Buffer[] = [];
  let byteCount = 0;

  return await new Promise<string>((resolvePromise, reject) => {
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      totalTimer = undefined;
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const fail = (message: string): void => {
      settle(() => reject(new Error(message)));
    };
    const resetIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(`Open Design stdin idle timeout after ${idleMs}ms`);
      }, idleMs);
      idleTimer.unref?.();
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      byteCount += buffer.byteLength;
      if (byteCount > maxBytes) {
        fail(`Open Design stdin exceeded ${maxBytes} bytes`);
        return;
      }
      chunks.push(buffer);
      resetIdleTimer();
    };
    const onEnd = (): void => {
      settle(() => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    };
    const onError = (err: Error): void => {
      settle(() => reject(err));
    };

    totalTimer = setTimeout(() => {
      fail(`Open Design stdin total timeout after ${timeoutMs}ms`);
    }, timeoutMs);
    totalTimer.unref?.();
    resetIdleTimer();
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    if (process.stdin.readableEnded) {
      onEnd();
      return;
    }
    process.stdin.resume();
  });
}

function setModelArg(args: string[], model: string | undefined): void {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === "default") return;
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === "--model") {
      args.splice(i, 2);
    }
  }
  args.push("--model", trimmed);
}

function stripTerminalControls(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function normalizeStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || Boolean(rel && !rel.startsWith("..") && !isAbsolute(rel));
}

async function realPathOrResolve(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function trustedWorkspaceRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.OMK_OPEN_DESIGN_WORKSPACE_ROOTS
    ?.split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
  return [getProjectRoot(), tmpdir(), ...configured].map((entry) => resolve(entry));
}

async function resolveOpenDesignWorkspace(rawCwd: string | undefined): Promise<string> {
  const cwd = resolve(rawCwd ?? process.cwd());
  if (!(await pathExists(cwd))) {
    throw new Error(`OMK Open Design bridge cwd does not exist: ${cwd}`);
  }
  const cwdStat = await lstat(cwd);
  if (cwdStat.isSymbolicLink()) {
    throw new Error(`OMK Open Design bridge refuses symlink cwd: ${cwd}`);
  }
  const realCwd = await realPathOrResolve(cwd);
  const originalHome = await realPathOrResolve(resolveOriginalHome(process.env)).catch(() => "");
  if (realCwd === "/" || (originalHome && realCwd === originalHome)) {
    throw new Error(`OMK Open Design bridge refuses unsafe cwd: ${cwd}`);
  }
  const roots = await Promise.all(trustedWorkspaceRoots().map((root) => realPathOrResolve(root)));
  if (!roots.some((root) => isPathInside(root, realCwd))) {
    throw new Error(`OMK Open Design bridge cwd must be under the project or an allowed temp workspace: ${cwd}`);
  }
  return realCwd;
}

function normalizeRunId(value: string | undefined): string {
  const raw = value?.trim() || `od-${Date.now().toString(36)}`;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(raw)) {
    throw new Error("--run-id may contain only letters, numbers, dot, underscore, or dash");
  }
  return raw;
}

async function resolveArtifactDir(cwd: string, runId: string, rawArtifactDir: string | undefined): Promise<string> {
  const artifactDir = resolveArtifactDirPath(cwd, runId, rawArtifactDir);
  await mkdir(artifactDir, { recursive: true });
  return artifactDir;
}

function resolveArtifactDirPath(cwd: string, runId: string, rawArtifactDir: string | undefined): string {
  const artifactDir = rawArtifactDir
    ? resolve(cwd, rawArtifactDir)
    : join(cwd, ".omk", "open-design-artifacts", runId);
  const allowedRoots = [cwd, tmpdir()].map((root) => resolve(root));
  if (!allowedRoots.some((root) => isPathInside(root, artifactDir))) {
    throw new Error(`OMK Open Design artifact dir must be inside the workspace or temp dir: ${artifactDir}`);
  }
  return artifactDir;
}

async function normalizeImagePaths(cwd: string, rawImagePaths: string[]): Promise<string[]> {
  const allowedRoots = [cwd, tmpdir(), process.env.TMPDIR, process.env.TMP, process.env.TEMP]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => resolve(entry));
  const normalized = new Set<string>();
  for (const rawPath of rawImagePaths) {
    const resolved = resolve(cwd, rawPath);
    if (!(await pathExists(resolved))) {
      throw new Error(`Open Design image path does not exist: ${rawPath}`);
    }
    const info = await lstat(resolved);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Open Design image path must be a regular file: ${rawPath}`);
    }
    const realImage = await realPathOrResolve(resolved);
    if (!allowedRoots.some((root) => isPathInside(root, realImage))) {
      throw new Error(`Open Design image path must be inside the workspace or temp dir: ${rawPath}`);
    }
    normalized.add(realImage);
  }
  return [...normalized];
}

export function buildBridgePrompt(prompt: string, options: BridgePromptOptions = {}): string {
  const imageLines = options.imagePaths && options.imagePaths.length > 0
    ? [
      "",
      "Attached image/screenshot paths:",
      ...options.imagePaths.map((imagePath) => `- ${imagePath}`),
      "Use ReadMediaFile on these local paths when media reading is available; if it is unavailable, say so clearly and continue with advisory analysis only.",
    ]
    : [];
  const artifactLines = options.artifactDir
    ? [
      "",
      `If you create standalone Open Design artifacts, write them inside this run artifact directory: ${options.artifactDir}`,
      "Do not treat unrelated repository file changes as artifact success.",
    ]
    : [];
  return [
    "You are OMK CLI connected as the local agent inside Open Design.",
    "Follow the repository AGENTS.md and DESIGN.md rules before editing.",
    "For named visual references, use VoltAgent awesome-design-md through `omk design list`, `omk design search <keyword>`, and `omk design apply <name>`; adapt templates instead of cloning brands.",
    "For image generation/editing, use `omk image ... --model gpt-image-2` only when the user explicitly asks; never use Codex/ChatGPT OAuth tokens as Images API bearer credentials.",
    "Keep responses focused on actionable design/code changes and cite files you inspect.",
    "When writing or modifying files, keep diffs small and verify where possible.",
    ...artifactLines,
    ...imageLines,
    "",
    prompt.trim(),
  ].join("\n");
}

export function sanitizeOpenDesignAgentOutput(output: string): string {
  return redactOpenDesignSensitiveText(stripTerminalControls(output)
    .split(/\r?\n/)
    .filter((line) => !/^\s*<choice>[^<]*<\/choice>\s*$/.test(line))
    .filter((line) => !/^\s*To resume this session:\s*kimi\s+-r\s+[0-9a-f-]+\s*$/i.test(line))
    .join("\n"))
    .trim();
}

function redactOpenDesignSensitiveText(value: string): string {
  return value
    .replace(/\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{16,}\b/g, "sk-***")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "sk-***")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}\b/gi, "$1***")
    .replace(/\b((?:oauth|session|refresh|access)[_-]?token\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{20,}/gi, "$1***");
}

function parseArtifactSettleMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_ARTIFACT_SETTLE_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_ARTIFACT_SETTLE_MS;
  return Math.min(parsed, 60_000);
}

function hasFatalBridgeError(stderr: string): boolean {
  const normalized = stderr.trim();
  if (!normalized) return false;
  if (/timed?\s*out|timeout|sigterm|killed/i.test(normalized)) return false;
  return /invalid authentication|unauthorized|http\s*40[13]|permission denied|eacces|enoent|enospc|traceback|syntaxerror|typeerror|referenceerror|cannot find module|unhandled|npm err!/i.test(
    normalized
  );
}

function isTimeoutBridgeError(stderr: string): boolean {
  return /timed?\s*out|timeout|sigterm|killed/i.test(stderr);
}

function hasExplicitBridgeSuccessMarker(stdout: string): boolean {
  return /\bOMK_OPEN_DESIGN_SUCCESS\b|\[omk-open-design:success]/i.test(stdout);
}

const OPEN_DESIGN_SAFE_ENV_NAMES = new Set([
  "CI",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "KIMI_BIN",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "OMK_ORIGINAL_HOME",
  "OMK_PROJECT_ROOT",
  "PATH",
  "Path",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);

export function isSecretLikeOpenDesignEnvName(name: string): boolean {
  if (name === "KIMI_BIN") return false;
  return /(^|_)(TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|COOKIE|AUTH)(_|$)/i.test(name);
}

export function buildSafeOpenDesignKimiEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const trustSecretEnv = sourceEnv.OMK_OPEN_DESIGN_TRUST_SECRET_ENV === "1";
  const baseEntries = Object.entries(sourceEnv)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .filter(([name]) => trustSecretEnv || (OPEN_DESIGN_SAFE_ENV_NAMES.has(name) && !isSecretLikeOpenDesignEnvName(name)));
  return {
    ...Object.fromEntries(baseEntries),
    ...overrides,
  };
}

async function collectGeneratedArtifacts(root: string, sinceMs: number, nowMs = Date.now(), depth = ARTIFACT_SCAN_DEPTH, displayRoot = root): Promise<OpenDesignGeneratedArtifact[]> {
  const artifacts: OpenDesignGeneratedArtifact[] = [];
  const settleMs = parseArtifactSettleMs(process.env.OMK_OPEN_DESIGN_ARTIFACT_SETTLE_MS);

  async function walk(dir: string, remainingDepth: number): Promise<void> {
    if (remainingDepth < 0) return;
    let entries: Array<{
      name: string | Buffer;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = String(entry.name);
      if (ARTIFACT_SCAN_IGNORES.has(name)) continue;
      const fullPath = resolve(dir, name);
      if (entry.isDirectory()) {
        await walk(fullPath, remainingDepth - 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const info = await stat(fullPath);
        if (info.size <= 0) continue;
        if (info.mtimeMs + 1000 < sinceMs) continue;
        if (nowMs - info.mtimeMs < settleMs) continue;
        artifacts.push({
          path: stripTerminalControls(relative(displayRoot, fullPath) || name).slice(0, 240),
          size: info.size,
          modifiedAt: info.mtimeMs,
        });
      } catch {
        // Ignore files that vanish while the agent is still writing.
      }
    }
  }

  await walk(root, depth);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

export function shouldTreatOpenDesignBridgeAsSuccess(input: {
  failed: boolean;
  exitCode: number | null | undefined;
  cleanStdout: string;
  cleanStderr: string;
  generatedArtifacts: OpenDesignGeneratedArtifact[];
}): boolean {
  const status = classifyOpenDesignBridgeResult(input);
  return status === "ok" || status === "artifact_ok" || status === "timeout_artifact_ok";
}

export function classifyOpenDesignBridgeResult(input: {
  failed: boolean;
  exitCode: number | null | undefined;
  cleanStdout: string;
  cleanStderr: string;
  generatedArtifacts: OpenDesignGeneratedArtifact[];
}): OpenDesignAgentStatus {
  if (hasFatalBridgeError(input.cleanStderr)) return "fatal";
  if (hasExplicitBridgeSuccessMarker(input.cleanStdout)) {
    return input.generatedArtifacts.length > 0 ? "artifact_ok" : "ok";
  }
  if (!input.failed && (input.exitCode ?? 0) === 0) return "ok";
  if (isTimeoutBridgeError(input.cleanStderr)) {
    return input.generatedArtifacts.length > 0 ? "timeout_artifact_ok" : "timeout_no_artifact";
  }
  return "fatal";
}

function formatGeneratedArtifactMessage(artifacts: OpenDesignGeneratedArtifact[]): string {
  const shown = artifacts.slice(0, 5).map((artifact) => stripTerminalControls(artifact.path).slice(0, 160)).join(", ");
  const suffix = artifacts.length > 5 ? ` +${artifacts.length - 5} more` : "";
  return `Generated Open Design artifact${artifacts.length === 1 ? "" : "s"}: ${shown}${suffix}`;
}

export async function openDesignAgentCommand(options: OpenDesignAgentOptions = {}): Promise<void> {
  if (options.smoke) {
    process.stdout.write("ok\n");
    return;
  }

  if (options.diagnose) {
    try {
      const cwd = await resolveOpenDesignWorkspace(options.cwd);
      const runId = normalizeRunId(options.runId);
      const artifactDir = resolveArtifactDirPath(cwd, runId, options.artifactDir);
      const report = {
        ok: true,
        status: "ok",
        command: "open-design-agent --diagnose",
        cwd,
        runId,
        artifactDir,
        kimiBin: resolveKimiBin(),
        stdioRequired: true,
        stdin: {
          idleMs: parseBoundedMs(options.stdinIdleMs ?? process.env.OMK_OPEN_DESIGN_STDIN_IDLE_MS, DEFAULT_STDIN_IDLE_MS, 100, 60_000),
          timeoutMs: parseBoundedMs(options.stdinTimeoutMs ?? process.env.OMK_OPEN_DESIGN_STDIN_TIMEOUT_MS, DEFAULT_STDIN_TIMEOUT_MS, 1_000, 5 * 60_000),
          maxBytes: parseBoundedBytes(options.stdinMaxBytes ?? process.env.OMK_OPEN_DESIGN_STDIN_MAX_BYTES, DEFAULT_STDIN_MAX_BYTES, 1, 10 * 1024 * 1024),
        },
      };
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(`Open Design bridge diagnostics ok: ${cwd}\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: false, status: "fatal", error: message }, null, 2)}\n`);
      } else {
        process.stderr.write(`${message}\n`);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (!options.stdio) {
    const message = "OMK Open Design bridge requires --stdio for prompt input";
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, status: "fatal", error: message }, null, 2)}\n`);
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  let prompt: string;
  try {
    prompt = await readStdinText({
      idleMs: options.stdinIdleMs,
      maxBytes: options.stdinMaxBytes,
      timeoutMs: options.stdinTimeoutMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, status: "fatal", error: message }, null, 2)}\n`);
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }
  if (isOpenDesignSmokePrompt(prompt)) {
    process.stdout.write("ok\n");
    return;
  }

  let cwd: string;
  let runId: string;
  let artifactDir: string;
  let imagePaths: string[];
  try {
    cwd = await resolveOpenDesignWorkspace(options.cwd);
    runId = normalizeRunId(options.runId);
    artifactDir = await resolveArtifactDir(cwd, runId, options.artifactDir);
    imagePaths = await normalizeImagePaths(cwd, normalizeStringList(options.image));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  const args: string[] = [];
  await injectKimiGlobals(args, { role: "designer", mcpScope: "project", skillsScope: "project" });
  setModelArg(args, options.model);
  args.push("--prompt", buildBridgePrompt(prompt, { artifactDir, imagePaths }), "--quiet");

  const preHomeEnv = buildSafeOpenDesignKimiEnv(process.env, {
    OMK_OPEN_DESIGN_BRIDGE: "1",
    OMK_OPEN_DESIGN_ARTIFACT_DIR: artifactDir,
    OMK_OPEN_DESIGN_RUN_ID: runId,
  });
  const originalHome = resolveOriginalHome(preHomeEnv);
  const tmpHome = await prepareIsolatedKimiHome({ originalHome, env: preHomeEnv, inheritLocalAuth: false, skillsScope: "project", hooksScope: "project" });
  const env = buildSafeOpenDesignKimiEnv(process.env, {
    ...preHomeEnv,
    OMK_ORIGINAL_HOME: originalHome,
    OMK_OPEN_DESIGN_ARTIFACT_DIR: artifactDir,
    OMK_OPEN_DESIGN_BRIDGE: "1",
    OMK_OPEN_DESIGN_RUN_ID: runId,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    HOMEDRIVE: "",
    HOMEPATH: tmpHome,
  });

  try {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    const result = await runShellStreaming(resolveKimiBin(), args, {
      cwd,
      env,
      timeout: parseTimeoutMs(options.timeoutMs),
      input: "",
      onStdout: (chunk) => {
        stdout += chunk;
      },
      onStderr: (chunk) => {
        stderr += chunk;
      },
    });
    const cleanStdout = sanitizeOpenDesignAgentOutput(result.stdout || stdout);
    const cleanStderr = sanitizeOpenDesignAgentOutput(result.stderr || stderr);
    const generatedArtifacts = await collectGeneratedArtifacts(artifactDir, startedAt, Date.now(), ARTIFACT_SCAN_DEPTH, cwd);
    const bridgeStatus = classifyOpenDesignBridgeResult({
      failed: result.failed,
      exitCode: result.exitCode,
      cleanStdout,
      cleanStderr,
      generatedArtifacts,
    });
    const bridgeSucceeded = bridgeStatus === "ok" || bridgeStatus === "artifact_ok" || bridgeStatus === "timeout_artifact_ok";
    if (options.json) {
      process.stdout.write(`${JSON.stringify({
        ok: bridgeSucceeded,
        status: bridgeStatus,
        runId,
        artifactDir,
        artifacts: generatedArtifacts,
        exitCode: result.exitCode,
      }, null, 2)}\n`);
    } else {
      if (cleanStdout) {
        process.stdout.write(`${cleanStdout}\n`);
      } else if (generatedArtifacts.length > 0) {
        process.stdout.write(`${formatGeneratedArtifactMessage(generatedArtifacts)}\n`);
      } else if (bridgeSucceeded) {
        process.stdout.write("Done.\n");
      }
    }
    if (cleanStderr) process.stderr.write(`${cleanStderr}\n`);
    if (!bridgeSucceeded && (result.failed || result.exitCode !== 0)) {
      process.exitCode = result.exitCode || 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[omk] Open Design bridge error: ${message}\n`);
    process.exitCode = 1;
  } finally {
    await cleanupIsolatedKimiHome(tmpHome);
  }
}
