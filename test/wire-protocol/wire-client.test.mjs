import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { Readable, Writable } from "stream";

// Mock child_process before importing the module
const mockProcs = [];
const originalSpawn = (await import("child_process")).spawn;

// We'll create a custom mock spawn by intercepting at the module level
// Since the wire-client imports spawn at top level, we need to test
// via the built dist which uses the real spawn. Instead, we'll test
// the public API surface and type exports directly.

import {
  KimiWireClient,
  JSONRPC_PARSE_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INTERNAL_ERROR,
  WIRE_TURN_IN_PROGRESS,
  WIRE_LLM_NOT_SET,
  WIRE_LLM_NOT_SUPPORTED,
  WIRE_LLM_SERVICE_ERROR,
} from "../../dist/adapters/kimi/wire-client.js";

test("error code constants match spec", () => {
  assert.equal(JSONRPC_PARSE_ERROR, -32700);
  assert.equal(JSONRPC_INVALID_REQUEST, -32600);
  assert.equal(JSONRPC_METHOD_NOT_FOUND, -32601);
  assert.equal(JSONRPC_INVALID_PARAMS, -32602);
  assert.equal(JSONRPC_INTERNAL_ERROR, -32603);
  assert.equal(WIRE_TURN_IN_PROGRESS, -32000);
  assert.equal(WIRE_LLM_NOT_SET, -32001);
  assert.equal(WIRE_LLM_NOT_SUPPORTED, -32002);
  assert.equal(WIRE_LLM_SERVICE_ERROR, -32003);
});

test("KimiWireClient exposes server info getters before start", () => {
  const client = new KimiWireClient();
  assert.equal(client.serverInfo, undefined);
  assert.equal(client.slashCommands, undefined);
  assert.equal(client.serverCapabilities, undefined);
  assert.equal(client.registeredTools, undefined);
  assert.equal(client.hooksInfo, undefined);
});

test("KimiWireClient onEvent returns unsubscribe function", () => {
  const client = new KimiWireClient();
  const unsub = client.onEvent(() => {});
  assert.equal(typeof unsub, "function");
  // Should not throw
  unsub();
});

test("KimiWireClient onApprovalRequest returns unsubscribe function", () => {
  const client = new KimiWireClient();
  const unsub = client.onApprovalRequest(() => {});
  assert.equal(typeof unsub, "function");
  unsub();
});

test("KimiWireClient onToolCallRequest returns unsubscribe function", () => {
  const client = new KimiWireClient();
  const unsub = client.onToolCallRequest(() => {});
  assert.equal(typeof unsub, "function");
  unsub();
});

test("KimiWireClient onQuestionRequest returns unsubscribe function", () => {
  const client = new KimiWireClient();
  const unsub = client.onQuestionRequest(() => {});
  assert.equal(typeof unsub, "function");
  unsub();
});

test("KimiWireClient onHookRequest returns unsubscribe function", () => {
  const client = new KimiWireClient();
  const unsub = client.onHookRequest(() => {});
  assert.equal(typeof unsub, "function");
  unsub();
});

test("KimiWireClient onRequest returns unsubscribe function", () => {
  const client = new KimiWireClient();
  const unsub = client.onRequest(() => {});
  assert.equal(typeof unsub, "function");
  unsub();
});

test("KimiWireClient stop is safe before start", async () => {
  const client = new KimiWireClient();
  await client.stop();
});
