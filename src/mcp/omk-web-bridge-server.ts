#!/usr/bin/env node
import { createInterface } from "readline";
import { writeSync } from "fs";
import { getOmkVersionSync } from "../util/version.js";
import {
  WEB_BRIDGE_MCP_SERVER_NAME,
  getDefaultWebBridgeCapabilities,
  type WebBridgePageSnapshot,
} from "../contracts/web-bridge.js";
import { handleWebBridgeRequest } from "../web-bridge/host.js";
import { getWebBridgeStatus, readLatestWebBridgePageContext } from "../web-bridge/status.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_VERSION = getOmkVersionSync();

export const WEB_BRIDGE_MCP_TOOLS: readonly Tool[] = [
  {
    name: "web_bridge_status",
    description: "Return local OMK Web Bridge readiness, install state, permissions, and artifact paths. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "web_bridge_list_tabs",
    description: "List tabs from the latest sanitized bridge snapshot or supplied mock tabs. Read-only.",
    inputSchema: { type: "object", properties: { tabs: { type: "array", description: "Optional mock tab list for tests/native-host forwarding" } } },
  },
  {
    name: "web_bridge_read_page",
    description: "Read sanitized text/metadata/DOM from the latest bridge page snapshot or supplied snapshot. Read-only.",
    inputSchema: { type: "object", properties: { snapshot: { type: "object", description: "Optional page snapshot supplied by the extension/native host" } } },
  },
  {
    name: "web_bridge_read_selection",
    description: "Read sanitized selected text from the latest bridge page snapshot. Read-only.",
    inputSchema: { type: "object", properties: { snapshot: { type: "object" } } },
  },
  {
    name: "web_bridge_screenshot",
    description: "Return screenshot artifact metadata when the user granted screenshot permission. Read-only.",
    inputSchema: { type: "object", properties: { snapshot: { type: "object" } } },
  },
  {
    name: "web_bridge_request_action",
    description: "Request a browser mutation. Always denied unless explicit one-shot approval is provided; v1 remains read-only.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "click | formFill | download | upload | post | clipboardWrite | navigate" },
        target: { type: "string" },
        approval: { type: "object" },
      },
      required: ["action", "target"],
    },
  },
];

export async function handleWebBridgeMcpToolCall(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case "web_bridge_status":
      return await getWebBridgeStatus();
    case "web_bridge_list_tabs":
      return await webBridgeEnvelopeResult("browser.tabs.list", args);
    case "web_bridge_read_page":
      return await webBridgeEnvelopeResult("browser.page.read", args);
    case "web_bridge_read_selection":
      return await webBridgeEnvelopeResult("browser.selection.read", args);
    case "web_bridge_screenshot":
      return await webBridgeEnvelopeResult("browser.screenshot.capture", args);
    case "web_bridge_request_action":
      return await webBridgeEnvelopeResult("browser.action.request", { action: args });
    default:
      throw new Error(`Unknown OMK web bridge MCP tool: ${name}`);
  }
}

function textResult(value: unknown, isError = false): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

async function webBridgeEnvelopeResult(method: string, params: unknown): Promise<unknown> {
  const response = await handleWebBridgeRequest({
    schemaVersion: 1,
    requestId: `mcp-${Date.now()}`,
    method,
    params,
  });
  return response.ok ? response.result : response;
}

async function handleToolCall(name: string, args: unknown): Promise<unknown> {
  try {
    return textResult(await handleWebBridgeMcpToolCall(name, args));
  } catch (err) {
    return textResult({ ok: false, error: err instanceof Error ? err.message : String(err) }, true);
  }
}

function send(response: JsonRpcResponse): void {
  writeSync(process.stdout.fd, `${JSON.stringify(response)}\n`);
}

function sendResult(id: string | number, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number, code: number, message: string, data?: unknown): void {
  send({ jsonrpc: "2.0", id, error: { code, message, data } });
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const id = req.id ?? 0;
  if (req.method === "initialize") {
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: WEB_BRIDGE_MCP_SERVER_NAME, version: SERVER_VERSION },
    });
    return;
  }
  if (req.method === "notifications/initialized") return;
  if (req.method === "tools/list") {
    sendResult(id, { tools: WEB_BRIDGE_MCP_TOOLS });
    return;
  }
  if (req.method === "tools/call") {
    const params = req.params && typeof req.params === "object" ? req.params as Record<string, unknown> : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = params.arguments ?? {};
    sendResult(id, await handleToolCall(name, args));
    return;
  }
  if (req.method === "resources/list") {
    sendResult(id, { resources: [] });
    return;
  }
  if (req.method === "prompts/list") {
    sendResult(id, { prompts: [] });
    return;
  }
  sendError(id, -32601, `Method not found: ${req.method}`);
}

export async function main(): Promise<void> {
  // Touch these imports in the bundle and keep capability metadata reachable for direct tests.
  void getDefaultWebBridgeCapabilities;
  void readLatestWebBridgePageContext;
  void (undefined as WebBridgePageSnapshot | undefined);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      await handleRequest(req);
    } catch (err) {
      sendError(0, -32700, err instanceof Error ? err.message : String(err));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`[omk-web-bridge-mcp] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
