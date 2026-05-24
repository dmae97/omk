import test from "node:test";
import assert from "node:assert/strict";

import { createKimiApiRuntime, createKimiWireRuntime } from "../dist/runtime/kimi-api-runtime.js";

function makeCapsule(overrides = {}) {
  return {
    nodeId: "test-node",
    node: { routing: {} },
    ...overrides,
  };
}

test("kimi-api runtime requires KIMI_API_KEY to be available", () => {
  const disabled = createKimiApiRuntime({});
  assert.equal(disabled.supports(makeCapsule()), false);

  const enabled = createKimiApiRuntime({ apiKey: "test-key" });
  assert.equal(enabled.supports(makeCapsule()), true);
});

test("createKimiWireRuntime backward-compat alias works", () => {
  const runtime = createKimiWireRuntime({ apiKey: "test-key" });
  assert.equal(runtime.supports(makeCapsule()), true);
  assert.equal(runtime.id, "kimi-api");
});
