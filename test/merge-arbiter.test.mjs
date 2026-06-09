import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
await mkdir(join(repoRoot, "node_modules", ".cache"), { recursive: true });
const bundleDir = await mkdtemp(join(repoRoot, "node_modules", ".cache", "omk-merge-arbiter-test-"));

async function bundle(relSource, outName) {
  const outfile = join(bundleDir, outName);
  await build({
    entryPoints: [fileURLToPath(new URL(relSource, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const {
  normalizeDiff,
  extractFileScopes,
  detectConflicts,
  scorePatch,
  selectWinnerOrHybrid,
  produceMergeRationale,
} = await bundle("../src/orchestration/merge-arbiter.ts", "merge-arbiter.mjs");

process.on("exit", () => {
  try {
    rmSync(bundleDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ── Helpers ─────────────────────────────────────────────────────

function makeCandidate(overrides = {}) {
  return {
    id: "candidate-test",
    name: "test-worker",
    path: "/tmp/test",
    diff: "",
    normalizedDiff: "",
    fileScopes: [],
    diffLines: 100,
    canApply: true,
    conflictsWith: [],
    evidence: {
      testsPassed: true,
      lintPassed: true,
      typecheckPassed: true,
      reviewerScore: 80,
      reviewerReason: "good",
      evidenceTrustScore: 0.8,
    },
    scores: {
      testPassScore: 1,
      evidenceTrustScore: 0.8,
      minimalityScore: 0.8,
      lintTypecheckScore: 1,
      conflictFreeScore: 1,
      reviewerAgreementScore: 0.8,
    },
    compositeScore: 0,
    ...overrides,
  };
}

// ── normalizeDiff ───────────────────────────────────────────────

test("normalizeDiff strips index timestamps", () => {
  const raw = "index 1a2b3c4..5d6e7f8 100644\n--- a/file.ts\n+++ b/file.ts";
  const normalized = normalizeDiff(raw);
  assert.ok(!normalized.includes("1a2b3c4"));
  assert.ok(!normalized.includes("5d6e7f8"));
  assert.ok(normalized.includes("index <hash>..<hash> 100644"));
});

test("normalizeDiff strips ---/+++ timestamps", () => {
  const raw = "--- a/file.ts\t2024-01-01 00:00:00.000000000 +0000\n+++ b/file.ts\t2024-01-02 00:00:00.000000000 +0000";
  const normalized = normalizeDiff(raw);
  assert.ok(!normalized.includes("2024-01-01"));
  assert.ok(!normalized.includes("2024-01-02"));
  assert.ok(normalized.includes("--- a/file.ts"));
  assert.ok(normalized.includes("+++ b/file.ts"));
});

test("normalizeDiff preserves hunk lines", () => {
  const raw = "@@ -1,3 +1,3 @@\n line1\n-line2\n+line2-modified";
  const normalized = normalizeDiff(raw);
  assert.ok(normalized.includes("@@ -1,3 +1,3 @@"));
  assert.ok(normalized.includes("+line2-modified"));
});

// ── extractFileScopes ───────────────────────────────────────────

test("extractFileScopes parses diff --git lines", () => {
  const diff = "diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts";
  const scopes = extractFileScopes(diff);
  assert.deepEqual(scopes, ["src/foo.ts"]);
});

test("extractFileScopes deduplicates multiple hunks", () => {
  const diff = "diff --git a/src/foo.ts b/src/foo.ts\ndiff --git a/src/foo.ts b/src/foo.ts";
  const scopes = extractFileScopes(diff);
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0], "src/foo.ts");
});

test("extractFileScopes ignores /dev/null", () => {
  const diff = "--- a/src/old.ts\n+++ /dev/null";
  const scopes = extractFileScopes(diff);
  assert.ok(!scopes.includes("/dev/null"));
  assert.ok(scopes.includes("src/old.ts"));
});

// ── detectConflicts ─────────────────────────────────────────────

test("detectConflicts marks overlapping file scopes", () => {
  const a = makeCandidate({ id: "a", name: "worker-a", fileScopes: ["src/foo.ts"] });
  const b = makeCandidate({ id: "b", name: "worker-b", fileScopes: ["src/foo.ts"] });
  const candidates = detectConflicts([a, b]);
  assert.equal(candidates[0].conflictsWith.length, 1);
  assert.equal(candidates[1].conflictsWith.length, 1);
  assert.equal(candidates[0].scores.conflictFreeScore, 0);
});

test("detectConflicts leaves disjoint scopes clean", () => {
  const a = makeCandidate({ id: "a", name: "worker-a", fileScopes: ["src/foo.ts"] });
  const b = makeCandidate({ id: "b", name: "worker-b", fileScopes: ["src/bar.ts"] });
  const candidates = detectConflicts([a, b]);
  assert.equal(candidates[0].conflictsWith.length, 0);
  assert.equal(candidates[1].conflictsWith.length, 0);
  assert.equal(candidates[0].scores.conflictFreeScore, 1);
});

// ── scorePatch ──────────────────────────────────────────────────

test("scorePatch computes exact weighted composite", () => {
  const c = makeCandidate({
    evidence: {
      testsPassed: true,
      lintPassed: true,
      typecheckPassed: true,
      reviewerScore: 100,
      reviewerReason: "perfect",
      evidenceTrustScore: 1.0,
    },
    diffLines: 100,
    canApply: true,
    conflictsWith: [],
  });
  scorePatch(c, { maxDiffLines: 500 });
  const expected =
    0.35 * 1.0 +
    0.25 * 1.0 +
    0.15 * (1 - 100 / 500) +
    0.10 * 1.0 +
    0.10 * 1.0 +
    0.05 * 1.0;
  assert.ok(Math.abs(c.compositeScore - expected) < 1e-12);
});

test("scorePatch penalizes large diffs", () => {
  const c = makeCandidate({ diffLines: 1000, canApply: true, conflictsWith: [] });
  scorePatch(c, { maxDiffLines: 500 });
  assert.equal(c.scores.minimalityScore, 0);
});

test("scorePatch penalizes conflicts", () => {
  const c = makeCandidate({ conflictsWith: ["other"], canApply: true });
  scorePatch(c);
  assert.equal(c.scores.conflictFreeScore, 0);
});

test("scorePatch uses default reviewer score of 0.5 when missing", () => {
  const c = makeCandidate({
    evidence: {
      testsPassed: false,
      lintPassed: false,
      typecheckPassed: false,
      reviewerScore: undefined,
      reviewerReason: undefined,
      evidenceTrustScore: 0.5,
    },
    diffLines: 100,
    canApply: true,
    conflictsWith: [],
  });
  scorePatch(c);
  assert.equal(c.scores.reviewerAgreementScore, 0.5);
});

// ── selectWinnerOrHybrid ────────────────────────────────────────

test("selectWinnerOrHybrid picks highest scorer above threshold", () => {
  const a = makeCandidate({ id: "a", name: "a", compositeScore: 0.9 });
  const b = makeCandidate({ id: "b", name: "b", compositeScore: 0.7 });
  const result = selectWinnerOrHybrid([a, b], { threshold: 0.6 });
  assert.equal(result.winner.id, "a");
  assert.equal(result.requiresHumanApproval, false);
});

test("selectWinnerOrHybrid requires approval when all below threshold", () => {
  const a = makeCandidate({ id: "a", name: "a", compositeScore: 0.4 });
  const b = makeCandidate({ id: "b", name: "b", compositeScore: 0.3 });
  const result = selectWinnerOrHybrid([a, b], { threshold: 0.6 });
  assert.equal(result.winner, null);
  assert.equal(result.requiresHumanApproval, true);
  assert.ok(result.reason.includes("below threshold"));
});

test("selectWinnerOrHybrid prefers conflict-free alternative when best has conflicts", () => {
  const conflicted = makeCandidate({ id: "a", name: "a", compositeScore: 0.9, conflictsWith: ["b"] });
  const clean = makeCandidate({ id: "b", name: "b", compositeScore: 0.7, conflictsWith: [] });
  const result = selectWinnerOrHybrid([conflicted, clean], { threshold: 0.6 });
  assert.equal(result.winner.id, "b");
  assert.equal(result.requiresHumanApproval, false);
});

test("selectWinnerOrHybrid requires approval when no clean candidate meets threshold", () => {
  const conflicted = makeCandidate({ id: "a", name: "a", compositeScore: 0.9, conflictsWith: ["b"] });
  const clean = makeCandidate({ id: "b", name: "b", compositeScore: 0.5, conflictsWith: [] });
  const result = selectWinnerOrHybrid([conflicted, clean], { threshold: 0.6 });
  assert.equal(result.winner, null);
  assert.equal(result.requiresHumanApproval, true);
});

test("selectWinnerOrHybrid handles empty candidates", () => {
  const result = selectWinnerOrHybrid([], { threshold: 0.6 });
  assert.equal(result.winner, null);
  assert.equal(result.requiresHumanApproval, true);
});

// ── produceMergeRationale ───────────────────────────────────────

test("produceMergeRationale includes score breakdown", () => {
  const a = makeCandidate({ id: "a", name: "a", compositeScore: 0.9 });
  const b = makeCandidate({ id: "b", name: "b", compositeScore: 0.7 });
  const { rationale } = produceMergeRationale(
    [a, b],
    { winner: a, requiresHumanApproval: false },
    { threshold: 0.6 }
  );
  assert.equal(rationale.winnerId, "a");
  assert.equal(rationale.scoreBreakdown["a"], 0.9);
  assert.equal(rationale.scoreBreakdown["b"], 0.7);
  assert.equal(rationale.threshold, 0.6);
});

test("produceMergeRationale includes human approval reason when required", () => {
  const a = makeCandidate({ id: "a", name: "a", compositeScore: 0.4 });
  const { rationale } = produceMergeRationale(
    [a],
    { winner: null, requiresHumanApproval: true, reason: "too low" },
    { threshold: 0.6 }
  );
  assert.equal(rationale.winnerId, null);
  assert.equal(rationale.humanApprovalReason, "too low");
});

test("produceMergeRationale deduplicates bidirectional conflicts", () => {
  const a = makeCandidate({ id: "a", name: "a", compositeScore: 0.9, conflictsWith: ["b"] });
  const b = makeCandidate({ id: "b", name: "b", compositeScore: 0.7, conflictsWith: ["a"] });
  const { rationale } = produceMergeRationale(
    [a, b],
    { winner: a, requiresHumanApproval: false },
    { threshold: 0.6 }
  );
  // Should not have both "a ↔ b" and "b ↔ a"
  assert.equal(rationale.conflicts.length, 1);
});

test("produceMergeRationale trace contains all steps", () => {
  const a = makeCandidate({ id: "a", name: "a", compositeScore: 0.9 });
  const { trace } = produceMergeRationale(
    [a],
    { winner: a, requiresHumanApproval: false },
    { threshold: 0.6 }
  );
  assert.ok(trace.steps.some((s) => s.step === "score"));
  assert.ok(trace.steps.some((s) => s.step === "select-winner"));
  assert.ok(typeof trace.timestamp === "string");
});
