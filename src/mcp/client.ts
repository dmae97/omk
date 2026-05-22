// ─── MCP Client Session ─────────────────────────────────────────────────────
// Per-server MCP client that handles the JSON-RPC 2.0 protocol over
// a pluggable transport (stdio or streamable-http).

import type { Transport } from "./transports/transport.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InitializeParams {
  protocolVersion: string;
  capabilities: {
    tools?: object;
    resources?: object;
    prompts?: object;
    sampling?: object;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: object;
    resources?: { listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    sampling?: object;
  };
  serverInfo?: {
    name: string;
    version: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasValidServerInfo(result: unknown): result is InitializeResult & { serverInfo: { name: string; version: string } } {
  if (!isRecord(result) || !isRecord(result.serverInfo)) return false;
  return typeof result.serverInfo.name === "string" && result.serverInfo.name.trim().length > 0
    && typeof result.serverInfo.version === "string" && result.serverInfo.version.trim().length > 0;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "streamable-http" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  http_headers?: Record<string, string>;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timeout: NodeJS.Timeout;
  abort: () => void;
  createdAt: number;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ─── MCP Client Session ─────────────────────────────────────────────────────

export class McpClientSession {
  private config: McpServerConfig;
  private transport: Transport | null = null;
  private requestIdCounter = 0;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private initialized = false;
  private notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private closed = false;
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private malformedMessageCount = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private static readonly MAX_MALFORMED_MESSAGES = 3;
  private static readonly CLOSE_TIMEOUT_MS = 10_000;

  serverInfo: { name: string; version: string } | undefined;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.startupTimeoutMs = normalizeTimeoutMs(config.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
    this.requestTimeoutMs = normalizeTimeoutMs(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  private async createTransport(): Promise<Transport> {
    const config = this.config;
    if (config.url) {
      const { StreamableHttpTransport } = await import("./transports/streamable-http.js");
      return new StreamableHttpTransport(config.url, {
        ...(config.http_headers ?? {}),
        ...(config.headers ?? {}),
      });
    }
    if (config.command) {
      const { StdioTransport } = await import("./transports/stdio.js");
      return new StdioTransport(config.command, config.args ?? [], config.env ?? {});
    }
    throw new Error(`Cannot create transport for server ${config.name}: no url or command specified`);
  }

  // ── Connection lifecycle ──────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.initialized) return;

    this.transport = await this.createTransport();
    try {
      await withTimeout(
        this.transport.connect(),
        this.startupTimeoutMs,
        `MCP transport connect timed out after ${this.startupTimeoutMs}ms`
      );
    } catch (err) {
      await this.transport.close?.().catch(() => {});
      this.transport = null;
      throw err;
    }

    // Start listening for incoming messages
    this.transport.onMessage((raw) => this.handleIncoming(raw));
    this.transport.onNotification((method, params) => this.handleNotification(method, params));
    this.transport.onError((err) => this.handleTransportError(err));

    this.startCleanupTimer();
  }

  get transportPid(): number | undefined {
    return this.transport?.pid;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.initialized = false;
    this.rejectAllPending(new Error("Session closed"));
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.transport) {
      await withTimeout(
        Promise.resolve(this.transport.close?.()),
        McpClientSession.CLOSE_TIMEOUT_MS,
        `MCP transport close timed out after ${McpClientSession.CLOSE_TIMEOUT_MS}ms`
      ).catch(() => {});
    }
    this.transport = null;
  }

  private handleTransportError(err: Error): void {
    this.rejectAllPending(err);
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.abort();
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  private rejectPendingRequest(id: string | number, err: Error): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.abort();
    this.pendingRequests.delete(id);
    pending.reject(err);
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      if (this.pendingRequests.size === 0) return;
      if (this.closed || !this.transport) {
        this.rejectAllPending(new Error("MCP session no longer active"));
        return;
      }
      const now = Date.now();
      for (const [id, pending] of this.pendingRequests) {
        if (now - pending.createdAt > this.requestTimeoutMs) {
          this.rejectPendingRequest(id, new Error(`MCP request stale: ${id}`));
        }
      }
    }, 30_000);
    this.cleanupTimer.unref?.();
  }

  // ── Message handling ──────────────────────────────────────────────────

  private handleIncoming(raw: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(raw);
      this.malformedMessageCount = 0;
    } catch {
      this.malformedMessageCount++;
      if (this.malformedMessageCount > McpClientSession.MAX_MALFORMED_MESSAGES) {
        this.rejectAllPending(new Error("MCP server sent too many malformed JSON messages"));
        this.malformedMessageCount = 0;
      }
      return;
    }

    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      clearTimeout(pending.timeout);
      pending.abort();
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(msg.error.message ?? `JSON-RPC error ${msg.error.code}`));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const handlers = this.notificationHandlers.get(method);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(params);
        } catch {
          // ignore handler errors
        }
      }
    }
  }

  // ── JSON-RPC request/response ─────────────────────────────────────────

  private sendRequest(
    method: string,
    params?: unknown,
    timeoutMs = this.requestTimeoutMs,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Session is closed"));
    if (!this.transport) return Promise.reject(new Error("Session is not connected"));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted"));
    const transport = this.transport;

    const id = ++this.requestIdCounter;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.rejectPendingRequest(id, signal!.reason ?? new Error("Request aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        this.rejectPendingRequest(id, new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject: (e: Error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
        timeout,
        abort: () => {
          controller.abort();
          signal?.removeEventListener("abort", onAbort);
        },
        createdAt: Date.now(),
      });

      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

      const sendTimeoutMs = timeoutMs;
      withTimeout(
        transport.send(JSON.stringify(payload) + "\n", { signal: controller.signal, timeoutMs }),
        sendTimeoutMs,
        `MCP transport send timed out after ${sendTimeoutMs}ms: ${method}`
      ).catch((err) => {
        controller.abort();
        this.rejectPendingRequest(id, err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (this.closed || !this.transport) return;
    const payload: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    const timeoutMs = Math.min(this.requestTimeoutMs, 30_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    this.transport.send(JSON.stringify(payload) + "\n", {
      signal: controller.signal,
      timeoutMs,
    }).catch(() => {}).finally(() => clearTimeout(timeout));
  }

  // ── MCP protocol methods ──────────────────────────────────────────────

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    try {
      const result = (await this.sendRequest("initialize", params, this.startupTimeoutMs)) as InitializeResult;
      if (!hasValidServerInfo(result)) {
        throw new Error("MCP initialize response missing serverInfo.name/version");
      }
      this.initialized = true;
      this.serverInfo = result.serverInfo;

      // Send initialized notification
      this.sendNotification("notifications/initialized", {});

      return result;
    } catch (err) {
      await this.close().catch(() => {});
      throw err;
    }
  }

  async listTools(): Promise<{ tools: McpTool[] }> {
    return (await this.sendRequest("tools/list", {})) as { tools: McpTool[] };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest("tools/call", { name, arguments: args });
  }

  async listResources(): Promise<{ resources: McpResource[] }> {
    return (await this.sendRequest("resources/list", {})) as { resources: McpResource[] };
  }

  async readResource(uri: string): Promise<unknown> {
    return this.sendRequest("resources/read", { uri });
  }

  async listPrompts(): Promise<{ prompts: McpPrompt[] }> {
    return (await this.sendRequest("prompts/list", {})) as { prompts: McpPrompt[] };
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    return this.sendRequest("prompts/get", { name, arguments: args });
  }

  // ── Notification subscriptions ────────────────────────────────────────

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, new Set());
    }
    const handlers = this.notificationHandlers.get(method)!;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }
}
