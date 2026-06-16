import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateHeadroomAwareLoopController } from "../dist/orchestration/loop-controller-headroom.js";

describe("loop controller headroom integration", () => {
  function baseInput(overrides = {}) {
    return {
      runId: "run-1",
      inputId: "input-1",
      runState: {
        runId: "run-1",
        iterationCount: 1,
        maxIterations: 3,
        nodes: [],
      },
      headroomHistory: [],
      ...overrides,
    };
  }

  it("returns continue when no risk but pending evidence remains", () => {
    const result = evaluateHeadroomAwareLoopController(baseInput());
    assert.equal(result.action, "continue");
    assert.equal(result.risk.headroom.kind, "none");
  });

  it("blocks when repeated validation drift", () => {
    const history = [
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: true, beforeTokens: 1000, afterTokens: 900 },
    ];
    const result = evaluateHeadroomAwareLoopController(baseInput({ headroomHistory: history }));
    assert.equal(result.action, "block");
    assert.equal(result.risk.headroom.kind, "compaction-contract-drift");
  });

  it("replans when repeated no-apply", () => {
    const history = [
      { attempted: true, applied: false, validated: false, compactedTextProduced: false, beforeTokens: 1000, afterTokens: 1000 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: false, beforeTokens: 1000, afterTokens: 1000 },
      { attempted: true, applied: false, validated: false, compactedTextProduced: false, beforeTokens: 1000, afterTokens: 1000 },
    ];
    const result = evaluateHeadroomAwareLoopController(baseInput({ headroomHistory: history }));
    assert.equal(result.action, "replan");
    assert.equal(result.risk.headroom.kind, "headroom-no-apply");
  });
});
