import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateHeadroomAwareLoopDecision } from "../dist/runtime/headroom-aware-loop-decision.js";

describe("headroom-aware loop decision", () => {
  it("continues when headroom risk is none", () => {
    const result = evaluateHeadroomAwareLoopDecision({
      baseAction: "continue",
      baseReason: "pending nodes remain",
      baseConfidence: 0.8,
      headroomHistory: [],
    });
    assert.equal(result.action, "continue");
    assert.equal(result.risk.headroom.kind, "none");
  });

  it("blocks when repeated validation drift", () => {
    const history = [
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
    ];
    const result = evaluateHeadroomAwareLoopDecision({
      baseAction: "continue",
      baseReason: "pending nodes remain",
      baseConfidence: 0.8,
      headroomHistory: history,
    });
    assert.equal(result.action, "block");
    assert.equal(result.risk.headroom.kind, "compaction-contract-drift");
    assert.ok(result.confidence >= 0.9);
  });

  it("replans when repeated no-apply", () => {
    const history = [
      { attempted: true, applied: false, validated: false, compactedTextProduced: false, beforeTokens: 1000, afterTokens: 1000 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: false, beforeTokens: 1000, afterTokens: 1000 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: false, beforeTokens: 1000, afterTokens: 1000 },
    ];
    const result = evaluateHeadroomAwareLoopDecision({
      baseAction: "continue",
      baseReason: "pending nodes remain",
      baseConfidence: 0.5,
      headroomHistory: history,
    });
    assert.equal(result.action, "replan");
    assert.equal(result.risk.headroom.kind, "headroom-no-apply");
  });

  it("adjusts context when compaction yield is low", () => {
    const history = [
      { attempted: true, applied: true, validated: true, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
      { attempted: true, applied: true, validated: true, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 920 },
    ];
    const result = evaluateHeadroomAwareLoopDecision({
      baseAction: "continue",
      baseReason: "pending nodes remain",
      baseConfidence: 0.7,
      headroomHistory: history,
    });
    assert.equal(result.action, "continue");
    assert.equal(result.risk.headroom.kind, "low-compaction-yield");
    assert.equal(result.contextAdjustment.dropLowPriorityGraphMemory, true);
  });
});
