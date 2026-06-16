import test from "node:test";
import assert from "node:assert/strict";

import { computeHeadroomLoopRiskSignal } from "../dist/runtime/headroom-loop-risk.js";

test("headroom loop risk escalates repeated validation drift", () => {
  const signal = computeHeadroomLoopRiskSignal([
    { attempted: true, compactedTextProduced: true, validated: false, applied: false, reason: "typed routing provider" },
    { attempted: true, compactedTextProduced: true, validated: false, applied: false, reason: "typed capabilities" },
  ]);
  assert.equal(signal.kind, "compaction-contract-drift");
  assert.equal(signal.recommendedAction, "block");
  assert.ok(signal.severity >= 0.9);
});

test("headroom loop risk escalates repeated no-apply decisions", () => {
  const signal = computeHeadroomLoopRiskSignal([
    { attempted: true, compactedTextProduced: false, applied: false },
    { attempted: true, compactedTextProduced: false, applied: false },
    { attempted: true, compactedTextProduced: false, applied: false },
  ]);
  assert.equal(signal.kind, "headroom-no-apply");
  assert.equal(signal.recommendedAction, "replan");
});

test("headroom loop risk flags low compaction yield", () => {
  const signal = computeHeadroomLoopRiskSignal([
    { attempted: true, compactedTextProduced: true, validated: true, applied: true, beforeTokens: 1000, afterTokens: 900 },
    { attempted: true, compactedTextProduced: true, validated: true, applied: true, beforeTokens: 1000, afterTokens: 910 },
  ]);
  assert.equal(signal.kind, "low-compaction-yield");
  assert.equal(signal.recommendedAction, "summarize-or-drop-low-priority-context");
});

test("headroom loop risk stays low with insufficient or healthy history", () => {
  assert.equal(computeHeadroomLoopRiskSignal([{ attempted: true, applied: false }]).kind, "none");
  assert.equal(computeHeadroomLoopRiskSignal([
    { attempted: true, compactedTextProduced: true, validated: true, applied: true, beforeTokens: 1000, afterTokens: 200 },
    { attempted: false, applied: false },
  ]).kind, "none");
});
