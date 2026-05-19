import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const OMK_ROOT = process.cwd();
const HOST_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "mcp", "host.js")).href;

const SERVER_SCRIPT = `
  process.stdin.setEncoding("utf8");
  let buffer = "";
  function send(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
  }
  function handle(msg) {
    if (msg.method === "initialize") {
      send(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: "blocked-fixture", version: "0.0.0" }
      });
      return;
    }
    if (msg.method === "tools/list") {
      send(msg.id, { tools: [
        { name: "blocked_tool", description: "blocked", inputSchema: { type: "object", properties: {} } },
        { name: "safe_echo", description: "safe", inputSchema: { type: "object", properties: {} } },
        { name: "write_file", description: "write", inputSchema: { type: "object", properties: {} } },
        { name: "apply_patch", description: "mutate files", inputSchema: { type: "object", properties: {} } },
        { name: "mutate", description: "mutate", inputSchema: { type: "object", properties: {} } },
        { name: "upload", description: "upload", inputSchema: { type: "object", properties: {} } }
      ] });
      return;
    }
    if (msg.method === "tools/call") {
      const text = msg.params && msg.params.name === "safe_echo" ? process.env.FAKE_TOKEN : "called";
      send(msg.id, { content: [{ type: "text", text }] });
      return;
    }
    if (msg.method === "resources/list") {
      send(msg.id, { resources: [{ uri: "blocked://resource", name: "blocked resource", description: "blocked" }] });
      return;
    }
    if (msg.method === "resources/read") {
      send(msg.id, { contents: [{ uri: "blocked://resource", text: "read" }] });
      return;
    }
    if (msg.method === "prompts/list") {
      send(msg.id, { prompts: [{ name: "blocked_prompt", description: "blocked" }] });
      return;
    }
    if (msg.method === "prompts/get") {
      send(msg.id, { messages: [{ role: "user", content: { type: "text", text: "prompt" } }] });
    }
  }
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined) continue;
      handle(msg);
    }
  });
`;

test("McpHost denies raw tool, resource, and prompt operations for denied servers", async () => {
  const { McpHost } = await import(HOST_MODULE_URL);
  const host = new McpHost({ denyServers: ["blocked"] });

  host.registerServer({
    name: "blocked",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", SERVER_SCRIPT],
    startupTimeoutMs: 1000,
  });

  try {
    await host.connectServer("blocked");

    await assert.rejects(
      () => host.callTool("blocked_tool", {}, "blocked"),
      /Permission denied: tools\/call on server "blocked"/
    );
    await assert.rejects(
      () => host.readResource("blocked://resource", "blocked"),
      /Permission denied: resources\/read on server "blocked"/
    );
    await assert.rejects(
      () => host.getPrompt("blocked_prompt", {}, "blocked"),
      /Permission denied: prompts\/get on server "blocked"/
    );
  } finally {
    await host.close();
  }
});

test("McpHost governance redacts safe tool output and denies risky write tools by default", async () => {
  const { McpHost } = await import(HOST_MODULE_URL);
  const { ToolPermissionLevel } = await import(pathToFileURL(join(OMK_ROOT, "dist", "mcp", "governance.js")).href);
  const host = new McpHost({
    permissionRules: [
      { pattern: "*shell*", permission: ToolPermissionLevel.DENY, reason: "Shell-capable MCP tools require explicit host permission", priority: 100 },
      { pattern: "*exec*", permission: ToolPermissionLevel.DENY, reason: "Exec-capable MCP tools require explicit host permission", priority: 100 },
      { pattern: "*command*", permission: ToolPermissionLevel.DENY, reason: "Command-capable MCP tools require explicit host permission", priority: 100 },
      { pattern: "*write*", permission: ToolPermissionLevel.DENY, reason: "Write-capable MCP tools require explicit host permission", priority: 90 },
      { pattern: "*delete*", permission: ToolPermissionLevel.DENY, reason: "Delete-capable MCP tools require explicit host permission", priority: 90 },
      { pattern: "*remove*", permission: ToolPermissionLevel.DENY, reason: "Remove-capable MCP tools require explicit host permission", priority: 90 },
      { pattern: "safe_echo", permission: ToolPermissionLevel.ALLOW, reason: "Test fixture read-only echo", priority: 10 },
    ],
  });
  const fakeToken = ["sk", "123456789012345678901234"].join("-");

  host.registerServer({
    name: "allowed",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", SERVER_SCRIPT],
    env: { FAKE_TOKEN: fakeToken },
    startupTimeoutMs: 1000,
  });

  try {
    await host.connectServer("allowed");

    await assert.rejects(
      () => host.callTool("write_file", {}, "allowed"),
      /Permission denied: tools\/call on server "allowed"/
    );

    const result = await host.governedCallTool("safe_echo", {}, "allowed");
    assert.doesNotMatch(JSON.stringify(result.evidence.content), new RegExp(fakeToken));
    assert.equal(result.audit.secretsRedacted, true);
  } finally {
    await host.close();
  }
});

test("McpHost denies unknown write-capable external tools by default", async () => {
  const { McpHost } = await import(HOST_MODULE_URL);
  const host = new McpHost();

  host.registerServer({
    name: "external",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", SERVER_SCRIPT],
    startupTimeoutMs: 1000,
  });

  try {
    await host.connectServer("external");

    for (const toolName of ["apply_patch", "mutate", "upload"]) {
      await assert.rejects(
        () => host.callTool(toolName, {}, "external"),
        /Permission denied: tools\/call on server "external"/
      );
    }
  } finally {
    await host.close();
  }
});
