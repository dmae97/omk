import { readdir, stat } from "fs/promises";
import { relative, resolve } from "path";

import { injectKimiGlobals, pathExists } from "../util/fs.js";
import { runShellStreaming } from "../util/shell.js";
import { cleanupIsolatedKimiHome, prepareIsolatedKimiHome, resolveOriginalHome } from "../kimi/isolated-home.js";

const OPEN_DESIGN_SMOKE_PROMPT = "Reply with only: ok";
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_ARTIFACT_SETTLE_MS = 5 * 1000;
const ARTIFACT_SCAN_DEPTH = 3;
const ARTIFACT_SCAN_IGNORES = new Set([".git", "node_modules", ".next", "dist", "build"]);

export interface OpenDesignGeneratedArtifact {
  path: string;
  size: number;
  modifiedAt: number;
}

export interface OpenDesignAgentOptions {
  cwd?: string;
  model?: string;
  smoke?: boolean;
  stdio?: boolean;
  timeoutMs?: string | number;
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

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
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

function buildBridgePrompt(prompt: string): string {
  return [
    "You are OMK CLI connected as the local agent inside Open Design.",
    "Follow the repository AGENTS.md and DESIGN.md rules before editing.",
    "For named visual references, use VoltAgent awesome-design-md through `omk design list`, `omk design search <keyword>`, and `omk design apply <name>`; adapt templates instead of cloning brands.",
    "Keep responses focused on actionable design/code changes and cite files you inspect.",
    "When writing or modifying files, keep diffs small and verify where possible.",
    "",
    prompt.trim(),
  ].join("\n");
}

export function sanitizeOpenDesignAgentOutput(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => !/^\s*<choice>[^<]*<\/choice>\s*$/.test(line))
    .filter((line) => !/^\s*To resume this session:\s*kimi\s+-r\s+[0-9a-f-]+\s*$/i.test(line))
    .join("\n")
    .trim();
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

async function collectGeneratedArtifacts(root: string, sinceMs: number, nowMs = Date.now(), depth = ARTIFACT_SCAN_DEPTH): Promise<OpenDesignGeneratedArtifact[]> {
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
          path: relative(root, fullPath) || name,
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
  if (!input.failed && (input.exitCode ?? 0) === 0) return true;
  if (hasFatalBridgeError(input.cleanStderr)) return false;
  return input.cleanStdout.length > 0 || input.generatedArtifacts.length > 0;
}

function formatGeneratedArtifactMessage(artifacts: OpenDesignGeneratedArtifact[]): string {
  const shown = artifacts.slice(0, 5).map((artifact) => artifact.path).join(", ");
  const suffix = artifacts.length > 5 ? ` +${artifacts.length - 5} more` : "";
  return `Generated Open Design artifact${artifacts.length === 1 ? "" : "s"}: ${shown}${suffix}`;
}

export async function openDesignAgentCommand(options: OpenDesignAgentOptions = {}): Promise<void> {
  if (options.smoke) {
    process.stdout.write("ok\n");
    return;
  }

  const prompt = await readStdinText();
  if (isOpenDesignSmokePrompt(prompt)) {
    process.stdout.write("ok\n");
    return;
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  if (!(await pathExists(cwd))) {
    process.stderr.write(`OMK Open Design bridge cwd does not exist: ${cwd}\n`);
    process.exitCode = 1;
    return;
  }

  const args: string[] = [];
  await injectKimiGlobals(args, { role: "designer", mcpScope: "none" });
  setModelArg(args, options.model);
  args.push("--prompt", buildBridgePrompt(prompt), "--quiet");

  const baseEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OMK_OPEN_DESIGN_BRIDGE: "1",
  };
  const originalHome = resolveOriginalHome(baseEnv);
  const tmpHome = await prepareIsolatedKimiHome({ originalHome, env: baseEnv });
  const env: Record<string, string> = {
    ...baseEnv,
    OMK_ORIGINAL_HOME: originalHome,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    HOMEDRIVE: "",
    HOMEPATH: tmpHome,
  };

  try {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    const result = await runShellStreaming("kimi", args, {
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
    const cleanStdout = sanitizeOpenDesignAgentOutput(stdout);
    const cleanStderr = sanitizeOpenDesignAgentOutput(stderr);
    const generatedArtifacts = await collectGeneratedArtifacts(cwd, startedAt);
    const bridgeSucceeded = shouldTreatOpenDesignBridgeAsSuccess({
      failed: result.failed,
      exitCode: result.exitCode,
      cleanStdout,
      cleanStderr,
      generatedArtifacts,
    });
    if (cleanStdout) {
      process.stdout.write(`${cleanStdout}\n`);
    } else if (generatedArtifacts.length > 0) {
      process.stdout.write(`${formatGeneratedArtifactMessage(generatedArtifacts)}\n`);
    } else if (bridgeSucceeded) {
      process.stdout.write("Done.\n");
    }
    if (cleanStderr) process.stderr.write(`${cleanStderr}\n`);
    if (!bridgeSucceeded && (result.failed || result.exitCode !== 0)) {
      process.exitCode = result.exitCode || 1;
    }
  } finally {
    await cleanupIsolatedKimiHome(tmpHome);
  }
}
