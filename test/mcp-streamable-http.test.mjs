import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

const OMK_ROOT = process.cwd();
const CLIENT_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "mcp", "client.js")).href;

test("Streamable HTTP requests use the configured request timeout instead of a fixed 30s send cap", async () => {
  const clientSource = await readFile(join(OMK_ROOT, "dist", "mcp", "client.js"), "utf-8");
  const transportSource = await readFile(join(OMK_ROOT, "dist", "mcp", "transports", "streamable-http.js"), "utf-8");

  assert.doesNotMatch(clientSource, /SEND_TIMEOUT_MS/);
  assert.match(clientSource, /transport\.send[\s\S]*timeoutMs/);
  assert.match(transportSource, /normalizeTimeoutMs\(options\.timeoutMs/);
  assert.doesNotMatch(transportSource, /CHUNK_TIMEOUT_MS/);
});

test("StreamableHttpTransport initializes exactly once and preserves auth/session headers", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const previousFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), headers: { ...init.headers }, body });

    if (body.method === "initialize") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "http-fixture", version: "0.0.0" },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-123" },
      });
    }

    if (body.method === "tools/list") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [] },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`unexpected method ${body.method}`);
  };

  try {
    const session = new McpClientSession({
      name: "http-fixture",
      transport: "streamable-http",
      url: "https://mcp.example.test",
      headers: { Authorization: "Bearer test-token" },
      startupTimeoutMs: 1000,
    });

    await session.connect();
    assert.equal(calls.length, 0, "connect must not send initialize");

    await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    await session.listTools();

    const initializeCalls = calls.filter((call) => call.body.method === "initialize");
    assert.equal(initializeCalls.length, 1);
    assert.equal(initializeCalls[0].headers.Authorization, "Bearer test-token");
    assert.equal(initializeCalls[0].headers.Accept, "application/json, text/event-stream");

    const listCall = calls.find((call) => call.body.method === "tools/list");
    assert.ok(listCall);
    assert.equal(listCall.headers.Authorization, "Bearer test-token");
    assert.equal(listCall.headers["Mcp-Session-Id"], "session-123");
    assert.equal(listCall.headers["MCP-Protocol-Version"], "2024-11-05");
    await session.close();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("StreamableHttpTransport accepts initialize result from SSE data frame", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const previousFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), headers: { ...init.headers }, body });

    if (body.method === "initialize") {
      return new Response([
        "event: message",
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "sse-fixture", version: "0.0.0" },
          },
        })}`,
        "",
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
          params: { source: "initialize-stream" },
        })}`,
        "",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": "sse-session-123" },
      });
    }

    if (body.method === "tools/list") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [] },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("", { status: 202 });
  };

  try {
    const session = new McpClientSession({
      name: "sse-fixture",
      transport: "streamable-http",
      url: "https://mcp.example.test",
      startupTimeoutMs: 1000,
    });
    const notifications = [];
    session.onNotification("notifications/tools/list_changed", (params) => notifications.push(params));

    await session.connect();
    const result = await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    assert.equal(result.serverInfo.name, "sse-fixture");
    assert.deepEqual(notifications, [{ source: "initialize-stream" }]);

    await session.listTools();
    const listCall = calls.find((call) => call.body.method === "tools/list");
    assert.ok(listCall);
    assert.equal(listCall.headers["Mcp-Session-Id"], "sse-session-123");
    assert.equal(listCall.headers["MCP-Protocol-Version"], "2024-11-05");
    await session.close();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("StreamableHttpTransport dispatches long-lived SSE frames before body end", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const previousFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let streamCancelled = false;

  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (body.method === "initialize") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode([
            "event: message",
            `data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                serverInfo: { name: "long-sse", version: "0.0.0" },
              },
            })}`,
            "",
            "",
          ].join("\n")));
        },
        cancel() {
          streamCancelled = true;
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const session = new McpClientSession({
      name: "long-sse",
      transport: "streamable-http",
      url: "https://mcp.example.test",
      startupTimeoutMs: 500,
    });
    await session.connect();
    const startedAt = Date.now();
    const result = await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    assert.equal(result.serverInfo.name, "long-sse");
    assert.ok(Date.now() - startedAt < 450, "initialize should not wait for the SSE response body to end");
    await session.close();
    assert.equal(streamCancelled, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("StreamableHttpTransport dispatches notifications after matched SSE array response", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (body.method === "initialize") {
      return new Response(`data: ${JSON.stringify([
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "sse-array", version: "0.0.0" },
          },
        },
        {
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
          params: { source: "same-array" },
        },
      ])}\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const session = new McpClientSession({
      name: "sse-array",
      transport: "streamable-http",
      url: "https://mcp.example.test",
      startupTimeoutMs: 1000,
    });
    const notifications = [];
    session.onNotification("notifications/tools/list_changed", (params) => notifications.push(params));
    await session.connect();
    await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    assert.deepEqual(notifications, [{ source: "same-array" }]);
    await session.close();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("McpClientSession bounds initialized notification send with abort signal", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const previousFetch = globalThis.fetch;
  let notificationAbortSeen = false;
  let resolveNotificationStarted;
  const notificationStarted = new Promise((resolve) => {
    resolveNotificationStarted = resolve;
  });

  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (body.method === "initialize") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "notification-timeout", version: "0.0.0" },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (body.method === "notifications/initialized") {
      resolveNotificationStarted();
      return new Promise((resolve, reject) => {
        const signal = init.signal;
        signal?.addEventListener("abort", () => {
          notificationAbortSeen = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }
    throw new Error(`unexpected method ${body.method}`);
  };

  try {
    const session = new McpClientSession({
      name: "notification-timeout",
      transport: "streamable-http",
      url: "https://mcp.example.test",
      startupTimeoutMs: 1000,
      requestTimeoutMs: 25,
    });
    await session.connect();
    await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    await notificationStarted;
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(notificationAbortSeen, true);
    await session.close();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("StreamableHttpTransport rejects oversized JSON response before parsing", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Length": String(10 * 1024 * 1024 + 1) },
    });
  };

  try {
    const session = new McpClientSession({
      name: "oversized-json",
      transport: "streamable-http",
      url: "https://mcp.example.test",
      startupTimeoutMs: 1000,
    });
    await session.connect();
    await assert.rejects(
      () =>
        session.initialize({
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.0" },
        }),
      /MCP HTTP response body exceeded/
    );
    await session.close();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("McpClientSession aborts in-flight streamable HTTP request on timeout", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const previousFetch = globalThis.fetch;
  let abortSeen = false;

  globalThis.fetch = async (url, init = {}) => {
    return new Promise((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) {
        abortSeen = true;
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      signal?.addEventListener("abort", () => {
        abortSeen = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  };

  try {
    const session = new McpClientSession({
      name: "abort-http",
      transport: "streamable-http",
      url: "https://mcp.example.test",
      startupTimeoutMs: 50,
    });
    await session.connect();
    await assert.rejects(
      () =>
        session.initialize({
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.0" },
        }),
      /MCP request timed out: initialize/
    );
    assert.equal(abortSeen, true);
    await session.close();
  } finally {
    globalThis.fetch = previousFetch;
  }
});
