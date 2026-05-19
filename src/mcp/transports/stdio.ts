// ─── Stdio Transport ────────────────────────────────────────────────────────
// Runs an MCP server as a child process and communicates via stdin/stdout.

import { spawn } from "node:child_process";
import { Writable } from "node:stream";

import type { Transport, TransportSendOptions } from "./transport.js";

const SAFE_ENV_NAMES = new Set([
  "CI",
  "COLORTERM",
  "ComSpec",
  "FORCE_COLOR",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_ENV",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "Path",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "windir",
]);

function isSafeInheritedEnvName(name: string): boolean {
  return SAFE_ENV_NAMES.has(name) || /^LC_[A-Z0-9_]+$/.test(name);
}

function buildSubprocessEnv(
  inheritedEnv: Record<string, string | undefined>,
  serverEnv: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined || !isSafeInheritedEnvName(key)) continue;
    result[key] = value;
  }
  for (const [key, value] of Object.entries(serverEnv)) {
    result[key] = value;
  }
  return result;
}

export class StdioTransport implements Transport {
  private process: ReturnType<typeof spawn> | null = null;
  private messageHandlers: Set<(raw: string) => void> = new Set();
  private notificationHandlers: Set<(method: string, params: unknown) => void> = new Set();
  private errorHandlers: Set<(err: Error) => void> = new Set();
  private buffer = "";
  private closing = false;

  constructor(
    private command: string,
    private args: string[],
    private env: Record<string, string>
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildSubprocessEnv(process.env, this.env),
      });

      this.process.on("error", (err) => {
        for (const h of this.errorHandlers) h(err);
        reject(err);
      });

      this.process.on("close", (code, signal) => {
        this.process = null;
        if (this.closing) return;
        const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        const err = new Error(`MCP server exited with ${reason}`);
        for (const h of this.errorHandlers) h(err);
      });

      if (!this.process.stdout) {
        reject(new Error("Failed to create stdout stream"));
        return;
      }

      this.process.stdout.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      if (!this.process.stdin) {
        reject(new Error("Failed to create stdin stream"));
        return;
      }

      resolve();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id === undefined) {
          // Notification
          for (const h of this.notificationHandlers) {
            h(msg.method, msg.params);
          }
        } else {
          // Response
          for (const h of this.messageHandlers) {
            h(trimmed);
          }
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  async send(message: string, options: TransportSendOptions = {}): Promise<void> {
    if (options.signal?.aborted) throw new Error("Send aborted");
    if (!this.process?.stdin) throw new Error("Process stdin not available");
    return new Promise((resolve, reject) => {
      (this.process!.stdin as Writable).write(message, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandlers.add(handler);
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandlers.add(handler);
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandlers.add(handler);
  }

  async close(): Promise<void> {
    const child = this.process;
    if (!child) return;
    this.closing = true;
    this.process = null;
    child.stdin?.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}
