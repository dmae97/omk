import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeRouter } from "../dist/runtime/runtime-router.js";

test("runtime router prefers Codex over Kimi for coding intent when both are available", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-cli", calls),
      fakeRuntime("codex-cli", calls),
    ],
  });

  const result = await router.execute(fakeTask({ prompt: "implement the provider-neutral routing patch" }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "codex-cli");
  assert.deepEqual(calls, ["codex-cli"]);
  assert.deepEqual(result.metadata.fallbackChain, ["codex-cli", "kimi-cli"]);
});

test("runtime router keeps Kimi as compatibility fallback when preferred runtimes are absent", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-cli", calls),
    ],
  });

  const result = await router.execute(fakeTask({ prompt: "implement a fallback-only patch" }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "kimi-cli");
  assert.deepEqual(calls, ["kimi-cli"]);
  assert.deepEqual(result.metadata.fallbackChain, ["kimi-cli"]);
});

test("runtime router filters runtimes that lack requested task capabilities", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("deepseek-api", calls, {
        read: true,
        write: false,
        shell: false,
        mcp: false,
        patch: false,
        review: true,
        merge: false,
        vision: false,
      }),
      fakeRuntime("codex-cli", calls, {
        read: true,
        write: true,
        shell: true,
        mcp: false,
        patch: true,
        review: true,
        merge: false,
        vision: false,
      }),
    ],
  });

  const result = await router.execute(fakeTask({
    prompt: "review then patch and run shell test",
    capabilities: {
      read: true,
      write: true,
      shell: true,
      mcp: false,
      patch: true,
      review: true,
      merge: false,
      vision: false,
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "codex-cli");
  assert.deepEqual(calls, ["codex-cli"]);
  assert.deepEqual(result.metadata.fallbackChain, ["codex-cli"]);
});

test("runtime router honors task provider policy and does not fall back to Kimi implicitly", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-cli", calls),
      fakeRuntime("codex-cli", calls),
    ],
  });

  const result = await router.execute(fakeTask({
    prompt: "implement with explicitly requested codex provider",
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: ["codex"],
      fallbackChain: [],
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "codex-cli");
  assert.deepEqual(calls, ["codex-cli"]);
  assert.deepEqual(result.metadata.fallbackChain, ["codex-cli"]);
});

function fakeRuntime(id, calls, capabilities) {
  return {
    id,
    priority: id === "kimi-cli" ? 100 : 60,
    capabilities,
    supports: () => true,
    async runNode() {
      return {
        success: true,
        exitCode: 0,
        stdout: id,
        stderr: "",
        metadata: { runtime: id },
      };
    },
    async execute() {
      calls.push(id);
      return {
        output: id,
        exitCode: 0,
        metadata: { runtime: id },
      };
    },
  };
}

function fakeTask(overrides = {}) {
  return {
    prompt: "implement a change",
    context: {
      runId: "local-runtime-router-test",
      nodeId: "coder-node",
      role: "coder",
      goal: "provider-neutral routing",
      system: "",
      files: [],
      memory: [],
      cwd: process.cwd(),
    },
    tools: { available: [] },
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: [],
      fallbackChain: [],
    },
    capabilities: {
      read: true,
      write: true,
      shell: false,
      mcp: false,
      patch: true,
      review: false,
      merge: false,
      vision: false,
    },
    ...overrides,
  };
}
