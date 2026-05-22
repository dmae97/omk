import test from "node:test";
import assert from "node:assert/strict";

import { analyzeUserIntent } from "../dist/goal/intake.js";
import { resolveExecutionSelectionDecision } from "../dist/util/execution-selection.js";

test("complex orchestrated intent resolves to execution prompt before running in TTY", () => {
  const intent = analyzeUserIntent([
    "Implement a multi-file orchestration feature touching CLI, config, chat agent contract, tests, and docs.",
    "It should run reviewers and QA after coding and preserve existing behavior.",
  ].join(" "));

  const decision = resolveExecutionSelectionDecision({
    cliValue: "ask",
    intent,
    isTTY: true,
  });

  assert.notEqual(intent.complexity, "simple");
  assert.equal(decision.strategy, "prompt");
  assert.equal(decision.reason, "TTY non-trivial intent must ask before execution");
});
