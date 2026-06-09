import test from "node:test";
import assert from "node:assert/strict";

import {
  createProviderMaturityGate,
} from "../dist/runtime/provider-maturity-gate.js";

const gate = createProviderMaturityGate();

// ── Helpers ─────────────────────────────────────────────────────

function makeResults(overrides = {}) {
  const base = {
    auth: 0,
    read: 0,
    write: 0,
    shell: 0,
    mcp: 0,
    merge: 0,
    evidence: 0,
    fallback: 0,
  };
  const scores = { ...base, ...overrides };
  return Object.entries(scores).map(([kind, score]) => ({
    kind,
    passed: score >= 0.5,
    score,
  }));
}

// ── Authority class assignment ──────────────────────────────────

test("merge-authority when score >= 0.90 and merge/evidence sub-scores high", () => {
  const results = makeResults({
    auth: 1.0,
    read: 1.0,
    write: 1.0,
    shell: 1.0,
    mcp: 1.0,
    merge: 1.0,
    evidence: 1.0,
    fallback: 1.0,
  });
  const result = gate.evaluate(results);
  assert.equal(result.authorityClass, "merge-authority");
  assert.equal(result.passed, true);
});

test("write-authority when score >= 0.80 and write sub-score high", () => {
  const results = makeResults({
    auth: 0.9,
    read: 0.9,
    write: 0.9,
    shell: 0.8,
    mcp: 0.8,
    merge: 0.7,
    evidence: 0.8,
    fallback: 0.8,
  });
  const result = gate.evaluate(results);
  assert.equal(result.authorityClass, "write-authority");
  assert.equal(result.passed, true);
});

test("review-authority when score >= 0.70 and read sub-score high", () => {
  const results = makeResults({
    auth: 0.8,
    read: 0.95,
    write: 0.6,
    shell: 0.6,
    mcp: 0.7,
    merge: 0.6,
    evidence: 0.8,
    fallback: 0.7,
  });
  const result = gate.evaluate(results);
  // Score = 0.10*0.8 + 0.10*0.95 + 0.15*0.6 + 0.10*0.6 + 0.15*0.7 + 0.15*0.6 + 0.15*0.8 + 0.10*0.7
  //       = 0.08 + 0.095 + 0.09 + 0.06 + 0.105 + 0.09 + 0.12 + 0.07 = 0.71
  assert.ok(result.score >= 0.70);
  assert.equal(result.authorityClass, "review-authority");
  assert.equal(result.passed, true);
});

test("read-only-advisory when score >= 0.55 but below review threshold", () => {
  const results = makeResults({
    auth: 0.7,
    read: 0.7,
    write: 0.4,
    shell: 0.4,
    mcp: 0.5,
    merge: 0.4,
    evidence: 0.6,
    fallback: 0.5,
  });
  const result = gate.evaluate(results);
  // Score = 0.10*0.7 + 0.10*0.7 + 0.15*0.4 + 0.10*0.4 + 0.15*0.5 + 0.15*0.4 + 0.15*0.6 + 0.10*0.5
  //       = 0.07 + 0.07 + 0.06 + 0.04 + 0.075 + 0.06 + 0.09 + 0.05 = 0.515
  // Need a bit more — adjust to hit >= 0.55.
  const results2 = makeResults({
    auth: 0.8,
    read: 0.8,
    write: 0.4,
    shell: 0.4,
    mcp: 0.6,
    merge: 0.4,
    evidence: 0.6,
    fallback: 0.6,
  });
  const result2 = gate.evaluate(results2);
  // Score = 0.08 + 0.08 + 0.06 + 0.04 + 0.09 + 0.06 + 0.09 + 0.06 = 0.56
  assert.ok(result2.score >= 0.55);
  assert.equal(result2.authorityClass, "read-only-advisory");
  assert.equal(result2.passed, true);
});

test("disabled when score is below 0.55", () => {
  const results = makeResults({
    auth: 0.1,
    read: 0.1,
    write: 0.1,
    shell: 0.1,
    mcp: 0.1,
    merge: 0.1,
    evidence: 0.1,
    fallback: 0.1,
  });
  const result = gate.evaluate(results);
  assert.equal(result.authorityClass, "disabled");
  assert.equal(result.passed, false);
});

test("merge-authority blocked when merge sub-score is below threshold", () => {
  const results = makeResults({
    auth: 1.0,
    read: 1.0,
    write: 1.0,
    shell: 1.0,
    mcp: 1.0,
    merge: 0.5,
    evidence: 1.0,
    fallback: 1.0,
  });
  const result = gate.evaluate(results);
  // score is 0.95, but merge sub-score < 0.90 → drops to write-authority
  assert.notEqual(result.authorityClass, "merge-authority");
});

test("write-authority blocked when write sub-score is below threshold", () => {
  const results = makeResults({
    auth: 1.0,
    read: 1.0,
    write: 0.5,
    shell: 1.0,
    mcp: 1.0,
    merge: 0.5,
    evidence: 1.0,
    fallback: 1.0,
  });
  const result = gate.evaluate(results);
  // score ~0.925, but write sub-score < 0.85 → drops to review-authority
  assert.equal(result.authorityClass, "review-authority");
});

// ── Maturity score formula ──────────────────────────────────────

test("maturity score formula with mock adapter results", () => {
  const results = makeResults({
    auth: 1.0,
    read: 0.5,
    write: 0.5,
    shell: 0.5,
    mcp: 0.5,
    merge: 0.5,
    evidence: 0.5,
    fallback: 0.5,
  });
  const result = gate.evaluate(results);

  const expected =
    0.10 * 1.0 +
    0.10 * 0.5 +
    0.15 * 0.5 +
    0.10 * 0.5 +
    0.15 * 0.5 +
    0.15 * 0.5 +
    0.15 * 0.5 +
    0.10 * 0.5;

  assert.equal(result.score, expected);
});

test("maturity score is clamped to [0, 1]", () => {
  const results = makeResults({
    auth: 2.0,
    read: 2.0,
    write: 2.0,
    shell: 2.0,
    mcp: 2.0,
    merge: 2.0,
    evidence: 2.0,
    fallback: 2.0,
  });
  const result = gate.evaluate(results);
  assert.equal(result.score, 1.0);
});

test("missing adapter kinds default to 0", () => {
  const results = [{ kind: "auth", passed: true, score: 1.0 }];
  const result = gate.evaluate(results);
  assert.equal(result.subScores.auth, 1.0);
  assert.equal(result.subScores.write, 0.0);
  assert.equal(result.subScores.shell, 0.0);
});

// ── Disabled class blocks all write/merge/shell ─────────────────

test("disabled class blocks write, merge, and shell operations", () => {
  const results = makeResults({
    auth: 0.2,
    read: 0.2,
    write: 0.2,
    shell: 0.2,
    mcp: 0.2,
    merge: 0.2,
    evidence: 0.2,
    fallback: 0.2,
  });
  const result = gate.evaluate(results);

  assert.equal(result.authorityClass, "disabled");
  assert.equal(result.passed, false);
  assert.ok(result.subScores.write < 0.85);
  assert.ok(result.subScores.merge < 0.90);
  assert.ok(result.subScores.shell < 0.85);
});

test("getSubScore returns clamped score or 0 for missing kind", () => {
  const results = makeResults({ write: 1.2, read: -0.5 });
  assert.equal(gate.getSubScore(results, "write"), 1.0);
  assert.equal(gate.getSubScore(results, "read"), 0.0);
  assert.equal(gate.getSubScore(results, "shell"), 0.0);
});
