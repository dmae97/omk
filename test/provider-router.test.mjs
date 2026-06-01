import test from "node:test";
import assert from "node:assert/strict";

import { createProviderRouter } from "../dist/providers/index.js";

test("provider-router no-match fallback uses sorted provider order instead of Kimi", () => {
  const router = createProviderRouter({
    providers: [
      mockProvider({ id: "kimi", priority: 70, supports: false }),
      mockProvider({ id: "qwen", priority: 100, supports: false }),
      mockProvider({ id: "codex", priority: 90, supports: false }),
    ],
  });

  const decision = router.select(routeInput());

  assert.equal(decision.provider.id, "qwen");
  assert.equal(decision.reason, "no-supported-provider-matched");
  assert.deepEqual(decision.fallbacks, []);
});

test("provider-router evidence-fail fallback uses neutral priority cost and capability ordering", () => {
  const router = createProviderRouter({
    providers: [
      mockProvider({ id: "kimi", kind: "kimi-native", priority: 100 }),
      mockProvider({ id: "codex", kind: "codex-cli", priority: 100, health: true }),
      mockProvider({ id: "openrouter", kind: "openai-compatible", priority: 100, estimateCost: true }),
    ],
  });

  const decision = router.select(routeInput({
    strategy: "fallback-on-evidence-fail",
    needsMcp: true,
    needsToolCalling: true,
  }));

  assert.equal(decision.provider.id, "openrouter");
  assert.deepEqual(decision.fallbacks.map((provider) => provider.id), ["codex", "kimi"]);
  assert.equal(decision.reason, "evidence-fail-fallback-ordered");
});

function mockProvider({
  id,
  kind = "external-cli",
  priority,
  supports = true,
  estimateCost = false,
  health = false,
}) {
  const provider = {
    id,
    kind,
    priority,
    supports: () => supports,
    async run() {
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    },
  };
  if (estimateCost) {
    provider.estimateCost = async () => ({
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsd: 0.001,
      currency: "USD",
    });
  }
  if (health) {
    provider.health = async () => ({ available: true, lastCheckedAt: 0 });
  }
  return provider;
}

function routeInput(overrides = {}) {
  return {
    node: {
      id: "provider-router-node",
      name: "Provider router node",
      role: "coder",
      dependsOn: [],
      maxRetries: 1,
    },
    risk: "write",
    complexity: "moderate",
    needsToolCalling: false,
    needsMcp: false,
    readOnly: false,
    estimatedTokens: 1000,
    ...overrides,
  };
}
