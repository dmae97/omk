import test from "node:test";
import assert from "node:assert/strict";

import {
  createRouterV2ScoringEngine,
} from "../dist/runtime/router-v2-scoring.js";

// ── Helpers ─────────────────────────────────────────────────────

function makeRuntime(overrides = {}) {
  return {
    id: "test-runtime",
    priority: 50,
    capabilities: {
      read: true,
      write: false,
      shell: false,
      patch: false,
      review: false,
      merge: false,
      vision: false,
      mcp: false,
      toolCalling: false,
      supportsToolCalling: false,
      streaming: false,
      supportsStreaming: false,
      maxTokens: 0,
      maxContextTokens: 0,
    },
    supports() {
      return true;
    },
    async runNode() {
      return { success: true, stdout: "", stderr: "" };
    },
    ...overrides,
  };
}

function makeHistory(entries = []) {
  return entries.map((e, i) => ({
    runtime: e.runtime ?? "test-runtime",
    intent: e.intent ?? "coding",
    passed: e.passed ?? true,
    timestamp: new Date(Date.now() - i * 1000).toISOString(),
    nodeId: `node-${i}`,
  }));
}

// ── Bayesian smoothing ──────────────────────────────────────────

test("Bayesian smoothing with α₀=1, β₀=1: zero attempts yields mean 0.5", () => {
  const engine = createRouterV2ScoringEngine();
  const runtime = makeRuntime();
  const score = engine.score(runtime, "coding", []);

  assert.equal(score.bayesianEvidenceScore, 0.5);
});

test("Bayesian smoothing with one pass yields 2/3", () => {
  const engine = createRouterV2ScoringEngine();
  const runtime = makeRuntime();
  const history = makeHistory([{ passed: true }]);
  const score = engine.score(runtime, "coding", history);

  // (1 + 1) / (1 + 1 + 1) = 2/3
  assert.equal(score.bayesianEvidenceScore, 2 / 3);
});

test("Bayesian smoothing with one fail yields 1/3", () => {
  const engine = createRouterV2ScoringEngine();
  const runtime = makeRuntime();
  const history = makeHistory([{ passed: false }]);
  const score = engine.score(runtime, "coding", history);

  // (1 + 0) / (1 + 1 + 1) = 1/3
  assert.equal(score.bayesianEvidenceScore, 1 / 3);
});

test("Bayesian smoothing with many attempts approaches empirical rate", () => {
  const engine = createRouterV2ScoringEngine();
  const runtime = makeRuntime();
  const passes = 80;
  const fails = 20;
  const entries = [
    ...Array.from({ length: passes }, () => ({ passed: true })),
    ...Array.from({ length: fails }, () => ({ passed: false })),
  ];
  const history = makeHistory(entries);
  const score = engine.score(runtime, "coding", history);

  // (1 + 80) / (1 + 1 + 100) = 81/102 ≈ 0.794
  const expected = (1 + passes) / (1 + 1 + passes + fails);
  assert.equal(score.bayesianEvidenceScore, expected);
});

// ── Capability fit ──────────────────────────────────────────────

test("coding intent prefers write+patch+shell capabilities", () => {
  const engine = createRouterV2ScoringEngine();
  const codingRuntime = makeRuntime({
    capabilities: {
      read: true,
      write: true,
      shell: true,
      patch: true,
      review: false,
      merge: false,
      vision: false,
      mcp: false,
      toolCalling: true,
      supportsToolCalling: true,
      streaming: false,
      supportsStreaming: false,
      maxTokens: 0,
      maxContextTokens: 0,
    },
  });
  const score = engine.score(codingRuntime, "coding", []);
  assert.ok(score.capabilityFit > 0.5);
});

test("shell-operation intent heavily weights shell capability", () => {
  const engine = createRouterV2ScoringEngine();
  const shellRuntime = makeRuntime({
    capabilities: {
      read: true,
      write: false,
      shell: true,
      patch: false,
      review: false,
      merge: false,
      vision: false,
      mcp: false,
      toolCalling: false,
      supportsToolCalling: false,
      streaming: false,
      supportsStreaming: false,
      maxTokens: 0,
      maxContextTokens: 0,
    },
  });
  const score = engine.score(shellRuntime, "shell-operation", []);
  assert.ok(score.capabilityFit > 0.3);
});

test("coding intent with no relevant capabilities yields low fit", () => {
  const engine = createRouterV2ScoringEngine();
  const weakRuntime = makeRuntime({
    capabilities: {
      read: true,
      write: false,
      shell: false,
      patch: false,
      review: false,
      merge: false,
      vision: false,
      mcp: false,
      toolCalling: false,
      supportsToolCalling: false,
      streaming: false,
      supportsStreaming: false,
      maxTokens: 0,
      maxContextTokens: 0,
    },
  });
  const score = engine.score(weakRuntime, "coding", []);
  assert.ok(score.capabilityFit < 0.3);
});

// ── Blast radius penalty ────────────────────────────────────────

test("blast radius penalty is capped at 0.30", () => {
  const engine = createRouterV2ScoringEngine({
    enableBlastRadius: true,
    blastRadiusParams: {
      downstreamNodeCount: 100,
      affectedFileCount: 1000,
      hasGlobalSideEffects: true,
    },
  });
  const runtime = makeRuntime();
  const score = engine.score(runtime, "coding", []);

  assert.equal(score.blastRadiusPenalty, 0.30);
});

test("blast radius penalty is 0 when disabled", () => {
  const engine = createRouterV2ScoringEngine({
    enableBlastRadius: false,
    blastRadiusParams: {
      downstreamNodeCount: 10,
      affectedFileCount: 100,
      hasGlobalSideEffects: true,
    },
  });
  const runtime = makeRuntime();
  const score = engine.score(runtime, "coding", []);

  assert.equal(score.blastRadiusPenalty, 0);
});

test("blast radius penalty increases with downstream nodes and files", () => {
  const engineSmall = createRouterV2ScoringEngine({
    enableBlastRadius: true,
    blastRadiusParams: {
      downstreamNodeCount: 1,
      affectedFileCount: 1,
      hasGlobalSideEffects: false,
    },
  });
  const engineLarge = createRouterV2ScoringEngine({
    enableBlastRadius: true,
    blastRadiusParams: {
      downstreamNodeCount: 10,
      affectedFileCount: 50,
      hasGlobalSideEffects: true,
    },
  });

  const runtime = makeRuntime();
  const small = engineSmall.score(runtime, "coding", []);
  const large = engineLarge.score(runtime, "coding", []);

  assert.ok(small.blastRadiusPenalty < large.blastRadiusPenalty);
  assert.ok(large.blastRadiusPenalty <= 0.30);
});

// ── Composite score range ───────────────────────────────────────

test("composite score is within [0, 1] for empty history", () => {
  const engine = createRouterV2ScoringEngine();
  const runtime = makeRuntime();
  const score = engine.score(runtime, "coding", []);

  assert.ok(score.composite >= 0);
  assert.ok(score.composite <= 1);
});

test("composite score decreases with recent failures", () => {
  const engine = createRouterV2ScoringEngine();
  const runtime = makeRuntime();
  const goodHistory = makeHistory([
    { passed: true },
    { passed: true },
    { passed: true },
  ]);
  const badHistory = makeHistory([
    { passed: false },
    { passed: false },
    { passed: false },
  ]);

  const good = engine.score(runtime, "coding", goodHistory);
  const bad = engine.score(runtime, "coding", badHistory);

  assert.ok(good.composite > bad.composite);
});

test("select returns primary runtime with highest composite score", () => {
  const engine = createRouterV2ScoringEngine();
  const runtimeA = makeRuntime({ id: "a", priority: 90 });
  const runtimeB = makeRuntime({ id: "b", priority: 10 });
  const decision = engine.select([runtimeA, runtimeB], "coding", []);

  assert.equal(decision.runtime.id, "a");
  assert.ok(decision.reason.includes("composite="));
  assert.equal(decision.fallbacks.length, 1);
  assert.equal(decision.fallbacks[0].id, "b");
});

test("recent failure penalty is capped at 0.30", () => {
  const engine = createRouterV2ScoringEngine();
  const runtime = makeRuntime();
  const history = makeHistory(
    Array.from({ length: 10 }, () => ({ passed: false })),
  );
  const score = engine.score(runtime, "coding", history);

  assert.equal(score.recentFailurePenalty, 0.30);
});
