import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDag } from "../dist/orchestration/dag.js";
import { createExecutor } from "../dist/orchestration/executor.js";
import {
  ProviderHealthRegistry,
  DeepSeekClient,
  checkDeepSeekBalance,
  createDeepSeekReadOnlyTaskRunner,
  createOpenAICompatibleReadOnlyTaskRunner,
  createProviderBackedTaskRunner,
  createProviderTaskRunner,
  normalizeProviderPolicy,
  parseProviderModelArg,
  providerDoctorStatus,
  readProviderRegistry,
  setProviderConfig,
  isDeepSeekPaymentOrAvailabilityFailure,
  isDeepSeekTransientFailure,
  routeProvider,
  selectDeepSeekModelTier,
} from "../dist/providers/index.js";

const monthlyQuotaError = `LLM provider error: Error code: 429 - {'error': {'message': "You've reached kimi monthly usage limit for this billing cycle. Your quota will be refreshed in the next cycle.", 'type': 'exceeded_current_quota_error'}}`;

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

test("provider router supports Qwen, Codex, and OpenRouter policies with Kimi authority fallback", () => {
  const qwenRoute = routeProvider(baseRoute({
    role: "researcher",
    providerPolicy: "qwen",
    providerAvailability: { qwen: true },
    preferredModel: "Qwen 3.7 MAX",
  }));
  assert.equal(qwenRoute.provider, "qwen");
  assert.equal(qwenRoute.providerModel.provider, "qwen");
  assert.equal(qwenRoute.providerModel.model, "qwen3-max");
  assert.equal(qwenRoute.providerModel.authority, "direct");
  assert.equal(qwenRoute.routeEnsemble.winner, "qwen-direct");

  const codexPlanner = routeProvider(baseRoute({
    role: "planner",
    providerPolicy: "codex",
    providerAvailability: { codex: true },
    complexity: "complex",
    preferredModel: "codex-cli",
  }));
  assert.equal(codexPlanner.provider, "codex");
  assert.equal(codexPlanner.providerModel.provider, "codex");
  assert.equal(codexPlanner.routeEnsemble.winner, "codex-direct");

  const openRouterReview = routeProvider(baseRoute({
    role: "reviewer",
    providerPolicy: "openrouter",
    providerAvailability: { openrouter: true },
    preferredModel: "anthropic/claude-sonnet-4.5",
  }));
  assert.equal(openRouterReview.provider, "openrouter");
  assert.equal(openRouterReview.providerModel.provider, "openrouter");
  assert.equal(openRouterReview.providerModel.model, "anthropic/claude-sonnet-4.5");
  assert.equal(openRouterReview.providerModel.authority, "direct");
  assert.equal(openRouterReview.routeEnsemble.winner, "openrouter-direct");

  const qwenWrite = routeProvider(baseRoute({
    role: "coder",
    risk: "write",
    providerPolicy: "qwen",
    providerAvailability: { qwen: true },
    complexity: "complex",
  }));
  assert.equal(qwenWrite.provider, "kimi");
  assert.equal(qwenWrite.providerModel.provider, "qwen");
  assert.equal(qwenWrite.providerModel.authority, "advisory");
  assert.equal(qwenWrite.routeEnsemble.winner, "qwen-advisory");

  const openRouterWrite = routeProvider(baseRoute({
    role: "coder",
    risk: "write",
    providerPolicy: "openrouter",
    providerAvailability: { openrouter: true },
    complexity: "complex",
  }));
  assert.equal(openRouterWrite.provider, "kimi");
  assert.equal(openRouterWrite.providerModel.provider, "openrouter");
  assert.equal(openRouterWrite.providerModel.model, "openrouter/auto");
  assert.equal(openRouterWrite.providerModel.authority, "advisory");
  assert.equal(openRouterWrite.routeEnsemble.winner, "openrouter-advisory");

  const missingCodex = routeProvider(baseRoute({
    role: "reviewer",
    providerPolicy: "codex",
    providerAvailability: { codex: false },
  }));
  assert.equal(missingCodex.provider, "kimi");
  assert.equal(missingCodex.providerModel.provider, "codex");
  assert.equal(missingCodex.providerModel.authority, "veto");
  assert.equal(missingCodex.routeEnsemble.winner, "safety-gate");
});

test("provider model parser normalizes Qwen 3.7 MAX, OpenRouter models, and known provider policies", () => {
  assert.deepEqual(parseProviderModelArg("qwen/Qwen 3.7 MAX"), { provider: "qwen", model: "qwen3-max" });
  assert.deepEqual(parseProviderModelArg("openrouter/anthropic/claude-sonnet-4.5"), {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.5",
  });
  assert.equal(normalizeProviderPolicy("deepseek"), "deepseek");
  assert.equal(normalizeProviderPolicy("codex"), "codex");
  assert.equal(normalizeProviderPolicy("qwen"), "qwen");
  assert.equal(normalizeProviderPolicy("openrouter"), "openrouter");
  assert.equal(normalizeProviderPolicy("unknown"), "auto");
});

test("provider router honors configured defaults for generic OpenAI-compatible provider hints", () => {
  const route = routeProvider(baseRoute({
    role: "auditor",
    providerHint: "acme-compat",
    providerAvailability: { "acme-compat": true },
    providerModels: {
      "acme-compat": {
        model: "acme/default-review",
        capabilities: ["read", "review", "advisory"],
      },
    },
  }));

  assert.equal(route.provider, "acme-compat");
  assert.equal(route.providerModel.provider, "acme-compat");
  assert.equal(route.providerModel.model, "acme/default-review");
  assert.deepEqual(route.providerModel.capabilities, ["read", "review", "advisory"]);
  assert.equal(route.routeEnsemble.winner, "acme-compat-direct");
});

test("provider registry stores generic provider metadata without secret values", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-provider-registry-"));
  try {
    const qwen = await setProviderConfig("qwen", {
      model: "Qwen 3.7 MAX",
      baseUrl: "https://dashscope.example/compatible-mode/v1",
      apiKeyEnv: "QWEN_TEST_KEY",
    }, { homeDir });
    assert.equal(qwen.enabled, true);
    assert.equal(qwen.defaultModel, "qwen3-max");
    assert.equal(qwen.apiKeyEnv, "QWEN_TEST_KEY");

    const registry = await readProviderRegistry({ homeDir });
    const qwenEntry = registry.find((entry) => entry.id === "qwen");
    assert.equal(qwenEntry.defaultModel, "qwen3-max");
    assert.equal(JSON.stringify(qwenEntry).includes("secret-value"), false);

    const openrouterEntry = registry.find((entry) => entry.id === "openrouter");
    assert.equal(openrouterEntry.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(openrouterEntry.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(openrouterEntry.defaultModel, "openrouter/auto");
  assert.equal(openrouterEntry.headers["X-OpenRouter-Title"], "oh-my-kimi");

    const missing = await providerDoctorStatus("qwen", { homeDir, env: { QWEN_TEST_KEY: "" } });
    assert.equal(missing.available, false);
    assert.equal(missing.apiKeyEnv, "QWEN_TEST_KEY");
    assert.equal(missing.apiKeySet, false);
    const present = await providerDoctorStatus("qwen", { homeDir, env: { QWEN_TEST_KEY: "secret-value" } });
    assert.equal(present.available, true);
    assert.equal(JSON.stringify(present).includes("secret-value"), false);
    const openrouterMissing = await providerDoctorStatus("openrouter", { homeDir, env: { OPENROUTER_API_KEY: "" } });
    assert.equal(openrouterMissing.available, false);
    assert.equal(openrouterMissing.apiKeyEnv, "OPENROUTER_API_KEY");
    const openrouterPresent = await providerDoctorStatus("openrouter", { homeDir, env: { OPENROUTER_API_KEY: "secret-value" } });
    assert.equal(openrouterPresent.available, false);
    assert.equal(JSON.stringify(openrouterPresent).includes("secret-value"), false);
    await assert.rejects(
      () => setProviderConfig("qwen", { apiKeyEnv: "sk-should-not-store" }, { homeDir }),
      /environment variable name/
    );

    const codex = await providerDoctorStatus("codex", { homeDir, env: {} });
    assert.equal(codex.provider, "codex");
    assert.match(codex.reason, /does not read ~\/\.codex\/auth\.json|Kimi fallback/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
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

test("provider health tracks Kimi monthly quota exhaustion for the run", () => {
  const health = new ProviderHealthRegistry();
  assert.equal(health.isKimiAvailable(), true);

  health.markKimiUnavailable("Kimi monthly quota exhausted");

  assert.equal(health.isKimiAvailable(), false);
  assert.equal(health.getKimi().disableForRun, true);
  assert.match(health.getKimi().reason ?? "", /monthly quota/i);
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

test("provider task runner skips optional DeepSeek lanes without Kimi fallback on timeout", async () => {
  const calls = [];
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      throw new Error("DeepSeek request timed out");
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi fallback should not run for optional DeepSeek lane",
        stderr: "",
      };
    },
  };

  const node = {
    ...providerNode(),
    id: "deepseek-flash-agent",
    name: "DeepSeek Flash optional lane",
    role: "planner",
    outputs: [{ name: "deepseek flash decomposition", gate: "none", required: false }],
    failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
    routing: {
      provider: "deepseek",
      providerModelTier: "flash",
      readOnly: true,
      requiresMcp: false,
      requiresToolCalling: false,
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner, deepseekMaxRetries: 0 });
  const result = await runner.run(node, { OMK_TASK_TYPE: "plan", OMK_COMPLEXITY: "complex" });

  assert.equal(result.success, false);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek"]);
  assert.equal(result.metadata.provider, "deepseek");
  assert.equal(result.metadata.requestedProvider, "deepseek");
  assert.equal(result.metadata.providerModel, "deepseek-v4-flash");
  assert.equal(result.metadata.providerSkip.provider, "deepseek");
  assert.equal(result.metadata.providerSkip.skippable, true);
  assert.equal(result.metadata.providerSkip.failureKind, "transient");
  assert.equal(result.metadata.providerFallback, undefined);
  assert.match(result.metadata.providerSkip.reason, /timed out/);
});

test("provider task runner skips unavailable explicit DeepSeek lanes before Kimi fallback", async () => {
  const calls = [];
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi fallback should not run for unavailable DeepSeek lane",
        stderr: "",
      };
    },
  };
  const node = {
    ...providerNode(),
    id: "deepseek-pro-agent",
    name: "DeepSeek Pro optional lane",
    role: "reviewer",
    routing: {
      provider: "deepseek",
      providerModelTier: "pro",
      readOnly: true,
      requiresMcp: false,
      requiresToolCalling: false,
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner });
  const result = await runner.run(node, { OMK_TASK_TYPE: "review", OMK_COMPLEXITY: "complex" });

  assert.equal(result.success, false);
  assert.deepEqual(calls.map((call) => call.provider), []);
  assert.equal(node.failurePolicy.skipOnFailure, true);
  assert.equal(result.metadata.provider, "deepseek");
  assert.equal(result.metadata.requestedProvider, "deepseek");
  assert.equal(result.metadata.providerModel, "deepseek-v4-pro");
  assert.equal(result.metadata.providerSkip.failureKind, "availability");
  assert.equal(result.metadata.providerFallback, undefined);
  assert.match(result.stderr, /DeepSeek unavailable/);
});

test("provider task runner skips optional generic provider lanes when unavailable", async () => {
  const calls = [];
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi fallback should not run for optional Qwen lane",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, providerPolicy: "qwen" });
  const result = await runner.run({
    ...providerNode(),
    id: "qwen-review-lane",
    role: "researcher",
    outputs: [{ name: "qwen research notes", gate: "none", required: false }],
    failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
    routing: { provider: "qwen", readOnly: true },
  }, { OMK_TASK_TYPE: "research", OMK_PROVIDER_MODEL: "Qwen 3.7 MAX" });

  assert.equal(result.success, false);
  assert.deepEqual(calls.map((call) => call.provider), []);
  assert.equal(result.metadata.provider, "qwen");
  assert.equal(result.metadata.requestedProvider, "qwen");
  assert.equal(result.metadata.providerModel, "qwen3-max");
  assert.equal(result.metadata.providerAuthority, "veto");
  assert.equal(result.metadata.providerSkip.provider, "qwen");
  assert.equal(result.metadata.providerSkip.skippable, true);
  assert.equal(result.metadata.providerFallback, undefined);
});

test("provider task runner routes Qwen read-only lanes and falls back to Kimi when unavailable", async () => {
  const calls = [];
  const qwenRunner = {
    async run(_node, env) {
      calls.push({ provider: "qwen", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Qwen research result",
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
        stdout: "Kimi fallback result",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({
    kimiRunner,
    providerRunners: { qwen: qwenRunner },
    providerPolicy: "qwen",
  });
  const result = await runner.run({
    ...providerNode(),
    role: "researcher",
    routing: { provider: "qwen", readOnly: true },
  }, { OMK_TASK_TYPE: "research", OMK_PROVIDER_MODEL: "Qwen 3.7 MAX" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["qwen"]);
  assert.equal(calls[0].env.OMK_PROVIDER_MODEL, "qwen3-max");
  assert.equal(calls[0].env.OMK_PROVIDER_AUTHORITY, "direct");
  assert.equal(result.metadata.provider, "qwen");
  assert.equal(result.metadata.requestedProvider, "qwen");
  assert.equal(result.metadata.providerModel, "qwen3-max");

  calls.length = 0;
  const fallbackRunner = createProviderTaskRunner({ kimiRunner, providerPolicy: "qwen" });
  const fallback = await fallbackRunner.run({
    ...providerNode(),
    role: "reviewer",
    routing: { provider: "qwen", readOnly: true },
  }, { OMK_TASK_TYPE: "review" });
  assert.equal(fallback.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["kimi"]);
  assert.equal(fallback.metadata.provider, "kimi");
  assert.equal(fallback.metadata.requestedProvider, "qwen");
  assert.equal(fallback.metadata.providerModelRef.provider, "qwen");
  assert.equal(fallback.metadata.providerModelRef.authority, "veto");
});

test("provider task runner routes OpenRouter read-only lanes through generic provider runners", async () => {
  const calls = [];
  const openrouterRunner = {
    async run(_node, env) {
      calls.push({ provider: "openrouter", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "OpenRouter review result",
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

  const runner = createProviderTaskRunner({
    kimiRunner,
    providerRunners: { openrouter: openrouterRunner },
    providerModels: {
      openrouter: {
        model: "openrouter/auto",
        capabilities: ["read", "research", "review", "qa", "advisory"],
      },
    },
    providerPolicy: "openrouter",
  });
  const result = await runner.run({
    ...providerNode(),
    role: "reviewer",
    routing: { provider: "openrouter", readOnly: true },
  }, { OMK_TASK_TYPE: "review" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["openrouter"]);
  assert.equal(calls[0].env.OMK_PROVIDER_MODEL, "openrouter/auto");
  assert.equal(calls[0].env.OMK_PROVIDER_AUTHORITY, "direct");
  assert.equal(result.metadata.provider, "openrouter");
  assert.equal(result.metadata.providerModel, "openrouter/auto");
  assert.equal(result.metadata.providerAuthority, "direct");
});

test("provider task runner runs OpenRouter advisory before Kimi on file-affecting nodes", async () => {
  const calls = [];
  const openrouterRunner = {
    async run(_node, env) {
      calls.push({ provider: "openrouter", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "OpenRouter advisory: keep Kimi as the only writer.",
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
        stdout: "Kimi applied bounded patch",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({
    kimiRunner,
    providerRunners: { openrouter: openrouterRunner },
    providerModels: {
      openrouter: {
        model: "openrouter/auto",
        capabilities: ["read", "research", "review", "qa", "advisory"],
      },
    },
    providerPolicy: "openrouter",
  });
  const result = await runner.run({
    ...providerNode(),
    id: "openrouter-file-advisory",
    role: "coder",
    routing: { provider: "openrouter", readOnly: true },
  }, { OMK_TASK_TYPE: "implementation", OMK_COMPLEXITY: "complex" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["openrouter", "kimi"]);
  assert.equal(calls[0].env.OMK_PROVIDER_AUTHORITY, "advisory");
  assert.equal(calls[1].env.OMK_PROVIDER_ADVISORY_PROVIDER, "openrouter");
  assert.match(calls[1].env.OMK_PROVIDER_ADVISORY, /only writer/);
  assert.equal(result.metadata.provider, "kimi");
  assert.equal(result.metadata.providerAssist.provider, "openrouter");
  assert.equal(result.metadata.providerAssist.participation, "advisory");
  assert.equal(result.metadata.providerModelRef.provider, "openrouter");
  assert.equal(result.metadata.providerModelRef.authority, "advisory");
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

test("provider task runner recovers Kimi monthly quota with read-only DeepSeek fallback", async () => {
  const calls = [];
  const health = new ProviderHealthRegistry();
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: monthlyQuotaError,
      };
    },
  };
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "DeepSeek read-only fallback result",
        stderr: "",
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner, providerHealth: health });
  const result = await runner.run({
    ...providerNode(),
    id: "quota-analyst",
    role: "analyst",
    routing: { provider: "auto", readOnly: true, requiresMcp: false, requiresToolCalling: false },
  }, { OMK_TASK_TYPE: "review", OMK_COMPLEXITY: "complex" });

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.provider), ["kimi", "deepseek"]);
  assert.equal(health.isKimiAvailable(), false);
  assert.equal(result.metadata.provider, "deepseek");
  assert.equal(result.metadata.requestedProvider, "kimi");
  assert.equal(result.metadata.providerFallback.from, "kimi");
  assert.equal(result.metadata.providerFallback.to, "deepseek");
  assert.equal(result.metadata.providerFallback.failureKind, "quota");
  assert.match(result.metadata.providerFallback.reason, /monthly quota/i);
  assert.equal(calls[1].env.OMK_PROVIDER_FALLBACK_FROM, "kimi");
  assert.equal(calls[1].env.OMK_KIMI_FAILURE_KIND, "monthly-quota");
});

test("provider task runner does not grant DeepSeek write fallback on Kimi quota exhaustion", async () => {
  const calls = [];
  const health = new ProviderHealthRegistry();
  const deepseekRunner = {
    async run(_node, env) {
      calls.push({ provider: "deepseek", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "DeepSeek advisory only",
        stderr: "",
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
        stderr: monthlyQuotaError,
      };
    },
  };

  const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner, providerHealth: health });
  const result = await runner.run({
    ...providerNode(),
    id: "quota-coder",
    role: "coder",
    routing: { provider: "auto", readOnly: false, requiresMcp: false, requiresToolCalling: false },
  }, { OMK_TASK_TYPE: "implementation", OMK_COMPLEXITY: "complex" });

  assert.equal(result.success, false);
  assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "kimi"]);
  assert.equal(health.isKimiAvailable(), false);
  assert.equal(result.metadata.provider, "kimi");
  assert.equal(result.metadata.providerFailure.kind, "monthly-quota");
  assert.match(result.stderr, /Login\/auth can be valid/);
  assert.equal(calls.some((call) => call.env.OMK_PROVIDER_FALLBACK_FROM === "kimi"), false);
});

test("provider-backed runner keeps provider metadata when Kimi runtime is unavailable", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-provider-backed-"));
  const previousPath = process.env.PATH;
  const previousPathUpper = process.env.Path;

  try {
    process.env.PATH = join(projectRoot, "empty-bin");
    process.env.Path = process.env.PATH;

    const runner = await createProviderBackedTaskRunner({
      providerPolicy: "kimi",
      kimi: {
        cwd: projectRoot,
        timeout: 1000,
        mcpScope: "none",
        skillsScope: "none",
      },
    });

    const result = await runner.run(providerNode(), { OMK_TASK_TYPE: "review" });

    assert.equal(result.success, false);
    assert.equal(result.metadata.provider, "kimi");
    assert.equal(result.metadata.requestedProvider, "kimi");
    assert.ok(result.metadata._budgetReport);
    assert.equal(result.metadata.runtime, undefined);
    assert.match(result.stderr, /kimi.*not found/i);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousPathUpper === undefined) delete process.env.Path;
    else process.env.Path = previousPathUpper;
    await rm(projectRoot, { recursive: true, force: true });
  }
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

test("provider task runner aborts DeepSeek advisory runner after advisory timeout", async () => {
  const previousTimeout = process.env.OMK_DEEPSEEK_ADVISORY_TIMEOUT_MS;
  process.env.OMK_DEEPSEEK_ADVISORY_TIMEOUT_MS = "20";
  const calls = [];
  let resolveAbort;
  const abortSeen = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  const deepseekRunner = {
    async run(_node, env, signal) {
      calls.push({ provider: "deepseek", env });
      signal?.addEventListener("abort", () => {
        resolveAbort(signal.reason);
      }, { once: true });
      return new Promise(() => {});
    },
  };
  const kimiRunner = {
    async run(_node, env) {
      calls.push({ provider: "kimi", env });
      return {
        success: true,
        exitCode: 0,
        stdout: "Kimi continued after advisory timeout.",
        stderr: "",
      };
    },
  };

  try {
    const runner = createProviderTaskRunner({ kimiRunner, deepseekRunner });
    const result = await runner.run({
      ...providerNode(),
      id: "advisory-timeout-abort",
      name: "Modify provider files",
      role: "coder",
      routing: { provider: "auto", readOnly: true },
    }, { OMK_TASK_TYPE: "implementation" });
    const abortReason = await Promise.race([
      abortSeen,
      new Promise((_, reject) => setTimeout(() => reject(new Error("DeepSeek advisory abort not observed")), 1000)),
    ]);

    assert.equal(result.success, true);
    assert.deepEqual(calls.map((call) => call.provider), ["deepseek", "kimi"]);
    assert.match(String(abortReason?.message ?? abortReason), /DeepSeek advisory timed out/);
    assert.equal(calls[1].env.OMK_DEEPSEEK_ADVISORY_STATUS, "failed");
    assert.equal(result.metadata.providerAssist.success, false);
    assert.match(result.metadata.providerAssist.failureReason, /timed out/);
  } finally {
    if (previousTimeout === undefined) delete process.env.OMK_DEEPSEEK_ADVISORY_TIMEOUT_MS;
    else process.env.OMK_DEEPSEEK_ADVISORY_TIMEOUT_MS = previousTimeout;
  }
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

test("executor marks optional unavailable DeepSeek provider lanes skipped", async () => {
  const calls = [];
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
        id: "deepseek-flash-agent",
        name: "DeepSeek Flash optional lane",
        role: "planner",
        dependsOn: [],
        maxRetries: 1,
        failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
        outputs: [{ name: "deepseek flash decomposition", gate: "none", required: false }],
        routing: {
          provider: "deepseek",
          providerModelTier: "flash",
          readOnly: true,
          requiresMcp: false,
          requiresToolCalling: false,
        },
      },
    ],
  });
  const runner = createProviderTaskRunner({
    kimiRunner: {
      async run(_node, env) {
        calls.push({ provider: "kimi", env });
        return {
          success: true,
          exitCode: 0,
          stdout: "Kimi fallback should not run for optional DeepSeek lane",
          stderr: "",
        };
      },
    },
  });

  const result = await executor.execute(dag, runner, {
    runId: "optional-deepseek-skip-test",
    workers: 1,
    approvalPolicy: "yolo",
  });
  const node = result.state.nodes[0];

  assert.equal(result.success, true);
  assert.equal(node.status, "skipped");
  assert.deepEqual(calls.map((call) => call.provider), []);
  assert.equal(node.attempts?.[0]?.provider, "deepseek");
  assert.equal(node.attempts?.[0]?.requestedProvider, "deepseek");
  assert.equal(node.attempts?.[0]?.providerModel, "deepseek-v4-flash");
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

test("DeepSeek client and balance checks propagate external AbortSignal to fetch", async () => {
  const chatAbort = new AbortController();
  let chatSignal;
  const client = new DeepSeekClient({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      chatSignal = init.signal;
      chatAbort.abort(new Error("chat-stop"));
      if (init.signal.aborted) throw init.signal.reason;
      return await new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });

  await assert.rejects(
    () => client.complete({ messages: [{ role: "user", content: "ping" }], signal: chatAbort.signal }),
    /chat-stop/,
  );
  assert.equal(chatSignal instanceof AbortSignal, true);
  assert.equal(chatSignal.aborted, true);

  const balanceAbort = new AbortController();
  let balanceSignal;
  const balance = await checkDeepSeekBalance({
    apiKey: "test-key",
    signal: balanceAbort.signal,
    fetchImpl: async (_url, init) => {
      balanceSignal = init.signal;
      balanceAbort.abort(new Error("balance-stop"));
      if (init.signal.aborted) throw init.signal.reason;
      return await new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });
  assert.equal(balanceSignal instanceof AbortSignal, true);
  assert.equal(balanceSignal.aborted, true);
  assert.equal(balance.available, false);
  assert.match(balance.reason ?? "", /balance-stop/);
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

test("OpenAI-compatible runner supports OpenRouter base URL, attribution headers, and secret redaction", async () => {
  const apiKey = "test-openrouter-key";
  let request;
  const runner = createOpenAICompatibleReadOnlyTaskRunner({
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    apiKeyEnv: "OPENROUTER_API_KEY",
    model: "openrouter/auto",
    headers: {
      "HTTP-Referer": "https://example.test/omk",
      "X-OpenRouter-Title": "OMK Test",
    },
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return fakeResponse(200, {
        choices: [{ message: { content: "OpenRouter advisory response" } }],
      });
    },
  });

  const result = await runner.run(providerNode(), { OMK_TASK_TYPE: "review" });

  assert.equal(result.success, true);
  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.init.headers.authorization, `Bearer ${apiKey}`);
  assert.equal(request.init.headers["HTTP-Referer"], "https://example.test/omk");
  assert.equal(request.init.headers["X-OpenRouter-Title"], "OMK Test");
  assert.equal(JSON.parse(String(request.init.body)).model, "openrouter/auto");
  assert.doesNotMatch(result.stdout, new RegExp(apiKey));

  const failingRunner = createOpenAICompatibleReadOnlyTaskRunner({
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    apiKeyEnv: "OPENROUTER_API_KEY",
    model: "openrouter/auto",
    fetchImpl: async () => fakeResponse(401, { error: `bad bearer ${apiKey}` }),
  });
  const failure = await failingRunner.run(providerNode(), { OMK_TASK_TYPE: "review" });

  assert.equal(failure.success, false);
  assert.doesNotMatch(failure.stderr, new RegExp(apiKey));
  assert.match(failure.stderr, /\[redacted\]/);
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
