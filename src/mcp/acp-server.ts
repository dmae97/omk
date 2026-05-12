#!/usr/bin/env node
// ─── ACP (Agent Communication Protocol) Server ─────────────────────────────
// OMK Protocol Gateway — P0: ACP Server
// Implements the editor↔agent protocol with session management, streaming,
// progress notifications, cancellation, and error semantics.
//
// ACP differs from MCP: MCP is request/response (tools, resources, prompts),
// while ACP adds: session lifecycle, streaming results, progress events,
// and bidirectional cancellation.

import { createInterface } from "readline";
import { writeSync } from "fs";
import { randomUUID } from "node:crypto";

import { getOmkVersionSync } from "../util/version.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_NAME = "omk-acp";
const SERVER_VERSION = getOmkVersionSync();

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

interface AcpSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "cancelled" | "completed" | "error";
  agentName?: string;
  taskDescription?: string;
  metadata: Record<string, unknown>;
}

interface AcpSessionStartParams {
  agentName?: string;
  taskDescription?: string;
  metadata?: Record<string, unknown>;
}

interface AcpSessionStartResult {
  sessionId: string;
  capabilities: string[];
  serverInfo: { name: string; version: string };
}

interface AcpProgressNotification {
  sessionId: string;
  progress: number;
  status: string;
  data?: Record<string, unknown>;
}

interface AcpStreamChunk {
  sessionId: string;
  chunk: string;
  sequence: number;
  done: boolean;
}

interface AcpCancelParams {
  sessionId: string;
  reason?: string;
}

interface AcpCancelResult {
  sessionId: string;
  cancelled: boolean;
}

interface AcpRunResult {
  sessionId: string;
  result: unknown;
  status: "success" | "error" | "cancelled";
  error?: { code: number; message: string };
}

// ─── JSON-RPC helpers ───────────────────────────────────────────────────────

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const ACP_SERVER_ERROR = -32000;

function sendResponse(res: JsonRpcResponse): void {
  const data = JSON.stringify(res) + "\n";
  try {
    writeSync(process.stdout.fd ?? 1, data);
  } catch {
    try {
      process.stdout.write(data);
    } catch {
      // stdout unavailable
    }
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
    writeSync(process.stdout.fd ?? 1, payload + "\n");
  } catch {
    try {
      process.stdout.write(payload + "\n");
    } catch {
      // stdout unavailable
    }
  }
}

// ─── Session Store ──────────────────────────────────────────────────────────

const sessions = new Map<string, AcpSession>();

function createSession(params: AcpSessionStartParams): AcpSession {
  const id = randomUUID();
  const now = new Date().toISOString();
  const session: AcpSession = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "active",
    agentName: params.agentName,
    taskDescription: params.taskDescription,
    metadata: params.metadata ?? {},
  };
  sessions.set(id, session);
  return session;
}

function getSession(sessionId: string): AcpSession | undefined {
  return sessions.get(sessionId);
}

// ─── Notification dispatch ──────────────────────────────────────────────────

function notifyProgress(sessionId: string, progress: number, status: string, data?: Record<string, unknown>): void {
  sendNotification("acp/progress", {
    sessionId,
    progress,
    status,
    ...(data ? { data } : {}),
  } as AcpProgressNotification);
}

function notifyStreamChunk(sessionId: string, chunk: string, sequence: number, done: boolean): void {
  sendNotification("acp/stream", {
    sessionId,
    chunk,
    sequence,
    done,
  } as AcpStreamChunk);
}

// ─── Request Handlers ───────────────────────────────────────────────────────

async function handleInitialize(): Promise<AcpSessionStartResult> {
  return {
    sessionId: randomUUID(),
    capabilities: [
      "session/start",
      "session/cancel",
      "session/status",
      "prompt/run",
      "prompt/run-streaming",
      "progress/subscribe",
      "result/get",
    ],
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  };
}

async function handleSessionStart(params: AcpSessionStartParams): Promise<AcpSessionStartResult> {
  const session = createSession(params);
  return {
    sessionId: session.id,
    capabilities: [
      "prompt/run",
      "prompt/run-streaming",
      "session/cancel",
      "session/status",
      "result/get",
    ],
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  };
}

async function handleSessionStatus(sessionId: string): Promise<AcpSession> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

async function handleSessionCancel(params: AcpCancelParams): Promise<AcpCancelResult> {
  const session = getSession(params.sessionId);
  if (!session) throw new Error(`Session not found: ${params.sessionId}`);

  if (session.status === "active") {
    session.status = "cancelled";
    session.updatedAt = new Date().toISOString();
    notifyProgress(params.sessionId, 0, "cancelled", { reason: params.reason });
  }

  return {
    sessionId: params.sessionId,
    cancelled: session.status === "cancelled",
  };
}

async function handlePromptRun(sessionId: string, prompt: string, options?: Record<string, unknown>): Promise<AcpRunResult> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== "active") {
    return {
      sessionId,
      result: null,
      status: session.status as "cancelled" | "error",
      error: session.status === "cancelled"
        ? { code: -32001, message: "Session was cancelled" }
        : { code: -32002, message: "Session is not active" },
    };
  }

  try {
    notifyProgress(sessionId, 10, "processing", { promptLength: prompt.length });

    const result = {
      sessionId,
      receivedPrompt: prompt,
      options,
      sessionAgent: session.agentName,
      timestamp: new Date().toISOString(),
      message: "ACP prompt received and queued for execution",
    };

    session.updatedAt = new Date().toISOString();
    notifyProgress(sessionId, 100, "completed");

    return {
      sessionId,
      result,
      status: "success",
    };
  } catch (err) {
    session.status = "error";
    session.updatedAt = new Date().toISOString();
    return {
      sessionId,
      result: null,
      status: "error",
      error: {
        code: ACP_SERVER_ERROR,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function handlePromptRunStreaming(
  sessionId: string,
  prompt: string,
  options?: Record<string, unknown>
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== "active") {
    throw new Error(`Session ${sessionId} is not active (status: ${session.status})`);
  }

  let sequence = 0;

  notifyStreamChunk(sessionId, `ACK: Processing started for session ${sessionId}`, sequence++, false);
  notifyStreamChunk(sessionId, `PROMPT: ${prompt.substring(0, 200)}${prompt.length > 200 ? "..." : ""}`, sequence++, false);

  const responseParts = [
    "OMK ACP Server received your request.",
    `Session: ${sessionId}`,
    `Agent: ${session.agentName ?? "default"}`,
    `Options: ${Object.keys(options ?? {}).join(", ") || "none"}`,
    "Processing...",
    "Complete.",
  ];

  for (const part of responseParts) {
    notifyStreamChunk(sessionId, part, sequence++, false);
  }

  notifyStreamChunk(sessionId, "[DONE]", sequence, true);
}

async function handleResultGet(sessionId: string): Promise<AcpRunResult> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  return {
    sessionId,
    result: { status: session.status, updatedAt: session.updatedAt },
    status: session.status === "completed" ? "success" : (session.status as "cancelled" | "error"),
  };
}

// ─── Main request router ────────────────────────────────────────────────────

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

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

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
      await handleRequest(req);
    } catch (err) {
      sendError(req.id ?? null, ACP_SERVER_ERROR, err instanceof Error ? err.message : String(err));
    }
  }

  try {
    process.stdout.end?.();
  } catch {
    // ignore
  }
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  switch (req.method) {
    case "initialize": {
      const result = await handleInitialize();
      sendResult(req.id, result);
      return;
    }

    case "notifications/initialized":
      return;

    case "acp/session/start": {
      const params = req.params as AcpSessionStartParams | undefined;
      const result = await handleSessionStart(params ?? {});
      sendResult(req.id, result);
      return;
    }

    case "acp/session/status": {
      const params = req.params as { sessionId: string } | undefined;
      if (!params?.sessionId) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing sessionId");
        return;
      }
      const result = await handleSessionStatus(params.sessionId);
      sendResult(req.id, result);
      return;
    }

    case "acp/session/cancel": {
      const params = req.params as AcpCancelParams | undefined;
      if (!params?.sessionId) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing sessionId");
        return;
      }
      const result = await handleSessionCancel(params);
      sendResult(req.id, result);
      return;
    }

    case "acp/prompt/run": {
      const params = req.params as { sessionId: string; prompt: string; options?: Record<string, unknown> } | undefined;
      if (!params?.sessionId || !params?.prompt) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing sessionId or prompt");
        return;
      }
      const result = await handlePromptRun(params.sessionId, params.prompt, params.options);
      sendResult(req.id, result);
      return;
    }

    case "acp/prompt/run-streaming": {
      const params = req.params as { sessionId: string; prompt: string; options?: Record<string, unknown> } | undefined;
      if (!params?.sessionId || !params?.prompt) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing sessionId or prompt");
        return;
      }
      try {
        await handlePromptRunStreaming(params.sessionId, params.prompt, params.options);
        sendResult(req.id, { sessionId: params.sessionId, streaming: true, done: true });
      } catch (err) {
        sendError(req.id, ACP_SERVER_ERROR, err instanceof Error ? err.message : String(err));
      }
      return;
    }

    case "acp/result/get": {
      const params = req.params as { sessionId: string } | undefined;
      if (!params?.sessionId) {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Missing sessionId");
        return;
      }
      const result = await handleResultGet(params.sessionId);
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