import { strictEqual, ok } from "node:assert";
import { test } from "node:test";
import { createRuntimeRouter } from "../dist/runtime/runtime-router.js";

function runtime(id, caps) {
  return {
    id,
    providerId: id,
    supports: () => true,
    capabilities: caps,
    health: async () => ({
      runtimeId: id,
      available: true,
      checkedAt: new Date().toISOString(),
      vector: { runtimeOk: true, authOk: true, modelOk: true, quotaOk: true, rateLimitOk: true },
    }),
    runNode: async () => ({ success: true, exitCode: 0, stdout: "ok", stderr: "", metadata: { runtime: id } }),
  };
}

function task(capabilities) {
  return {
    prompt: "do it",
    context: { runId: "r", nodeId: "n", risk: "write" },
    tools: { available: [], mcpServers: [], skills: [], hooks: [] },
    providerPolicy: { strategy: "priority-first", preferredProviders: [], fallbackChain: [] },
    capabilities,
  };
}

function capsuleFromTask(task) {
  return {
    runId: "r",
    nodeId: "n",
    goal: "test",
    system: "sys",
    task: task.prompt,
    dependencySummaries: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    evidenceRequirements: [],
    budget: { maxInputTokens: 1000, reservedOutputTokens: 500, maxFileTokens: 500, maxToolResultTokens: 500, maxMemoryFacts: 5, compression: "none" },
    node: { id: "n", routing: { readOnly: false } },
  };
}

test("advisory runtime is rerouted to non-advisory fallback for write task", async () => {
  const advisory = runtime("advisory-api", { read: true, write: true, shell: true, mcp: true, patch: true, review: true, merge: true, vision: true, advisory: true });
  const executor = runtime("executor-api", { read: true, write: true, shell: true, mcp: true, patch: true, review: true, merge: true, vision: true });
  const router = createRuntimeRouter({ runtimes: [advisory, executor] });
  const t = task({ read: true, write: true });
  const result = await router.execute(t, new AbortController().signal);
  strictEqual(result.success, true);
  strictEqual(result.metadata?.selectedRuntime, "executor-api");
});

test("advisory runtime runs read-only task directly", async () => {
  const advisory = runtime("advisory-api", { read: true, write: false, shell: false, mcp: false, patch: false, review: true, merge: false, vision: false, advisory: true });
  const router = createRuntimeRouter({ runtimes: [advisory] });
  const t = task({ read: true, write: false });
  const result = await router.execute(t, new AbortController().signal);
  strictEqual(result.success, true);
  strictEqual(result.metadata?.selectedRuntime, "advisory-api");
});

test("write task with only advisory runtime fails via executeTask", async () => {
  const advisory = runtime("advisory-api", { read: true, write: true, shell: true, mcp: true, patch: true, review: true, merge: true, vision: true, advisory: true });
  const router = createRuntimeRouter({ runtimes: [advisory] });
  const t = task({ read: true, write: true });
  const capsule = {
    runId: "r",
    nodeId: "n",
    goal: "test",
    system: "sys",
    task: t.prompt,
    dependencySummaries: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    evidenceRequirements: [],
    budget: { maxInputTokens: 1000, reservedOutputTokens: 500, maxFileTokens: 500, maxToolResultTokens: 500, maxMemoryFacts: 5, compression: "none" },
    node: { id: "n", routing: { readOnly: false } },
  };
  const result = await router.executeTask(t, capsule, new AbortController().signal);
  strictEqual(result.success, false);
  strictEqual(result.exitCode, 78);
  ok(result.stderr.includes("advisory"), result.stderr);
});

test("write task with only advisory runtime fails via legacy execute()", async () => {
  const advisory = runtime("advisory-api", { read: true, write: true, shell: true, mcp: true, patch: true, review: true, merge: true, vision: true, advisory: true });
  const router = createRuntimeRouter({ runtimes: [advisory] });
  const t = task({ read: true, write: true });
  const result = await router.execute(t, new AbortController().signal);
  strictEqual(result.success, false);
  strictEqual(result.exitCode, 78);
  ok(
    result.stderr.includes("advisory") || result.metadata?.authorityMode === "advisory",
    JSON.stringify(result),
  );
});
