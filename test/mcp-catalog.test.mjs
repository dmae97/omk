import test from "node:test";
import assert from "node:assert/strict";

import { getDefaultSelections, RECOMMENDED_MCP_SERVERS } from "../dist/mcp/server-catalog.js";

test("MCP catalog starts fresh projects with no external defaults", () => {
  assert.deepEqual(getDefaultSelections(), []);
});

test("MCP catalog keeps bundled recommendations secret-free without preselecting them", () => {
  const bundled = RECOMMENDED_MCP_SERVERS.filter((server) => server.bundled);

  assert.deepEqual(bundled.map((entry) => entry.name).sort(), ["context7", "fetch", "github"].sort());
  for (const entry of bundled) {
    const serialized = JSON.stringify(entry);
    assert.doesNotMatch(serialized, /PERSONAL_ACCESS_TOKEN|Bearer|API_KEY|PASSWORD|SECRET/);
    assert.equal(getDefaultSelections().includes(entry.name), false);
  }

  const github = bundled.find((entry) => entry.name === "github");
  assert.equal(github?.command, "https://api.githubcopilot.com/mcp/");
  assert.deepEqual(github?.args, []);
});

test("MCP catalog includes Playwright for ts product preset without making it a core default", () => {
  const playwright = RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === "playwright");

  assert.equal(playwright?.command, "npx");
  assert.deepEqual(playwright?.args, ["-y", "@playwright/mcp@0.0.75"]);
  assert.equal(playwright?.bundled, undefined);
  assert.equal(getDefaultSelections().includes("playwright"), false);
});

test("MCP catalog includes bundled OMK web bridge without making it a core default", () => {
  const bridge = RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === "omk-web-bridge");

  assert.equal(bridge?.command, "omk");
  assert.deepEqual(bridge?.args, ["mcp", "serve", "omk-web-bridge"]);
  assert.equal(bridge?.category, "web");
  assert.equal(bridge?.env?.OMK_WEB_BRIDGE_MODE, "readonly");
  assert.equal(bridge?.bundled, undefined);
  assert.equal(getDefaultSelections().includes("omk-web-bridge"), false);
  assert.doesNotMatch(JSON.stringify(bridge), /TOKEN|SECRET|PASSWORD|Bearer/);
});

test("MCP catalog includes filesystem-readonly for worktree review lanes without making it a core default", () => {
  const filesystemReadonly = RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === "filesystem-readonly");

  assert.equal(filesystemReadonly?.command, "omk");
  assert.deepEqual(filesystemReadonly?.args, ["mcp", "serve", "filesystem-readonly"]);
  assert.equal(filesystemReadonly?.env?.OMK_MCP_MODE, "readonly");
  assert.equal(filesystemReadonly?.bundled, undefined);
  assert.equal(getDefaultSelections().includes("filesystem-readonly"), false);
});

test("MCP catalog includes memory for worktree team lanes without making it a core default", () => {
  const memory = RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === "memory");

  assert.equal(memory?.command, "npx");
  assert.deepEqual(memory?.args, ["-y", "@modelcontextprotocol/server-memory@2026.1.26"]);
  assert.equal(memory?.category, "memory");
  assert.equal(memory?.bundled, undefined);
  assert.equal(getDefaultSelections().includes("memory"), false);
});

test("MCP catalog runs PDF server in stdio mode to avoid JSON-RPC stdout pollution", () => {
  const pdf = RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === "pdf");

  assert.equal(pdf?.command, "npx");
  assert.deepEqual(pdf?.args, ["-y", "@modelcontextprotocol/server-pdf@1.7.2", "--stdio"]);
  assert.equal(pdf?.bundled, undefined);
  assert.equal(getDefaultSelections().includes("pdf"), false);
});

test("MCP catalog pins all npx packages and avoids latest tags", () => {
  for (const server of RECOMMENDED_MCP_SERVERS.filter((entry) => entry.command === "npx")) {
    const packageArg = server.args.find((arg) => arg.startsWith("@") || /^[a-z0-9._-]+@/i.test(arg));
    assert.ok(packageArg, `${server.name} should include an npm package arg`);
    assert.doesNotMatch(packageArg, /@latest$/);
    assert.match(packageArg, /@[^/]+$/);
  }
});
