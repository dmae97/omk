import test from "node:test";
import assert from "node:assert/strict";

import {
  KimiWireProtocolRuntime,
  createKimiWireProtocolRuntime,
} from "../../dist/runtime/kimi-wire-protocol-runtime.js";

function makeCapsule(overrides = {}) {
  return {
    runId: "test-run",
    nodeId: "test-node",
    goal: "test goal",
    system: "",
    task: "test task",
    dependencySummaries: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    evidenceRequirements: [],
    budget: {},
    node: {
      id: "test-node",
      name: "Test Node",
      role: "coder",
      dependsOn: [],
      status: "pending",
      retries: 0,
      maxRetries: 3,
      routing: {},
    },
    ...overrides,
  };
}

test("KimiWireProtocolRuntime has correct id and capabilities", () => {
  const runtime = createKimiWireProtocolRuntime();
  assert.equal(runtime.id, "kimi-wire");
  assert.equal(runtime.kind, "cli");
  assert.equal(runtime.capabilities.read, true);
  assert.equal(runtime.capabilities.write, true);
  assert.equal(runtime.capabilities.shell, false);
  assert.equal(runtime.capabilities.vision, true);
  assert.equal(runtime.capabilities.supportsToolCalling, true);
});

test("KimiWireProtocolRuntime supports capsule when kimi binary not checked yet", () => {
  const runtime = createKimiWireProtocolRuntime();
  assert.equal(runtime.supports(makeCapsule()), true);
});

test("KimiWireProtocolRuntime supports respects vision requirement", () => {
  const runtime = createKimiWireProtocolRuntime();
  const capsule = makeCapsule({
    node: {
      ...makeCapsule().node,
      routing: { assignedProviderCapabilities: ["vision"] },
    },
  });
  assert.equal(runtime.supports(capsule), true);
});

test("KimiWireProtocolRuntime supports respects tool calling requirement", () => {
  const runtime = createKimiWireProtocolRuntime();
  const capsule = makeCapsule({
    node: {
      ...makeCapsule().node,
      routing: { requiresToolCalling: true },
    },
  });
  assert.equal(runtime.supports(capsule), true);
});

test("KimiWireProtocolRuntime health checks kimi binary availability", async () => {
  const runtime = createKimiWireProtocolRuntime();
  const health = await runtime.health();
  assert.equal(health.runtimeId, "kimi-wire");
  assert.equal(typeof health.available, "boolean");
  assert.equal(typeof health.checkedAt, "string");
});

test("KimiWireProtocolRuntime class can be instantiated directly", () => {
  const runtime = new KimiWireProtocolRuntime({ cwd: "/tmp" });
  assert.equal(runtime.id, "kimi-wire");
});
