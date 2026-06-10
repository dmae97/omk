/**
 * omk.weights.v1 contract tests.
 *
 * (a) normalization invariant Σŵ = 1 ± 1e-6 for normalize:true vectors;
 * (b) schemas/omk.weights.v1.json deep-equals the embedded defaults;
 * (c) release-gate verdict parity: 300 seeded random inputs, old inline
 *     formula verdict === new gate verdict;
 * (d) Router V2 ranking parity: 50 seeded random runtime/score sets,
 *     argsort(old composite) === argsort(new composite).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_WEIGHTS,
  loadWeightsConfig,
  normalizeVector,
  releaseGateEffective,
  routerV2CompositeEffective,
} from "../dist/runtime/weights-config.js";
import { createReleasePromotionGate } from "../dist/cli/release-promotion-gate.js";
import { scoreRuntimes } from "../dist/runtime/router-v2-scoring.js";

const here = dirname(fileURLToPath(import.meta.url));

// ── Seeded PRNG (mulberry32) ────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── (a) normalization invariant ─────────────────────────────────

test("normalize:true vectors satisfy Σŵ = 1 ± 1e-6", () => {
  for (const [name, spec] of [
    ["releaseGate", DEFAULT_WEIGHTS.vectors.releaseGate],
    ["routerV2Composite", DEFAULT_WEIGHTS.vectors.routerV2Composite],
  ]) {
    const effective = normalizeVector(name, spec);
    const sum = Object.values(effective.weights).reduce((acc, v) => acc + v, 0);
    assert.ok(Math.abs(sum - 1) <= 1e-6, `Σŵ=${sum} for ${name}`);
  }
});

test("normalizeVector scales penalties and thresholds by the same factor", () => {
  const effective = releaseGateEffective(DEFAULT_WEIGHTS);
  const raw = DEFAULT_WEIGHTS.vectors.releaseGate;
  const positiveSum = Object.values(raw.weights).reduce((acc, v) => acc + v, 0);
  assert.ok(Math.abs(positiveSum - 1.05) < 1e-12);
  assert.ok(Math.abs(effective.scale - 1 / 1.05) < 1e-12);
  assert.ok(Math.abs(effective.penalties.regression - 0.15 / 1.05) < 1e-12);
  assert.ok(Math.abs(effective.thresholds.preRelease - 0.75 / 1.05) < 1e-12);
  assert.ok(Math.abs(effective.thresholds.stable - 0.9 / 1.05) < 1e-12);

  const router = routerV2CompositeEffective(DEFAULT_WEIGHTS);
  const routerSum = Object.values(DEFAULT_WEIGHTS.vectors.routerV2Composite.weights)
    .reduce((acc, v) => acc + v, 0);
  assert.ok(Math.abs(routerSum - 0.95) < 1e-12);
  assert.ok(Math.abs(router.scale - 1 / 0.95) < 1e-12);
  assert.ok(Math.abs(router.penalties.recentFailure - 0.15 / 0.95) < 1e-12);
  assert.ok(Math.abs(router.penalties.blastRadius - 0.1 / 0.95) < 1e-12);
});

test("normalizeVector throws the invariant error for a violating vector", () => {
  assert.throws(
    () =>
      normalizeVector("corrupt", {
        normalize: true,
        weights: { a: Number.NaN },
        penalties: {},
      }),
    /omk\.weights\.v1 invariant violated/,
  );
});

// ── (b) JSON file == embedded defaults ──────────────────────────

test("schemas/omk.weights.v1.json deep-equals embedded DEFAULT_WEIGHTS", () => {
  const filePath = join(here, "..", "schemas", "omk.weights.v1.json");
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  assert.deepStrictEqual(parsed, DEFAULT_WEIGHTS);
});

test("loadWeightsConfig returns the contract (file or embedded)", () => {
  const config = loadWeightsConfig();
  assert.equal(config.schemaVersion, "omk.weights.v1");
  assert.deepStrictEqual(config, DEFAULT_WEIGHTS);
});

// ── (c) release-gate verdict parity ─────────────────────────────

/** Old inline formula (pre-omk.weights.v1), reproduced verbatim. */
function oldReleaseVerdict(inputs) {
  const w = {
    ci: 0.15, build: 0.10, types: 0.10, tests: 0.10, install: 0.10,
    demo: 0.15, proof: 0.15, maturity: 0.10, docs: 0.10, regression: 0.15,
  };
  const clamp01 = (n) => (Number.isNaN(n) ? 0 : Math.max(0, Math.min(1, n)));

  const demoRun = inputs.demoRun ?? false;
  const maturity = inputs.maturity ?? inputs.providerMinimum ?? 0;
  const versionConsistency = inputs.versionConsistency ?? inputs.semver ?? 1;
  const liveBenchmarkPass = inputs.liveBenchmarkPass ?? false;
  const sandboxViolationCount = inputs.sandboxViolationCount ?? Number.POSITIVE_INFINITY;
  const exactTagCiPass = inputs.exactTagCiPass ?? false;

  const rawScore =
    w.ci * inputs.ci +
    w.build * (inputs.build ?? 0) +
    w.types * (inputs.types ?? 0) +
    w.tests * (inputs.tests ?? 0) +
    w.install * inputs.freshInstallSmoke +
    w.demo * (demoRun ? 1 : 0) +
    w.proof * inputs.proofMedian +
    w.maturity * maturity +
    w.docs * inputs.docs * versionConsistency -
    w.regression * inputs.regressionSeverity;

  const score = clamp01(rawScore);
  const blocked =
    inputs.ci === 0 || inputs.freshInstallSmoke === 0 || versionConsistency === 0 || !demoRun;
  const stableEligible = liveBenchmarkPass && sandboxViolationCount === 0 && exactTagCiPass;

  if (blocked) return "block";
  if (score >= 0.90 && inputs.proofMedian >= 0.85 && maturity >= 0.80 && stableEligible) {
    return "stable";
  }
  if (score >= 0.75 && inputs.proofMedian >= 0.75) return "pre-release";
  return "block";
}

function randomGateInputs(rand) {
  // Bias toward high dimensions so all three verdict branches are exercised.
  const high = () => (rand() < 0.7 ? 0.7 + 0.3 * rand() : rand());
  return {
    ci: rand() < 0.08 ? 0 : high(),
    build: high(),
    types: high(),
    tests: high(),
    docs: high(),
    proofMedian: high(),
    maturity: high(),
    regressionSeverity: rand() < 0.5 ? 0 : rand() * 0.5,
    freshInstallSmoke: rand() < 0.08 ? 0 : high(),
    versionConsistency: rand() < 0.08 ? 0 : 1,
    demoRun: rand() < 0.85,
    liveBenchmarkPass: rand() < 0.6,
    sandboxViolationCount: rand() < 0.7 ? 0 : 1,
    exactTagCiPass: rand() < 0.6,
  };
}

test("release gate verdict parity: 300 seeded random inputs", () => {
  const gate = createReleasePromotionGate();
  const rand = mulberry32(0xc0ffee);
  const seen = new Set();

  for (let i = 0; i < 300; i += 1) {
    const inputs = randomGateInputs(rand);
    const expected = oldReleaseVerdict(inputs);
    const actual = gate.evaluate(inputs).verdict;
    assert.equal(
      actual,
      expected,
      `verdict mismatch at iteration ${i}: ${JSON.stringify(inputs)}`,
    );
    seen.add(expected);
  }

  // The random corpus must exercise every verdict branch.
  assert.deepStrictEqual([...seen].sort(), ["block", "pre-release", "stable"]);
});

// ── (d) Router V2 ranking parity ────────────────────────────────

const NODE_INTENTS = [
  "research", "planning", "coding", "debugging", "refactor",
  "review", "test-generation", "documentation", "shell-operation",
];

function randomRuntime(rand, index) {
  const flag = (p) => rand() < p;
  return {
    id: `rt-${index}`,
    priority: Math.floor(rand() * 100),
    capabilities: {
      read: flag(0.8),
      write: flag(0.6),
      shell: flag(0.5),
      mcp: flag(0.4),
      patch: flag(0.5),
      review: flag(0.5),
      merge: flag(0.3),
      vision: flag(0.3),
      toolCalling: flag(0.6),
      supportsToolCalling: flag(0.3),
      streaming: flag(0.4),
      supportsStreaming: flag(0.3),
      maxTokens: flag(0.5) ? Math.floor(rand() * 200000) : undefined,
      maxContextTokens: flag(0.5) ? Math.floor(rand() * 200000) : undefined,
    },
  };
}

function randomHistory(rand, runtimeIds) {
  const history = [];
  for (const runtimeId of runtimeIds) {
    const entries = Math.floor(rand() * 8);
    for (let i = 0; i < entries; i += 1) {
      history.push({
        runtime: runtimeId,
        passed: rand() < 0.7,
        timestamp: new Date(1700000000000 + Math.floor(rand() * 1e9)).toISOString(),
      });
    }
  }
  return history;
}

/** Old composite formula (pre-omk.weights.v1) from raw component scores. */
function oldComposite(s) {
  return (
    0.25 * s.bayesianEvidenceScore +
    0.15 * s.confidence +
    0.20 * s.capabilityFit +
    0.15 * s.maturityScore +
    0.10 * s.latencyScore +
    0.10 * s.costScore -
    0.15 * s.recentFailurePenalty -
    0.10 * s.blastRadiusPenalty
  );
}

function argsortDesc(values) {
  return values
    .map((value, index) => [value, index])
    .sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]))
    .map(([, index]) => index);
}

test("router V2 ranking parity: 50 seeded random runtime/score sets", () => {
  const rand = mulberry32(0xbeef);

  for (let round = 0; round < 50; round += 1) {
    const count = 2 + Math.floor(rand() * 5);
    const candidates = Array.from({ length: count }, (_, i) => randomRuntime(rand, i));
    const intent = NODE_INTENTS[Math.floor(rand() * NODE_INTENTS.length)];
    const history = randomHistory(rand, candidates.map((c) => c.id));

    const scores = scoreRuntimes(candidates, intent, history);
    const newRanking = argsortDesc(scores.map((s) => s.composite));
    const oldRanking = argsortDesc(scores.map((s) => oldComposite(s)));

    assert.deepStrictEqual(
      newRanking,
      oldRanking,
      `ranking mismatch at round ${round} (intent=${intent})`,
    );
  }
});
