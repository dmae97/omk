import pty from "node-pty";
import { BannerReplacer } from "./banner.js";
import { KimiBugFilter } from "./bug-filter.js";
import { kimicatBanner, style } from "../util/theme.js";
import { ensureDir, injectKimiGlobals, getProjectRoot, pathExists } from "../util/fs.js";
import { pasteScreenshot } from "../util/screenshot-store.js";
import { join } from "path";
import type { TaskRunner, TaskResult } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { runShellStreaming } from "../util/shell.js";
import { resolveTimeoutMs } from "../util/timeout-config.js";
import { getOmkResourceSettings, type OmkRuntimeScope } from "../util/resource-profile.js";
import { KimiStatusLineEnhancer } from "./statusline.js";
import { formatOmkVersionFooter } from "../util/version.js";
import { prepareIsolatedKimiHome, cleanupIsolatedKimiHome, resolveOriginalHome } from "./isolated-home.js";
import { enableRawTerminalInput, restoreTerminalInputState } from "../util/terminal-input.js";
import { checkCommand } from "../util/shell.js";

/** args 배열에서 --mcp-config-file 경로들을 찾아 존재 여부 검증 (fail-fast, 3s timeout) */
async function preflightMcpConfigs(args: string[]): Promise<void> {
  const MCP_PREFLIGHT_TIMEOUT_MS = 3000;
  const start = Date.now();
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--mcp-config-file") {
      const configPath = args[i + 1];
      if (!configPath) continue;
      if (Date.now() - start > MCP_PREFLIGHT_TIMEOUT_MS) {
        console.warn(style.orange(`[omk] ⚠️  MCP preflight timed out after ${MCP_PREFLIGHT_TIMEOUT_MS}ms`));
        break;
      }
      if (!(await pathExists(configPath))) {
        console.warn(
          style.orange(`[omk] ⚠️  MCP config not found: ${configPath}`) +
            "\n  Kimi may fail to start. Run `omk doctor` to check MCP configuration."
        );
      }
    }
  }
}
export async function runKimiInteractive(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    onMeta?: (meta: { directory?: string; session?: string; model?: string }) => void;
    onData?: (data: string) => void;
  }
): Promise<number> {
  const resources = await getOmkResourceSettings();

  // Debug: log args so we can verify MCP/skills flags are present
  if (process.env.OMK_DEBUG === "1") {
    process.stderr.write(`[omk-debug] runKimiInteractive args: ${JSON.stringify(args)}\n`);
  }

  const replacer = new BannerReplacer((meta) => {
    writeStdout(kimicatBanner(meta, formatOmkVersionFooter()) + "\n");
    options?.onMeta?.(meta);
  });
  const bugFilter = new KimiBugFilter();
  const statusLine = await KimiStatusLineEnhancer.create();

  const baseEnv = { ...(process.env as Record<string, string>), ...(options?.env ?? {}) };
  const originalHome = resolveOriginalHome(baseEnv);
  const tmpHome = await prepareIsolatedKimiHome({ originalHome, env: baseEnv });
  const env = {
    ...baseEnv,
    OMK_RESOURCE_PROFILE_EFFECTIVE: resources.profile,
    OMK_ORIGINAL_HOME: originalHome,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    HOMEDRIVE: "",
    HOMEPATH: tmpHome,
  };


  // Binary resolution guard: verify `kimi` is reachable before spawn
  const kimiAvailable = await checkCommand("kimi");
  if (!kimiAvailable) {
    await cleanupIsolatedKimiHome(tmpHome);
    throw new Error(
      "[omk] `kimi` command not found in PATH. " +
        "Install Kimi CLI first: npm i -g @anthropic-ai/kimi-code\n" +
        "If already installed, check your PATH or set KIMI_BIN env var."
    );
  }

  // MCP preflight: verify config files exist before spawn
  await preflightMcpConfigs(args);

  let ptyProcess: ReturnType<typeof pty.spawn>;
  try {
    ptyProcess = pty.spawn("kimi", args, {
      name: "xterm-256color",
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: options?.cwd ?? process.cwd(),
      env,
    });
  } catch (err) {
    await cleanupIsolatedKimiHome(tmpHome);
    throw err;
  }

  // ── Signal handlers registered inside Promise below ──

  // ── Backpressure-safe stdout writer (circular buffer) ──
  // Prevents process.stdout.write from blocking the event loop when the
  // TTY is slow, which in turn starves stdin keypress handlers.
  const MAX_STDOUT_LINES = Math.max(1000, Math.min(20000, parseInt(process.env.OMK_MAX_STDOUT_LINES ?? "10000", 10)));
  const MAX_CHUNK_BYTES = 65536; // cap individual chunks to avoid memory spikes
  const stdoutQueue: string[] = [];
  let stdoutHead = 0;
  let stdoutCount = 0;
  let stdoutWriting = false;

  function circularPush(data: string): void {
    // Limit individual chunk size to prevent memory spikes from huge single writes
    const chunks = data.length > MAX_CHUNK_BYTES
      ? [data.slice(0, MAX_CHUNK_BYTES), data.slice(MAX_CHUNK_BYTES)]
      : [data];
    for (const chunk of chunks) {
      const idx = (stdoutHead + stdoutCount) % MAX_STDOUT_LINES;
      if (stdoutCount < MAX_STDOUT_LINES) {
        stdoutQueue[idx] = chunk;
        stdoutCount++;
      } else {
        stdoutQueue[stdoutHead] = chunk;
        stdoutHead = (stdoutHead + 1) % MAX_STDOUT_LINES;
      }
    }
  }

  function circularShift(): string | undefined {
    if (stdoutCount === 0) return undefined;
    const data = stdoutQueue[stdoutHead];
    stdoutQueue[stdoutHead] = "";
    stdoutHead = (stdoutHead + 1) % MAX_STDOUT_LINES;
    stdoutCount--;
    return data;
  }

  function flushStdoutQueue(): void {
    stdoutWriting = true;
    while (stdoutCount > 0) {
      const chunk = circularShift()!;
      if (!process.stdout.write(chunk)) {
        process.stdout.once("drain", () => {
          stdoutWriting = false;
          flushStdoutQueue();
        });
        return;
      }
    }
    stdoutWriting = false;
  }

  function writeStdout(data: string): void {
    circularPush(data);
    if (!stdoutWriting) {
      flushStdoutQueue();
    }
  }

  // stdout → 터미널 (버그 필터 → 배너 필터링 적용)
  ptyProcess.onData((data) => {
    options?.onData?.(data);
    // Strip terminal sequences that break scrollback / native mouse scrolling:
    // - alternate-screen buffer enter/exit (1049, legacy 47)
    // - mouse tracking (1000, 1002, 1006)
    // - scroll-region setting (r) — prevents partial-screen redraws that confuse scrollback
    data = data
      .replace(/\x1b\[\?1049[hl]/g, "")
      .replace(/\x1b\[\?47[hl]/g, "")
      .replace(/\x1b\[\?(1000|1002|1003|1006)[hl]/g, "")
      .replace(/\x1b\[\d+;\d+[r]/g, "");
    const bugResult = bugFilter.process(data);
    if (bugResult.sendEnter) {
      ptyProcess.write("\n");
    }
    if (bugResult.output === null) {
      return;
    }
    const output = replacer.process(bugResult.output);
    if (output !== null) {
      writeStdout(statusLine.process(output));
    }
  });

  // stdin → pty (Buffer passthrough for lower latency)
  const terminalInputState = enableRawTerminalInput(process.stdin);
  const handleStdinData = (data: string | Buffer): void => {
    const text = typeof data === "string" ? data : data.toString("utf8");

    // Ctrl+V (0x16) — auto-attach a clipboard image if Windows Capture/Snipping Tool
    // copied one via Ctrl+C. Text paste still falls through to Kimi unchanged.
    // Set OMK_IMAGE_PASTE_MODE=native/off to disable, or managed to show clipboard errors.
    if (text.includes("\x16")) {
      const mode = (process.env.OMK_IMAGE_PASTE_MODE ?? "auto").toLowerCase();
      const remaining = text.replace(/\x16/g, "");
      if (!["native", "off", "disabled", "0"].includes(mode)) {
        const result = pasteScreenshot(getProjectRoot());
        if (result.ok && result.relativePath) {
          // Insert path but do NOT auto-submit; user must press Enter.
          ptyProcess.write(`Image file: ${result.relativePath}`);
          if (remaining) {
            ptyProcess.write(remaining);
          }
          return;
        }
        if (mode === "managed" && remaining.trim().length === 0) {
          ptyProcess.write(`[Clipboard: ${result.error ?? "no image found"}]`);
          return;
        }
      }
      ptyProcess.write(text);
      return;
    }

    // /paste-image — explicit command to save clipboard image and insert path
    if (text.trim() === "/paste-image") {
      const result = pasteScreenshot(getProjectRoot());
      if (result.ok && result.relativePath) {
        // Insert path but do NOT auto-submit; user must press Enter.
        ptyProcess.write(`Image file: ${result.relativePath}`);
      } else {
        ptyProcess.write(`[Screenshot error: ${result.error ?? "No image found"}]`);
      }
      return;
    }


    ptyProcess.write(text);
  };
  process.stdin.on("data", handleStdinData);

  // 터미널 리사이즈 → pty 동기화
  const handleStdoutResize = (): void => {
    ptyProcess.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  };
  process.stdout.on("resize", handleStdoutResize);

  // 종료 대기
  return new Promise<number>((resolve) => {
    let cleaned = false;
    const cleanupRuntime = async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      try {
        process.stdin.off("data", handleStdinData);
        process.stdout.off("resize", handleStdoutResize);
      } finally {
        try {
          statusLine.dispose();
        } finally {
          restoreTerminalInputState(process.stdin, terminalInputState);
        }
      }
      await cleanupIsolatedKimiHome(tmpHome);
    };

    const signalHandler = async (signal: string): Promise<void> => {
      // Remove listeners first to prevent re-entry
      process.removeListener("SIGINT", signalHandler as NodeJS.SignalsListener);
      process.removeListener("SIGTERM", signalHandler as NodeJS.SignalsListener);
      try {
        ptyProcess.kill("SIGTERM");
      } catch { /* pty already dead */ }
      await cleanupRuntime();
      process.exitCode = signal === "SIGINT" ? 130 : 143; // 128+2, 128+15
    };
    process.once("SIGINT", signalHandler as NodeJS.SignalsListener);
    process.once("SIGTERM", signalHandler as NodeJS.SignalsListener);

    ptyProcess.onExit(({ exitCode }) => {
      const bugRest = bugFilter.forceFlush();
      if (bugRest) writeStdout(statusLine.process(bugRest));
      const replacerRest = replacer.forceFlush();
      if (replacerRest) writeStdout(statusLine.process(replacerRest));
      cleanupRuntime().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[omk] PTY cleanup warning: ${message}\n`);
      });
      if (exitCode !== 0) {
        const runId = options?.env?.OMK_RUN_ID;
        const resumeHint = runId ? ` • resume: omk chat --run-id ${runId}` : "";
        process.stderr.write(style.red(`[omk] kimi exited with code ${exitCode}${resumeHint}\n`));
        // Detect MCP connection failures from stderr that was buffered in PTY
        if (exitCode === 1) {
          process.stderr.write(
            style.orange(
              `[omk] If this was caused by MCP server connection failure, run 'omk doctor' to diagnose.\n` +
                `      You can also try: OMK_MCP_SCOPE=none omk chat --provider kimi\n`
            )
          );
        }
      }
      resolve(exitCode);
});
  });
}

export interface KimiTaskRunnerOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  agentFile?: string;
  promptPrefix?: string;
  mcpScope?: OmkRuntimeScope;
  skillsScope?: OmkRuntimeScope;
  onThinking?: (thinking: string) => void;
  /** If true, automatically pick .omk/agents/{role}.yaml per node role */
  roleAgentFiles?: boolean;
}

function createLiveThinkingHandler(onThinking: ((thinking: string) => void) | undefined) {
  if (!onThinking) return undefined;
  let recentLine = "";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (recentLine) onThinking(`📝 ${recentLine}`);
  };

  return (chunk: string) => {
    const lines = chunk.split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.length < 3) continue;

      // Explicit thinking markers
      const explicit = line.match(/^<think(?:ing)?>[\s:]*(.+?)(?:<\/think(?:ing)?>)?$/i);
      if (explicit) {
        onThinking(`🧠 ${explicit[1].trim().slice(0, 100)}`);
        continue;
      }

      // Tool/file activity
      if (/read_file|write_file|edit_file|search_files|glob|grep|ctx_read/i.test(line)) {
        const m = line.match(/["']([^"']{1,60})["']/);
        onThinking(m ? `📄 ${m[1].split("/").pop() ?? m[1]}` : `🔧 ${line.slice(0, 60)}`);
        continue;
      }

      if (line.length > 5 && line.length < 120 && !line.startsWith("```")) {
        recentLine = line.slice(0, 80);
      }
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, 400);
  };
}

async function resolveAgentFileForRole(role: string, fallback?: string): Promise<string | undefined> {
  const projectRoot = getProjectRoot();
  const candidates = [
    join(projectRoot, ".omk", "agents", `${role}.yaml`),
    join(projectRoot, ".omk", "agents", `${role}.yml`),
    join(projectRoot, ".omk", "agents", "roles", `${role}.yaml`),
    join(projectRoot, ".omk", "agents", "roles", `${role}.yml`),
    join(projectRoot, ".kimi", "agents", `${role}.yaml`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return fallback;
}

export function createKimiTaskRunner(options: KimiTaskRunnerOptions = {}): TaskRunner {
  const { cwd, timeout = 120000, env, agentFile, promptPrefix, mcpScope, skillsScope, onThinking, roleAgentFiles } = options;
  let currentOnThinking = onThinking;

  const runner: TaskRunner = {
    get onThinking() {
      return currentOnThinking;
    },
    set onThinking(fn) {
      currentOnThinking = fn;
    },

    fork(newOnThinking) {
      return createKimiTaskRunner({ ...options, onThinking: newOnThinking });
    },

    async run(node: DagNode, nodeEnv: Record<string, string>): Promise<TaskResult> {
      const baseEnv: Record<string, string> = { ...(process.env as Record<string, string>), ...(env ?? {}), ...nodeEnv };
      const originalHome = resolveOriginalHome(baseEnv);
      const tmpHome = await prepareIsolatedKimiHome({ originalHome, env: baseEnv });
      const mergedEnv: Record<string, string> = {
        ...baseEnv,
        OMK_ORIGINAL_HOME: originalHome,
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        HOMEDRIVE: "",
        HOMEPATH: tmpHome,
      };
      const args: string[] = [];
      await injectKimiGlobals(args, { mcpScope, skillsScope, role: node.role });
      await preflightMcpConfigs(args);

      const resolvedAgentFile = roleAgentFiles
        ? await resolveAgentFileForRole(node.role, agentFile)
        : agentFile;
      if (resolvedAgentFile) {
        args.push("--agent-file", resolvedAgentFile);
      }
      args.push("--prompt", buildNodeMessage(node, mergedEnv, promptPrefix));
      args.push("--print");

      const worktree = node.worktree ?? cwd;
      if (worktree) {
        await ensureDir(worktree);
      }

      const runId = mergedEnv.OMK_RUN_ID;
      const logPath = runId
        ? join(getProjectRoot(), ".omk", "runs", runId, `${node.id}.log`)
        : undefined;

      const thinkingHandler = createLiveThinkingHandler(currentOnThinking);

      const effectiveTimeout = await resolveTimeoutMs({ timeoutMs: timeout, timeoutPreset: node.timeoutPreset });

      // Binary resolution guard for DAG mode
      const kimiAvailable = await checkCommand("kimi");
      if (!kimiAvailable) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "[omk] `kimi` command not found in PATH. Install Kimi CLI first.",
        };
      }
      let result: Awaited<ReturnType<typeof runShellStreaming>>;
      try {
        result = await runShellStreaming("kimi", args, {
          cwd: worktree,
          timeout: effectiveTimeout,
          env: mergedEnv,
          logPath,
          input: "",
          onStdout: thinkingHandler,
        });
      } finally {
        await cleanupIsolatedKimiHome(tmpHome);
      }

      // Debug: log runner result so we can diagnose unexpected failures
      if (result.failed || result.exitCode !== 0) {
        const stderrPreview = result.stderr.slice(0, 500).replace(/\n/g, "\\n");
        process.stderr.write(
          `[omk-debug] node=${node.id} exitCode=${result.exitCode} failed=${result.failed} stdoutLen=${result.stdout.length} stderrLen=${result.stderr.length} stderrPreview=${stderrPreview}\n`
        );
        if (result.stderr.includes("Failed to connect MCP servers")) {
          process.stderr.write(
            style.red(
              `[omk] MCP server connection failure detected in node ${node.id}.\n` +
                `      Run 'omk doctor' to check MCP status, or disable the failing server in ~/.kimi/mcp.json.\n`
            )
          );
        }
        if (result.stderr.includes("text content is empty")) {
          process.stderr.write(
            style.red(
              `[omk] Kimi API returned 400 "text content is empty" in node ${node.id}.\n` +
                `      This is a known Kimi CLI bug (fixed in v1.39.0, 2026-04-24).\n` +
                `      Upgrade Kimi CLI: npm i -g @anthropic-ai/kimi-code\n`
            )
          );
        }
      }

      const prefix = `[${node.id}:${node.role}] `;
      const prefixStdout = result.stdout
        .split("\n")
        .map((line) => (line.trim() ? prefix + line : line))
        .join("\n");
      const prefixStderr = result.stderr
        .split("\n")
        .map((line) => (line.trim() ? prefix + line : line))
        .join("\n");

      // Known MCP soft-failure: Kimi CLI may return exit code 1 when an MCP
      // server fails to connect, even though it produced meaningful stdout.
      // Only allow this specific exception; all other non-zero exits are failures.
      return {
        success: !result.failed && result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: prefixStdout,
        stderr: prefixStderr,
      };
    },
  };

  return runner;
}


function buildNodeMessage(
  node: DagNode,
  env: Record<string, string>,
  promptPrefix?: string
): string {
  const routing = node.routing;
  const mandatoryRouting: string[] = [];
  if (routing?.skills?.length) {
    mandatoryRouting.push(`- Skills (MUST use): ${routing.skills.join(", ")}`);
  }
  if (routing?.mcpServers?.length) {
    mandatoryRouting.push(`- MCP servers (MUST activate): ${routing.mcpServers.join(", ")}`);
  }
  if (routing?.tools?.length) {
    mandatoryRouting.push(`- Tools (MUST call when relevant): ${routing.tools.join(", ")}`);
  }
  if (routing?.rationale) {
    mandatoryRouting.push(`- Rationale: ${routing.rationale}`);
  }
  const deepseekAdvisory = env.OMK_DEEPSEEK_ADVISORY?.trim();

  const sections = [
    promptPrefix?.trim(),
    [
      `Execute DAG node: ${node.id}`,
      `Name: ${node.name}`,
      `Role: ${node.role}`,
      `Run ID: ${env.OMK_RUN_ID ?? ""}`,
      `Dependencies: ${node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "none"}`,
      `Context budget: ${routing?.contextBudget ?? env.OMK_CONTEXT_BUDGET ?? "small"}`,
      `Evidence required: ${String(routing?.evidenceRequired ?? env.OMK_ROUTE_EVIDENCE_REQUIRED ?? false)}`,
    ].join("\n"),
    mandatoryRouting.length > 0
      ? [
          "Routing directives (MANDATORY — activate these skills/MCP/tools explicitly):",
          ...mandatoryRouting,
          "- Do not ignore the routing hints above.",
          "- If a skill or MCP server is listed, prefer its capabilities over generic reasoning.",
        ].join("\n")
      : undefined,
    deepseekAdvisory
      ? [
          "DeepSeek advisory (non-authoritative — verify before editing):",
          `- Status: ${env.OMK_DEEPSEEK_ADVISORY_STATUS ?? "success"}`,
          `- Model: ${env.OMK_DEEPSEEK_ADVISORY_MODEL ?? "deepseek-v4-pro"}`,
          deepseekAdvisory,
          "Kimi remains responsible for actual file edits, shell execution, evidence, and final acceptance.",
        ].join("\n")
      : undefined,
    [
      "Instructions:",
      "- Treat the prompt prefix as the active Kimi orchestration contract; turn it into concrete node work, not a repeated summary.",
      "- Preserve completed work and continue only the unresolved scope named by this node.",
      "- Keep context small and read only the files needed for this node.",
      "- Use the listed skills/MCP/tools when they fit the node.",
      "- Produce concrete evidence, changed files, blockers, and verification result.",
      "- Do not silently skip required gates.",
    ].join("\n"),
  ].filter((section): section is string => Boolean(section));

  return sections.join("\n\n");
}
