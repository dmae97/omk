import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const OMK_ROOT = process.cwd();
const CLIENT_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "mcp", "client.js")).href;
const STDIO_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "mcp", "transports", "stdio.js")).href;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(path, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf-8");
    } catch {
      await sleep(25);
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf-8");
      const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      if (state === "Z") return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function waitForPidExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPidAlive(pid))) return;
    await sleep(50);
  }
  assert.fail(`process ${pid} is still alive`);
}

function bestEffortKill(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

test("McpClientSession initialize times out when a server never responds", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const session = new McpClientSession({
    name: "silent",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", "setInterval(() => {}, 1000);"],
    startupTimeoutMs: 50,
  });

  try {
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
  } finally {
    await session.close();
  }
});

test("McpClientSession rejects initialize responses without serverInfo", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const script = `
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      for (const line of chunk.split("\\n")) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { protocolVersion: "2024-11-05", capabilities: {} }
          }) + "\\n");
        }
      }
    });
  `;
  const session = new McpClientSession({
    name: "missing-server-info",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", script],
    startupTimeoutMs: 1000,
  });

  try {
    await session.connect();
    await assert.rejects(
      () =>
        session.initialize({
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.0" },
        }),
      /missing serverInfo/
    );
  } finally {
    await session.close();
  }
});

test("McpClientSession initialized notification omits JSON-RPC id", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const script = `
    process.stdin.setEncoding("utf8");
    let buffer = "";
    let initializedNotificationHasId = null;
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "capture", version: "0.0.0" }
            }
          }) + "\\n");
        }
        if (msg.method === "notifications/initialized") {
          initializedNotificationHasId = Object.prototype.hasOwnProperty.call(msg, "id");
        }
        if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { tools: [{ name: "notification_probe", description: String(initializedNotificationHasId), inputSchema: { type: "object", properties: {} } }] }
          }) + "\\n");
        }
      }
    });
  `;
  const session = new McpClientSession({
    name: "capture",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", script],
    startupTimeoutMs: 1000,
  });

  try {
    await session.connect();
    await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    const { tools } = await session.listTools();
    assert.equal(tools[0].description, "false");
  } finally {
    await session.close();
  }
});


test("McpClientSession uses request timeout after initialize", async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const script = `
    process.stdin.setEncoding("utf8");
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "delayed-tool", version: "0.0.0" }
            }
          }) + "\\n");
        }
        if (msg.method === "tools/call") {
          setTimeout(() => {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: "done" }] }
            }) + "\\n");
          }, 120);
        }
      }
    });
  `;
  const session = new McpClientSession({
    name: "delayed-tool",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", script],
    startupTimeoutMs: 1000,
    requestTimeoutMs: 1000,
  });

  try {
    await session.connect();
    await session.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    const result = await session.callTool("slow", {});
    assert.deepEqual(result, { content: [{ type: "text", text: "done" }] });
  } finally {
    await session.close();
  }
});

test("StdioTransport treats id 0 as a response, not a notification", async () => {
  const { StdioTransport } = await import(STDIO_MODULE_URL);
  const script = `
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 0, result: { ok: true } }) + "\\n");
    setTimeout(() => {}, 1000);
  `;
  const transport = new StdioTransport(process.execPath, ["--eval", script], {});
  const messagePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for response id 0")), 1000);
    transport.onMessage((raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw));
    });
    transport.onNotification(() => {
      clearTimeout(timeout);
      reject(new Error("id 0 was routed as notification"));
    });
    transport.onError((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  try {
    await transport.connect();
    const message = await messagePromise;
    assert.equal(message.id, 0);
    assert.deepEqual(message.result, { ok: true });
  } finally {
    await transport.close();
  }
});

test("McpClientSession initialize timeout kills silent stdio server process tree", { skip: process.platform === "win32" }, async () => {
  const { McpClientSession } = await import(CLIENT_MODULE_URL);
  const session = new McpClientSession({
    name: "silent-tree",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", "setInterval(() => {}, 1000);"],
    startupTimeoutMs: 50,
  });

  try {
    await session.connect();
    const pid = session.transportPid;
    assert.ok(typeof pid === "number" && pid > 0, "expected transport pid");
    await assert.rejects(
      () =>
        session.initialize({
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.0" },
        }),
      /MCP request timed out: initialize/
    );
    // Give the transport close a moment to propagate
    await sleep(200);
    if (await isPidAlive(pid)) {
      assert.fail(`silent server process ${pid} should have been killed after initialize timeout`);
    }
  } finally {
    await session.close().catch(() => {});
  }
});

test("StdioTransport close cleans descendant process tree", { skip: process.platform === "win32" }, async () => {
  const { StdioTransport } = await import(STDIO_MODULE_URL);
  const tempDir = await mkdtemp(join(tmpdir(), "omk-mcp-stdio-tree-"));
  const pidPath = join(tempDir, "child.pid");
  let childPid;
  const script = `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const child = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
    child.unref();
    writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
    process.stdin.resume();
    setInterval(() => {}, 1000);
  `;
  const transport = new StdioTransport(process.execPath, ["--eval", script], {});

  try {
    await transport.connect();
    childPid = Number((await waitForFile(pidPath)).trim());
    await transport.close();
    await waitForPidExit(childPid);
  } finally {
    if (childPid) bestEffortKill(childPid);
    await transport.close().catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  }
});
