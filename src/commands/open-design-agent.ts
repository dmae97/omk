import { resolve } from "path";

import { injectKimiGlobals, pathExists } from "../util/fs.js";
import { runShellStreaming } from "../util/shell.js";
import { cleanupIsolatedKimiHome, prepareIsolatedKimiHome, resolveOriginalHome } from "../kimi/isolated-home.js";

const OPEN_DESIGN_SMOKE_PROMPT = "Reply with only: ok";
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

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
    "Keep responses focused on actionable design/code changes and cite files you inspect.",
    "When writing or modifying files, keep diffs small and verify where possible.",
    "",
    prompt.trim(),
  ].join("\n");
}

export async function openDesignAgentCommand(options: OpenDesignAgentOptions = {}): Promise<void> {
  const prompt = await readStdinText();
  if (options.smoke || isOpenDesignSmokePrompt(prompt)) {
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
  await injectKimiGlobals(args, { role: "designer" });
  setModelArg(args, options.model);
  args.push("--prompt", buildBridgePrompt(prompt), "--print");

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
    const result = await runShellStreaming("kimi", args, {
      cwd,
      env,
      timeout: parseTimeoutMs(options.timeoutMs),
      input: "",
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    if (result.failed || result.exitCode !== 0) {
      process.exitCode = result.exitCode || 1;
    }
  } finally {
    await cleanupIsolatedKimiHome(tmpHome);
  }
}
