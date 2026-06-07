import test from "node:test";
import assert from "node:assert/strict";

import {
  canCallMcpTool,
  canWriteConfig,
  configWriteDeniedMessage,
  filterAllowedMcpTools,
  getMcpPermissionProfile,
  mcpToolDeniedMessage,
} from "../dist/mcp/config-permissions.js";

test("MCP config writes are disabled by default", () => {
  assert.equal(canWriteConfig({}), false);
  assert.match(configWriteDeniedMessage(), /disabled by default/);
});

test("MCP config writes require explicit trusted env opt-in", () => {
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "1" }), true);
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "true" }), true);
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "yes" }), true);
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "0" }), false);
});

test("MCP permission profile defaults to read-only write tool denial", () => {
  assert.equal(getMcpPermissionProfile({}), "default");
  assert.equal(getMcpPermissionProfile({ OMK_MCP_PERMISSION_PROFILE: "repo" }), "repo");
  assert.equal(getMcpPermissionProfile({ OMK_MCP_PERMISSION_PROFILE: "unknown" }), "default");
  assert.equal(canCallMcpTool("omk_memory_read", {}), true);
  assert.equal(canCallMcpTool("omk_memory_write", {}), false);
  assert.equal(canCallMcpTool("omk_write_todos", {}), false);
  assert.equal(canCallMcpTool("TodoWrite", {}), false);
  assert.equal(canCallMcpTool("omk_todo_write", {}), false);
  assert.equal(canCallMcpTool("omk_goal_verify", {}), false);
  assert.equal(canCallMcpTool("omk_evidence_check", {}), false);
  assert.equal(canCallMcpTool("omk_quality_gate", {}), false);
  assert.equal(canCallMcpTool("omk_run_quality_gate", {}), false);
  assert.equal(canCallMcpTool("omk_run_quality_gate_print", {}), false);
  assert.match(mcpToolDeniedMessage("omk_write_todos", {}), /permission profile 'default'/);
});

test("MCP permission profiles allow only intended write surfaces", () => {
  assert.equal(canCallMcpTool("omk_memory_write", { OMK_MCP_PERMISSION_PROFILE: "docs" }), true);
  assert.equal(canCallMcpTool("omk_write_todos", { OMK_MCP_PERMISSION_PROFILE: "docs" }), false);
  assert.equal(canCallMcpTool("omk_write_todos", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("TodoWrite", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("omk_todo_write", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("todo_write", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("omk_goal_verify", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("omk_evidence_check", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("omk_quality_gate", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("omk_run_quality_gate", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("omk_run_quality_gate_print", { OMK_MCP_PERMISSION_PROFILE: "repo" }), true);
  assert.equal(canCallMcpTool("omk_run_quality_gate_print", { OMK_MCP_PERMISSION_PROFILE: "browser" }), true);
  assert.equal(canCallMcpTool("omk_write_config", { OMK_MCP_PERMISSION_PROFILE: "browser" }), false);
  assert.equal(canCallMcpTool("omk_write_config", {
    OMK_MCP_PERMISSION_PROFILE: "browser",
    OMK_MCP_ALLOW_WRITE_CONFIG: "1",
  }), true);
});

test("MCP tool filtering hides write-capable tools in default profile", () => {
  const tools = [
    { name: "omk_memory_read" },
    { name: "omk_memory_write" },
    { name: "omk_quality_gate" },
    { name: "omk_write_todos" },
    { name: "TodoWrite" },
    { name: "omk_todo_write" },
  ];
  assert.deepEqual(filterAllowedMcpTools(tools, {}).map((tool) => tool.name), ["omk_memory_read"]);
  assert.deepEqual(filterAllowedMcpTools(tools, { OMK_MCP_PERMISSION_PROFILE: "repo" }).map((tool) => tool.name), [
    "omk_memory_read",
    "omk_memory_write",
    "omk_quality_gate",
    "omk_write_todos",
    "TodoWrite",
    "omk_todo_write",
  ]);
});
