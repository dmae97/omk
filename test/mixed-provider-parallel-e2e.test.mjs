import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeRouter } from "../dist/runtime/runtime-router.js";

function capabilities(overrides = {}) {
  return {
    read: true,
    write: false,
    shell: false,
    mcp: false,
    patch: false,
    review: true,
    merge: false,
    vision: false,
    ...overrides,
  };
}

function task(id, prompt, capabilityOverrides, safetyOverrides = {}) {
  const risk = safetyOverrides.risk ?? (capabilityOverrides.shell ? "shell" : capabilityOverrides.write || capabilityOverrides.patch ? "write" : "read");
  return {
    prompt,
    context: { runId: "mixed-provider-e2e", nodeId: id, role: id, goal: "mixed-provider parallel e2e", system: "", cwd: process.cwd() },
    tools: { available: [] },
    providerPolicy: { strategy: "priority-first", preferredProviders: [], fallbackChain: [] },
    capabilities: capabilities(capabilityOverrides),
    safety: {
      risk,
      approvalPolicy: "ask",
      sandboxMode: risk === "read" ? "read-only" : "workspace-write",
      evidenceRequired: risk !== "read",
      authorityMode: "scoped",
      ...safetyOverrides,
    },
  };
}

function runtime(id, caps, calls, healthRequests, priority = 60) {
  return {
    id,
    providerId: id.split("-")[0],
    runtimeMode: id.split("-").slice(1).join("-"),
    priority,
    capabilities: caps,
    supports: () => true,
    async health(input) {
      healthRequests.push({ id, input });
      return {
        runtimeId: id,
        available: true,
        checkedAt: new Date().toISOString(),
        vector: {
          runtimeOk: true,
          authOk: true,
          modelOk: true,
          quotaOk: true,
          rateLimitOk: true,
          runtime: "pass",
          auth: "pass",
          model: "pass",
          quota: "unknown",
          rateLimit: "unknown",
          lastProbeKind: input?.probeKind ?? "static",
          checkedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      };
    },
    async execute(agentTask) {
      calls.push({ runtime: id, nodeId: agentTask.context.nodeId, risk: agentTask.safety.risk });
      return { output: `ok:${id}:${agentTask.context.nodeId}`, exitCode: 0, metadata: { commandPass: agentTask.safety.risk !== "read" } };
    },
    async runNode() {
      throw new Error("execute path expected");
    },
  };
}

test("mixed-provider parallel E2E routes advisory reviewer away from write authority and escalates health probes for high-risk lanes", async () => {
  const calls = [];
  const healthRequests = [];
  const router = createRuntimeRouter({
    runtimes: [
      runtime("deepseek-api", capabilities({ review: true }), calls, healthRequests, 100),
      runtime("codex-cli", capabilities({ write: true, patch: true, shell: true, review: true }), calls, healthRequests, 70),
    ],
  });

  const lanes = [
    task("reviewer", "review the patch", { review: true }),
    task("coder", "implement the patch", { write: true, patch: true, review: false }),
    task("verifier", "run command evidence", { shell: true, review: false }, { risk: "shell" }),
  ];

  const results = await Promise.all(lanes.map((lane) => router.execute(lane)));

  assert.deepEqual(results.map((result) => result.exitCode), [0, 0, 0]);
  assert.equal(calls.find((call) => call.nodeId === "reviewer")?.runtime, "deepseek-api");
  assert.equal(calls.find((call) => call.nodeId === "coder")?.runtime, "codex-cli");
  assert.equal(calls.find((call) => call.nodeId === "verifier")?.runtime, "codex-cli");
  assert.ok(healthRequests.some((request) => request.id === "codex-cli" && request.input?.probeKind === "cheap-call"));
  assert.ok(healthRequests.some((request) => request.id === "deepseek-api" && request.input?.probeKind === "static"));
  for (const result of results) assert.ok(Array.isArray(result.metadata.fallbackChain));
});
