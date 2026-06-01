import { execa, type ExecaError } from "execa";
import { constants, createWriteStream } from "fs";
import { access, appendFile, mkdir } from "fs/promises";
import { dirname, isAbsolute } from "path";
import { CappedOutputBuffer } from "./output-buffer.js";
import { managedChildProcessOptions, terminateProcessTree, type ProcessTreeTarget } from "./process-tree.js";
import { getOmkResourceSettings } from "./resource-profile.js";
import { redactSecrets as redactSecretText } from "../mcp/secret-scanner.js";

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  failed: boolean;
}

export interface StreamingShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
  stdio?: "pipe" | "inherit";
  logPath?: string;
  input?: string;
  onStdout?: (line: string, io?: StreamingShellIo) => void;
  onStderr?: (line: string, io?: StreamingShellIo) => void;
  sudo?: boolean;
  signal?: AbortSignal;
  inheritEnv?: boolean;
}

export interface StreamingShellIo {
  writeStdin(input: string): void;
  terminate(reason?: string): void;
}

function isExecaError(err: unknown): err is ExecaError {
  return (
    typeof err === "object" &&
    err !== null &&
    ("stdout" in err || "stderr" in err || "exitCode" in err)
  );
}

const SUDO_ALLOWLIST = new Set([
  "docker",
]);

function applySudo(
  command: string,
  args: string[],
  sudo?: boolean
): [string, string[]] {
  const useSudo = sudo === true || (sudo === undefined && process.env.OMK_SUDO === "1" && process.env.OMK_CLI_SUDO_REQUEST === "1");
  if (!useSudo) return [command, args];
  if (!SUDO_ALLOWLIST.has(command)) {
    throw new Error(`Command not in sudo allowlist: ${command}. Set sudo explicitly or add to allowlist.`);
  }
  return ["sudo", [command, ...args]];
}

const SAFE_INHERITED_ENV_NAMES = new Set([
  "CI",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "OMK_ORIGINAL_HOME",
  "OMK_PROJECT_ROOT",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

function buildShellEnv(env: Record<string, string> | undefined, inheritEnv = false): Record<string, string> {
  const inherited = inheritEnv
    ? process.env
    : Object.fromEntries(
      Object.entries(process.env)
        .filter(([name, value]) => value !== undefined && SAFE_INHERITED_ENV_NAMES.has(name))
    );
  return { ...inherited, ...(env ?? {}) } as Record<string, string>;
}

function redactShellText(text: string): string {
  return redactSecretText(text).redacted;
}

function shellTerminationMessage(reason: "timeout" | "abort", timeout?: number): string {
  return reason === "timeout" ? `timed out after ${timeout ?? 0}ms` : "aborted";
}

function destroyProcessStreams(subprocess: ProcessTreeTarget): void {
  const streams = subprocess as ProcessTreeTarget & {
    stdout?: { destroy(error?: Error): void };
    stderr?: { destroy(error?: Error): void };
  };
  try {
    streams.stdout?.destroy(new Error("process tree terminated"));
  } catch {
    // ignore stream cleanup failures
  }
  try {
    streams.stderr?.destroy(new Error("process tree terminated"));
  } catch {
    // ignore stream cleanup failures
  }
}

function cleanupProcessTreeOnParentExit(subprocess: ProcessTreeTarget): void {
  subprocess.once("exit", () => {
    void terminateProcessTree(subprocess);
  });
}

function createShellTerminator(
  subprocess: ProcessTreeTarget,
  timeout: number,
  signal: AbortSignal | undefined
): {
  termination: Promise<never>;
  reason: () => string | undefined;
  clear: () => void;
} {
  let terminationReason: string | undefined;
  let rejectTermination: ((error: Error) => void) | undefined;
  const termination = new Promise<never>((_, reject) => {
    rejectTermination = reject;
  });
  let terminationStarted: Promise<void> | undefined;

  const requestTermination = (reason: string): void => {
    if (!terminationReason) terminationReason = reason;
    if (!terminationStarted) {
      destroyProcessStreams(subprocess);
      terminationStarted = terminateProcessTree(subprocess);
      void terminationStarted.finally(() => {
        rejectTermination?.(new Error(terminationReason ?? reason));
      });
    }
  };

  const timeoutTimer = timeout > 0
    ? setTimeout(() => {
      requestTermination(shellTerminationMessage("timeout", timeout));
    }, timeout)
    : undefined;
  timeoutTimer?.unref?.();

  const abortHandler = (): void => {
    requestTermination(shellTerminationMessage("abort"));
  };
  if (signal?.aborted) abortHandler();
  signal?.addEventListener("abort", abortHandler, { once: true });

  return {
    termination,
    reason: () => terminationReason,
    clear: () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", abortHandler);
    },
  };
}

async function appendRedactedLog(logPath: string | undefined, stdout: string, stderr: string): Promise<void> {
  if (!logPath) return;
  await mkdir(dirname(logPath), { recursive: true });
  const chunks: string[] = [];
  if (stdout) chunks.push(redactShellText(stdout));
  if (stderr) chunks.push(redactShellText(stderr));
  if (chunks.length > 0) {
    await appendFile(logPath, chunks.join("\n"), "utf-8");
  }
}

export async function runShell(
  command: string,
  args: string[] = [],
  options: StreamingShellOptions = {}
): Promise<ShellResult> {
  const resources = await getOmkResourceSettings();
  const { cwd, env, timeout = 30000, maxBuffer = resources.shellMaxBufferBytes, stdio = "pipe", logPath, input, sudo, signal, inheritEnv } = options;
  const [cmd, cmdArgs] = applySudo(command, args, sudo);
  const subprocess = execa(cmd, cmdArgs, {
    cwd,
    env: buildShellEnv(env, inheritEnv),
    extendEnv: false,
    timeout: 0,
    maxBuffer,
    buffer: stdio !== "inherit",
    stdio: stdio === "inherit" ? "inherit" : "pipe",
    reject: false,
    stripFinalNewline: false,
    input,
    ...managedChildProcessOptions(),
  });
  const terminator = createShellTerminator(subprocess, timeout, signal);
  cleanupProcessTreeOnParentExit(subprocess);

  try {
    const result = await Promise.race([subprocess, terminator.termination]);
    const stdout = redactShellText(String(result.stdout ?? ""));
    const terminationReason = terminator.reason();
    const stderr = redactShellText([
      String(result.stderr ?? ""),
      terminationReason,
    ].filter(Boolean).join("\n"));
    await appendRedactedLog(logPath, stdout, stderr);
    return {
      stdout,
      stderr,
      exitCode: result.exitCode ?? 1,
      failed: terminationReason ? true : result.failed ?? result.exitCode !== 0,
    };
  } catch (err) {
    const terminationReason = terminator.reason();
    if (isExecaError(err)) {
      const stdout = redactShellText(String(err.stdout ?? ""));
      const stderr = redactShellText([
        String(err.stderr ?? "") || (err instanceof Error ? err.message : String(err)),
        terminationReason,
      ].filter(Boolean).join("\n"));
      await appendRedactedLog(logPath, stdout, stderr);
      return {
        stdout,
        stderr,
        exitCode: err.exitCode ?? 1,
        failed: true,
      };
    }
    const stderr = redactShellText(terminationReason ?? (err instanceof Error ? err.message : String(err)));
    await appendRedactedLog(logPath, "", stderr);
    return {
      stdout: "",
      stderr,
      exitCode: 1,
      failed: true,
    };
  } finally {
    terminator.clear();
  }
}

export async function runShellStreaming(
  command: string,
  args: string[] = [],
  options: StreamingShellOptions = {}
): Promise<ShellResult> {
  const resources = await getOmkResourceSettings();
  const { cwd, env, timeout = 30000, maxBuffer = resources.shellMaxBufferBytes, stdio = "pipe", logPath, input, onStdout, onStderr, sudo, signal, inheritEnv } = options;
  const [cmd, cmdArgs] = applySudo(command, args, sudo);
  let logStream: ReturnType<typeof createWriteStream> | undefined;
  const stdoutBuffer = new CappedOutputBuffer(maxBuffer, "stdout");
  const stderrBuffer = new CappedOutputBuffer(maxBuffer, "stderr");

  // Set up log stream before spawning so data handlers can write to it
  // immediately, avoiding any race between spawn and listener attachment.
  if (logPath) {
    await mkdir(dirname(logPath), { recursive: true });
    logStream = createWriteStream(logPath, { flags: "a" });
  }

  const subprocess = execa(cmd, cmdArgs, {
    cwd,
    env: buildShellEnv(env, inheritEnv),
    extendEnv: false,
    timeout: 0,
    buffer: false,
    stdio: stdio === "inherit" ? "inherit" : "pipe",
    reject: false,
    stripFinalNewline: false,
    input,
    ...managedChildProcessOptions(),
  });
  const io: StreamingShellIo = {
    writeStdin(input: string): void {
      subprocess.stdin?.write(input);
    },
    terminate(): void {
      void terminateProcessTree(subprocess);
    },
  };

  // Attach data listeners IMMEDIATELY after execa() returns.
  // Execa v9 with buffer:false schedules a setImmediate that calls
  // resumeStream() if readableFlowing === null. If we yield to the event
  // loop before attaching listeners (e.g. an await), that resumeStream()
  // discards all stdout/stderr data because no consumer is present.
  // By attaching synchronously here, readableFlowing becomes true before
  // the setImmediate fires, so execa's internal resume is a no-op.
  subprocess.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString("utf-8");
    const redactedLine = redactShellText(line);
    stdoutBuffer.append(redactedLine);
    logStream?.write(redactedLine);
    onStdout?.(redactedLine, io);
  });

  subprocess.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString("utf-8");
    const redactedLine = redactShellText(line);
    stderrBuffer.append(redactedLine);
    logStream?.write(redactedLine);
    onStderr?.(redactedLine, io);
  });

  const terminator = createShellTerminator(subprocess, timeout, signal);
  cleanupProcessTreeOnParentExit(subprocess);

  try {
    const result = await Promise.race([subprocess, terminator.termination]);
    // Execa v9 resolves on the 'exit' event, which can fire before stdio
    // streams have fully drained. Yield to the event loop so any pending
    // 'data' events on stdout/stderr are processed before we read the buffers.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const terminationReason = terminator.reason();
    if (terminationReason) stderrBuffer.append(`\n${terminationReason}`);
    return {
      stdout: stdoutBuffer.toString(),
      stderr: stderrBuffer.toString(),
      exitCode: result.exitCode ?? 1,
      failed: terminationReason ? true : result.failed ?? result.exitCode !== 0,
    };
  } catch (err) {
    await new Promise<void>((resolve) => setImmediate(resolve)).catch(() => {});
    const terminationReason = terminator.reason();
    if (isExecaError(err)) {
      return {
        stdout: stdoutBuffer.toString() || redactShellText(String(err.stdout ?? "")),
        stderr: [
          stderrBuffer.toString() || redactShellText(String(err.stderr ?? "") || (err instanceof Error ? err.message : String(err))),
          terminationReason,
        ].filter(Boolean).join("\n"),
        exitCode: err.exitCode ?? 1,
        failed: true,
      };
    }
    const stderr = redactShellText(terminationReason ?? (err instanceof Error ? err.message : String(err)));
    return {
      stdout: "",
      stderr,
      exitCode: 1,
      failed: true,
    };
  } finally {
    terminator.clear();
    logStream?.end();
  }
}

function okShellResult(stdout: string): ShellResult {
  return { stdout, stderr: "", exitCode: 0, failed: false };
}

function failedShellResult(stderr: string): ShellResult {
  return { stdout: "", stderr, exitCode: 1, failed: true };
}

function includesPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

async function commandPathExists(command: string): Promise<boolean> {
  try {
    await access(command, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function which(command: string): Promise<ShellResult> {
  if (isAbsolute(command) || includesPathSeparator(command)) {
    return await commandPathExists(command)
      ? okShellResult(command)
      : failedShellResult(`command not found: ${command}`);
  }

  const isWindows = process.platform === "win32";
  return isWindows
    ? runShell("where.exe", [command], { timeout: 5000 })
    : runShell("which", [command], { timeout: 5000 });
}

export async function checkCommand(command: string): Promise<boolean> {
  try {
    if (isAbsolute(command) || includesPathSeparator(command)) {
      return await commandPathExists(command);
    }
    const isWindows = process.platform === "win32";
    const result = isWindows
      ? await runShell("where.exe", [command], { timeout: 5000 })
      : await runShell("sh", ["-c", 'command -v "$1"', "sh", command], { timeout: 5000 });
    return !result.failed && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function resolveKimiBin(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string {
  return env.KIMI_BIN ?? "kimi";
}

export async function getKimiVersion(): Promise<string | null> {
  const result = await runShell(resolveKimiBin(), ["--version"], { timeout: 10000 });
  if (result.failed) return null;
  return result.stdout.trim();
}
