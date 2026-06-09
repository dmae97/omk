import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import {
  createRegressionProofMatrixEngine,
} from "../dist/evidence/regression-proof-matrix.js";
import { TAU_EVIDENCE } from "../dist/runtime/contracts/weakness-remediation.js";

const engine = createRegressionProofMatrixEngine();

// ── Helpers ─────────────────────────────────────────────────────

function makeAlgorithm(overrides = {}) {
  return {
    name: "alg-test",
    tests: 1,
    proofBundles: 1,
    decisionTraces: 1,
    cliSurface: "reachable",
    ...overrides,
  };
}

function makeInputs(algorithmOverrides = {}, releaseOverrides = {}) {
  return {
    algorithmSet: [makeAlgorithm(algorithmOverrides)],
    testSuite: { testsByAlgorithm: {} },
    proofBundles: [],
    releaseCandidate: {
      medianProofTrust: 0.85,
      routerShadowSafety: 1,
      providerAuthorityInvariant: 1,
      minimalVerifiedDemo: 1,
      ...releaseOverrides,
    },
  };
}

// ── Coverage calculation ────────────────────────────────────────

test("perfect coverage yields 1.0", () => {
  const inputs = makeInputs();
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.coverageByAlgorithm["alg-test"], 1.0);
  assert.equal(result.verdict, "pass");
});

test("coverage without tests drops by 0.35", () => {
  const inputs = makeInputs({ tests: 0 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.coverageByAlgorithm["alg-test"], 0.65);
  assert.equal(result.verdict, "fail");
});

test("coverage without proof bundles drops by 0.30", () => {
  const inputs = makeInputs({ proofBundles: 0 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.coverageByAlgorithm["alg-test"], 0.70);
  assert.equal(result.verdict, "fail");
});

test("coverage without decision traces drops by 0.20", () => {
  const inputs = makeInputs({ decisionTraces: 0 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.coverageByAlgorithm["alg-test"], 0.80);
  assert.equal(result.verdict, "pass");
});

test("coverage with unreachable cli surface drops by 0.15", () => {
  const inputs = makeInputs({ cliSurface: "unreachable" });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.coverageByAlgorithm["alg-test"], 0.85);
  assert.equal(result.verdict, "pass");
});

test("zero coverage yields 0.0", () => {
  const inputs = makeInputs({
    tests: 0,
    proofBundles: 0,
    decisionTraces: 0,
    cliSurface: "unreachable",
  });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.coverageByAlgorithm["alg-test"], 0.0);
  assert.equal(result.verdict, "fail");
});

// ── Global gate logic ───────────────────────────────────────────

test("fail when medianProofTrust < 0.75", () => {
  const inputs = makeInputs({}, { medianProofTrust: 0.70 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.some((r) => r.includes("medianProofTrust")));
});

test("fail when routerShadowSafety !== 1", () => {
  const inputs = makeInputs({}, { routerShadowSafety: 0 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.some((r) => r.includes("routerShadowSafety")));
});

test("fail when providerAuthorityInvariant !== 1", () => {
  const inputs = makeInputs({}, { providerAuthorityInvariant: 0 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.some((r) => r.includes("providerAuthorityInvariant")));
});

test("fail when minimalVerifiedDemo !== 1", () => {
  const inputs = makeInputs({}, { minimalVerifiedDemo: 0 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.some((r) => r.includes("minimalVerifiedDemo")));
});

// ── Threshold boundary ──────────────────────────────────────────

test("coverage boundary: 0.70 fails, 0.80 passes", () => {
  const inputs70 = makeInputs({
    proofBundles: 0,
    decisionTraces: 1,
    cliSurface: "reachable",
  });
  const result70 = engine.evaluate(
    inputs70.algorithmSet,
    inputs70.testSuite,
    inputs70.proofBundles,
    inputs70.releaseCandidate
  );
  assert.equal(result70.coverageByAlgorithm["alg-test"], 0.70);
  assert.equal(result70.verdict, "fail");

  const inputs80 = makeInputs({ decisionTraces: 0, cliSurface: "reachable" });
  const result80 = engine.evaluate(
    inputs80.algorithmSet,
    inputs80.testSuite,
    inputs80.proofBundles,
    inputs80.releaseCandidate
  );
  assert.equal(result80.coverageByAlgorithm["alg-test"], 0.80);
  assert.equal(result80.verdict, "pass");
});

// ── Multiple algorithms ─────────────────────────────────────────

test("fail if any algorithm coverage < 0.75", () => {
  const algorithmSet = [
    makeAlgorithm({ name: "good-alg" }),
    makeAlgorithm({
      name: "bad-alg",
      tests: 0,
      proofBundles: 0,
      decisionTraces: 0,
      cliSurface: "unreachable",
    }),
  ];
  const result = engine.evaluate(
    algorithmSet,
    { testsByAlgorithm: {} },
    [{ algorithm: "good-alg", trustScore: 0.9 }],
    {
      medianProofTrust: 0.85,
      routerShadowSafety: 1,
      providerAuthorityInvariant: 1,
      minimalVerifiedDemo: 1,
    }
  );
  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.some((r) => r.includes("bad-alg")));
  assert.equal(result.coverageByAlgorithm["good-alg"], 1.0);
  assert.equal(result.coverageByAlgorithm["bad-alg"], 0.0);
});

// ── Median computation ──────────────────────────────────────────

test("medianProofTrust falls back to releaseCandidate when no proof bundle scores", () => {
  const inputs = makeInputs();
  inputs.proofBundles = [];
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.verdict, "pass");
});

test("medianProofTrust uses proof bundle scores when available", () => {
  const algorithmSet = [makeAlgorithm()];
  const proofBundles = [
    { algorithm: "alg-test", trustScore: 0.5 },
    { algorithm: "alg-test", trustScore: 0.6 },
    { algorithm: "alg-test", trustScore: 0.7 },
  ];
  const releaseCandidate = {
    medianProofTrust: 0.99,
    routerShadowSafety: 1,
    providerAuthorityInvariant: 1,
    minimalVerifiedDemo: 1,
  };
  const result = engine.evaluate(
    algorithmSet,
    { testsByAlgorithm: {} },
    proofBundles,
    releaseCandidate
  );
  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.some((r) => r.includes("medianProofTrust")));
  assert.ok(result.reasons.some((r) => r.includes("0.6")));
});

// ── Options ─────────────────────────────────────────────────────

test("custom thresholds via options", () => {
  const customEngine = createRegressionProofMatrixEngine({
    coverageThreshold: 0.9,
    proofTrustThreshold: 0.95,
  });
  const inputs = makeInputs();
  const result = customEngine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.verdict, "fail");
  assert.ok(
    result.reasons.some((r) => r.includes("medianProofTrust"))
  );
});

// ── TAU_EVIDENCE reuse ──────────────────────────────────────────

test("default threshold matches TAU_EVIDENCE", () => {
  assert.equal(TAU_EVIDENCE, 0.75);
  const inputs = makeInputs({ tests: 0 });
  const result = engine.evaluate(
    inputs.algorithmSet,
    inputs.testSuite,
    inputs.proofBundles,
    inputs.releaseCandidate
  );
  assert.equal(result.coverageByAlgorithm["alg-test"], 0.65);
  assert.equal(result.verdict, "fail");
});

// ── CLI integration ─────────────────────────────────────────────

test("regression proof matrix CLI emits a pass verdict in JSON mode", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/regression-proof-matrix.mjs", "--json"],
    { encoding: "utf8" }
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.verdict, "pass");
  assert.deepEqual(parsed.reasons, []);
});
