// ─── Stdio Transport ────────────────────────────────────────────────────────
// Runs an MCP server as a child process and communicates via stdin/stdout.

import { spawn } from "node:child_process";
import { Writable } from "node:stream";

import type { Transport } from "./transport.js";

export class StdioTransport implements Transport {
  private process: ReturnType<typeof spawn> | null = null;
  private messageHandlers: Set<(raw: string) => void> = new Set();
  private notificationHandlers: Set<(method: string, params: unknown) => void> = new Set();
  private errorHandlers: Set<(err: Error) => void> = new Set();
  private buffer = "";

  constructor(
    private command: string,
    private args: string[],
    private env: Record<string, string>
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.env },
      });

      this.process.on("error", (err) => {
        for (const h of this.errorHandlers) h(err);
        reject(err);
      });

      this.process.on("close", (code) => {
        if (code !== 0 && code !== null) {
          const err = new Error(`MCP server exited with code ${code}`);
          for (const h of this.errorHandlers) h(err);
        }
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
        if (msg.id === undefined || msg.id === 0 || msg.id === null) {
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

  async send(message: string): Promise<void> {
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
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}