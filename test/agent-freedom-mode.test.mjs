import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompactionQualityGate } from "../dist/runtime/structured-compaction.js";
import { evaluateHeadroomAwareLoopDecision } from "../dist/runtime/headroom-aware-loop-decision.js";
import { checkEvidenceGates } from "../dist/orchestration/evidence-gate.js";

describe("agent freedom mode", () => {
  const originalEnv = process.env.OMK_AGENT_FREEDOM;

  before(() => {
    process.env.OMK_AGENT_FREEDOM = "1";
  });

  after(() => {
    if (originalEnv === undefined) {
      delete process.env.OMK_AGENT_FREEDOM;
    } else {
      process.env.OMK_AGENT_FREEDOM = originalEnv;
    }
  });

  it("compaction quality gate accepts low quality in freedom mode", () => {
    const result = evaluateCompactionQualityGate({ applied: true, validated: true, qualityScore: 0.2, contractScore: 1, risk: "shell" });
    assert.equal(result.gateDecision, "accept-with-warning");
    assert.ok(result.warning?.includes("agent-freedom"));
  });

  it("headroom loop risk does not block in freedom mode", () => {
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
    assert.ok(result.reason.includes("agent-freedom"));
  });

  it("evidence gate allows arbitrary shell commands in freedom mode", async () => {
    const result = await checkEvidenceGates(
      [{ type: "command-pass", command: "python -c 'print(1)'" }],
      { cwd: process.cwd(), stdout: "", nodeId: "n" },
    );
    assert.equal(result.passed, true);
  });
});
