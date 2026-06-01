import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRuntimeBackedTaskRunner } from "../dist/runtime/runtime-backed-task-runner.js";
import { createRuntimeRouter } from "../dist/runtime/runtime-router.js";
import { createKimiApiRuntime } from "../dist/runtime/kimi-api-runtime.js";
import { buildTaskRunContext } from "../dist/runtime/worker-manifest.js";

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


test("legacy Kimi API runtime advertises explicit legacy metadata", () => {
  const runtime = createKimiApiRuntime({ apiKey: "test-key" });

  assert.equal(runtime.providerId, "kimi");
  assert.equal(runtime.legacy, true);
  assert.equal(runtime.runtimeMode, "api");
});

test("runtime router blocks legacy provider CLI in neutral mode and allows legacy Kimi only when explicit", async () => {
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
  const explicitProvider = await explicitProviderRouter.execute(fakeTask({
    prompt: "run through explicit Kimi compatibility provider",
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: ["kimi"],
      fallbackChain: [],
    },
  }));

  assert.equal(explicitProvider.exitCode, 0);
  assert.equal(explicitProvider.metadata.selectedRuntime, "kimi-cli");
  assert.deepEqual(calls, ["kimi-cli"]);

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
    assert.equal(runtimeIds.includes("kimi-api"), false, "neutral mode must not register legacy Kimi API from legacy config");

    await mkdir(join(home, ".omk"), { recursive: true });
    await writeFile(join(home, ".omk", "config.toml"), [
      "[providers.mimo]",
      "api_key = \"omk-mimo-key\"",
      "",
    ].join("\n"), "utf8");

    runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, runId: "omk-home-enabled" });
    runtimeIds = runner._registry.list().map((runtime) => runtime.id);
    assert.equal(runtimeIds.includes("mimo-api"), true, "neutral mode should read provider keys from OMK config");
    assert.equal(runtimeIds.includes("kimi-api"), false, "OMK config should not implicitly enable legacy Kimi");

    runner = await createRuntimeBackedTaskRunner({
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", OMK_LEGACY_KIMI_ENABLED: "true" },
      runId: "legacy-home-explicit",
    });
    runtimeIds = runner._registry.list().map((runtime) => runtime.id);
    assert.equal(runtimeIds.includes("kimi-api"), true, "legacy Kimi API is allowed only when legacy mode is explicit");
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

test("runtime-backed runner forwards OMK-owned scoped worker manifest into native AgentTask", async () => {
  const runner = await createRuntimeBackedTaskRunner({ cwd: process.cwd(), env: {}, runId: "local-runtime-backed-owner" });
  const registry = runner._registry;
  for (const runtime of [...registry.list()]) registry.unregister(runtime.id);

  let captured;
  registry.register({
    id: "codex-cli",
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
        metadata: { runtime: "codex-cli" },
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
    selectedRuntimeId: "codex-cli",
    model: "codex-cli",
  });

  const result = await runner.run(node, {}, undefined, runContext);

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.selectedRuntime, "codex-cli");
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
  return ["kimi-api", "kimi-cli", "kimi-print", "kimi-wire"];
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
