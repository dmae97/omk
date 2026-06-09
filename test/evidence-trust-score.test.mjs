import test from "node:test";
import assert from "node:assert/strict";
import {
  extractClaims,
  requiredEvidenceForClaim,
  verifyEvidence,
  createEvidenceTrustScoreV2Engine,
} from "../dist/evidence/evidence-trust-score.js";

const engine = createEvidenceTrustScoreV2Engine();

// ── Helpers ─────────────────────────────────────────────────────

function makeArtifactMeta(overrides = {}) {
  return {
    runId: "run-001",
    nodeId: "node-a",
    provider: "kimi",
    model: "kimi-v1",
    cwd: "/repo",
    treeHashBefore: "abc123",
    treeHashAfter: "def456",
    commandHash: "cmd789",
    timestamp: new Date().toISOString(),
    command: "npm test",
    ...overrides,
  };
}

function makeCollectedEvidence(items = [], metaOverrides = {}) {
  return {
    items,
    meta: makeArtifactMeta(metaOverrides),
  };
}

function makeEvidenceItem(overrides = {}) {
  return {
    id: "ev-1",
    kind: "test",
    source: "runner",
    description: "test passed",
    verdict: "pass",
    timestamp: new Date().toISOString(),
    confidence: 0.9,
    linkedFilePaths: ["src/index.ts"],
    ...overrides,
  };
}

// ── Claim Extraction ────────────────────────────────────────────

test("extractClaims finds test claim", () => {
  const claims = extractClaims("All tests passed successfully.");
  assert.ok(claims.length >= 1);
  assert.equal(claims[0].category, "test");
});

test("extractClaims finds build claim", () => {
  const claims = extractClaims("Build succeeded without errors.");
  assert.ok(claims.length >= 1);
  assert.equal(claims[0].category, "build");
});

test("extractClaims returns empty for neutral text", () => {
  const claims = extractClaims("Hello world.");
  assert.equal(claims.length, 0);
});

// ── Required Evidence ───────────────────────────────────────────

test("requiredEvidenceForClaim returns items for test claim", () => {
  const claim = { claimId: "c1", text: "tests passed", category: "test", confidence: 0.8 };
  const required = requiredEvidenceForClaim(claim, "feature", "medium");
  assert.ok(required.length > 0);
  assert.ok(required.some((r) => r.kind === "test"));
  assert.ok(required.some((r) => r.kind === "command"));
});

test("requiredEvidenceForClaim adds audit for high risk", () => {
  const claim = { claimId: "c1", text: "tests passed", category: "test", confidence: 0.8 };
  const required = requiredEvidenceForClaim(claim, "feature", "high");
  assert.ok(required.some((r) => r.kind === "audit"));
});

test("requiredEvidenceForClaim adds review for critical risk", () => {
  const claim = { claimId: "c1", text: "tests passed", category: "test", confidence: 0.8 };
  const required = requiredEvidenceForClaim(claim, "security", "critical");
  assert.ok(required.some((r) => r.kind === "review"));
});

// ── Evidence Verifier ───────────────────────────────────────────

test("verifyEvidence marks satisfied when evidence matches", () => {
  const req = [
    { evidenceId: "r1", kind: "test", description: "need test", minConfidence: 0.5 },
  ];
  const collected = makeCollectedEvidence([makeEvidenceItem({ kind: "test", confidence: 0.9, verdict: "pass" })]);
  const result = verifyEvidence(req, collected);
  assert.equal(result.satisfied.length, 1);
  assert.equal(result.missing.length, 0);
});

test("verifyEvidence marks missing when no evidence", () => {
  const req = [
    { evidenceId: "r1", kind: "test", description: "need test", minConfidence: 0.5 },
  ];
  const collected = makeCollectedEvidence([]);
  const result = verifyEvidence(req, collected);
  assert.equal(result.satisfied.length, 0);
  assert.equal(result.missing.length, 1);
});

test("verifyEvidence marks partial when only partial verdict", () => {
  const req = [
    { evidenceId: "r1", kind: "test", description: "need test", minConfidence: 0.5 },
  ];
  const collected = makeCollectedEvidence([makeEvidenceItem({ kind: "test", confidence: 0.9, verdict: "partial" })]);
  const result = verifyEvidence(req, collected);
  assert.equal(result.partial.length, 1);
  assert.equal(result.satisfied.length, 0);
});

// ── ETS v2 Engine ───────────────────────────────────────────────

test("ETS v2 pass with strong evidence", async () => {
  const result = await engine.evaluate({
    output: "All tests passed. Build succeeded.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "test", source: "runner", verdict: "pass", linkedFilePaths: ["src/a.ts"] }),
      makeEvidenceItem({ kind: "command", source: "runner", verdict: "pass" }),
      makeEvidenceItem({ kind: "trace", source: "runner", verdict: "pass" }),
      makeEvidenceItem({ kind: "metric", source: "runner", verdict: "pass" }),
    ]),
    dependencyGraphFiles: ["src/a.ts"],
  });
  assert.equal(result.verdict, "pass");
  assert.ok(result.score >= 0.75);
  assert.ok(result.reproducibility >= 0.5);
  assert.ok(result.independence >= 0.5);
});

test("ETS v2 fail with no evidence", async () => {
  const result = await engine.evaluate({
    output: "All tests passed.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([]),
  });
  assert.equal(result.verdict, "fail");
  assert.ok(result.score < 0.5);
  assert.ok(result.unverifiableClaimPenalty > 0);
});

test("ETS v2 warn with weak provenance", async () => {
  const result = await engine.evaluate({
    output: "Build succeeded.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence(
      [makeEvidenceItem({ kind: "metric", source: "runner", verdict: "pass" })],
      { treeHashBefore: "", treeHashAfter: "", commandHash: "" }
    ),
  });
  // Low reproducibility should push score toward warn/fail
  assert.ok(result.reproducibility < 0.5);
  assert.ok(result.verdict === "warn" || result.verdict === "fail");
});

test("ETS v2 applies gaming penalty for agent-only sources", async () => {
  const result = await engine.evaluate({
    output: "Tests passed. Build succeeded. Lint clean.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "test", source: "agent", verdict: "pass" }),
      makeEvidenceItem({ kind: "metric", source: "agent", verdict: "pass" }),
    ]),
  });
  assert.ok(result.gamingPenalty > 0);
});

test("ETS v2 applies stale penalty for old evidence", async () => {
  const oldDate = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(); // 100 hours ago
  const result = await engine.evaluate({
    output: "Tests passed.",
    taskType: "feature",
    risk: "high",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "test", source: "runner", verdict: "pass", timestamp: oldDate }),
    ]),
  });
  assert.ok(result.staleResultPenalty > 0);
});

test("ETS v2 independence high with runner sources", async () => {
  const result = await engine.evaluate({
    output: "Tests passed.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "test", source: "runner", verdict: "pass" }),
      makeEvidenceItem({ kind: "command", source: "shell", verdict: "pass" }),
    ]),
  });
  assert.ok(result.independence >= 0.5);
});

test("ETS v2 coverage relevance with dependency graph link", async () => {
  const result = await engine.evaluate({
    output: "Tests passed.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "test", source: "runner", verdict: "pass", linkedFilePaths: ["src/a.ts"] }),
    ]),
    dependencyGraphFiles: ["src/a.ts"],
  });
  assert.ok(result.coverageRelevance > 0);
});

test("ETS v2 score bounded in [0,1]", async () => {
  const result = await engine.evaluate({
    output: "Everything is perfect.",
    taskType: "feature",
    risk: "critical",
    runArtifacts: makeCollectedEvidence([]),
  });
  assert.ok(result.score >= 0);
  assert.ok(result.score <= 1);
});

test("ETS v2 provenance integrity full when all fields present", async () => {
  const result = await engine.evaluate({
    output: "Tests passed.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([makeEvidenceItem({ kind: "test", source: "runner", verdict: "pass" })]),
  });
  assert.ok(result.provenanceIntegrity >= 0.8);
});

test("ETS v2 freshness 1.0 for recent evidence", async () => {
  const result = await engine.evaluate({
    output: "Tests passed.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "test", source: "runner", verdict: "pass", timestamp: new Date().toISOString() }),
    ]),
  });
  assert.equal(result.freshness, 1.0);
});

test("ETS v2 critical risk requires review evidence", async () => {
  const result = await engine.evaluate({
    output: "Security scan passed.",
    taskType: "security",
    risk: "critical",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "audit", source: "runner", verdict: "pass" }),
      // No review evidence → should be missing
    ]),
  });
  assert.ok(result.unverifiableClaimPenalty > 0);
});

test("ETS v2 custom weights affect score", async () => {
  const customEngine = createEvidenceTrustScoreV2Engine({
    customWeights: { reproducibility: 0.5, independence: 0.1 },
  });
  const result = await customEngine.evaluate({
    output: "Tests passed.",
    taskType: "feature",
    risk: "medium",
    runArtifacts: makeCollectedEvidence([
      makeEvidenceItem({ kind: "test", source: "runner", verdict: "pass" }),
    ]),
  });
  // Should still produce a valid result
  assert.ok(result.score >= 0);
  assert.ok(result.score <= 1);
});
