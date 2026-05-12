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
  startupTimeoutMs?: number;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── MCP Client Session ─────────────────────────────────────────────────────

export class McpClientSession {
  private config: McpServerConfig;
  private transport: Transport | null = null;
  private requestIdCounter = 0;
  private pendingRequests = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initialized = false;
  private notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private closed = false;

  serverInfo: { name: string; version: string } | undefined;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  private async createTransport(): Promise<Transport> {
    const config = this.config;
    if (config.url) {
      const { StreamableHttpTransport } = await import("./transports/streamable-http.js");
      return new StreamableHttpTransport(config.url, config.headers ?? {});
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
    await this.transport.connect();

    // Start listening for incoming messages
    this.transport.onMessage((raw) => this.handleIncoming(raw));
    this.transport.onNotification((method, params) => this.handleNotification(method, params));
    this.transport.onError((err) => this.handleTransportError(err));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.initialized = false;
    // Resolve all pending requests with a close error
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error("Session closed"));
    }
    this.pendingRequests.clear();
    await this.transport?.close?.();
  }

  private handleTransportError(err: Error): void {
    // Reject all pending requests
    for (const [, { reject }] of this.pendingRequests) {
      reject(err);
    }
    this.pendingRequests.clear();
  }

  // ── Message handling ──────────────────────────────────────────────────

  private handleIncoming(raw: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed messages
    }

    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message ?? `JSON-RPC error ${msg.error.code}`));
      } else {
        resolve(msg.result);
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

  private sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Session is closed"));

    const id = ++this.requestIdCounter;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.transport!.send(JSON.stringify(payload) + "\n").catch((err) => {
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (this.closed) return;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id: 0, method, params };
    this.transport!.send(JSON.stringify(payload) + "\n").catch(() => {});
  }

  // ── MCP protocol methods ──────────────────────────────────────────────

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    const result = (await this.sendRequest("initialize", params)) as InitializeResult;
    this.initialized = true;
    this.serverInfo = result.serverInfo;

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});

    return result;
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