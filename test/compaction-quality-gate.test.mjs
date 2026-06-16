import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompactionQualityGate, resolveCompactionQualityThreshold } from "../dist/runtime/structured-compaction.js";

describe("compaction quality gate", () => {
  it("returns not-attempted when compaction was not applied", () => {
    const result = evaluateCompactionQualityGate({ applied: false, validated: false, qualityScore: 0, contractScore: 0 });
    assert.equal(result.gateDecision, "not-attempted");
  });

  it("accepts high quality compaction", () => {
    const result = evaluateCompactionQualityGate({ applied: true, validated: true, qualityScore: 0.9, contractScore: 1 });
    assert.equal(result.gateDecision, "accept");
  });

  it("rejects low quality compaction for shell risk", () => {
    const result = evaluateCompactionQualityGate({ applied: true, validated: true, qualityScore: 0.5, contractScore: 1, risk: "shell" });
    assert.equal(result.gateDecision, "reject");
    assert.equal(result.threshold, 0.85);
  });

  it("accepts with warning when quality is borderline", () => {
    const result = evaluateCompactionQualityGate({ applied: true, validated: true, qualityScore: 0.66, contractScore: 1, risk: "write" });
    assert.equal(result.gateDecision, "accept-with-warning");
  });

  it("uses capability-based threshold", () => {
    assert.equal(resolveCompactionQualityThreshold({ capabilities: { merge: true } }), 0.85);
    assert.equal(resolveCompactionQualityThreshold({ capabilities: { write: true } }), 0.75);
    assert.equal(resolveCompactionQualityThreshold({}), 0.60);
  });
});
