import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createKimiApiRuntime } from "../dist/runtime/kimi-api-runtime.js";
import { DeepSeekRuntime } from "../dist/runtime/deepseek-runtime.js";

describe("runtime health vectors", () => {
  it("kimi-api health returns structured vector when key is present", async () => {
    const runtime = createKimiApiRuntime({ apiKey: "test-key", model: "kimi-k2-6" });
    const health = await runtime.health();
    assert.equal(health.available, true);
    assert.ok(health.vector);
    assert.equal(health.vector.runtimeOk, true);
    assert.equal(health.vector.authOk, true);
    assert.equal(health.vector.modelOk, true);
  });

  it("kimi-api health returns unavailable when key is missing", async () => {
    const prev = process.env.KIMI_API_KEY;
    delete process.env.KIMI_API_KEY;
    const runtime = createKimiApiRuntime({});
    const health = await runtime.health();
    assert.equal(health.available, false);
    assert.equal(health.vector.authOk, false);
    process.env.KIMI_API_KEY = prev;
  });

  it("deepseek-api health returns structured vector", async () => {
    const runtime = new DeepSeekRuntime({ apiKey: "test-key", model: "deepseek-chat" });
    const health = await runtime.health();
    assert.equal(health.available, true);
    assert.ok(health.vector);
    assert.equal(health.vector.authOk, true);
    assert.equal(health.vector.modelOk, true);
  });
});
