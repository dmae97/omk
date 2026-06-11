import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRoutePriorTiebreakInvariant,
  computeRouteBaseScoreMinGap,
  routeSourcePrior,
  selectTaskRouting,
} from "../dist/orchestration/routing.js";
import {
  DEFAULT_ROUTE_WEIGHTS,
  decideRouteWeightAdoption,
  generateRouteWeightCandidates,
  projectRouteWeights,
  smoothKeywordScore,
} from "../dist/orchestration/route-calibration.js";
import {
  calibrateTrustWeights,
  DEFAULT_TRUST_WEIGHTS,
  scoreTrustFeatures,
} from "../dist/evidence/trust-calibration.js";
import {
  createHedgePersonaWeights,
  updateHedgePersonaWeights,
  applyPersonaWeights,
} from "../dist/orchestration/hedge-persona-weights.js";
import { computeProvenanceRatio } from "../dist/metrics/provenance-ratio.js";

function routingInput(overrides = {}) {
  return {
    id: "review-evidence",
    name: "Review evidence and test gates",
    role: "reviewer",
    dependsOn: [],
    maxRetries: 0,
    inputs: [],
    outputs: [{ name: "review", ref: "review.md", gate: "review-pass" }],
    ...overrides,
  };
}

test("route source prior is a strict tiebreaker under current score lattice", () => {
  const gap = computeRouteBaseScoreMinGap({ role: 0.30, keyword: 0.25, evidence: 0.20, context: 0.15, safety: 0.10 });
  assert.equal(gap, 0.025);
  assert.equal(routeSourcePrior("project"), 0.02);
  assert.equal(routeSourcePrior("builtin"), 0.01);
  assert.equal(routeSourcePrior("global"), 0);
  assert.doesNotThrow(() => assertRoutePriorTiebreakInvariant({ project: 0.02, builtin: 0.01, global: 0 }, gap));
  assert.throws(() => assertRoutePriorTiebreakInvariant({ project: 0.08, builtin: 0.04, global: 0 }, gap), /source prior spread/u);
});

test("selectTaskRouting exposes route trace for calibration", () => {
  const routing = selectTaskRouting(routingInput());
  assert.ok(Array.isArray(routing.routeTrace));
  assert.ok(routing.routeTrace.length > 0);
  const top = routing.routeTrace[0];
  assert.equal(typeof top.baseScore, "number");
  assert.equal(typeof top.sourcePrior, "number");
  assert.equal(typeof top.features.keywordMatches, "number");
  assert.equal(top.score, Number((top.baseScore + top.sourcePrior).toFixed(6)));
});

test("route calibration candidates stay on simplex and paired adoption uses McNemar", () => {
  const projected = projectRouteWeights({ role: 2, keyword: 1, evidence: 1, context: 1, safety: 0 });
  assert.equal(Object.values(projected).reduce((a, b) => a + b, 0), 1);
  assert.ok(smoothKeywordScore(4, 2) > smoothKeywordScore(2, 2));
  const candidates = generateRouteWeightCandidates(DEFAULT_ROUTE_WEIGHTS);
  assert.ok(candidates.length >= 10);
  for (const weights of candidates) {
    assert.equal(Number(Object.values(weights).reduce((a, b) => a + b, 0).toFixed(6)), 1);
  }

  const current = { weights: DEFAULT_ROUTE_WEIGHTS, keywordTau: 2, outcomes: [true, true, false, false, false, false, false, false] };
  const candidate = { weights: candidates[1], keywordTau: 2, outcomes: [true, true, true, true, true, true, true, true] };
  const result = decideRouteWeightAdoption(current, candidate, { alpha: 0.05 });
  assert.equal(result.adopted, true);
  assert.ok(result.oddsRatio > 1);
  assert.ok(result.mcnemarP < 0.05);
});

test("trust calibration refuses underpowered data and can score features", () => {
  const underpowered = calibrateTrustWeights([], { minSamples: 100 });
  assert.equal(underpowered.adopted, false);
  assert.deepEqual(underpowered.weights, DEFAULT_TRUST_WEIGHTS);
  const score = scoreTrustFeatures({
    schema: 1,
    commands: 1,
    stdout: 0,
    hashes: 1,
    decisions: 1,
    evidence: 1,
    limitations: 0,
    replay: 0,
  });
  assert.equal(score, 0.75);
});

test("hedge persona weights reward correct voters while retaining diversity floor", () => {
  const state = createHedgePersonaWeights(["a", "b", "c"], { horizon: 20, floor: 0.3 });
  const updated = updateHedgePersonaWeights(state, [
    { id: "a", action: "continue" },
    { id: "b", action: "block" },
    { id: "c", action: "block" },
  ], "continue");
  assert.ok(updated.state.weights.a > updated.state.weights.b);
  assert.ok(Math.min(...Object.values(updated.state.weights)) >= 0.3);
  const votes = applyPersonaWeights([{ id: "a", weight: 1, action: "continue" }], updated.state);
  assert.equal(votes[0].weight, updated.state.weights.a);
});

test("provenance ratio reports layer-wise weighted originality", () => {
  const result = computeProvenanceRatio([
    { name: "orchestration", addedModifiedLines: 50, loc: 100, importance: 2 },
    { name: "util", addedModifiedLines: 10, loc: 100, importance: 1 },
  ]);
  assert.equal(result.importanceSum, 1);
  assert.equal(result.layers[0].originality, 0.5);
  assert.equal(result.layers[1].originality, 0.1);
  assert.equal(result.headlineOriginality, 0.366667);
});
