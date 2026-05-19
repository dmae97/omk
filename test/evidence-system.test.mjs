import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ContextBudgetOptimizer
import {
  estimateTokens,
  breakdownCapsuleTokens,
  optimizeContextBudget,
  createContextBudgetOptimizer,
} from "../dist/runtime/context-budget-optimizer.js";

// RepairPolicyEngine
import { decideRepair } from "../dist/orchestration/repair-policy.js";

// EvidenceGate v2
import { checkEvidenceGates, compressDiagnostic } from "../dist/orchestration/evidence-gate.js";

// ─── ContextBudgetOptimizer ─────────────────────────────────────────────────

describe("ContextBudgetOptimizer", () => {
  describe("estimateTokens", () => {
    it("estimates tokens as ceil(charCount / 4)", () => {
      assert.equal(estimateTokens("hello"), 2); // 5 chars → 1.25 → 2
      assert.equal(estimateTokens("a".repeat(100)), 25);
      assert.equal(estimateTokens(""), 0);
    });
  });

  describe("breakdownCapsuleTokens", () => {
    it("returns per-field token breakdown", () => {
      const capsule = {
        runId: "r1",
        nodeId: "n1",
        goal: "fix the bug",
        system: "You are a coding agent.",
        task: "Fix the TypeScript error in main.ts",
        dependencySummaries: ["dep1 completed successfully"],
        relevantFiles: [{ path: "main.ts", startLine: 1, endLine: 10, content: "const x = 1;" }],
        graphMemory: [{ key: "framework", value: "next.js", category: "tech", confidence: 0.9 }],
        priorAttempts: [{ attempt: 1, provider: "kimi", status: "failed", failureSummary: "type error" }],
        evidenceRequirements: [{ gate: "test-pass", required: true }],
        budget: { maxInputTokens: 16384, reservedOutputTokens: 4096, maxFileTokens: 8192, maxToolResultTokens: 4096, maxMemoryFacts: 20, compression: "lossless-ish" },
        node: { id: "n1", name: "fix", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 3 },
      };
      const breakdown = breakdownCapsuleTokens(capsule);
      assert.ok(breakdown.system > 0);
      assert.ok(breakdown.task > 0);
      assert.ok(breakdown.goal > 0);
      assert.ok(breakdown.dependencies > 0);
      assert.ok(breakdown.files > 0);
      assert.ok(breakdown.memory > 0);
      assert.ok(breakdown.evidence > 0);
      assert.ok(breakdown.priorAttempts > 0);
      assert.ok(breakdown.total > 0);
      assert.equal(breakdown.total, breakdown.system + breakdown.task + breakdown.goal + breakdown.dependencies + breakdown.files + breakdown.memory + breakdown.evidence + breakdown.priorAttempts);
    });
  });

  describe("optimizeContextBudget", () => {
    it("returns capsule unchanged when within budget", () => {
      const capsule = {
        runId: "r1", nodeId: "n1", goal: "fix", system: "sys",
        task: "task", dependencySummaries: [], relevantFiles: [],
        graphMemory: [], priorAttempts: [], evidenceRequirements: [],
        budget: { maxInputTokens: 16384, reservedOutputTokens: 4096, maxFileTokens: 8192, maxToolResultTokens: 4096, maxMemoryFacts: 20, compression: "lossless-ish" },
        node: { id: "n1", name: "fix", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 3 },
      };
      const result = optimizeContextBudget(capsule);
      assert.equal(result.report.droppedItems.length, 0);
      assert.ok(result.report.totalTokensEstimated <= 16384);
    });

    it("trims background (memory) when over budget", () => {
      const bigMemory = Array.from({ length: 100 }, (_, i) => ({
        key: `fact${i}`, value: "x".repeat(500), category: "tech", confidence: 0.5 + (i % 5) * 0.1,
      }));
      const capsule = {
        runId: "r1", nodeId: "n1", goal: "fix", system: "sys",
        task: "task", dependencySummaries: [], relevantFiles: [],
        graphMemory: bigMemory, priorAttempts: [], evidenceRequirements: [],
        budget: { maxInputTokens: 2000, reservedOutputTokens: 500, maxFileTokens: 1000, maxToolResultTokens: 500, maxMemoryFacts: 50, compression: "aggressive" },
        node: { id: "n1", name: "fix", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 3 },
      };
      const result = optimizeContextBudget(capsule);
      assert.ok(result.report.droppedItems.length > 0);
      assert.ok(result.report.droppedItems.some((d) => d.kind === "memory"));
    });

    it("never trims goal, system, or evidence (priority 1-3)", () => {
      const capsule = {
        runId: "r1", nodeId: "n1", goal: "x".repeat(5000), system: "y".repeat(5000),
        task: "z".repeat(5000), dependencySummaries: [], relevantFiles: [],
        graphMemory: [], priorAttempts: [], evidenceRequirements: [{ gate: "test-pass", required: true }],
        budget: { maxInputTokens: 1000, reservedOutputTokens: 200, maxFileTokens: 500, maxToolResultTokens: 200, maxMemoryFacts: 10, compression: "aggressive" },
        node: { id: "n1", name: "fix", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 3 },
      };
      const result = optimizeContextBudget(capsule);
      // Goal, system, evidence should still be present
      assert.ok(result.capsule.goal.length > 0);
      assert.ok(result.capsule.system.length > 0);
      assert.ok(result.capsule.evidenceRequirements.length > 0);
    });
  });

  describe("createContextBudgetOptimizer", () => {
    it("returns optimizer with optimize method", () => {
      const optimizer = createContextBudgetOptimizer();
      assert.equal(typeof optimizer.optimize, "function");
    });
  });
});

// ─── RepairPolicyEngine ─────────────────────────────────────────────────────

describe("RepairPolicyEngine", () => {
  const makeCtx = (overrides) => ({
    node: {
      id: "n1", name: "fix", role: "coder", dependsOn: [], status: "failed",
      retries: 0, maxRetries: 3,
      failurePolicy: { retryable: true, blockDependents: true },
    },
    attempt: {
      runId: "r1", nodeId: "n1", attemptId: "n1__1", runtime: "kimi-print",
      startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      latencyMs: 1000, inputTokensEstimated: 1000, outputTokensEstimated: 200,
      toolResultTokensEstimated: 100, totalTokensEstimated: 1300,
      evidencePassCount: 0, evidenceFailCount: 1, evidencePassRate: 0, evidencePassRatePerToken: 0,
      contextHash: "h1", promptHash: "h2", status: "evidence_failed",
      evidenceResults: [], changedFiles: [], summary: "failed",
    },
    diagnosis: {
      category: "evidence_failed", rootCause: "test failure",
      retryStrategy: { action: "retry-with-context", reason: "retry with more context" },
      confidence: 0.8,
    },
    failureKind: "test_failure",
    availableProviders: ["kimi", "deepseek"],
    previousProviders: [],
    totalAttempts: 1,
    ...overrides,
  });

  it("aborts on policy_violation", () => {
    const decision = decideRepair(makeCtx({ failureKind: "policy_violation" }));
    assert.equal(decision.action, "abort");
  });

  it("escalates to fallback after 3+ attempts when providers available", () => {
    const decision = decideRepair(makeCtx({ totalAttempts: 3 }));
    // escalateDecision tries fallback provider first when available
    assert.equal(decision.action, "fallback-provider");
  });

  it("retries with context on type_error first attempt", () => {
    const decision = decideRepair(makeCtx({ failureKind: "type_error", totalAttempts: 1 }));
    assert.equal(decision.action, "retry-with-context");
    assert.ok(decision.adjustment);
  });

  it("falls back provider on type_error second attempt", () => {
    const decision = decideRepair(makeCtx({ failureKind: "type_error", totalAttempts: 2 }));
    assert.equal(decision.action, "fallback-provider");
  });

  it("retries with context on test_failure", () => {
    const decision = decideRepair(makeCtx({ failureKind: "test_failure", totalAttempts: 1 }));
    assert.equal(decision.action, "retry-with-context");
  });

  it("retries same on lint_failure", () => {
    const decision = decideRepair(makeCtx({ failureKind: "lint_failure", totalAttempts: 1 }));
    assert.equal(decision.action, "retry-same");
  });

  it("falls back or skips after exhausting retries", () => {
    const decision = decideRepair(makeCtx({
      failureKind: "lint_failure",
      totalAttempts: 3,
      availableProviders: [],
      node: {
        id: "n1", name: "fix", role: "coder", dependsOn: [], status: "failed",
        retries: 2, maxRetries: 3,
        failurePolicy: { retryable: true, blockDependents: true, skipOnFailure: true },
      },
    }));
    assert.ok(decision.action === "skip" || decision.action === "abort");
  });
});

// ─── EvidenceGate v2 ────────────────────────────────────────────────────────

describe("EvidenceGate v2", () => {

  describe("compressDiagnostic", () => {
    it("extracts TypeScript error details", () => {
      const result = compressDiagnostic("tsc --noEmit", 2, "", "src/main.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.");
      assert.equal(result.failureKind, "type_error");
      assert.ok(result.diagnosis.includes("TS2322"));
    });

    it("extracts test failure details", () => {
      const result = compressDiagnostic("npm test", 1, "FAIL src/main.test.ts\nExpected: 42\nReceived: 0", "");
      assert.equal(result.failureKind, "test_failure");
      assert.ok(result.diagnosis.includes("src/main.test"));
    });

    it("returns generic diagnosis for unknown errors", () => {
      const result = compressDiagnostic("unknown-cmd", 1, "", "some random error");
      assert.ok(result.failureKind);
      assert.ok(result.diagnosis.length > 0);
    });
  });

  it("redacts secret-looking stdout and stderr tails from command-pass failures", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "omk-evidence-redaction-"));
    const fakeToken = ["sk", "123456789012345678901234"].join("-");
    try {
      await writeFile(join(projectRoot, "package.json"), JSON.stringify({
        scripts: {
          leak: `node -e "console.log('${fakeToken}'); console.error('TOKEN=${fakeToken}'); process.exit(1)"`,
        },
      }));

      const result = await checkEvidenceGates([
        { type: "command-pass", command: "npm run leak" },
      ], {
        cwd: projectRoot,
        stdout: "",
        nodeId: "redaction-test",
      });

      assert.equal(result.passed, false);
      const evidence = result.evidence[0];
      const serialized = JSON.stringify(evidence);
      assert.doesNotMatch(serialized, new RegExp(fakeToken));
      assert.match(serialized, /REDACTED/);
      assert.match(evidence.stdoutTail ?? "", /REDACTED/);
      assert.match(evidence.stderrTail ?? "", /REDACTED/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
