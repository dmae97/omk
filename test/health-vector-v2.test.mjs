import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRuntimeRouter } from "../dist/runtime/runtime-router.js";
import { createKimiApiRuntime } from "../dist/runtime/kimi-api-runtime.js";

describe("Runtime health vector v2", () => {
  it("performs adapter cheap/live probes with latency and rate-limit dimensions", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      const runtime = createKimiApiRuntime({ apiKey: "test-api-key", model: "kimi-test" });
      const ok = await runtime.health({ probeKind: "cheap-call", highRisk: true, taskRisk: "write" });
      assert.equal(ok.available, true);
      assert.equal(ok.vector.lastProbeKind, "cheap-call");
      assert.equal(ok.vector.auth, "pass");
      assert.equal(ok.vector.model, "pass");
      assert.equal(typeof ok.vector.latencyMs, "number");

      globalThis.fetch = async () => new Response("rate limited", { status: 429 });
      const limited = await runtime.health({ probeKind: "live-call", highRisk: true, taskRisk: "merge" });
      assert.equal(limited.available, false);
      assert.equal(limited.vector.lastProbeKind, "live-call");
      assert.equal(limited.vector.rateLimit, "fail");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("penalizes unknown health less than fail and filters failed hard dimensions", async () => {
    const calls = [];
    const unknown = fakeRuntime("unknown-cli", calls, {
      runtimeId: "unknown-cli",
      available: true,
      checkedAt: new Date().toISOString(),
      vector: {
        runtime: "unknown",
        auth: "unknown",
        model: "unknown",
        quota: "unknown",
        rateLimit: "unknown",
        lastProbeKind: "none",
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const failed = fakeRuntime("failed-cli", calls, {
      runtimeId: "failed-cli",
      available: true,
      checkedAt: new Date().toISOString(),
      vector: {
        runtime: "fail",
        auth: "pass",
        model: "pass",
        quota: "pass",
        rateLimit: "pass",
        lastProbeKind: "static",
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const router = createRuntimeRouter({ runtimes: [failed, unknown] });
    const result = await router.execute(fakeTask());
    assert.equal(result.exitCode, 0);
    assert.equal(result.metadata.selectedRuntime, "unknown-cli");
    assert.deepEqual(calls, ["unknown-cli"]);
  });
});

function fakeRuntime(id, calls, health) {
  return {
    id,
    providerId: id.split("-")[0],
    runtimeMode: "cli",
    priority: 50,
    capabilities: { read: true, write: false, shell: false, mcp: false, patch: false, review: true, merge: false, vision: false },
    supports: () => true,
    health: async () => health,
    async runNode() {
      return { success: true, exitCode: 0, stdout: id, stderr: "", metadata: { runtime: id } };
    },
    async execute() {
      calls.push(id);
      return { output: id, exitCode: 0, metadata: { runtime: id } };
    },
  };
}

function fakeTask() {
  return {
    prompt: "review this change",
    context: { runId: "health-v2", nodeId: "node", role: "reviewer", goal: "health", system: "", cwd: process.cwd() },
    tools: { available: [] },
    providerPolicy: { strategy: "priority-first", preferredProviders: [], fallbackChain: [] },
    capabilities: { read: true, write: false, shell: false, mcp: false, patch: false, review: true, merge: false, vision: false },
    safety: { risk: "read", approvalPolicy: "ask", sandboxMode: "read-only", evidenceRequired: false, authorityMode: "advisory" },
  };
}
