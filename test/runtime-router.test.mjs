import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRuntimeBackedTaskRunner } from "../dist/runtime/runtime-backed-task-runner.js";
import {
  createRuntimeRouter,
  sortRuntimesByCapabilityScore,
  computeRuntimeCapabilityScore,
} from "../dist/runtime/runtime-router.js";
import { createKimiApiRuntime } from "../dist/runtime/kimi-api-runtime.js";
import { buildTaskRunContext } from "../dist/runtime/worker-manifest.js";
import { classifyRuntimeFailure } from "../dist/runtime/runtime-failure-classifier.js";

test("runtime router prefers configured advisory API for advisory coding intent when API and CLI runtimes are available", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("mimo-api", calls, advisoryApiCapabilities({ vision: true, supportsToolCalling: true }), { priority: 100 }),
      fakeRuntime("codex-cli", calls),
    ],
  });

  const result = await router.execute(fakeTask({
    prompt: "implement the provider-neutral routing patch",
    capabilities: {
      read: true,
      write: false,
      shell: false,
      mcp: false,
      patch: false,
      review: true,
      merge: false,
      vision: false,
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "mimo-api");
  assert.deepEqual(calls, ["mimo-api"]);
  assert.deepEqual(result.metadata.fallbackChain, ["mimo-api", "codex-cli"]);
});

test("runtime router skips API advisory runtimes for workspace-write tasks", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("mimo-api", calls, advisoryApiCapabilities({ vision: true, supportsToolCalling: true })),
      fakeRuntime("kimi-api", calls, advisoryApiCapabilities({ vision: true, supportsToolCalling: true })),
      fakeRuntime("local-llm", calls, advisoryApiCapabilities()),
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
    prompt: "implement the provider-neutral routing patch",
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
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "codex-cli");
  assert.deepEqual(calls, ["codex-cli"]);
});

test("runtime router keeps decision class stable when provider ID changes but semantics match", async () => {
  const task = fakeTask({
    prompt: "review provider-neutral routing invariants",
    context: {
      ...fakeTask().context,
      nodeId: "review-node",
      role: "reviewer",
      goal: "provider-neutral routing invariants",
    },
    capabilities: advisoryApiCapabilities({ supportsToolCalling: true }),
  });

  const knownNeutral = await selectedRuntimeFor({
    task,
    runtimes: [
      fakeRuntime("mimo-api", [], advisoryApiCapabilities({ supportsToolCalling: true }), { priority: 100 }),
      fakeRuntime("codex-cli", [], workspaceCliCapabilities(), { priority: 60 }),
    ],
  });
  const genericNeutral = await selectedRuntimeFor({
    task,
    runtimes: [
      fakeRuntime("qwen-api", [], advisoryApiCapabilities({ supportsToolCalling: true }), { priority: 100 }),
      fakeRuntime("codex-cli", [], workspaceCliCapabilities(), { priority: 60 }),
    ],
  });

  assert.equal(runtimeDecisionClass(knownNeutral), "advisory-api");
  assert.equal(
    runtimeDecisionClass(genericNeutral),
    runtimeDecisionClass(knownNeutral),
    "same capability vector and priority must route to the same decision class independent of runtime ID/vendor"
  );
});

test("runtime router uses provider ID as a deterministic final tie-break after semantic ties", async () => {
  const task = fakeTask({
    prompt: "review provider-neutral tie-break invariants",
    context: {
      ...fakeTask().context,
      nodeId: "tie-break-review-node",
      role: "reviewer",
      goal: "provider-neutral tie-break invariants",
    },
    capabilities: advisoryApiCapabilities(),
  });
  const capabilities = advisoryApiCapabilities();

  const firstOrder = await selectedRuntimeFor({
    task,
    runtimes: [
      fakeRuntime("zeta-api", [], capabilities, { priority: 70 }),
      fakeRuntime("alpha-api", [], capabilities, { priority: 70 }),
    ],
  });
  const secondOrder = await selectedRuntimeFor({
    task,
    runtimes: [
      fakeRuntime("alpha-api", [], capabilities, { priority: 70 }),
      fakeRuntime("zeta-api", [], capabilities, { priority: 70 }),
    ],
  });

  assert.equal(runtimeDecisionClass(firstOrder), "advisory-api");
  assert.equal(
    firstOrder,
    secondOrder,
    "provider/runtime ID tie-break must be deterministic and not depend on registration order"
  );
});


test("Kimi API runtime is direct HTTP and not a legacy CLI runtime", () => {
  const runtime = createKimiApiRuntime({ apiKey: "test-key" });

  assert.equal(runtime.providerId, "kimi");
  assert.equal(runtime.legacy, false);
  assert.equal(runtime.runtimeMode, "api");
});

test("runtime router blocks legacy provider CLI in neutral mode and provider-only Kimi requests", async () => {
  const calls = [];
  const neutralRouter = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-cli", calls),
    ],
  });

  await assert.rejects(
    () => neutralRouter.execute(fakeTask({ prompt: "implement a fallback-only patch" })),
    /No runtime supports task for node coder-node.*Detected runtimes: legacy-external-runtime/
  );
  assert.deepEqual(calls, []);

  const explicitProviderRouter = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-cli", calls),
    ],
  });
  await assert.rejects(
    () => explicitProviderRouter.execute(fakeTask({
      prompt: "provider=kimi must not unlock legacy CLI runtime",
      providerPolicy: {
        strategy: "priority-first",
        preferredProviders: ["kimi"],
        fallbackChain: [],
      },
    })),
    /No runtime supports task for node coder-node.*Detected runtimes: legacy-external-runtime/
  );
  assert.deepEqual(calls, []);

  calls.length = 0;
  const explicitRuntimeRouter = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-cli", calls),
    ],
  });
  const explicitRuntime = await explicitRuntimeRouter.execute(fakeTask({
    prompt: "run through explicit legacy Kimi runtime fallback chain",
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: [],
      fallbackChain: ["kimi-cli"],
    },
  }));

  assert.equal(explicitRuntime.exitCode, 0);
  assert.equal(explicitRuntime.metadata.selectedRuntime, "kimi-cli");
  assert.deepEqual(calls, ["kimi-cli"]);
  assert.deepEqual(explicitRuntime.metadata.fallbackChain, ["kimi-cli"]);
});

test("runtime router excludes legacy compatibility runtime modes from neutral auto selection", async () => {
  for (const legacyRuntimeId of legacyCompatibilityRuntimeIds()) {
    const calls = [];
    const router = createRuntimeRouter({
      runtimes: [
        fakeRuntime(legacyRuntimeId, calls, workspaceCliCapabilities(), { priority: 1000 }),
        fakeRuntime("codex-cli", calls, workspaceCliCapabilities(), { priority: 10 }),
      ],
    });

    const result = await router.execute(fakeTask({
      prompt: `neutral route should skip ${legacyRuntimeId}`,
    }));

    assert.equal(result.exitCode, 0);
    assert.equal(result.metadata.selectedRuntime, "codex-cli");
    assert.deepEqual(result.metadata.fallbackChain, ["codex-cli"]);
    assert.deepEqual(calls, ["codex-cli"]);
  }
});

test("runtime router allows legacy compatibility runtimes only through explicit fallback runtime requests", async () => {
  for (const legacyRuntimeId of legacyCompatibilityRuntimeIds()) {
    const calls = [];
    const router = createRuntimeRouter({
      runtimes: [
        fakeRuntime(legacyRuntimeId, calls, workspaceCliCapabilities(), { priority: 10 }),
      ],
    });

    const result = await router.execute(fakeTask({
      prompt: `explicit fallback route may use ${legacyRuntimeId}`,
      providerPolicy: {
        strategy: "priority-first",
        preferredProviders: [],
        fallbackChain: [legacyRuntimeId],
      },
    }));

    assert.equal(result.exitCode, 0);
    assert.equal(result.metadata.selectedRuntime, legacyRuntimeId);
    assert.deepEqual(result.metadata.fallbackChain, [legacyRuntimeId]);
    assert.deepEqual(calls, [legacyRuntimeId]);
  }
});

test("runtime router keeps explicit fallback runtime requests exact for legacy compatibility runtimes", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-print", calls, workspaceCliCapabilities(), { priority: 1000 }),
      fakeRuntime("kimi-cli", calls, workspaceCliCapabilities(), { priority: 10 }),
    ],
  });

  const result = await router.execute(fakeTask({
    prompt: "explicit fallback route must not unlock sibling legacy runtimes",
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: [],
      fallbackChain: ["kimi-cli"],
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "kimi-cli");
  assert.deepEqual(result.metadata.fallbackChain, ["kimi-cli"]);
  assert.deepEqual(calls, ["kimi-cli"]);
});

test("runtime router allows legacy compatibility runtime through explicit fallback provider request", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("kimi-print", calls, workspaceCliCapabilities(), { priority: 100 }),
      fakeRuntime("codex-cli", calls, workspaceCliCapabilities(), { priority: 10 }),
    ],
  });

  const result = await router.execute(fakeTask({
    prompt: "explicit fallback provider route may use legacy provider runtime",
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: [],
      fallbackChain: ["kimi"],
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "kimi-print");
  assert.deepEqual(result.metadata.fallbackChain, ["kimi-print", "codex-cli"]);
  assert.deepEqual(calls, ["kimi-print"]);
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

test("runtime router explains MCP authority route blocks", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("codex-cli", calls, {
        read: true,
        write: true,
        shell: true,
        mcp: false,
        patch: true,
        review: true,
        merge: false,
        vision: false,
        supportsToolCalling: true,
      }),
    ],
  });

  await assert.rejects(
    () => router.execute(fakeTask({
      prompt: "execute MCP-backed worker task",
      capabilities: {
        read: true,
        write: true,
        shell: true,
        mcp: true,
        patch: true,
        review: false,
        merge: false,
        vision: false,
        toolCalling: true,
      },
    })),
    /Node requires MCP authority.*Codex CLI runtime does not receive OMK MCP authority/
  );
  assert.deepEqual(calls, []);
});

test("runtime router uses runtime display metadata for MCP authority route blocks", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("acme-cli", calls, {
        read: true,
        write: true,
        shell: true,
        mcp: false,
        patch: true,
        review: true,
        merge: false,
        vision: false,
        supportsToolCalling: true,
      }, { displayName: "Acme CLI" }),
    ],
  });

  await assert.rejects(
    () => router.execute(fakeTask({
      prompt: "execute MCP-backed worker task",
      capabilities: {
        read: true,
        write: true,
        shell: true,
        mcp: true,
        patch: true,
        review: false,
        merge: false,
        vision: false,
        toolCalling: true,
      },
    })),
    /Node requires MCP authority.*Acme CLI runtime does not receive OMK MCP authority/
  );
  assert.deepEqual(calls, []);
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

test("runtime router accepts explicit MiMo advisory chat turns after authority downgrade", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("mimo-api", calls, {
        read: true,
        write: false,
        shell: false,
        mcp: false,
        patch: false,
        review: true,
        merge: false,
        vision: true,
        supportsToolCalling: true,
      }),
    ],
  });

  const result = await router.execute(fakeTask({
    prompt: "npm run verify 해줘",
    context: {
      runId: "local-runtime-router-test",
      nodeId: "chat-turn",
      role: "coordinator",
      goal: "native mimo advisory shell turn",
      system: "",
      files: [],
      memory: [],
      cwd: process.cwd(),
      risk: "shell",
      sandboxMode: "read-only",
    },
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: ["mimo"],
      fallbackChain: [],
    },
    capabilities: {
      read: true,
      write: false,
      shell: false,
      mcp: false,
      patch: false,
      review: true,
      merge: false,
      vision: false,
    },
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "mimo-api");
  assert.deepEqual(calls, ["mimo-api"]);
});

test("runtime-backed runner routes non-Kimi CLI turns without optional capability over-constraint", async () => {
  const runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: {}, runId: "local-runtime-backed" });
  const registry = runner._registry;
  registry.unregister("codex-cli");
  registry.unregister("kimi-print");
  registry.unregister("deepseek-api");
  registry.unregister("opencode-cli");
  registry.unregister("commandcode-cli");
  registry.unregister("omk-advisory");

  const calls = [];
  registry.register(fakeRuntime("opencode-cli", calls, {
    read: true,
    write: true,
    shell: true,
    mcp: false,
    patch: true,
    review: true,
    merge: false,
    vision: false,
  }));

  const result = await runner.run({
    id: "native-turn",
    name: "Implement a small patch",
    role: "coder",
    dependsOn: [],
    status: "running",
    retries: 0,
    maxRetries: 1,
    outputs: [{ name: "diff", gate: "summary" }],
    routing: {
      provider: "opencode",
      readOnly: false,
      contextBudget: "small",
    },
  }, {});

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, ["opencode-cli"]);
  assert.equal(result.metadata.selectedRuntime, "opencode-cli");
});


test("runtime-backed runner ignores legacy home provider config unless legacy mode is explicit", async () => {
  const home = await mkdtemp(join(tmpdir(), "omk-runtime-home-"));
  const previousEnv = {
    HOME: process.env.HOME,
    OMK_ORIGINAL_HOME: process.env.OMK_ORIGINAL_HOME,
    MIMO_API_KEY: process.env.MIMO_API_KEY,
    KIMI_API_KEY: process.env.KIMI_API_KEY,
    OMK_LEGACY_KIMI_ENABLED: process.env.OMK_LEGACY_KIMI_ENABLED,
  };

  try {
    process.env.HOME = home;
    delete process.env.OMK_ORIGINAL_HOME;
    delete process.env.MIMO_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.OMK_LEGACY_KIMI_ENABLED;

    await mkdir(join(home, ".kimi"), { recursive: true });
    await writeFile(join(home, ".kimi", "config.toml"), [
      "[providers.mimo]",
      "api_key = \"legacy-mimo-key\"",
      "[providers.kimi]",
      "api_key = \"legacy-kimi-key\"",
      "",
    ].join("\n"), "utf8");

    let runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, runId: "legacy-home-disabled" });
    let runtimeIds = runner._registry.list().map((runtime) => runtime.id);
    assert.equal(runtimeIds.includes("mimo-api"), false, "neutral mode must not read provider keys from legacy .kimi config");
    assert.equal(runtimeIds.includes("kimi-api"), false, "neutral mode must not register Kimi API from legacy .kimi config");

    await mkdir(join(home, ".omk"), { recursive: true });
    await writeFile(join(home, ".omk", "config.toml"), [
      "[providers.mimo]",
      "api_key = \"omk-mimo-key\"",
      "",
    ].join("\n"), "utf8");

    runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, runId: "omk-home-enabled" });
    runtimeIds = runner._registry.list().map((runtime) => runtime.id);
    assert.equal(runtimeIds.includes("mimo-api"), true, "neutral mode should read provider keys from OMK config");
    assert.equal(runtimeIds.includes("kimi-api"), false, "OMK config without Kimi credentials should not enable Kimi API");
    await writeFile(join(home, ".omk", "config.toml"), [
      "[providers.mimo]",
      "api_key = \"omk-mimo-key\"",
      "[providers.kimi]",
      "api_key = \"omk-kimi-key\"",
      "",
    ].join("\n"), "utf8");

    runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, runId: "omk-kimi-api-enabled" });
    runtimeIds = runner._registry.list().map((runtime) => runtime.id);
    assert.equal(runtimeIds.includes("kimi-api"), true, "neutral mode should read Kimi API credentials from OMK config");

    runner = await createRuntimeBackedTaskRunner({
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", OMK_LEGACY_KIMI_ENABLED: "true" },
      runId: "legacy-home-explicit",
    });
    runtimeIds = runner._registry.list().map((runtime) => runtime.id);
    assert.equal(runtimeIds.includes("kimi-api"), true, "Kimi API is allowed from legacy .kimi config only when legacy mode is explicit");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
});

test("runtime-backed runner forwards per-turn env and routing providerModel", async () => {
  const runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: { OMK_PROVIDER_MODEL: "initial-model" }, runId: "local-runtime-backed-model" });
  const registry = runner._registry;
  for (const runtime of [...registry.list()]) registry.unregister(runtime.id);

  let seen;
  registry.register({
    id: "codex-cli",
    priority: 100,
    capabilities: {
      read: true,
      write: false,
      shell: false,
      mcp: false,
      patch: false,
      review: false,
      merge: false,
      vision: false,
    },
    supports: () => true,
    async runNode() {
      throw new Error("execute path expected");
    },
    async execute(task) {
      seen = {
        providerModel: task.context.providerModel,
        envModel: task.context.env?.OMK_PROVIDER_MODEL,
      };
      return {
        output: "ok",
        exitCode: 0,
        metadata: { runtime: "codex-cli" },
      };
    },
  });

  const result = await runner.run({
    id: "native-model-turn",
    name: "Summarize",
    role: "coordinator",
    dependsOn: [],
    status: "running",
    retries: 0,
    maxRetries: 1,
    routing: {
      provider: "codex",
      providerModel: "routing-model",
      readOnly: true,
      assignedProviderCapabilities: ["read"],
      contextBudget: "small",
    },
  }, { OMK_PROVIDER_MODEL: "turn-env-model" });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, {
    providerModel: "routing-model",
    envModel: "turn-env-model",
  });
});

test("runtime router excludes unhealthy runtimes before execution", async () => {
  const calls = [];
  const router = createRuntimeRouter({
    runtimes: [
      fakeRuntime("unhealthy-cli", calls, workspaceCliCapabilities(), {
        priority: 100,
        health: async () => ({ runtimeId: "unhealthy-cli", available: false, reason: "quota exhausted", checkedAt: new Date().toISOString() }),
      }),
      fakeRuntime("healthy-cli", calls, workspaceCliCapabilities(), {
        priority: 10,
        health: async () => ({ runtimeId: "healthy-cli", available: true, checkedAt: new Date().toISOString() }),
      }),
    ],
  });

  const result = await router.execute(fakeTask({ prompt: "implement with healthy fallback" }));

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "healthy-cli");
  assert.deepEqual(calls, ["healthy-cli"]);
});

test("runtime router classifies failures, opens circuit, and falls back", async () => {
  assert.equal(classifyRuntimeFailure({ exitCode: 1, stderr: "429 rate limit" }).failureClass, "rate_limit");
  const calls = [];
  const flaky = {
    id: "flaky-cli",
    providerId: "flaky",
    runtimeMode: "cli",
    priority: 100,
    capabilities: workspaceCliCapabilities(),
    supports: () => true,
    async runNode() {
      throw new Error("execute path expected");
    },
    async execute() {
      calls.push("flaky-cli");
      return { output: "429 rate limit", exitCode: 1, metadata: { runtime: "flaky-cli" } };
    },
  };
  const healthy = fakeRuntime("healthy-cli", calls, workspaceCliCapabilities(), { priority: 10 });
  const router = createRuntimeRouter({ runtimes: [flaky, healthy] });

  const first = await router.execute(fakeTask({ prompt: "implement with fallback after rate limit" }));
  const second = await router.execute(fakeTask({ prompt: "implement with circuit breaker skip" }));

  assert.equal(first.exitCode, 0);
  assert.equal(first.metadata.selectedRuntime, "healthy-cli");
  assert.equal(second.exitCode, 0);
  assert.equal(second.metadata.selectedRuntime, "healthy-cli");
  assert.deepEqual(calls, ["flaky-cli", "healthy-cli", "healthy-cli"]);
});

test("runtime router feeds audit graph route evidence into execute scoring", async () => {
  const temp = await mkdtemp(join(tmpdir(), "omk-router-memory-"));
  const memoryPath = join(temp, "graph-state.json");
  const now = new Date().toISOString();
  await writeFile(memoryPath, JSON.stringify({
    nodes: [
      { id: "route-bad", type: "ProviderRoute", createdAt: now, updatedAt: now, properties: { selectedRuntime: "bad-cli", nodeId: "n1", intent: "coding" } },
      { id: "evidence-bad", type: "Evidence", createdAt: now, updatedAt: now, properties: { kind: "turn-result-fail", nodeId: "n1" } },
      { id: "route-good", type: "ProviderRoute", createdAt: now, updatedAt: now, properties: { selectedRuntime: "good-cli", nodeId: "n2", intent: "coding" } },
      { id: "evidence-good", type: "Evidence", createdAt: now, updatedAt: now, properties: { kind: "turn-result-pass", nodeId: "n2" } },
    ],
    edges: [
      { id: "edge-bad", type: "EVIDENCED_BY", from: "route-bad", to: "evidence-bad" },
      { id: "edge-good", type: "EVIDENCED_BY", from: "route-good", to: "evidence-good" },
    ],
  }), "utf8");

  try {
    const calls = [];
    const router = createRuntimeRouter({
      memoryPath,
      runtimes: [
        fakeRuntime("bad-cli", calls, workspaceCliCapabilities(), { priority: 50 }),
        fakeRuntime("good-cli", calls, workspaceCliCapabilities(), { priority: 50 }),
      ],
    });

    const result = await router.execute(fakeTask({ prompt: "implement using audit graph scoring" }));

    assert.equal(result.exitCode, 0);
    assert.equal(result.metadata.selectedRuntime, "good-cli");
    assert.equal(result.metadata.scores.find((score) => score.runtime === "good-cli").evidencePassRate, 1);
    assert.equal(result.metadata.scores.find((score) => score.runtime === "bad-cli").evidencePassRate, 0);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("runtime router records decision trace for executeTask path", async () => {
  const temp = await mkdtemp(join(tmpdir(), "omk-router-trace-"));
  const previousCwd = process.cwd();
  const calls = [];
  try {
    process.chdir(temp);
    const router = createRuntimeRouter({
      runtimes: [fakeRuntime("codex-cli", calls, workspaceCliCapabilities(), { priority: 80 })],
    });
    const node = {
      id: "trace-node",
      name: "Implement trace evidence",
      role: "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
      routing: {
        assignedProviderCapabilities: ["write", "patch"],
        contextBudget: "small",
      },
    };
    const capsule = {
      runId: "trace-run",
      nodeId: node.id,
      goal: "trace goal",
      task: node.name,
      system: "",
      node,
      dependencySummaries: [],
      evidenceRequirements: [],
      relevantFiles: [],
      graphMemory: [],
      priorAttempts: [],
      budget: { maxInputTokens: 4096, reservedOutputTokens: 1024, maxFileTokens: 0, maxToolResultTokens: 0, maxMemoryFacts: 0, compression: "summary" },
    };

    const result = await router.executeTask(fakeTask({
      prompt: "implement trace evidence",
      context: { ...fakeTask().context, runId: "trace-run", nodeId: node.id },
    }), capsule, new AbortController().signal);

    assert.equal(result.exitCode, 0);
    const trace = await readFile(join(temp, ".omk", "runs", "trace-run", "decisions.jsonl"), "utf8");
    assert.match(trace, /"component":"runtime-router"/);
    assert.match(trace, /path=executeTask/);
  } finally {
    process.chdir(previousCwd);
    await rm(temp, { recursive: true, force: true });
  }
});

test("runtime-backed runner applies headroom compacted capsule to AgentTask", async () => {
  const previousEnv = {
    OMK_CONTEXT_WINDOW: process.env.OMK_CONTEXT_WINDOW,
    OMK_HEADROOM_THRESHOLD: process.env.OMK_HEADROOM_THRESHOLD,
  };
  try {
    process.env.OMK_CONTEXT_WINDOW = "1";
    process.env.OMK_HEADROOM_THRESHOLD = "0.5";
    const runner = await createRuntimeBackedTaskRunner({
      cwd: process.cwd(),
      env: {},
      runId: "local-headroom-compact",
      headroomCompactor: async () => "compact capsule summary",
    });
    const registry = runner._registry;
    for (const runtime of [...registry.list()]) registry.unregister(runtime.id);

    let captured;
    registry.register({
      id: "codex-cli",
      priority: 100,
      capabilities: workspaceCliCapabilities(),
      supports: () => true,
      async runNode() {
        throw new Error("execute path expected");
      },
      async execute(task) {
        captured = task;
        return { output: "ok", exitCode: 0, metadata: { runtime: "codex-cli" } };
      },
    });

    const result = await runner.run({
      id: "headroom-node",
      name: "Implement compacted context handoff",
      role: "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
      outputs: [{ name: "diff", gate: "summary" }],
      routing: {
        readOnly: false,
        assignedProviderCapabilities: ["write", "patch"],
        contextBudget: "small",
      },
    }, {});

    assert.equal(result.exitCode, 0);
    assert.equal(result.metadata.headroomCompaction.compacted, true);
    assert.equal(result.metadata.headroomCompaction.via, "headroom");
    assert.match(
      captured.context.system,
      /compact capsule summary|Headroom compaction removed required/,
    );
  } finally {
    if (previousEnv.OMK_CONTEXT_WINDOW === undefined) delete process.env.OMK_CONTEXT_WINDOW;
    else process.env.OMK_CONTEXT_WINDOW = previousEnv.OMK_CONTEXT_WINDOW;
    if (previousEnv.OMK_HEADROOM_THRESHOLD === undefined) delete process.env.OMK_HEADROOM_THRESHOLD;
    else process.env.OMK_HEADROOM_THRESHOLD = previousEnv.OMK_HEADROOM_THRESHOLD;
  }
});

test("runtime-backed runner autocompacts with structured fallback when headroom CLI compaction is unavailable", async () => {
  const previousEnv = {
    OMK_CONTEXT_WINDOW: process.env.OMK_CONTEXT_WINDOW,
    OMK_HEADROOM_THRESHOLD: process.env.OMK_HEADROOM_THRESHOLD,
  };
  try {
    process.env.OMK_CONTEXT_WINDOW = "1";
    process.env.OMK_HEADROOM_THRESHOLD = "0.5";
    const runner = await createRuntimeBackedTaskRunner({
      cwd: process.cwd(),
      env: {},
      runId: "local-headroom-fallback-autocompact",
      headroomCompactor: async () => null,
    });
    const registry = runner._registry;
    for (const runtime of [...registry.list()]) registry.unregister(runtime.id);

    let captured;
    registry.register({
      id: "codex-cli",
      priority: 100,
      capabilities: workspaceCliCapabilities(),
      supports: () => true,
      async runNode() {
        throw new Error("execute path expected");
      },
      async execute(task) {
        captured = task;
        return {
          output: "ok",
          exitCode: 0,
          metadata: {
            runtime: "codex-cli",
            evidenceGates: ["command-pass"],
            commandPass: true,
          },
        };
      },
    });

    const result = await runner.run({
      id: "headroom-fallback-node",
      name: "Implement fallback autocompact handoff",
      role: "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
      outputs: [{ name: "command evidence", gate: "command-pass" }],
      routing: {
        provider: "codex",
        risk: "write",
        sandboxMode: "workspace-write",
        readOnly: false,
        evidenceRequired: true,
        assignedProviderCapabilities: ["write", "patch"],
        contextBudget: "small",
      },
    }, {});

    assert.equal(result.exitCode, 0);
    assert.equal(result.metadata.headroomCompaction.compacted, true);
    assert.equal(result.metadata.headroomCompaction.via, "fallback");
    assert.match(captured.context.system, /omk\.structured-compaction\.v1/);
    assert.match(captured.context.system, /command-pass/);
  } finally {
    if (previousEnv.OMK_CONTEXT_WINDOW === undefined) delete process.env.OMK_CONTEXT_WINDOW;
    else process.env.OMK_CONTEXT_WINDOW = previousEnv.OMK_CONTEXT_WINDOW;
    if (previousEnv.OMK_HEADROOM_THRESHOLD === undefined) delete process.env.OMK_HEADROOM_THRESHOLD;
    else process.env.OMK_HEADROOM_THRESHOLD = previousEnv.OMK_HEADROOM_THRESHOLD;
  }
});

test("runtime-backed runner forwards OMK-owned scoped worker manifest into native AgentTask", async () => {
  const runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: {}, runId: "local-runtime-backed-owner" });
  const registry = runner._registry;
  for (const runtime of [...registry.list()]) registry.unregister(runtime.id);

  let captured;
  registry.register({
    id: "test-cli",
    providerId: "test-provider",
    runtimeMode: "cli",
    priority: 100,
    capabilities: {
      read: true,
      write: true,
      shell: true,
      mcp: true,
      patch: true,
      review: true,
      merge: true,
      vision: false,
      supportsToolCalling: true,
    },
    supports: () => true,
    async runNode() {
      throw new Error("execute path expected");
    },
    async execute(task) {
      captured = task;
      return {
        output: "ok",
        exitCode: 0,
        metadata: { runtime: "test-cli" },
      };
    },
  });

  const node = {
    id: "owned-worker",
    name: "Implement with scoped worker tools",
    role: "coder",
    dependsOn: [],
    status: "running",
    retries: 0,
    maxRetries: 1,
    outputs: [{ name: "diff", gate: "summary" }],
    routing: {
      provider: "codex",
      readOnly: false,
      requiresMcp: true,
      requiresToolCalling: true,
      skills: ["omk-typescript-strict", "custom-skill"],
      mcpServers: ["omk-project", "custom-mcp"],
      hooks: ["protect-secrets.sh", "custom-hook"],
      tools: ["custom-tool"],
      assignedProviderCapabilities: ["write", "patch", "shell", "mcp"],
      contextBudget: "small",
    },
  };
  const runContext = buildTaskRunContext({
    runId: "local-runtime-backed-owner",
    root: process.cwd(),
    node,
    toolPlane: {
      mcpServers: ["omk-project", "custom-mcp"],
      skills: ["omk-typescript-strict", "custom-skill"],
      hooks: ["protect-secrets.sh", "custom-hook"],
      tools: ["custom-tool"],
      requiresRuntimeMcp: true,
    },
    selectedRuntimeId: "test-cli",
    model: "test-cli",
  });

  const result = await runner.run(node, {}, undefined, runContext);

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "test-cli");
  assert.equal(result.metadata.workerOwner, "omk");
  assert.deepEqual(captured.tools.mcpServers, ["omk-project", "custom-mcp"]);
  assert.deepEqual(captured.tools.skills, ["omk-typescript-strict", "custom-skill"]);
  assert.deepEqual(captured.tools.hooks, ["protect-secrets.sh", "custom-hook"]);
  assert.deepEqual(captured.tools.available.map((tool) => tool.name), ["custom-tool"]);
  assert.equal(captured.context.workerManifest.owner, "omk");
  assert.equal(captured.context.workerManifest.toolPlane.requiresRuntimeMcp, true);
  assert.equal(captured.context.env.OMK_NODE_SKILLS, "omk-typescript-strict,custom-skill");
  assert.equal(captured.context.env.OMK_NODE_MCP_SERVERS, "omk-project,custom-mcp");
  assert.equal(captured.context.env.OMK_NODE_HOOKS, "protect-secrets.sh,custom-hook");
  assert.equal(captured.context.env.OMK_NODE_TOOLS, "custom-tool");
});

test("capability sort precomputes scores into a Map without changing order vs recompute-in-comparator reference", () => {
  const intents = [
    "research",
    "planning",
    "coding",
    "debugging",
    "refactor",
    "review",
    "test-generation",
    "documentation",
    "shell-operation",
  ];

  const base = [
    fakeRuntime("alpha-api", [], advisoryApiCapabilities({ supportsToolCalling: true }), { priority: 70 }),
    fakeRuntime("zeta-api", [], advisoryApiCapabilities({ supportsToolCalling: true }), { priority: 70 }),
    fakeRuntime("codex-cli", [], workspaceCliCapabilities(), { priority: 60 }),
    fakeRuntime("omega-cli", [], workspaceCliCapabilities(), { priority: 90 }),
    fakeRuntime("vision-api", [], advisoryApiCapabilities({ vision: true, supportsToolCalling: true }), { priority: 60 }),
    fakeRuntime("nocaps-runtime", [], undefined, { priority: 50 }),
  ];

  // Exact pre-change comparator: recompute capability score for both operands per comparison.
  const referenceOrder = (runtimes, intent) =>
    [...runtimes]
      .sort((a, b) => {
        const capabilityDelta =
          computeRuntimeCapabilityScore(b, intent) - computeRuntimeCapabilityScore(a, intent);
        if (capabilityDelta !== 0) return capabilityDelta;
        const priorityDelta = b.priority - a.priority;
        if (priorityDelta !== 0) return priorityDelta;
        return a.id.localeCompare(b.id);
      })
      .map((r) => r.id);

  const permutations = [
    base,
    [...base].reverse(),
    [...base.slice(3), ...base.slice(0, 3)],
  ];

  for (const intent of intents) {
    const expected = referenceOrder(base, intent);
    for (const perm of permutations) {
      const cached = sortRuntimesByCapabilityScore(perm, intent).map((r) => r.id);
      assert.deepEqual(
        cached,
        referenceOrder(perm, intent),
        `intent=${intent}: cached sort must equal recompute reference`
      );
      // total-order comparator => order is independent of input permutation
      assert.deepEqual(cached, expected, `intent=${intent}: order must be permutation-independent`);
    }
  }
});

test("runtime router redacts secret-like provider stderr before exposing failures", async () => {
  const router = createRuntimeRouter({
    runtimes: [{
      id: "codex-cli",
      providerId: "codex",
      runtimeMode: "cli",
      priority: 100,
      capabilities: workspaceCliCapabilities(),
      supports: () => true,
      async runNode() {
        throw new Error("execute path expected");
      },
      async execute() {
        return { output: "provider failed with OPENAI_API_KEY=shortvalue", exitCode: 1, metadata: { runtime: "codex-cli" } };
      },
    }],
  });

  const result = await router.execute(fakeTask());

  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stderr, /shortvalue/);
  assert.match(result.stderr, /OPENAI_API_KEY=\*\*\*/);
  assert.equal(result.metadata.stderrRedacted, true);
  assert.equal(result.metadata.secretLikeContentRedacted, true);
});

test("runtime router retains full redacted stderr in private debug artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-stderr-retention-"));
  try {
    const router = createRuntimeRouter({
      runtimes: [{
        id: "codex-cli",
        providerId: "codex",
        runtimeMode: "cli",
        priority: 100,
        capabilities: workspaceCliCapabilities(),
        supports: () => true,
        async runNode() {
          throw new Error("execute path expected");
        },
        async execute() {
          return { output: `provider failed\n${"x".repeat(700)}\nOPENAI_API_KEY=shortvalue`, exitCode: 1, metadata: { runtime: "codex-cli" } };
        },
      }],
    });

    const result = await router.execute(fakeTask({
      context: {
        ...fakeTask().context,
        runId: "stderr-retention-test",
        nodeId: "coder-node",
        cwd: root,
        env: { OMK_PRIVATE_STDERR_ARTIFACTS: "1" },
      },
    }));

    assert.equal(result.exitCode, 1);
    assert.equal(result.metadata.stderrRetainedPrivately, true);
    assert.match(result.metadata.stderrPrivateArtifact, /^private\/stderr\//);
    assert.doesNotMatch(result.stderr, /shortvalue/);
    const artifact = JSON.parse(await readFile(join(root, ".omk", "runs", "stderr-retention-test", result.metadata.stderrPrivateArtifact), "utf8"));
    assert.equal(artifact.schemaVersion, "omk.private-stderr.v1");
    assert.match(artifact.stderr, /x{700}/);
    assert.doesNotMatch(artifact.stderr, /shortvalue/);
    assert.match(artifact.stderr, /OPENAI_API_KEY=\*\*\*/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime router synthetic capsule redacts direct task prompt from public node label", async () => {
  let capturedCapsule;
  const secretPrompt = "implement private customer bugfix with token-like marker demo-token-12345";
  const router = createRuntimeRouter({
    runtimes: [{
      id: "codex-cli",
      providerId: "codex",
      runtimeMode: "cli",
      priority: 100,
      capabilities: workspaceCliCapabilities(),
      supports: () => true,
      async runNode(capsule) {
        capturedCapsule = capsule;
        return { success: true, exitCode: 0, stdout: "ok", stderr: "", metadata: { runtime: "codex-cli" } };
      },
    }],
  });

  const result = await router.execute(fakeTask({ prompt: secretPrompt }));

  assert.equal(result.exitCode, 0);
  assert.ok(capturedCapsule, "expected runtime to receive a synthetic capsule");
  assert.equal(capturedCapsule.task, secretPrompt);
  assert.doesNotMatch(capturedCapsule.node.name, /private customer bugfix/);
  assert.doesNotMatch(capturedCapsule.node.name, /demo-token-12345/);
  assert.match(capturedCapsule.node.name, /^runtime task:[a-f0-9]{12}$/);
  assert.equal(capturedCapsule.node.routing.promptMode, "synthetic-private");
  assert.match(capturedCapsule.node.routing.promptHash, /^[a-f0-9]{64}$/);
});

async function selectedRuntimeFor({ task, runtimes }) {
  const router = createRuntimeRouter({ runtimes });
  const result = await router.execute(task);
  assert.equal(result.exitCode, 0);
  return result.metadata.selectedRuntime;
}

function fakeRuntime(id, calls, capabilities, options = {}) {
  return {
    id,
    providerId: options.providerId ?? id.split("-")[0],
    runtimeMode: options.runtimeMode ?? id.split("-").slice(1).join("-"),
    legacy: options.legacy ?? legacyCompatibilityRuntimeIds().includes(id),
    displayName: options.displayName,
    priority: options.priority ?? 60,
    capabilities,
    supports: options.supports ?? (() => true),
    ...(options.health && { health: options.health }),
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

function workspaceCliCapabilities(overrides = {}) {
  return {
    read: true,
    write: true,
    shell: true,
    mcp: false,
    patch: true,
    review: true,
    merge: false,
    vision: false,
    ...overrides,
  };
}

function advisoryApiCapabilities(overrides = {}) {
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

function runtimeDecisionClass(runtimeId) {
  if (runtimeId.endsWith("-api"))
    return "advisory-api";
  if (runtimeId.endsWith("-cli"))
    return "workspace-cli";
  return "other-runtime";
}

function legacyCompatibilityRuntimeIds() {
  return ["kimi-cli", "kimi-print", "kimi-wire"];
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

test("headroom guard keeps original capsule when compactor drops required sections", async () => {
  const previousEnv = {
    OMK_CONTEXT_WINDOW: process.env.OMK_CONTEXT_WINDOW,
    OMK_HEADROOM_THRESHOLD: process.env.OMK_HEADROOM_THRESHOLD,
  };
  try {
    process.env.OMK_CONTEXT_WINDOW = "1";
    process.env.OMK_HEADROOM_THRESHOLD = "0.5";
    const runner = await createRuntimeBackedTaskRunner({
      cwd: process.cwd(),
      env: {},
      runId: "local-headroom-guard",
      // Malicious compactor that strips task and routing information.
      headroomCompactor: async () => "compact summary without task or routing",
    });
    const registry = runner._registry;
    for (const runtime of [...registry.list()]) registry.unregister(runtime.id);

    let captured;
    registry.register({
      id: "codex-cli",
      priority: 100,
      capabilities: workspaceCliCapabilities(),
      supports: () => true,
      async runNode() {
        throw new Error("execute path expected");
      },
      async execute(task) {
        captured = task;
        return { output: "ok", exitCode: 0, metadata: { runtime: "codex-cli" } };
      },
    });

    const result = await runner.run({
      id: "headroom-guard-node",
      name: "Implement compacted context handoff",
      role: "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
      outputs: [{ name: "diff", gate: "summary" }],
      routing: {
        readOnly: false,
        assignedProviderCapabilities: ["write", "patch"],
        contextBudget: "small",
      },
    }, {});

    assert.equal(result.exitCode, 0);
    assert.equal(result.metadata.headroomCompaction.compacted, true);
    assert.equal(result.metadata.headroomCompaction.via, "headroom");
    assert.match(
      captured.context.system,
      /Headroom compaction removed required sections/,
    );
  } finally {
    if (previousEnv.OMK_CONTEXT_WINDOW === undefined) delete process.env.OMK_CONTEXT_WINDOW;
    else process.env.OMK_CONTEXT_WINDOW = previousEnv.OMK_CONTEXT_WINDOW;
    if (previousEnv.OMK_HEADROOM_THRESHOLD === undefined) delete process.env.OMK_HEADROOM_THRESHOLD;
    else process.env.OMK_HEADROOM_THRESHOLD = previousEnv.OMK_HEADROOM_THRESHOLD;
  }
});
