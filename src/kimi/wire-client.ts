import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { CappedOutputBuffer } from "../util/output-buffer.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { getOmkVersionSync } from "../util/version.js";
import { checkCommand, resolveKimiBin } from "../util/shell.js";
import { buildSafeKimiChildEnv } from "./runner.js";

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: TParams;
}

export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: string;
  result?: TResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface KimiInitializeParams {
  protocol_version: string;
  client: {
    name: string;
    version: string;
  };
  capabilities: {
    supports_question: boolean;
    supports_plan_mode: boolean;
  };
  external_tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface KimiPromptParams {
  user_input: string;
}

export interface KimiPromptResult {
  status: "finished" | "cancelled";
}

export type WireEvent =
  | { type: "status"; contextUsage: number; maxContextTokens: number; tokenUsage: number; planMode: boolean }
  | { type: "message"; role: "assistant" | "user"; content: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown }
  | { type: "error"; message: string }
  | { type: "request"; method: string; params: unknown; respond: (result: unknown) => void; reject: (error: { code: number; message: string }) => void };

let requestId = 0;
function nextId(): string {
  return `omk-${++requestId}`;
}

export class KimiWireClient {
  private proc?: ChildProcess;
  private rl?: ReturnType<typeof createInterface>;
  private pending = new Map<string, { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private eventHandlers: Array<(event: WireEvent) => void> = [];
  private static readonly MAX_PENDING_RPCS = 64;

  constructor(
    private options: {
      agentFile?: string;
      configFile?: string;
      mcpConfigFile?: string;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    } = {}
  ) {}

  onEvent(handler: (event: WireEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  private emit(event: WireEvent): void {
    for (const h of this.eventHandlers) {
      try {
        h(event);
      } catch {
        // ignore
      }
    }
  }

  async start(): Promise<void> {
    const kimiBin = resolveKimiBin();

    // Binary resolution guard: verify `kimi` is reachable before spawn
    const kimiAvailable = await checkCommand(kimiBin);
    if (!kimiAvailable) {
      throw new Error(
        "[omk] `kimi` command not found in PATH. " +
          "Install Kimi CLI first: npm i -g @anthropic-ai/kimi-code\n" +
          "If already installed, check your PATH or set KIMI_BIN env var."
      );
    }

    const args = ["--wire"];
    if (this.options.agentFile) args.push("--agent-file", this.options.agentFile);
    if (this.options.configFile) args.push("--config-file", this.options.configFile);
    if (this.options.mcpConfigFile) args.push("--mcp-config-file", this.options.mcpConfigFile);

    const childEnv = buildSafeKimiChildEnv(process.env, this.options.env ?? {}, {}, {
      warnExplicitSecrets: true,
      explicitEnvContext: "Kimi wire client env",
    });

    this.proc = spawn(kimiBin, args, {
      cwd: this.options.cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.rl = createInterface({ input: this.proc.stdout! });

    this.rl.on("line", (line) => {
      const MAX_LINE_LENGTH = 10 * 1024 * 1024; // 10MB
      if (line.length > MAX_LINE_LENGTH) return; // skip oversized messages
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcRequest;
        if ("id" in msg && ("result" in msg || "error" in msg)) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            if ("error" in msg && msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg as JsonRpcResponse);
            }
          }
        } else if ("method" in msg) {
          this.handleServerMessage(msg as JsonRpcRequest);
        }
      } catch {
        this.emit({ type: "message", role: "assistant", content: trimmed });
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      this.emit({ type: "error", message: text });
    });

    this.proc.on("exit", (code) => {
      this.emit({ type: "error", message: `Kimi process exited with code ${code}` });
      this.rl?.close();
      this.rl = undefined;
      // Reject all pending Promises on process exit to prevent memory leaks / deadlocks
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`Kimi process exited (code ${code}) before response to request ${id}`));
      }
      this.pending.clear();
    });

    await this.call("initialize", {
      protocol_version: "2025-03-11",
      client: { name: "oh-my-kimi", version: getOmkVersionSync() },
      capabilities: { supports_question: true, supports_plan_mode: true },
      external_tools: [
        {
          name: "omk_claim_task",
          description: "Receive a DAG node task assignment",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "omk_update_task",
          description: "Update task status",
          parameters: {
            type: "object",
            properties: {
              task_id: { type: "string" },
              status: { type: "string", enum: ["running", "done", "failed", "blocked"] },
            },
            required: ["task_id", "status"],
          },
        },
        {
          name: "omk_read_memory",
          description: "Read project memory",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
        {
          name: "omk_write_memory",
          description: "Write project memory",
          parameters: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
        {
          name: "omk_emit_metric",
          description: "Record metrics",
          parameters: {
            type: "object",
            properties: { key: { type: "string" }, value: { type: "number" } },
            required: ["key", "value"],
          },
        },
        {
          name: "omk_report_blocker",
          description: "Report blockers",
          parameters: {
            type: "object",
            properties: { reason: { type: "string" } },
            required: ["reason"],
          },
        },
      ],
    });
  }

  private async call<TParams, TResult>(method: string, params?: TParams): Promise<TResult> {
    if (!this.proc?.stdin) throw new Error("Wire client not started");
    if (this.pending.size >= KimiWireClient.MAX_PENDING_RPCS) {
      throw new Error(`Too many pending RPCs (${this.pending.size}), max is ${KimiWireClient.MAX_PENDING_RPCS}`);
    }
    const id = nextId();
    const req: JsonRpcRequest<TParams> = { jsonrpc: "2.0", id, method, params };
    const timeoutMs = Number(process.env.OMK_WIRE_TIMEOUT_MS || "120000");
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Wire RPC timeout: ${method} (id: ${id}, timeout: ${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      if (this.proc.stdin.destroyed || this.proc.stdin.writableEnded) {
        throw new Error("Kimi process stdin is closed");
      }
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    } catch (err) {
      this.pending.delete(id);
      clearTimeout(timer);
      throw err;
    }
    const res = await promise;
    if (res.error) throw new Error(res.error.message);
    return res.result as TResult;
  }

  private handleServerMessage(msg: JsonRpcRequest): void {
    if (msg.method === "status") {
      const p = msg.params as Record<string, unknown>;
      this.emit({
        type: "status",
        contextUsage: Number(p.context_usage ?? 0),
        maxContextTokens: Number(p.max_context_tokens ?? 256000),
        tokenUsage: Number(p.token_usage ?? 0),
        planMode: Boolean(p.plan_mode ?? false),
      });
      return;
    }

    // Handle server->client requests (ApprovalRequest, ToolCallRequest, QuestionRequest)
    const respond = (result: unknown): void => {
      const res: JsonRpcResponse = { jsonrpc: "2.0", id: msg.id, result };
      this.proc?.stdin?.write(JSON.stringify(res) + "\n");
    };
    const reject = (error: { code: number; message: string }): void => {
      const res: JsonRpcResponse = { jsonrpc: "2.0", id: msg.id, error };
      this.proc?.stdin?.write(JSON.stringify(res) + "\n");
    };

    this.emit({ type: "request", method: msg.method, params: msg.params, respond, reject });
  }

  async prompt(userInput: string): Promise<KimiPromptResult> {
    return this.call("prompt", { user_input: userInput });
  }

  async steer(userInput: string): Promise<void> {
    await this.call("steer", { user_input: userInput });
  }

  async cancel(): Promise<void> {
    await this.call("cancel", {});
  }

  async stop(): Promise<void> {
    // Clean up all pending to prevent memory leaks / deadlocks
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`Wire client stopped before response to request ${id}`));
    }
    this.pending.clear();
    this.proc?.removeAllListeners();
    this.proc?.stderr?.removeAllListeners("data");
    this.rl?.removeAllListeners();
    this.eventHandlers = [];
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = undefined;
    }
  }
}

export function createKimiTaskRunner(client: KimiWireClient): TaskRunner {
  return {
    async run(node: DagNode, _env: Record<string, string>): Promise<TaskResult> {
      const resources = await getOmkResourceSettings();
      const prompt = `[${node.role}] ${node.name}`;
      const stdout = new CappedOutputBuffer(resources.wireOutputBytes, "wire stdout");
      const stderr = new CappedOutputBuffer(resources.wireOutputBytes, "wire stderr");

      const offEvent = client.onEvent((event) => {
        if (event.type === "message") {
          stdout.append(`${event.content}\n`);
        } else if (event.type === "error") {
          stderr.append(`${event.message}\n`);
        } else if (event.type === "tool_result") {
          stdout.append(`${JSON.stringify(event.output)}\n`);
        }
      });

      try {
        // Restart client with merged env if needed, or just use existing client
        // For simplicity, we use the existing client and assume env is passed via prompt context
        const result = await client.prompt(prompt);
        const success = result.status === "finished";
        return {
          success,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        };
      } catch (err) {
        stderr.append(`\n${String(err)}`);
        return {
          success: false,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        };
      } finally {
        offEvent();
      }
    },
  };
}
