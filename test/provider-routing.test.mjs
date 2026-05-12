import test from "node:test";
import assert from "node:assert/strict";

import { createDag } from "../dist/orchestration/dag.js";
import { createExecutor } from "../dist/orchestration/executor.js";
import {
  ProviderHealthRegistry,
  DeepSeekClient,
  checkDeepSeekBalance,
  createDeepSeekReadOnlyTaskRunner,
  createProviderTaskRunner,
  isDeepSeekPaymentOrAvailabilityFailure,
  isDeepSeekTransientFailure,
  routeProvider,
  selectDeepSeekModelTier,
} from "../dist/providers/index.js";

test("provider router keeps Kimi in authority and offloads only low-risk read roles", () => {
  assert.equal(routeProvider(baseRoute({ role: "orchestrator" })).provider, "kimi");
  assert.equal(routeProvider(baseRoute({ role: "merger", risk: "merge" })).provider, "kimi");
  const coderRoute = routeProvider(baseRoute({ role: "coder", risk: "write" }));
  assert.equal(coderRoute.provider, "kimi");
  assert.equal(coderRoute.deepseek?.participation, "advisory");
  assert.equal(coderRoute.deepseek?.model, "deepseek-v4-pro");
  assert.equal(coderRoute.routeEnsemble.winner, "deepseek-pro-advisory");
  assert.equal(
    coderRoute.routeEnsemble.candidates.some((candidate) => candidate.id === "deepseek-pro-advisory" && candidate.selected),
    true
  );
  const reviewerRoute = routeProvider(baseRoute({ role: "reviewer" }));
  assert.equal(reviewerRoute.provider, "deepseek");
  assert.equal(reviewerRoute.routeEnsemble.winner, "deepseek-direct");
  assert.equal(routeProvider(baseRoute({ role: "explorer" })).provider, "deepseek");
  assert.equal(routeProvider(baseRoute({ role: "analyst", complexity: "simple", readOnly: false })).provider, "kimi");
  assert.equal(routeProvider(baseRoute({ role: "analyst", complexity: "simple", readOnly: true })).provider, "deepseek");
  const mcpRoute = routeProvider(baseRoute({ role: "reviewer", needsMcp: true }));
  assert.equal(mcpRoute.provider, "kimi");
  assert.equal(mcpRoute.routeEnsemble.winner, "safety-gate");
  assert.equal(
    mcpRoute.routeEnsemble.candidates.some((candidate) => candidate.id === "safety-gate" && candidate.veto),
    true
  );
  assert.equal(routeProvider(baseRoute({ role: "reviewer", providerPolicy: "kimi" })).provider, "kimi");
  assert.equal(routeProvider(baseRoute({ role: "reviewer", providerHint: "deepseek", complexity: "complex" })).provider, "kimi");
});

test("DeepSeek direct routing uses deterministic 60 flash / 40 pro tier buckets", () => {
  const tiers = Array.from({ length: 100 }, (_, index) => selectDeepSeekModelTier(`node-${index}`).tier);
  assert.equal(tiers.filter((tier) => tier === "flash").length, 60);
  assert.equal(tiers.filter((tier) => tier === "pro").length, 40);

  const flashRoute = routeProvider(baseRoute({ nodeId: "node-0", role: "reviewer" }));
  assert.equal(flashRoute.provider, "deepseek");
  assert.equal(flashRoute.deepseek?.participation, "direct");
  assert.equal(flashRoute.deepseek?.reasoningEffort, "max");
  assert.match(flashRoute.deepseek?.model ?? "", /^deepseek-v4-(flash|pro)$/);
});

test("dedicated DeepSeek model agents honor explicit Flash and Pro tiers on complex read-only routes", () => {
  const flash = routeProvider(baseRoute({
    nodeId: "deepseek-flash-agent",
    role: "planner",
    complexity: "complex",
    providerHint: "deepseek",
    preferredDeepSeekTier: "flash",
  }));
  const pro = routeProvider(baseRoute({
    nodeId: "deepseek-pro-agent",
    role: "reviewer",
    complexity: "complex",
    providerHint: "deepseek",
    preferredDeepSeekTier: "pro",
  }));

  assert.equal(flash.provider, "deepseek");
  assert.equal(flash.deepseek?.model, "deepseek-v4-flash");
  assert.equal(flash.deepseek?.tier, "flash");
  assert.equal(flash.deepseek?.ratioBucket, 0);
  assert.equal(flash.routeEnsemble.winner, "deepseek-direct");
  assert.equal(pro.provider, "deepseek");
  assert.equal(pro.deepseek?.model, "deepseek-v4-pro");
  assert.equal(pro.deepseek?.tier, "pro");
  assert.equal(pro.deepseek?.ratioBucket, 9);
  assert.equal(pro.routeEnsemble.winner, "deepseek-direct");
});

test("provider health disables DeepSeek for the remainder of a run", () => {
  const health = new ProviderHealthRegistry();
  assert.equal(health.isDeepSeekAvailable(), true);

  health.markDeepSeekUnavailable("DeepSeek 402 insufficient balance");

  assert.equal(health.isDeepSeekAvailable(), false);
  assert.equal(health.getDeepSeek()?.disableForRun, true);
});

test("provider task runner falls back from DeepSeek to Kimi and records metadata", async () => {
  const calls = [];
  const disabledEvents = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "DeepSeek 402 insufficient balance",
      };
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi fallback result",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({
    kimiRunner,
    deepseekRunner,
    onDeepSeekDisabled: (event) => {
      disabledEvents.push(event);
    },
  });
  const result = await runner.run(providerNode(), { OMK_TASK_TYPE: "review" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "kimi"]);
  assert.equal(disabledEvents.length, 1);
  assert.equal(disabledEvents[0].forced, true);
  assert.match(disabledEvents[0].reason, /402/);
  assert.equal(result.metadata.provider, "kimi");
  assert.equal(result.metadata.requestedProvider, "deepseek");
  assert.deepEqual(result.metadata.providerFallback.from, "deepseek");
  assert.match(result.metadata.providerFallback.reason, /402/);
  assert.equal(calls[1].env.OMK_PROVIDER_FALLBACK_FROM, "deepseek");
});

test("provider task runner records transient fallback metadata for rate limit and timeout failures", async () => {
  for (const { stderr, expectedReason } of [
    { stderr: "DeepSeek 429 rate limit exceeded", expectedReason: /rate limit/ },
    { stderr: "DeepSeek request timed out", expectedReason: /timed out/ },
  ]) {
    const calls = [];
    const health = new ProviderHealthRegistry();
    const deepseekRunner = {
      async run(_node, env) {
        calls.push({ provider: "deepseek", env });
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr,
        };
      },
    };
    const kimiRunner = {
      async run(_node, env) {
        calls.push({ provider: "kimi", env });
        return {
          success: true,
          exitCode: 0,
          stdout: "Kimi handled transient fallback",
          stderr: "",
        };
      },
    };

    const runner = createProviderTaskRunner({
      kimiRunner,
      deepseekRunner,
      providerHealth: health,
      deepseekMaxRetries: 0,
    });
    const result = await runner.run(providerNode(), { OMK_TASK_TYPE: "review" });

    assert.equal(result.success, true);
    assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "kimi"]);
    assert.equal(health.isDeepSeekAvailable(), false);
    assert.equal(result.metadata.provider, "kimi");
    assert.equal(result.metadata.requestedProvider, "deepseek");
    assert.equal(result.metadata.providerAttemptCount, 1);
    assert.equal(result.metadata.providerFallback.from, "deepseek");
    assert.equal(result.metadata.providerFallback.to, "kimi");
    assert.equal(result.metadata.providerFallback.attempts, 1);
    assert.equal(result.metadata.providerFallback.failureKind, "transient");
    assert.match(result.metadata.providerFallback.reason, expectedReason);
    assert.equal(calls[1].env.OMK_PROVIDER_FALLBACK_FROM, "deepseek");
    assert.match(calls[1].env.OMK_PROVIDER_FALLBACK_REASON, expectedReason);
  }
});

test("provider task runner preserves fallback metadata when Kimi fallback fails", async () => {
  const calls = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "DeepSeek 429 rate limit exceeded",
      };
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Kimi fallback failed",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner, deepseekMaxRetries: 0 });
  const result = await runner.run(providerNode(), { OMK_TASK_TYPE: "review" });

  assert.equal(result.success, false);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "kimi"]);
  assert.equal(result.metadata.provider, "kimi");
  assert.equal(result.metadata.requestedProvider, "deepseek");
  assert.equal(result.metadata.providerFallback.from, "deepseek");
  assert.equal(result.metadata.providerFallback.to, "kimi");
  assert.equal(result.metadata.providerFallback.failureKind, "transient");
  assert.match(result.metadata.providerFallback.reason, /rate limit/);
  assert.equal(calls[1].env.OMK_PROVIDER_FALLBACK_FROM, "deepseek");
});

test("provider task runner retries transient DeepSeek failures before returning success", async () => {
  const calls = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      if (calls.length === 1) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "DeepSeek 503 server overloaded",
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: "DeepSeek retry result",
        stderr: "",
      };
    },
  };
  const kimiRunner = {
    async run() {
      calls.push({ provider: "kimi", env: {} });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi should not run",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner, deepseekMaxRetries: 1 });
  const result = await runner.run(providerNode(), { OMK_TASK_TYPE: "review" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "deepseek"]);
  assert.equal(result.metadata.provider, "deepseek");
  assert.equal(result.metadata.providerAttemptCount, 2);
  assert.equal(calls[1].env.OMK_PROVIDER_ATTEMPT, "2");
});

test("provider task runner routes real auto-routed reviewer nodes through DeepSeek despite Kimi-only hints", async () => {
  const dag = createDag({
    nodes: [
      {
        id: "review-real-flow",
        name: "Review DAG provider flow",
        role: "reviewer",
        dependsOn: [],
        maxRetries: 1,
        outputs: [{ name: "review", gate: "review-pass" }],
      },
    ],
  });
  const node = dag.nodes[0];
  assert.ok((node.routing?.mcpServers?.length ?? 0) > 0 || (node.routing?.tools?.length ?? 0) > 0);
  assert.notEqual(node.routing?.requiresMcp, true);
  assert.notEqual(node.routing?.requiresToolCalling, true);

  const calls = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "## Summary\nDeepSeek reviewed the DAG flow.",
        stderr: "",
      };
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi should not run for direct DeepSeek reviewer route",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner });
  const result = await runner.run(node, { OMK_TASK_TYPE: "review" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek"]);
  assert.equal(result.metadata.provider, "deepseek");
  assert.equal(result.metadata.providerParticipation, "direct");
  assert.match(calls[0].env.OMK_PROVIDER_ROUTE_CONFIDENCE, /^0\.\d{2}$/);
  assert.match(calls[0].env.OMK_PROVIDER_ROUTE_ENSEMBLE, /winner=deepseek-direct/);
  assert.match(calls[0].env.OMK_DEEPSEEK_INVOCATION_KEY, /^omk-[0-9a-f]+$/);
  assert.equal(result.metadata.providerInvocationKey, calls[0].env.OMK_PROVIDER_INVOCATION_KEY);
  assert.equal(result.metadata.providerRouteEnsemble.winner, "deepseek-direct");
});

test("provider task runner invokes dedicated DeepSeek Pro model agents as real direct workers", async () => {
  const calls = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "DeepSeek Pro critique",
        stderr: "",
      };
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi fallback should not run",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner });
  const result = await runner.run({
    ...providerNode(),
    id: "deepseek-pro-agent",
    name: "DeepSeek Pro critical model review",
    role: "reviewer",
    routing: {
      provider: "deepseek",
      providerModelTier: "pro",
      readOnly: true,
      requiresMcp: false,
      requiresToolCalling: false,
    },
  }, { OMK_TASK_TYPE: "implement", OMK_COMPLEXITY: "complex" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek"]);
  assert.equal(calls[0].env.OMK_DEEPSEEK_MODEL, "deepseek-v4-pro");
  assert.equal(calls[0].env.OMK_DEEPSEEK_MODEL_TIER, "pro");
  assert.equal(calls[0].env.OMK_DEEPSEEK_PARTICIPATION, "direct");
  assert.equal(result.metadata.provider, "deepseek");
  assert.equal(result.metadata.providerModel, "deepseek-v4-pro");
  assert.equal(result.metadata.providerModelTier, "pro");
});

test("provider task runner runs DeepSeek advisory for real auto-routed coder nodes before Kimi", async () => {
  const dag = createDag({
    nodes: [
      {
        id: "coder-real-flow",
        name: "Modify provider files",
        role: "coder",
        dependsOn: [],
        maxRetries: 1,
        outputs: [{ name: "implementation notes", gate: "summary" }],
      },
    ],
  });
  const node = dag.nodes[0];
  assert.equal(node.routing?.readOnly, false);
  assert.ok((node.routing?.mcpServers?.length ?? 0) > 0 || (node.routing?.tools?.length ?? 0) > 0);

  const calls = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "DeepSeek advisory: keep Kimi as writer and patch provider-task-runner tests.",
        stderr: "",
      };
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi applied advisory safely.",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner });
  const result = await runner.run(node, { OMK_TASK_TYPE: "implementation" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "kimi"]);
  assert.equal(calls[0].env.OMK_DEEPSEEK_PARTICIPATION, "advisory");
  assert.match(calls[0].env.OMK_PROVIDER_ROUTE_ENSEMBLE, /winner=deepseek-pro-advisory/);
  assert.match(calls[1].env.OMK_PROVIDER_ROUTE_ENSEMBLE, /winner=deepseek-pro-advisory/);
  assert.match(calls[1].env.OMK_DEEPSEEK_ADVISORY, /keep Kimi as writer/);
  assert.equal(result.metadata.provider, "kimi");
  assert.equal(result.metadata.providerRouteEnsemble.winner, "deepseek-pro-advisory");
  assert.equal(result.metadata.providerAssist.provider, "deepseek");
  assert.equal(result.metadata.providerAssist.participation, "advisory");
});

test("provider task runner uses DeepSeek V4 Pro Max as advisory for file-affecting nodes before Kimi", async () => {
  const calls = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "DeepSeek patch strategy: inspect src/providers/router.ts and update tests.",
        stderr: "",
      };
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi applied edits",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner });
  const result = await runner.run({
    ...providerNode(),
    id: "file-coder-provider",
    name: "Modify provider files",
    role: "coder",
    routing: { provider: "auto", readOnly: true },
  }, { OMK_TASK_TYPE: "implementation" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "kimi"]);
  assert.equal(calls[0].env.OMK_DEEPSEEK_MODEL, "deepseek-v4-pro");
  assert.equal(calls[0].env.OMK_DEEPSEEK_PARTICIPATION, "advisory");
  assert.match(calls[0].env.OMK_PROVIDER_ROUTE_ENSEMBLE, /winner=deepseek-pro-advisory/);
  assert.match(calls[0].env.OMK_DEEPSEEK_INVOCATION_KEY, /^omk-[0-9a-f]+$/);
  assert.equal(calls[1].env.OMK_PROVIDER_INVOCATION_KEY, calls[0].env.OMK_DEEPSEEK_INVOCATION_KEY);
  assert.match(calls[1].env.OMK_DEEPSEEK_ADVISORY, /patch strategy/);
  assert.equal(result.metadata.provider, "kimi");
  assert.equal(result.metadata.providerRouteEnsemble.winner, "deepseek-pro-advisory");
  assert.equal(result.metadata.providerAssist.provider, "deepseek");
  assert.equal(result.metadata.providerAssist.model, "deepseek-v4-pro");
  assert.equal(result.metadata.providerAssist.participation, "advisory");
  assert.equal(result.metadata.providerAssist.invocationKey, calls[0].env.OMK_DEEPSEEK_INVOCATION_KEY);
});

test("executor stores provider route and fallback evidence on node attempts", async () => {
  const executor = createExecutor({
    ensemble: false,
    persister: {
      async load() {
        return null;
      },
      async save() {},
    },
  });
  const dag = createDag({
    nodes: [
      {
        id: "review-provider-route",
        name: "Review provider route",
        role: "reviewer",
        dependsOn: [],
        maxRetries: 1,
      },
    ],
  });
  const runner = {
    async run() {
      return {
        success: true,
        exitCode: 0,
        stdout: "## Evidence\nreview complete",
        stderr: "",
        metadata: {
          provider: "kimi",
          requestedProvider: "deepseek",
          providerModel: "deepseek-v4-pro",
          providerModelTier: "pro",
          providerParticipation: "direct",
          providerFallback: {
            from: "deepseek",
            to: "kimi",
            reason: "DeepSeek 402 insufficient balance",
          },
        },
      };
    },
  };

  const result = await executor.execute(dag, runner, {
    runId: "provider-attempt-test",
    workers: 1,
    approvalPolicy: "yolo",
  });
  const attempt = result.state.nodes[0].attempts?.[0];

  assert.equal(result.success, true);
  assert.equal(attempt?.provider, "kimi");
  assert.equal(attempt?.requestedProvider, "deepseek");
  assert.equal(attempt?.fallbackFrom, "deepseek");
  assert.equal(attempt?.providerModel, "deepseek-v4-pro");
  assert.equal(attempt?.providerModelTier, "pro");
  assert.equal(attempt?.providerParticipation, "direct");
  assert.match(attempt?.fallbackReason ?? "", /402/);
});

test("DeepSeek availability checks handle missing keys, balance, and HTTP 402", async () => {
  const missing = await checkDeepSeekBalance({ env: {}, fetchImpl: failingFetch });
  assert.equal(missing.available, false);
  assert.match(missing.reason ?? "", /DEEPSEEK_API_KEY/);

  const available = await checkDeepSeekBalance({
    apiKey: "test-key",
    fetchImpl: async () => fakeResponse(200, { is_available: true, balance_infos: [] }),
  });
  assert.equal(available.available, true);

  const unpaid = await checkDeepSeekBalance({
    apiKey: "test-key",
    fetchImpl: async () => fakeResponse(402, { message: "insufficient balance" }),
  });
  assert.equal(unpaid.available, false);
  assert.match(unpaid.reason ?? "", /402/);
});

test("DeepSeek availability detector catches payment and provider failures", () => {
  assert.equal(
    isDeepSeekPaymentOrAvailabilityFailure({
      success: false,
      stdout: "",
      stderr: "DeepSeek 402 insufficient balance",
    }),
    true
  );
  assert.equal(
    isDeepSeekTransientFailure({
      success: false,
      stdout: "",
      stderr: "DeepSeek server overloaded",
    }),
    true
  );
});

test("DeepSeek client defaults to current v4 flash max-thinking request shape", async () => {
  let body;
  const client = new DeepSeekClient({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init.body));
      return fakeResponse(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "ok",
            },
          },
        ],
      });
    },
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "ping" }],
  });

  assert.equal(result, "ok");
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.reasoning_effort, "max");
  assert.equal("temperature" in body, false);
});

test("DeepSeek client applies max reasoning effort to explicit v4 pro too", async () => {
  let body;
  const client = new DeepSeekClient({
    apiKey: "test-key",
    model: "deepseek-v4-pro",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init.body));
      return fakeResponse(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "ok",
            },
          },
        ],
      });
    },
  });

  await client.complete({
    messages: [{ role: "user", content: "ping" }],
  });

  assert.equal(body.model, "deepseek-v4-pro");
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.reasoning_effort, "max");
});

test("DeepSeek runner allows Pro Max advisory on file-affecting nodes without write authority", async () => {
  let body;
  const runner = createDeepSeekReadOnlyTaskRunner({
    apiKey: "test-key",
    allowAdvisoryFileNodes: true,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init.body));
      return fakeResponse(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "advisory only",
            },
          },
        ],
      });
    },
  });

  const dag = createDag({
    nodes: [
      {
        id: "coder-file-node",
        role: "coder",
        name: "Plan file edits",
        dependsOn: [],
        maxRetries: 1,
        outputs: [{ name: "patch strategy", gate: "summary" }],
      },
    ],
  });
  const node = dag.nodes[0];
  assert.equal(node.routing?.readOnly, false);

  const result = await runner.run(node, {
    OMK_DEEPSEEK_MODEL: "deepseek-v4-pro",
    OMK_DEEPSEEK_MODEL_TIER: "pro",
    OMK_DEEPSEEK_PARTICIPATION: "advisory",
    OMK_DEEPSEEK_REASONING_EFFORT: "max",
  });

  assert.equal(result.success, true);
  assert.equal(body.model, "deepseek-v4-pro");
  assert.equal(body.reasoning_effort, "max");
  assert.match(result.stdout, /advisory only/);
});

test("DeepSeek runner treats auto-routing MCP and tool lists as Kimi-only hints", async () => {
  let body;
  const runner = createDeepSeekReadOnlyTaskRunner({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init.body));
      return fakeResponse(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "hint-only review",
            },
          },
        ],
      });
    },
  });
  const dag = createDag({
    nodes: [
      {
        id: "review-hint-node",
        name: "Review routed hints",
        role: "reviewer",
        dependsOn: [],
        maxRetries: 1,
        outputs: [{ name: "review", gate: "review-pass" }],
      },
    ],
  });
  const node = dag.nodes[0];
  assert.ok((node.routing?.mcpServers?.length ?? 0) > 0 || (node.routing?.tools?.length ?? 0) > 0);

  const result = await runner.run(node, {
    OMK_DEEPSEEK_MODEL: "deepseek-v4-flash",
    OMK_DEEPSEEK_MODEL_TIER: "flash",
    OMK_DEEPSEEK_PARTICIPATION: "direct",
  });

  assert.equal(result.success, true);
  assert.match(body.messages[1].content, /MCP hints visible to Kimi only/);
  assert.match(body.messages[1].content, /Tool hints visible to Kimi only/);
  assert.match(result.stdout, /hint-only review/);
});

test("DeepSeek runner includes Kimi goal context in worker prompts", async () => {
  let body;
  const runner = createDeepSeekReadOnlyTaskRunner({
    apiKey: "test-key",
    promptPrefix: "Kimi context: continue from failed goal evidence; do not repeat original goal.",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init.body));
      return fakeResponse(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "context-aware review",
            },
          },
        ],
      });
    },
  });

  const result = await runner.run(providerNode(), {
    OMK_TASK_TYPE: "review",
    OMK_GOAL_CONTEXT: "Goal context from env: failed node goal-followup needs a narrower retry.",
  });

  assert.equal(result.success, true);
  assert.match(body.messages[1].content, /continue from failed goal evidence/);
  assert.match(body.messages[0].content, /Do not echo the original user input/);
  assert.match(body.messages[1].content, /Goal context digest from Kimi/);
  assert.match(body.messages[1].content, /goal-followup/);
  assert.doesNotMatch(
    body.messages[1].content,
    /Goal context from env: failed node goal-followup needs a narrower retry\./
  );
  assert.match(body.messages[1].content, /Required output/);
});

function baseRoute(overrides = {}) {
  return {
    role: "reviewer",
    taskType: "review",
    risk: "read",
    complexity: "moderate",
    needsToolCalling: false,
    needsMcp: false,
    estimatedTokens: 1000,
    deepseekAvailable: true,
    ...overrides,
  };
}

function providerNode() {
  return {
    id: "review-provider",
    name: "Review provider",
    role: "reviewer",
    dependsOn: [],
    status: "pending",
    retries: 0,
    maxRetries: 1,
    routing: { provider: "auto", readOnly: true },
  };
}

async function failingFetch() {
  throw new Error("fetch should not run without key");
}

function fakeResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
    async json() {
      return payload;
    },
  };
}
