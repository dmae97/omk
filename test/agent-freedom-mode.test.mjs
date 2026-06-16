import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompactionQualityGate } from "../dist/runtime/structured-compaction.js";
import { evaluateHeadroomAwareLoopDecision } from "../dist/runtime/headroom-aware-loop-decision.js";
import { checkEvidenceGates } from "../dist/orchestration/evidence-gate.js";

describe("default freedom mode", () => {
  const originalStrict = process.env.OMK_STRICT_GUARDRAIL;

  before(() => {
    delete process.env.OMK_STRICT_GUARDRAIL;
  });

  after(() => {
    if (originalStrict === undefined) {
      delete process.env.OMK_STRICT_GUARDRAIL;
    } else {
      process.env.OMK_STRICT_GUARDRAIL = originalStrict;
    }
  });

  it("compaction quality gate accepts low quality by default", () => {
    const result = evaluateCompactionQualityGate({ applied: true, validated: true, qualityScore: 0.2, contractScore: 1, risk: "shell" });
    assert.equal(result.gateDecision, "accept-with-warning");
    assert.ok(result.warning?.includes("freedom"));
  });

  it("headroom loop risk does not block by default", () => {
    const history = [
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
    ];
    const result = evaluateHeadroomAwareLoopDecision({
      baseAction: "continue",
      baseReason: "pending",
      baseConfidence: 0.8,
      headroomHistory: history,
    });
    assert.equal(result.action, "continue");
    assert.ok(result.reason.includes("freedom"));
  });

  it("evidence gate allows arbitrary shell commands by default", async () => {
    const result = await checkEvidenceGates(
      [{ type: "command-pass", command: "python -c 'print(1)'" }],
      { cwd: process.cwd(), stdout: "", nodeId: "n" },
    );
    assert.equal(result.passed, true);
  });
});

describe("strict guardrail mode", () => {
  const originalStrict = process.env.OMK_STRICT_GUARDRAIL;

  before(() => {
    process.env.OMK_STRICT_GUARDRAIL = "1";
  });

  after(() => {
    if (originalStrict === undefined) {
      delete process.env.OMK_STRICT_GUARDRAIL;
    } else {
      process.env.OMK_STRICT_GUARDRAIL = originalStrict;
    }
  });

  it("rejects low quality compaction in strict mode", () => {
    const result = evaluateCompactionQualityGate({ applied: true, validated: true, qualityScore: 0.2, contractScore: 1, risk: "shell" });
    assert.equal(result.gateDecision, "reject");
  });

  it("blocks repeated validation drift in strict mode", () => {
    const history = [
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
    ];
    const result = evaluateHeadroomAwareLoopDecision({
      baseAction: "continue",
      baseReason: "pending",
      baseConfidence: 0.8,
      headroomHistory: history,
    });
    assert.equal(result.action, "block");
  });

  it("blocks arbitrary shell commands in strict mode", async () => {
    const result = await checkEvidenceGates(
      [{ type: "command-pass", command: "python -c 'print(1)'" }],
      { cwd: process.cwd(), stdout: "", nodeId: "n" },
    );
    assert.equal(result.passed, false);
    assert.ok(result.evidence.some((e) => e.message?.includes("Blocked unsafe")));
  });
});
