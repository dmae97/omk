import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { TaskResult, TaskRunner } from "../../contracts/orchestration.js";
import type { DagNode } from "../../orchestration/dag.js";
import { CappedOutputBuffer } from "../../util/output-buffer.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import { getOmkVersionSync } from "../../util/version.js";
import { checkCommand, resolveKimiBin } from "../../util/shell.js";
import { buildSafeKimiChildEnv } from "./runner.js";
import { terminateProcessTree, type ProcessTreeTarget } from "../../util/process-tree.js";
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  InitializeParams,
  InitializeResult,
  PromptParams,
  PromptResult,
  SteerParams,
  SteerResult,
  SetPlanModeParams,
  SetPlanModeResult,
  CancelParams,
  CancelResult,
  ReplayParams,
  ReplayResult,
  WireHookSubscription,
  WireEvent,
  WireRequest,
  ApprovalRequest,
  ToolCallRequest,
  QuestionRequest,
  HookRequest,
  ContentPart,
  StatusUpdate,
  ServerInfo,
  SlashCommandInfo,
  ServerCapabilities,
  ExternalToolsResult,
  HooksInfo,
  ToolCallEvent,
  ToolResultEvent,
  ApprovalResponseEvent,
  TurnBegin,
  StepBegin,
  SubagentEvent,
  SteerInput,
  PlanDisplay,
  HookTriggered,
  HookResolved,
  TokenUsage,
  ToolCallPart,
} from "./wire-protocol-types.js";

// Re-export deprecated names for backward compatibility
export type {
  JsonRpcRequest,
  JsonRpcResponse,
} from "./wire-protocol-types.js";

let requestId = 0;
function nextId(): string {
  return `omk-${++requestId}`;
}

function wireProcTarget(proc: ChildProcess): ProcessTreeTarget {
  return {
    pid: proc.pid,
    get exitCode() {
      return proc.exitCode ?? null;
    },
    get signalCode() {
      return (proc.signalCode as NodeJS.Signals | null) ?? null;
    },
    kill(signal?: NodeJS.Signals | number) {
      return proc.kill(signal);
    },
    once(event: "exit" | "close" | "error", listener: (...args: unknown[]) => void) {
      proc.once(event, listener);
      return undefined;
    },
  };
}

/** Backward-compatible generic wire event (deprecated — use WireEvent instead) */
export type LegacyWireEvent =
  | { type: "status"; contextUsage: number; maxContextTokens: number; tokenUsage: number; planMode: boolean }
  | { type: "message"; role: "assistant" | "user"; content: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown }
  | { type: "error"; message: string }
  | {
      type: "request";
      method: string;
      params: unknown;
      respond: (result: unknown) => void;
      reject: (error: { code: number; message: string }) => void;
    };

/** Kimi wire client options */
export interface KimiWireClientOptions {
  agentFile?: string;
  configFile?: string;
  mcpConfigFile?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Hook subscriptions to declare during initialize */
  hooks?: WireHookSubscription[];
  /** Resume previous session */
  continue?: boolean;
  /** Specific session ID */
  session?: string;
  /** Model to use */
  model?: string;
  /** YOLO mode (skip approvals) */
  yolo?: boolean;
}

/** Handler for a specific request type from the agent */
export type ApprovalRequestHandler = (
  request: ApprovalRequest,
  respond: (response: { request_id: string; response: "approve" | "approve_for_session" | "reject"; feedback?: string }) => void,
  reject: (error: { code: number; message: string }) => void
) => void;

export type ToolCallRequestHandler = (
  request: ToolCallRequest,
  respond: (result: { tool_call_id: string; return_value: { is_error: boolean; output: string | ContentPart[]; message: string; display: unknown[] } }) => void,
  reject: (error: { code: number; message: string }) => void
) => void;

export type QuestionRequestHandler = (
  request: QuestionRequest,
  respond: (response: { request_id: string; answers: Record<string, string> }) => void,
  reject: (error: { code: number; message: string }) => void
) => void;

export type HookRequestHandler = (
  request: HookRequest,
  respond: (response: { request_id: string; action: "allow" | "block"; reason: string }) => void,
  reject: (error: { code: number; message: string }) => void
) => void;

export class KimiWireClient {
  private proc?: ChildProcess;
  private rl?: ReturnType<typeof createInterface>;
  private pending = new Map<
    string,
    { resolve: (value: JSONRPCResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  // Strongly-typed event handlers
  private eventHandlers: Array<(event: WireEvent) => void> = [];
  private legacyEventHandlers: Array<(event: LegacyWireEvent) => void> = [];

  // Typed request handlers
  private approvalHandlers: ApprovalRequestHandler[] = [];
  private toolCallHandlers: ToolCallRequestHandler[] = [];
  private questionHandlers: QuestionRequestHandler[] = [];
  private hookHandlers: HookRequestHandler[] = [];
  private genericRequestHandlers: Array<(request: WireRequest, respond: (result: unknown) => void, reject: (error: { code: number; message: string }) => void) => void> = [];

  private static readonly MAX_PENDING_RPCS = 64;

  // Initialize response cache
  private _initializeResult?: InitializeResult;

  constructor(private options: KimiWireClientOptions = {}) {}

  // ─── Server info getters ─────────────────────────────────────

  get serverInfo(): ServerInfo | undefined {
    return this._initializeResult?.server;
  }

  get slashCommands(): SlashCommandInfo[] | undefined {
    return this._initializeResult?.slash_commands;
  }

  get serverCapabilities(): ServerCapabilities | undefined {
    return this._initializeResult?.capabilities;
  }

  get registeredTools(): ExternalToolsResult | undefined {
    return this._initializeResult?.external_tools;
  }

  get hooksInfo(): HooksInfo | undefined {
    return this._initializeResult?.hooks;
  }

  // ─── Event handlers ──────────────────────────────────────────

  /** Register a strongly-typed event handler */
  onEvent(handler: (event: WireEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  /** @deprecated Use onEvent with WireEvent instead */
  onLegacyEvent(handler: (event: LegacyWireEvent) => void): () => void {
    this.legacyEventHandlers.push(handler);
    return () => {
      this.legacyEventHandlers = this.legacyEventHandlers.filter((h) => h !== handler);
    };
  }

  private emitEvent(event: WireEvent): void {
    for (const h of this.eventHandlers) {
      try {
        h(event);
      } catch {
        // ignore handler errors
      }
    }
  }

  private emitLegacyEvent(event: LegacyWireEvent): void {
    for (const h of this.legacyEventHandlers) {
      try {
        h(event);
      } catch {
        // ignore handler errors
      }
    }
  }

  // ─── Request handlers ────────────────────────────────────────

  onApprovalRequest(handler: ApprovalRequestHandler): () => void {
    this.approvalHandlers.push(handler);
    return () => {
      this.approvalHandlers = this.approvalHandlers.filter((h) => h !== handler);
    };
  }

  onToolCallRequest(handler: ToolCallRequestHandler): () => void {
    this.toolCallHandlers.push(handler);
    return () => {
      this.toolCallHandlers = this.toolCallHandlers.filter((h) => h !== handler);
    };
  }

  onQuestionRequest(handler: QuestionRequestHandler): () => void {
    this.questionHandlers.push(handler);
    return () => {
      this.questionHandlers = this.questionHandlers.filter((h) => h !== handler);
    };
  }

  onHookRequest(handler: HookRequestHandler): () => void {
    this.hookHandlers.push(handler);
    return () => {
      this.hookHandlers = this.hookHandlers.filter((h) => h !== handler);
    };
  }

  /** Generic fallback request handler for unhandled request types */
  onRequest(handler: (request: WireRequest, respond: (result: unknown) => void, reject: (error: { code: number; message: string }) => void) => void): () => void {
    this.genericRequestHandlers.push(handler);
    return () => {
      this.genericRequestHandlers = this.genericRequestHandlers.filter((h) => h !== handler);
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  async start(): Promise<void> {
    const kimiBin = resolveKimiBin();

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
    if (this.options.continue) args.push("--continue");
    if (this.options.session) args.push("--session", this.options.session);
    if (this.options.model) args.push("--model", this.options.model);
    if (this.options.yolo) args.push("--yolo");

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
      if (line.length > MAX_LINE_LENGTH) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JSONRPCResponse | JSONRPCRequest<string, unknown>;
        if ("id" in msg && ("result" in msg || "error" in msg)) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            if ("error" in msg && msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg as JSONRPCResponse);
            }
          }
        } else if ("method" in msg) {
          this.handleServerMessage(msg as JSONRPCRequest<string, unknown>);
        }
      } catch {
        // Non-JSON line: emit as raw assistant message for backward compat
        this.emitLegacyEvent({ type: "message", role: "assistant", content: trimmed });
        this.emitEvent({ type: "ContentPart", payload: { type: "text", text: trimmed } });
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      this.emitLegacyEvent({ type: "error", message: text });
    });

    this.proc.on("exit", (code) => {
      this.emitLegacyEvent({ type: "error", message: `Kimi process exited with code ${code}` });
      this.rl?.close();
      this.rl = undefined;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`Kimi process exited (code ${code}) before response to request ${id}`));
      }
      this.pending.clear();
    });

    let initResult: InitializeResult | undefined;
    try {
      initResult = await this.call<InitializeParams, InitializeResult>(
        "initialize",
        {
          protocol_version: "1.7",
          client: { name: "open-multi-agent-kit", version: getOmkVersionSync() },
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
          hooks: this.options.hooks,
        },
        undefined,
        30000
      );
    } catch (err) {
      const msg = String(err);
      if (msg.includes("-32601") || msg.includes("method not found")) {
        // No-handshake fallback: proceed without initialize result
        initResult = undefined;
      } else {
        throw err;
      }
    }
    this._initializeResult = initResult;
  }

  // ─── JSON-RPC call machinery ─────────────────────────────────

  private async call<TParams, TResult>(
    method: string,
    params?: TParams,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<TResult> {
    if (!this.proc?.stdin) throw new Error("Wire client not started");
    if (this.pending.size >= KimiWireClient.MAX_PENDING_RPCS) {
      throw new Error(
        `Too many pending RPCs (${this.pending.size}), max is ${KimiWireClient.MAX_PENDING_RPCS}`
      );
    }
    if (signal?.aborted) {
      throw new Error(`Wire RPC aborted: ${method}`);
    }
    const id = nextId();
    const req: JSONRPCRequest<string, TParams> = { jsonrpc: "2.0", id, method, params: params as TParams };
    const effectiveTimeoutMs = timeoutMs ?? Number(process.env.OMK_WIRE_TIMEOUT_MS || "120000");
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<JSONRPCResponse>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Wire RPC timeout: ${method} (id: ${id}, timeout: ${effectiveTimeoutMs}ms)`));
      }, effectiveTimeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
    });
    if (signal?.aborted) {
      this.pending.delete(id);
      clearTimeout(timer);
      throw new Error(`Wire RPC aborted: ${method} (id: ${id})`);
    }
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
    const res = await (signal
      ? Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            const onAbort = () => {
              this.pending.delete(id);
              clearTimeout(timer);
              reject(new Error(`Wire RPC aborted: ${method} (id: ${id})`));
            };
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }),
        ])
      : promise);
    if ("error" in res && res.error) throw new Error(res.error.message);
    return (res as { result?: unknown }).result as TResult;
  }

  // ─── Server message dispatch ─────────────────────────────────

  private handleServerMessage(msg: JSONRPCRequest<string, unknown>): void {
    // event notification (no id, or we treat it as notification)
    if (msg.method === "event") {
      const params = msg.params as { type: string; payload: object } | undefined;
      if (!params) return;
      this.dispatchEvent(params.type, params.payload);
      return;
    }

    // request from agent (requires response)
    if (msg.method === "request") {
      const params = msg.params as { type: string; payload: object } | undefined;
      if (!params) return;
      this.dispatchRequest(msg.id, params.type, params.payload);
      return;
    }

    // Legacy: direct "status" method (pre-v1.7 servers may send this)
    if (msg.method === "status") {
      const p = msg.params as Record<string, unknown>;
      const statusUpdate: StatusUpdate = {
        context_usage: typeof p.context_usage === "number" ? p.context_usage : null,
        context_tokens: typeof p.context_tokens === "number" ? p.context_tokens : null,
        max_context_tokens: typeof p.max_context_tokens === "number" ? p.max_context_tokens : null,
        token_usage:
          typeof p.token_usage === "object" && p.token_usage !== null
            ? (p.token_usage as TokenUsage)
            : null,
        message_id: typeof p.message_id === "string" ? p.message_id : null,
        plan_mode: typeof p.plan_mode === "boolean" ? p.plan_mode : null,
      };
      this.emitEvent({ type: "StatusUpdate", payload: statusUpdate });
      // Also emit legacy status event
      this.emitLegacyEvent({
        type: "status",
        contextUsage: Number(p.context_usage ?? p.context_usage ?? 0),
        maxContextTokens: Number(p.max_context_tokens ?? 256000),
        tokenUsage: Number(p.token_usage ? (p.token_usage as TokenUsage).output : 0),
        planMode: Boolean(p.plan_mode ?? false),
      });
      return;
    }
  }

  private dispatchEvent(eventType: string, payload: object): void {
    switch (eventType) {
      case "TurnBegin": {
        const p = payload as TurnBegin;
        this.emitEvent({ type: "TurnBegin", payload: p });
        break;
      }
      case "TurnEnd": {
        this.emitEvent({ type: "TurnEnd" });
        break;
      }
      case "StepBegin": {
        const p = payload as StepBegin;
        this.emitEvent({ type: "StepBegin", payload: p });
        break;
      }
      case "StepInterrupted": {
        this.emitEvent({ type: "StepInterrupted" });
        break;
      }
      case "CompactionBegin": {
        this.emitEvent({ type: "CompactionBegin" });
        break;
      }
      case "CompactionEnd": {
        this.emitEvent({ type: "CompactionEnd" });
        break;
      }
      case "StatusUpdate": {
        const p = payload as StatusUpdate;
        this.emitEvent({ type: "StatusUpdate", payload: p });
        // Legacy emit
        this.emitLegacyEvent({
          type: "status",
          contextUsage: p.context_usage ?? 0,
          maxContextTokens: p.max_context_tokens ?? 256000,
          tokenUsage: p.token_usage?.output ?? 0,
          planMode: p.plan_mode ?? false,
        });
        break;
      }
      case "ContentPart": {
        const part = payload as ContentPart;
        this.emitEvent({ type: "ContentPart", payload: part });
        if (part.type === "text") {
          this.emitLegacyEvent({ type: "message", role: "assistant", content: part.text });
        }
        break;
      }
      case "ToolCall": {
        const p = payload as ToolCallEvent;
        this.emitEvent({ type: "ToolCall", payload: p });
        this.emitLegacyEvent({ type: "tool_use", name: p.function.name, input: p.function.arguments });
        break;
      }
      case "ToolCallPart": {
        this.emitEvent({ type: "ToolCallPart", payload: payload as ToolCallPart });
        break;
      }
      case "ToolResult": {
        const p = payload as ToolResultEvent;
        this.emitEvent({ type: "ToolResult", payload: p });
        this.emitLegacyEvent({
          type: "tool_result",
          name: p.tool_call_id,
          output: p.return_value.output,
        });
        break;
      }
      case "ApprovalResponse": {
        this.emitEvent({ type: "ApprovalResponse", payload: payload as ApprovalResponseEvent });
        break;
      }
      case "SubagentEvent": {
        this.emitEvent({ type: "SubagentEvent", payload: payload as SubagentEvent });
        break;
      }
      case "SteerInput": {
        this.emitEvent({ type: "SteerInput", payload: payload as SteerInput });
        break;
      }
      case "PlanDisplay": {
        this.emitEvent({ type: "PlanDisplay", payload: payload as PlanDisplay });
        break;
      }
      case "HookTriggered": {
        this.emitEvent({ type: "HookTriggered", payload: payload as HookTriggered });
        break;
      }
      case "HookResolved": {
        this.emitEvent({ type: "HookResolved", payload: payload as HookResolved });
        break;
      }
      default: {
        // Unknown event type — ignore or log
        break;
      }
    }
  }

  private dispatchRequest(rpcId: string, requestType: string, payload: object): void {
    let responded = false;
    const respond = (result: unknown): void => {
      if (responded) return;
      responded = true;
      const res = { jsonrpc: "2.0" as const, id: rpcId, result };
      this.proc?.stdin?.write(JSON.stringify(res) + "\n");
    };
    const reject = (error: { code: number; message: string }): void => {
      if (responded) return;
      responded = true;
      const res = { jsonrpc: "2.0" as const, id: rpcId, error };
      this.proc?.stdin?.write(JSON.stringify(res) + "\n");
    };

    switch (requestType) {
      case "ApprovalRequest": {
        const req = payload as ApprovalRequest;
        const wireReq: WireRequest = { type: "ApprovalRequest", payload: req };
        if (this.approvalHandlers.length > 0) {
          for (const h of this.approvalHandlers) {
            try {
              h(req, respond, reject);
            } catch {
              // handler error
            }
          }
        } else {
          for (const h of this.genericRequestHandlers) {
            try {
              h(wireReq, respond, reject);
            } catch {
              // handler error
            }
          }
        }
        // Also emit legacy request event
        this.emitLegacyEvent({ type: "request", method: requestType, params: payload, respond, reject });
        break;
      }
      case "ToolCallRequest": {
        const req = payload as ToolCallRequest;
        const wireReq: WireRequest = { type: "ToolCallRequest", payload: req };
        if (this.toolCallHandlers.length > 0) {
          for (const h of this.toolCallHandlers) {
            try {
              h(req, respond, reject);
            } catch {
              // handler error
            }
          }
        } else {
          for (const h of this.genericRequestHandlers) {
            try {
              h(wireReq, respond, reject);
            } catch {
              // handler error
            }
          }
        }
        this.emitLegacyEvent({ type: "request", method: requestType, params: payload, respond, reject });
        break;
      }
      case "QuestionRequest": {
        const req = payload as QuestionRequest;
        const wireReq: WireRequest = { type: "QuestionRequest", payload: req };
        if (this.questionHandlers.length > 0) {
          for (const h of this.questionHandlers) {
            try {
              h(req, respond, reject);
            } catch {
              // handler error
            }
          }
        } else {
          for (const h of this.genericRequestHandlers) {
            try {
              h(wireReq, respond, reject);
            } catch {
              // handler error
            }
          }
        }
        this.emitLegacyEvent({ type: "request", method: requestType, params: payload, respond, reject });
        break;
      }
      case "HookRequest": {
        const req = payload as HookRequest;
        const wireReq: WireRequest = { type: "HookRequest", payload: req };
        if (this.hookHandlers.length > 0) {
          for (const h of this.hookHandlers) {
            try {
              h(req, respond, reject);
            } catch {
              // handler error
            }
          }
        } else {
          for (const h of this.genericRequestHandlers) {
            try {
              h(wireReq, respond, reject);
            } catch {
              // handler error
            }
          }
        }
        this.emitLegacyEvent({ type: "request", method: requestType, params: payload, respond, reject });
        break;
      }
      default: {
        const wireReq: WireRequest = { type: requestType as never, payload: payload as never };
        for (const h of this.genericRequestHandlers) {
          try {
            h(wireReq, respond, reject);
          } catch {
            // handler error
          }
        }
        this.emitLegacyEvent({ type: "request", method: requestType, params: payload, respond, reject });
      }
    }
  }

  // ─── Public RPC methods ──────────────────────────────────────

  async prompt(userInput: string | ContentPart[]): Promise<PromptResult> {
    return this.call<PromptParams, PromptResult>("prompt", { user_input: userInput });
  }

  async steer(userInput: string | ContentPart[]): Promise<SteerResult> {
    return this.call<SteerParams, SteerResult>("steer", { user_input: userInput });
  }

  async cancel(): Promise<CancelResult> {
    return this.call<CancelParams, CancelResult>("cancel", {});
  }

  async replay(): Promise<ReplayResult> {
    return this.call<ReplayParams, ReplayResult>("replay", {});
  }

  async setPlanMode(enabled: boolean): Promise<SetPlanModeResult> {
    return this.call<SetPlanModeParams, SetPlanModeResult>("set_plan_mode", { enabled });
  }

  // ─── Shutdown ────────────────────────────────────────────────

  async stop(): Promise<void> {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`Wire client stopped before response to request ${id}`));
    }
    this.pending.clear();
    this.proc?.removeAllListeners();
    this.proc?.stderr?.removeAllListeners("data");
    this.rl?.removeAllListeners();
    this.eventHandlers = [];
    this.legacyEventHandlers = [];
    this.approvalHandlers = [];
    this.toolCallHandlers = [];
    this.questionHandlers = [];
    this.hookHandlers = [];
    this.genericRequestHandlers = [];
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    if (this.proc) {
      const proc = this.proc;
      this.proc = undefined;
      await terminateProcessTree(wireProcTarget(proc), { graceMs: 1000, waitMs: 5000 });
    }
  }
}

// ─── Backward-compat type exports ──────────────────────────────

/** @deprecated Use PromptResult instead */
export type KimiPromptResult = PromptResult;

/** @deprecated Use InitializeParams instead */
export type KimiInitializeParams = InitializeParams;

// Re-export all wire protocol types for convenience
export * from "./wire-protocol-types.js";

// ─── Task runner factory ───────────────────────────────────────

export function createKimiTaskRunner(client: KimiWireClient): TaskRunner {
  return {
    async run(node: DagNode, _env: Record<string, string>): Promise<TaskResult> {
      const resources = await getOmkResourceSettings();
      const prompt = `[${node.role}] ${node.name}`;
      const stdout = new CappedOutputBuffer(resources.wireOutputBytes, "wire stdout");
      const stderr = new CappedOutputBuffer(resources.wireOutputBytes, "wire stderr");

      const offEvent = client.onEvent((event) => {
        switch (event.type) {
          case "ContentPart": {
            if (event.payload.type === "text") {
              stdout.append(`${event.payload.text}\n`);
            }
            break;
          }
          case "ToolResult": {
            const output = event.payload.return_value.output;
            const text = typeof output === "string" ? output : JSON.stringify(output);
            stdout.append(`${text}\n`);
            break;
          }
        }
      });

      const offLegacy = client.onLegacyEvent((event) => {
        if (event.type === "error") stderr.append(`${event.message}\n`);
      });

      try {
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
        offLegacy();
      }
    },
  };
}
