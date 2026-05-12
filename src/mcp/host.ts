#!/usr/bin/env node
// ─── MCP Host ───────────────────────────────────────────────────────────────
// OMK Protocol Gateway — P0: MCP Host
//
// OMK currently acts as an MCP Server provider. This module adds the MCP Host
// role: coordinating multiple MCP server connections, aggregating capabilities,
// managing client sessions, and providing a unified interface to the
// orchestration layer.
//
// MCP Host pattern:
//   - Server Registry: track registered MCP servers and their capabilities
//   - Client Sessions: one McpClientSession per connected server
//   - Capability Aggregation: merge tools/resources/prompts from all servers
//   - Routing: dispatch tool calls to the correct server
//   - Permission Layer: consent and access control per server

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import { McpClientSession } from "./client.js";
import { getOmkVersionSync } from "../util/version.js";
import { ToolGovernor, type ToolGovernancePolicy, type GovernedToolResult, type AuditRecord } from "./governance.js";
import { UnifiedPermissionResolver } from "./permission-resolver.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "omk-mcp-host";

// ─── Types ──────────────────────────────────────────────────────────────────

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

export interface McpServerInfo {
  name: string;
  transport: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    sampling?: boolean;
  };
  serverInfo?: {
    name: string;
    version: string;
  };
  connected: boolean;
  error?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  _serverName?: string; // internal: track which server provides this tool
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
  _serverName?: string;
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
  _serverName?: string;
}

interface ServerSession {
  id: string;
  config: McpServerConfig;
  client: McpClientSession;
  connectedAt: string;
  lastHeartbeat: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    sampling?: boolean;
  };
}

interface PermissionPolicy {
  allowServers: string[] | null; // null = allow all
  denyServers: string[];
  requireConsentFor: string[]; // methods requiring explicit consent
  maxToolCallDepth: number;
  toolAllowPatterns?: string[] | null; // null = allow all tools
  toolDenyPatterns?: string[];
  governance?: Partial<ToolGovernancePolicy>;
  }

// ─── JSON-RPC helpers ───────────────────────────────────────────────────────

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const MCP_HOST_ERROR = -32000;

function sendResponse(res: JsonRpcResponse): void {
  const data = JSON.stringify(res) + "\n";
  try {
    process.stdout.write(data);
  } catch {
    // stdout unavailable
  }
}

function sendError(id: string | number, code: number, message: string, data?: unknown): void {
  sendResponse({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

function sendResult(id: string | number, result: unknown): void {
  sendResponse({ jsonrpc: "2.0", id, result });
}

function sendNotification(method: string, params: unknown): void {
  const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
  try {
    process.stdout.write(payload + "\n");
  } catch {
    // stdout unavailable
  }
}

// ─── MCP Host ───────────────────────────────────────────────────────────────

export class McpHost extends EventEmitter {
  private servers = new Map<string, ServerSession>();
  private aggregatedTools: McpTool[] = [];
  private aggregatedResources: McpResource[] = [];
  private aggregatedPrompts: McpPrompt[] = [];
  private permissionPolicy: PermissionPolicy;
  private initialized = false;
  private toolGovernor: ToolGovernor;
  private permissionResolver: UnifiedPermissionResolver;
  private auditSalt: string;

  constructor(permissionPolicy?: Partial<PermissionPolicy>) {
    super();
    this.permissionPolicy = {
      allowServers: null,
      denyServers: [],
      requireConsentFor: [],
      maxToolCallDepth: 3,
      ...permissionPolicy,
    };
    this.auditSalt = randomUUID();
    this.toolGovernor = new ToolGovernor({
      allowTools: permissionPolicy?.toolAllowPatterns ?? null,
      denyTools: permissionPolicy?.toolDenyPatterns ?? [],
      ...permissionPolicy?.governance,
    });
    this.permissionResolver = new UnifiedPermissionResolver([], {
      enableConsent: permissionPolicy?.requireConsentFor?.length ? true : false,
    });

    // Forward governance audit events
    this.toolGovernor.on("audit:entry", (record: AuditRecord) => {
      this.emit("governance:audit", record);
    });
    this.toolGovernor.on("policy:updated", (policy: unknown) => {
      this.emit("governance:policyUpdated", policy);
    });
  }

  // ── Server Management ──────────────────────────────────────────────────

  /**
   * Register a new MCP server definition. Does not connect immediately.
   * Call connectServer() to establish the connection.
   */
  registerServer(config: McpServerConfig): string {
    if (this.servers.has(config.name)) {
      throw new Error(`Server already registered: ${config.name}`);
    }

    // Validate transport
    if (!config.transport && !config.command && !config.url) {
      throw new Error(`Server ${config.name}: must specify transport, command, or url`);
    }

    const sessionId = randomUUID();
    const session: ServerSession = {
      id: sessionId,
      config,
      client: new McpClientSession(config),
      connectedAt: "",
      lastHeartbeat: "",
      capabilities: {},
    };

    this.servers.set(config.name, session);
    this.emit("server:registered", { name: config.name, sessionId });
    return sessionId;
  }

  /**
   * Connect to a registered server and perform the MCP initialize handshake.
   */
  async connectServer(name: string): Promise<McpServerInfo> {
    const session = this.servers.get(name);
    if (!session) throw new Error(`Server not registered: ${name}`);
    if (session.connectedAt) return this.getServerInfo(name);

    try {
      await session.client.connect();

      const initResult = await session.client.initialize({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        clientInfo: {
          name: SERVER_NAME,
          version: getOmkVersionSync(),
        },
      });

      session.connectedAt = new Date().toISOString();
      session.lastHeartbeat = session.connectedAt;
      session.capabilities = {
        tools: !!initResult.capabilities?.tools,
        resources: !!initResult.capabilities?.resources,
        prompts: !!initResult.capabilities?.prompts,
        sampling: !!initResult.capabilities?.sampling,
      };
      session.client.serverInfo = initResult.serverInfo;

      this.aggregateCapabilities();
      this.emit("server:connected", { name, capabilities: session.capabilities });

      return this.getServerInfo(name);
    } catch (err) {
      session.capabilities = {};
      this.emit("server:error", { name, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /**
   * Connect all registered servers in parallel.
   */
  async connectAll(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
    const results = await Promise.allSettled(
      Array.from(this.servers.keys()).map(async (name) => {
        try {
          await this.connectServer(name);
          return { name, ok: true };
        } catch (err) {
          return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
    return results.map((r) => (r.status === "fulfilled" ? r.value : { name: r.reason?.name ?? "unknown", ok: false, error: String(r.reason) }));
  }

  /**
   * Disconnect and remove a server.
   */
  async removeServer(name: string): Promise<void> {
    const session = this.servers.get(name);
    if (session) {
      await session.client.close().catch(() => {});
      this.servers.delete(name);
      this.aggregateCapabilities();
      this.emit("server:removed", { name });
    }
  }

  /**
   * List all registered servers.
   */
  listServers(): McpServerInfo[] {
    return Array.from(this.servers.entries()).map(([name]) => this.getServerInfo(name));
  }

  getServerInfo(name: string): McpServerInfo {
    const session = this.servers.get(name);
    if (!session) throw new Error(`Server not found: ${name}`);
    return {
      name,
      transport: session.config.transport || (session.config.command ? "stdio" : "http"),
      capabilities: { ...session.capabilities },
      serverInfo: session.client.serverInfo,
      connected: !!session.connectedAt,
      error: undefined,
    };
  }

  // ── Capability Aggregation ─────────────────────────────────────────────

  private aggregateCapabilities(): void {
    this.aggregatedTools = [];
    this.aggregatedResources = [];
    this.aggregatedPrompts = [];

    for (const session of this.servers.values()) {
      if (!session.connectedAt) continue;

      // Tools
      if (session.capabilities.tools) {
        // Tools are fetched lazily on first listTools call
      }

      // Resources
      if (session.capabilities.resources) {
        // Resources are fetched lazily on first listResources call
      }

      // Prompts
      if (session.capabilities.prompts) {
        // Prompts are fetched lazily on first listPrompts call
      }
    }
  }

  // ── Tool Operations ────────────────────────────────────────────────────

  async listTools(): Promise<{ tools: McpTool[] }> {
    const tools: McpTool[] = [];

    for (const [name, session] of this.servers) {
      if (!session.connectedAt || !session.capabilities.tools) continue;
      try {
        const result = await session.client.listTools();
        for (const tool of result.tools) {
          tools.push({ ...tool, _serverName: name });
        }
      } catch (err) {
        this.emit("server:error", { name, error: `listTools failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return { tools };
  }

  async callTool(name: string, args: Record<string, unknown>, serverHint?: string): Promise<unknown> {
    // Find which server provides this tool
    let targetServer = serverHint;

    if (!targetServer) {
      // Search all servers for the tool
      for (const [srvName, session] of this.servers) {
        if (!session.connectedAt || !session.capabilities.tools) continue;
        try {
          const { tools } = await session.client.listTools();
          if (tools.some((t) => t.name === name)) {
            targetServer = srvName;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!targetServer) {
      throw new Error(`Tool not found on any connected server: ${name}`);
    }

    // Permission check
    if (!this.checkPermission(targetServer, "tools/call")) {
      throw new Error(`Permission denied: tools/call on server "${targetServer}"`);
    }

    const session = this.servers.get(targetServer)!;
    return session.client.callTool(name, args);
  }

  /**
   * Governed tool call with full governance pipeline:
   * permission check → raw call → secret redaction → compression → audit
   */
  async governedCallTool(
    name: string,
    args: Record<string, unknown>,
    serverHint?: string,
  ): Promise<GovernedToolResult> {
    // Tool-level permission check
    const toolPerm = this.toolGovernor.checkToolPermission(name);
    if (!toolPerm.allowed) {
      throw new Error(`Tool governance denied: ${toolPerm.reason}`);
    }

    // Bypass governance for trusted tools
    if (this.toolGovernor.shouldBypassGovernance(name)) {
      const raw = await this.callTool(name, args, serverHint);
      return this.toolGovernor.govern(name, serverHint ?? "unknown", args, raw, 0);
    }

    // Find target server (same logic as callTool)
    let targetServer = serverHint;
    if (!targetServer) {
      for (const [srvName, session] of this.servers) {
        if (!session.connectedAt || !session.capabilities.tools) continue;
        try {
          const { tools } = await session.client.listTools();
          if (tools.some((t) => t.name === name)) {
            targetServer = srvName;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!targetServer) {
      throw new Error(`Tool not found on any connected server: ${name}`);
    }

    // Server-level + tool-level permission check (unified resolver)
    if (!(await this.checkPermission(targetServer, "tools/call", name, args))) {
      throw new Error(`Permission denied: tools/call on server "${targetServer}"`);
    }

    const startTime = Date.now();
    const session = this.servers.get(targetServer)!;
    const rawResult = await session.client.callTool(name, args);
    const durationMs = Date.now() - startTime;

    // Run through governance pipeline
    return this.toolGovernor.govern(name, targetServer, args, rawResult, durationMs);
  }

  /** Get the tool governor instance */
  getToolGovernor(): ToolGovernor {
    return this.toolGovernor;
  }

  /** Get the audit logger */
  getAuditLog(): AuditRecord[] {
    return this.toolGovernor.getAuditLogger().getAll();
  }

  /** Get audit log for a specific tool */
  getAuditLogForTool(toolName: string): AuditRecord[] {
    return this.toolGovernor.getAuditLogger().getByTool(toolName);
  }

  /** Get audit log for a specific server */
  getAuditLogForServer(serverName: string): AuditRecord[] {
    return this.toolGovernor.getAuditLogger().getByServer(serverName);
  }

  /** Get error audit records */
  getAuditErrors(): AuditRecord[] {
    return this.toolGovernor.getAuditLogger().getErrors();
  }

  /** Update governance policy at runtime */
  updateGovernancePolicy(update: Partial<ToolGovernancePolicy>): void {
    this.toolGovernor.updatePolicy(update);
  }

  // ── Resource Operations ────────────────────────────────────────────────

  async listResources(): Promise<{ resources: McpResource[] }> {
    const resources: McpResource[] = [];

    for (const [name, session] of this.servers) {
      if (!session.connectedAt || !session.capabilities.resources) continue;
      try {
        const result = await session.client.listResources();
        for (const resource of result.resources) {
          resources.push({ ...resource, _serverName: name });
        }
      } catch (err) {
        this.emit("server:error", { name, error: `listResources failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return { resources };
  }

  async readResource(uri: string, serverHint?: string): Promise<unknown> {
    let targetServer = serverHint;

    if (!targetServer) {
      for (const [srvName, session] of this.servers) {
        if (!session.connectedAt || !session.capabilities.resources) continue;
        try {
          const { resources } = await session.client.listResources();
          if (resources.some((r) => r.uri === uri)) {
            targetServer = srvName;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!targetServer) {
      throw new Error(`Resource not found on any connected server: ${uri}`);
    }

    if (!this.checkPermission(targetServer, "resources/read")) {
      throw new Error(`Permission denied: resources/read on server "${targetServer}"`);
    }

    const session = this.servers.get(targetServer)!;
    return session.client.readResource(uri);
  }

  // ── Prompt Operations ──────────────────────────────────────────────────

  async listPrompts(): Promise<{ prompts: McpPrompt[] }> {
    const prompts: McpPrompt[] = [];

    for (const [name, session] of this.servers) {
      if (!session.connectedAt || !session.capabilities.prompts) continue;
      try {
        const result = await session.client.listPrompts();
        for (const prompt of result.prompts) {
          prompts.push({ ...prompt, _serverName: name });
        }
      } catch (err) {
        this.emit("server:error", { name, error: `listPrompts failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return { prompts };
  }

  async getPrompt(name: string, args?: Record<string, string>, serverHint?: string): Promise<unknown> {
    let targetServer = serverHint;

    if (!targetServer) {
      for (const [srvName, session] of this.servers) {
        if (!session.connectedAt || !session.capabilities.prompts) continue;
        try {
          const { prompts } = await session.client.listPrompts();
          if (prompts.some((p) => p.name === name)) {
            targetServer = srvName;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!targetServer) {
      throw new Error(`Prompt not found on any connected server: ${name}`);
    }

    if (!this.checkPermission(targetServer, "prompts/get")) {
      throw new Error(`Permission denied: prompts/get on server "${targetServer}"`);
    }

    const session = this.servers.get(targetServer)!;
    return session.client.getPrompt(name, args);
  }

  // ── Permission & Consent ───────────────────────────────────────────────

  private async checkPermission(serverName: string, method: string, toolName?: string, args?: Record<string, unknown>): Promise<boolean> {
    if (this.permissionPolicy.denyServers.includes(serverName)) return false;
    if (this.permissionPolicy.allowServers && !this.permissionPolicy.allowServers.includes(serverName)) return false;

    // Use unified resolver for tool-level consent
    if (toolName) {
      const resolution = await this.permissionResolver.resolvePermission(toolName, serverName, args);
      return resolution.level === 'allow';
    }

    return true;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    for (const [name, session] of this.servers) {
      await session.client.close().catch((err) => {
        this.emit("server:error", { name, error: `close failed: ${err instanceof Error ? err.message : String(err)}` });
      });
    }
    this.servers.clear();
    this.aggregatedTools = [];
    this.aggregatedResources = [];
    this.aggregatedPrompts = [];
  }
}

// ─── Standalone host instance for CLI usage ─────────────────────────────────

let hostInstance: McpHost | null = null;

export function getOrCreateHost(): McpHost {
  if (!hostInstance) {
    hostInstance = new McpHost();
  }
  return hostInstance;
}

export function resetHost(): void {
  if (hostInstance) {
    hostInstance.close().catch(() => {});
    hostInstance = null;
  }
}

// ─── Main (stdio mode) ──────────────────────────────────────────────────────

process.stdout.on("error", (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END") {
    return;
  }
  throw err;
});

async function main(): Promise<void> {
  try {
    const stdoutWithHandle = process.stdout as NodeJS.WriteStream & {
      _handle?: { setBlocking?: (blocking: boolean) => void };
    };
    stdoutWithHandle._handle?.setBlocking?.(true);
  } catch {
    // ignore
  }

  const host = getOrCreateHost();

  host.on("server:registered", (info) => {
    sendNotification("mcpHost/serverRegistered", info);
  });
  host.on("server:connected", (info) => {
    sendNotification("mcpHost/serverConnected", info);
  });
  host.on("server:error", (info) => {
    sendNotification("mcpHost/serverError", info);
  });
  host.on("server:removed", (info) => {
    sendNotification("mcpHost/serverRemoved", info);
  });
  host.on("governance:audit", (record) => {
    sendNotification("mcpHost/governance/audit", record);
  });
  host.on("governance:policyUpdated", (policy) => {
    sendNotification("mcpHost/governance/policyUpdated", policy);
  });

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpcRequest | undefined;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      continue;
    }
    if (req.jsonrpc !== "2.0") continue;
    try {
      await handleHostRequest(req, host);
    } catch (err) {
      sendError(req.id ?? null, MCP_HOST_ERROR, err instanceof Error ? err.message : String(err));
    }
  }

  await host.close();

  try {
    process.stdout.end?.();
  } catch {
    // ignore
  }
}

async function handleHostRequest(req: JsonRpcRequest, host: McpHost): Promise<void> {
  switch (req.method) {
    case "initialize": {
      sendResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          serverRegistry: {},
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: getOmkVersionSync(),
        },
      });
      return;
    }

    case "notifications/initialized":
      return;

    // ── Server Registry ──

    case "mcpHost/server/register": {
      const params = req.params as { server: McpServerConfig } | undefined;
      if (!params?.server) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing server config");
        return;
      }
      const sessionId = host.registerServer(params.server);
      sendResult(req.id, { sessionId });
      return;
    }

    case "mcpHost/server/connect": {
      const params = req.params as { name: string } | undefined;
      if (!params?.name) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing server name");
        return;
      }
      const info = await host.connectServer(params.name);
      sendResult(req.id, info);
      return;
    }

    case "mcpHost/server/connectAll": {
      const results = await host.connectAll();
      sendResult(req.id, { results });
      return;
    }

    case "mcpHost/server/remove": {
      const params = req.params as { name: string } | undefined;
      if (!params?.name) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing server name");
        return;
      }
      await host.removeServer(params.name);
      sendResult(req.id, { success: true });
      return;
    }

    case "mcpHost/server/list": {
      const servers = host.listServers();
      sendResult(req.id, { servers });
      return;
    }

    // ── Aggregated Tools ──

    case "tools/list": {
      const result = await host.listTools();
      sendResult(req.id, result);
      return;
    }

    case "tools/call": {
      const params = req.params as { name: string; arguments?: Record<string, unknown>; _serverHint?: string } | undefined;
      if (!params?.name) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing tool name");
        return;
      }
      const result = await host.callTool(params.name, params.arguments ?? {}, params._serverHint);
      sendResult(req.id, result);
      return;
    }

    case "tools/governed_call": {
      const params = req.params as { name: string; arguments?: Record<string, unknown>; _serverHint?: string } | undefined;
      if (!params?.name) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing tool name");
        return;
      }
      const result = await host.governedCallTool(params.name, params.arguments ?? {}, params._serverHint);
      sendResult(req.id, result);
      return;
    }

    case "mcpHost/governance/auditLog": {
      const params = req.params as { toolName?: string; serverName?: string; errorsOnly?: boolean } | undefined;
      let records: AuditRecord[];
      if (params?.toolName) {
        records = host.getAuditLogForTool(params.toolName);
      } else if (params?.serverName) {
        records = host.getAuditLogForServer(params.serverName);
      } else if (params?.errorsOnly) {
        records = host.getAuditErrors();
      } else {
        records = host.getAuditLog();
      }
      sendResult(req.id, { records });
      return;
    }

    case "mcpHost/governance/policy": {
      const governor = host.getToolGovernor();
      sendResult(req.id, { policy: governor.getPolicy() });
      return;
    }

    case "mcpHost/governance/updatePolicy": {
      const params = req.params as { policy: Partial<ToolGovernancePolicy> } | undefined;
      if (!params?.policy) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing policy");
        return;
      }
      host.updateGovernancePolicy(params.policy);
      sendResult(req.id, { success: true });
      return;
    }

    // ── Aggregated Resources ──

    case "resources/list": {
      const result = await host.listResources();
      sendResult(req.id, result);
      return;
    }

    case "resources/read": {
      const params = req.params as { uri: string; _serverHint?: string } | undefined;
      if (!params?.uri) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing resource URI");
        return;
      }
      const result = await host.readResource(params.uri, params._serverHint);
      sendResult(req.id, { contents: [result] });
      return;
    }

    // ── Aggregated Prompts ──

    case "prompts/list": {
      const result = await host.listPrompts();
      sendResult(req.id, result);
      return;
    }

    case "prompts/get": {
      const params = req.params as { name: string; arguments?: Record<string, string>; _serverHint?: string } | undefined;
      if (!params?.name) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing prompt name");
        return;
      }
      const result = await host.getPrompt(params.name, params.arguments, params._serverHint);
      sendResult(req.id, result);
      return;
    }

    default: {
      sendError(req.id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`);
      return;
    }
  }
}

main().catch((err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EPIPE") return;
  try {
    console.error("Fatal error:", err);
  } catch {
    // stderr unavailable
  }
});