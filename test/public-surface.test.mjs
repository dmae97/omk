import test from "node:test";
import assert from "node:assert/strict";

import {
  computeSurfaceScore,
  enforceFlowInvariant,
  PublicSurfaceCompressor,
} from "../dist/runtime/public-surface.js";

const MANDATORY_ANCHORS = ["goal", "dag", "route", "verify", "replay"];

// ── Helpers ─────────────────────────────────────────────────────

function makeItem(overrides = {}) {
  return {
    id: "test-item",
    name: "Test Item",
    category: /** @type {const} */ ("tool"),
    usage: 0.5,
    verifiedRunContribution: 0.5,
    evidenceContribution: 0.5,
    onboardingCost: 0.1,
    explainabilityCost: 0.1,
    lineageRisk: 0.1,
    ...overrides,
  };
}

function makeCandidate(id, overrides = {}) {
  return makeItem({ id, name: id, ...overrides });
}

// ── Mandatory anchors ───────────────────────────────────────────

test("mandatory anchors are always present in public surface", () => {
  const compressor = new PublicSurfaceCompressor({ budget: 5 });
  const result = compressor.compress([]);

  const publicIds = result.publicSurface.map((s) => s.id);
  for (const anchor of MANDATORY_ANCHORS) {
    assert.ok(publicIds.includes(anchor), `missing anchor: ${anchor}`);
  }
});

test("missing mandatory anchors are injected as placeholders with score 0", () => {
  const compressor = new PublicSurfaceCompressor({ budget: 5 });
  const result = compressor.compress([makeCandidate("extra", { usage: 1 })]);

  const goal = result.publicSurface.find((s) => s.id === "goal");
  assert.ok(goal);
  assert.equal(goal.score, 0);
  assert.equal(goal.usage, 0);
});

// ── Budget enforcement ──────────────────────────────────────────

test("budget K=5 yields exactly 5 public items when no electives", () => {
  const compressor = new PublicSurfaceCompressor({ budget: 5 });
  const result = compressor.compress([]);

  assert.equal(result.publicSurface.length, 5);
  assert.equal(result.hiddenSet.length, 0);
  assert.equal(result.budget, 5);
});

test("budget K=8 fills remaining slots with highest-scoring electives", () => {
  const compressor = new PublicSurfaceCompressor({ budget: 8 });
  const candidates = [
    makeCandidate("goal", { usage: 1 }),
    makeCandidate("dag", { usage: 0.9 }),
    makeCandidate("route", { usage: 0.8 }),
    makeCandidate("verify", { usage: 0.7 }),
    makeCandidate("replay", { usage: 0.6 }),
    makeCandidate("a", { usage: 1.0, verifiedRunContribution: 1.0 }),
    makeCandidate("b", { usage: 0.8, verifiedRunContribution: 0.9 }),
    makeCandidate("c", { usage: 0.6, verifiedRunContribution: 0.8 }),
    makeCandidate("d", { usage: 0.4, verifiedRunContribution: 0.7 }),
  ];

  const result = compressor.compress(candidates);

  assert.equal(result.publicSurface.length, 8);
  assert.equal(result.hiddenSet.length, 1);
  assert.equal(result.hiddenSet[0].id, "d");
});

test("budget cannot drop below mandatory anchor count", () => {
  const compressor = new PublicSurfaceCompressor({ budget: 3 });
  assert.equal(compressor.compress([]).publicSurface.length, 5);
});

// ── Scoring formula precision ───────────────────────────────────

test("scoring formula with all zeros returns 0", () => {
  const item = makeItem({
    usage: 0,
    verifiedRunContribution: 0,
    evidenceContribution: 0,
    onboardingCost: 0,
    explainabilityCost: 0,
    lineageRisk: 0,
  });
  assert.equal(computeSurfaceScore(item), 0);
});

test("scoring formula with all ones returns clamped 1", () => {
  const item = makeItem({
    usage: 1,
    verifiedRunContribution: 1,
    evidenceContribution: 1,
    onboardingCost: 0,
    explainabilityCost: 0,
    lineageRisk: 0,
  });
  // Raw = 0.30 + 0.30 + 0.20 = 0.80, not clamped
  assert.equal(computeSurfaceScore(item), 0.8);
});

test("scoring formula clamps raw scores above 1 to exactly 1", () => {
  const item = makeItem({
    usage: 1,
    verifiedRunContribution: 1,
    evidenceContribution: 1,
    onboardingCost: -3, // negative cost inflates score
    explainabilityCost: 0,
    lineageRisk: 0,
  });
  const raw = 0.30 * 1 + 0.30 * 1 + 0.20 * 1 - 0.10 * (-3);
  assert.ok(raw > 1, `raw should exceed 1 but was ${raw}`);
  assert.equal(computeSurfaceScore(item), 1);
});

test("scoring formula precision: known input yields exact expected output", () => {
  const item = makeItem({
    usage: 0.5,
    verifiedRunContribution: 0.4,
    evidenceContribution: 0.3,
    onboardingCost: 0.2,
    explainabilityCost: 0.1,
    lineageRisk: 0.05,
  });
  const expected =
    0.30 * 0.5 +
    0.30 * 0.4 +
    0.20 * 0.3 -
    0.10 * 0.2 -
    0.05 * 0.1 -
    0.05 * 0.05;
  assert.equal(computeSurfaceScore(item), expected);
});

test("scoring formula clamps negative raw scores to 0", () => {
  const item = makeItem({
    usage: 0,
    verifiedRunContribution: 0,
    evidenceContribution: 0,
    onboardingCost: 1,
    explainabilityCost: 1,
    lineageRisk: 1,
  });
  assert.equal(computeSurfaceScore(item), 0);
});

test("scoring formula clamps scores above 1 to 1", () => {
  const item = makeItem({
    usage: 1,
    verifiedRunContribution: 1,
    evidenceContribution: 1,
    onboardingCost: 0,
    explainabilityCost: 0,
    lineageRisk: 0,
  });
  const raw = 0.30 * 1 + 0.30 * 1 + 0.20 * 1; // 0.80, within bounds
  assert.equal(computeSurfaceScore(item), raw);
});

// ── Flow invariant ──────────────────────────────────────────────

test("flow invariant passes when anchors are in canonical order", () => {
  const surface = [
    { id: "goal", score: 0 },
    { id: "dag", score: 0 },
    { id: "route", score: 0 },
    { id: "verify", score: 0 },
    { id: "replay", score: 0 },
  ];
  const result = enforceFlowInvariant(surface);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
});

test("flow invariant detects missing anchors", () => {
  const surface = [{ id: "goal", score: 0 }];
  const result = enforceFlowInvariant(surface);
  assert.equal(result.passed, false);
  assert.equal(result.violations.length, 4);
  assert.ok(result.violations.some((v) => v.includes("dag")));
  assert.ok(result.violations.some((v) => v.includes("replay")));
});

test("flow invariant detects order violation", () => {
  const surface = [
    { id: "goal", score: 0 },
    { id: "dag", score: 0 },
    { id: "verify", score: 0 },
    { id: "route", score: 0 },
    { id: "replay", score: 0 },
  ];
  const result = enforceFlowInvariant(surface);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.includes("route")));
});

test("compressor enforces invariant and reports violations", () => {
  const compressor = new PublicSurfaceCompressor({ budget: 5 });
  const result = compressor.compress([]);

  assert.equal(result.invariantPassed, true);
  assert.equal(result.invariantViolations.length, 0);
});

test("compressor produces ordered mandatory anchors regardless of input order", () => {
  const compressor = new PublicSurfaceCompressor({ budget: 7 });
  const candidates = [
    makeCandidate("replay", { usage: 1 }),
    makeCandidate("verify", { usage: 0.9 }),
    makeCandidate("route", { usage: 0.8 }),
    makeCandidate("dag", { usage: 0.7 }),
    makeCandidate("goal", { usage: 0.6 }),
    makeCandidate("zeta", { usage: 0.5 }),
    makeCandidate("alpha", { usage: 0.4 }),
  ];

  const result = compressor.compress(candidates);
  const ids = result.publicSurface.map((s) => s.id);

  assert.deepEqual(ids.slice(0, 5), MANDATORY_ANCHORS);
});
