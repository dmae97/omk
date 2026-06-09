import test from "node:test";
import assert from "node:assert/strict";

import {
  createProofBundleTrustEngine,
} from "../dist/runtime/proof-bundle-trust.js";
import { TAU_PROOF } from "../dist/runtime/contracts/weakness-remediation.js";

const engine = createProofBundleTrustEngine();

// ── Helpers ─────────────────────────────────────────────────────

function makeScores(overrides = {}) {
  return {
    schema: 1.0,
    hashes: 1.0,
    commands: 1.0,
    stdout: 1.0,
    decisions: 1.0,
    evidence: 1.0,
    limitations: 1.0,
    replay: 1.0,
    ...overrides,
  };
}

// ── Trust score calculation with exact weights ──────────────────

test("perfect scores yield trust score of 1.0", () => {
  const result = engine.evaluate(makeScores());
  assert.equal(result.score, 1.0);
  assert.equal(result.passed, true);
});

test("trust score uses exact weights", () => {
  const scores = makeScores({
    schema: 0.8,
    hashes: 0.6,
    commands: 0.4,
    stdout: 0.2,
    decisions: 1.0,
    evidence: 0.5,
    limitations: 0.0,
    replay: 0.3,
  });

  const expected =
    0.15 * 0.8 +
    0.15 * 0.6 +
    0.15 * 0.4 +
    0.10 * 0.2 +
    0.15 * 1.0 +
    0.15 * 0.5 +
    0.05 * 0.0 +
    0.10 * 0.3;

  const result = engine.evaluate(scores);
  assert.equal(result.score, expected);
});

test("scores are clamped to [0, 1] before weighting", () => {
  const result = engine.evaluate(makeScores({ schema: 1.5, hashes: -0.3 }));
  // clamped to 1.0 and 0.0 respectively
  const expected =
    0.15 * 1.0 +
    0.15 * 0.0 +
    0.15 * 1.0 +
    0.10 * 1.0 +
    0.15 * 1.0 +
    0.15 * 1.0 +
    0.05 * 1.0 +
    0.10 * 1.0;
  assert.equal(result.score, expected);
});

// ── Permission level thresholds ─────────────────────────────────

test("score >= 0.90 yields strong-public-claim", () => {
  const result = engine.evaluate(makeScores({ evidence: 0.85, replay: 0.85 }));
  assert.equal(result.permissionLevel, "strong-public-claim");
});

test("score >= 0.75 and < 0.90 yields qualified-public-claim", () => {
  const result = engine.evaluate(
    makeScores({ evidence: 0.5, replay: 0.5, decisions: 0.5 }),
  );
  // weighted average should land in [0.75, 0.90)
  assert.equal(result.permissionLevel, "qualified-public-claim");
});

test("score >= 0.60 and < 0.75 yields internal-claim-only", () => {
  // Target score in [0.60, 0.75): with uniform x across all dimensions,
  // score = x, so x = 0.65 fits.
  const result = engine.evaluate(
    makeScores({
      schema: 0.65,
      hashes: 0.65,
      commands: 0.65,
      stdout: 0.65,
      decisions: 0.65,
      evidence: 0.65,
      limitations: 0.65,
      replay: 0.65,
    }),
  );
  assert.ok(Math.abs(result.score - 0.65) < 1e-12);
  assert.equal(result.permissionLevel, "internal-claim-only");
});

test("score < 0.60 yields no-claim", () => {
  const result = engine.evaluate(
    makeScores({
      schema: 0.0,
      hashes: 0.0,
      commands: 0.0,
      stdout: 0.0,
      decisions: 0.0,
      evidence: 0.0,
      limitations: 0.0,
      replay: 0.0,
    }),
  );
  assert.equal(result.permissionLevel, "no-claim");
  assert.equal(result.passed, false);
});

test("score exactly at 0.90 boundary is strong-public-claim", () => {
  // Weights sum to 1.0, so uniform x yields score = x.
  // Use a small tolerance for floating-point comparison.
  const scores = makeScores({
    schema: 0.9,
    hashes: 0.9,
    commands: 0.9,
    stdout: 0.9,
    decisions: 0.9,
    evidence: 0.9,
    limitations: 0.9,
    replay: 0.9,
  });
  const result = engine.evaluate(scores);
  assert.ok(Math.abs(result.score - 0.9) < 1e-12);
  assert.equal(result.permissionLevel, "strong-public-claim");
});

// ── Edge cases ──────────────────────────────────────────────────

test("missing hashes (score 0) drops trust score by exact weight", () => {
  const perfect = engine.evaluate(makeScores());
  const missingHashes = engine.evaluate(makeScores({ hashes: 0 }));
  assert.ok(Math.abs(perfect.score - missingHashes.score - 0.15) < 1e-12);
});

test("failed commands (score 0) drops trust score by exact weight", () => {
  const perfect = engine.evaluate(makeScores());
  const failedCommands = engine.evaluate(makeScores({ commands: 0 }));
  assert.ok(Math.abs(perfect.score - failedCommands.score - 0.15) < 1e-12);
});

test("pass/fail against TAU_PROOF is exact", () => {
  const justAbove = engine.evaluate(makeScores());
  assert.equal(justAbove.score, 1.0);
  assert.equal(justAbove.passed, true);

  const justBelow = engine.evaluate(
    makeScores({
      schema: 0.5,
      hashes: 0.5,
      commands: 0.5,
      stdout: 0.5,
      decisions: 0.5,
      evidence: 0.5,
      limitations: 0.5,
      replay: 0.5,
    }),
  );
  assert.equal(justBelow.score, 0.5);
  assert.equal(justBelow.passed, false);
  assert.ok(justBelow.score < TAU_PROOF);
});

test("breakdown reflects clamped input values", () => {
  const result = engine.evaluate(makeScores({ schema: -0.5, hashes: 1.2 }));
  assert.equal(result.breakdown.schema, 0.0);
  assert.equal(result.breakdown.hashes, 1.0);
});

test("deriveScores maps verdicts to base scores and coverage", () => {
  const passScores = engine.deriveScores("pass", 100);
  assert.equal(passScores.schema, 1.0);
  assert.equal(passScores.hashes, 1.0);
  assert.equal(passScores.commands, 1.0);

  const failScores = engine.deriveScores("fail", 50);
  assert.equal(failScores.schema, 0.0);
  assert.equal(failScores.commands, 0.5);

  const partialScores = engine.deriveScores("partial", 75);
  assert.equal(partialScores.schema, 0.65);
  assert.equal(partialScores.commands, 0.75);
});
