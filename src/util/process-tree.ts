import { spawn } from "node:child_process";

export interface ProcessTreeTarget {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit" | "close" | "error", listener: (...args: unknown[]) => void): unknown;
}

export interface TerminateProcessTreeOptions {
  graceMs?: number;
  waitMs?: number;
  signal?: NodeJS.Signals;
  forceSignal?: NodeJS.Signals;
}

const DEFAULT_GRACE_MS = 1_000;
const DEFAULT_WAIT_MS = 6_000;

export function shouldUseProcessGroup(): boolean {
  return process.platform !== "win32";
}

export function managedChildProcessOptions(): { detached: boolean } {
  return { detached: shouldUseProcessGroup() };
}

function hasExited(target: ProcessTreeTarget): boolean {
  return target.exitCode !== null && target.exitCode !== undefined
    || target.signalCode !== null && target.signalCode !== undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function waitForExit(target: ProcessTreeTarget): Promise<void> {
  if (hasExited(target)) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    target.once("exit", done);
    target.once("close", done);
    target.once("error", done);
  });
}

function killWindowsTree(pid: number, force: boolean): void {
  const args = ["/PID", String(pid), "/T"];
  if (force) args.push("/F");
  const taskkill = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
  taskkill.unref();
}

function sendProcessTreeSignal(
  target: ProcessTreeTarget,
  signal: NodeJS.Signals,
  force = false
): void {
  const pid = target.pid;
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      if (!force) target.kill(signal);
    } catch {
      // fall through to taskkill fallback
    }
    if (force) killWindowsTree(pid, true);
    return;
  }

  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Fall back to the root child when it is not a process-group leader.
  }

  try {
    target.kill(signal);
  } catch {
    // ignore missing/already-exited processes
  }
}

export async function terminateProcessTree(
  target: ProcessTreeTarget,
  options: TerminateProcessTreeOptions = {}
): Promise<void> {
  if (!target.pid) return;
  if (hasExited(target) && !shouldUseProcessGroup()) return;
  const graceMs = Math.max(0, options.graceMs ?? DEFAULT_GRACE_MS);
  const waitMs = Math.max(graceMs, options.waitMs ?? DEFAULT_WAIT_MS);
  const signal = options.signal ?? "SIGTERM";
  const forceSignal = options.forceSignal ?? "SIGKILL";
  const exited = waitForExit(target);

  sendProcessTreeSignal(target, signal, false);

  let forceSent = false;
  const sendForce = (): void => {
    if (forceSent) return;
    forceSent = true;
    sendProcessTreeSignal(target, forceSignal, true);
  };

  const forceTimer = setTimeout(sendForce, graceMs);
  forceTimer.unref?.();

  await Promise.race([
    exited.then(() => {
      if (shouldUseProcessGroup()) sendForce();
    }),
    delay(graceMs).then(sendForce),
  ]);
  clearTimeout(forceTimer);

  await Promise.race([exited, delay(waitMs)]);
}
