import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeExecutionPromptPolicy,
  parseExecutionPromptPolicy,
  resolveExecutionSelectionDecision,
  resolvePromptExecutionDecision,
} from "../dist/util/execution-selection.js";

const simpleIntent = {
  taskType: "general",
  complexity: "simple",
  estimatedWorkers: 1,
  requiredRoles: ["coder"],
  isReadOnly: false,
  needsResearch: false,
  needsSecurityReview: false,
  needsTesting: false,
  needsDesignReview: false,
  parallelizable: false,
  rationale: "simple",
};

const complexIntent = {
  ...simpleIntent,
  taskType: "implement",
  complexity: "complex",
  estimatedWorkers: 4,
  parallelizable: true,
  rationale: "complex parallel work",
};

test("execution policy parser accepts aliases and rejects invalid values", () => {
  assert.equal(normalizeExecutionPromptPolicy("serial"), "sequential");
  assert.equal(normalizeExecutionPromptPolicy("agents"), "parallel");
  assert.equal(parseExecutionPromptPolicy("auto"), "auto");
  assert.throws(() => parseExecutionPromptPolicy("everything"), /Invalid --execution/);
});

test("execution selection asks in TTY for non-trivial work and auto-parallelizes non-TTY complex work", () => {
  const ttyAsk = resolveExecutionSelectionDecision({
    cliValue: "ask",
    intent: complexIntent,
    isTTY: true,
  });
  assert.equal(ttyAsk.strategy, "prompt");
  assert.equal(ttyAsk.isNonTrivial, true);

  const nonTtyAsk = resolveExecutionSelectionDecision({
    configValue: "ask",
    intent: complexIntent,
    isTTY: false,
  });
  assert.equal(nonTtyAsk.strategy, "parallel");
  assert.equal(nonTtyAsk.source, "config");

  const autoSimple = resolveExecutionSelectionDecision({
    cliValue: "auto",
    intent: simpleIntent,
    isTTY: false,
  });
  assert.equal(autoSimple.strategy, "sequential");

  const autoComplex = resolveExecutionSelectionDecision({
    cliValue: "auto",
    intent: complexIntent,
    isTTY: false,
  });
  assert.equal(autoComplex.strategy, "parallel");
});

test("prompt execution decision records user-selected plan-only", () => {
  const base = resolveExecutionSelectionDecision({
    cliValue: "ask",
    intent: complexIntent,
    isTTY: true,
  });
  const selected = resolvePromptExecutionDecision(base, "plan-only");
  assert.equal(selected.strategy, "plan-only");
  assert.equal(selected.source, "prompt");
});

test("execution selection honors forced policies and CLI precedence", () => {
  const forcedParallel = resolveExecutionSelectionDecision({
    cliValue: "parallel",
    configValue: "sequential",
    intent: simpleIntent,
    isTTY: false,
  });
  assert.equal(forcedParallel.strategy, "parallel");
  assert.equal(forcedParallel.source, "cli");

  const forcedSequential = resolveExecutionSelectionDecision({
    cliValue: "sequential",
    configValue: "parallel",
    intent: complexIntent,
    isTTY: true,
  });
  assert.equal(forcedSequential.strategy, "sequential");
  assert.equal(forcedSequential.source, "cli");

  const defaultSimple = resolveExecutionSelectionDecision({
    intent: simpleIntent,
    isTTY: false,
  });
  assert.equal(defaultSimple.policy, "ask");
  assert.equal(defaultSimple.strategy, "sequential");
  assert.equal(defaultSimple.source, "default");
});

test("execution selection rejects invalid config strings", () => {
  assert.throws(
    () => resolveExecutionSelectionDecision({
      configValue: "sequental",
      intent: simpleIntent,
      isTTY: false,
    }),
    /Invalid execution config/
  );
});

test("estimated workers and parallelizable flag independently trigger non-trivial ask gate", () => {
  const workerIntent = { ...simpleIntent, estimatedWorkers: 2 };
  assert.equal(resolveExecutionSelectionDecision({ cliValue: "ask", intent: workerIntent, isTTY: true }).strategy, "prompt");

  const parallelizableIntent = { ...simpleIntent, parallelizable: true };
  assert.equal(resolveExecutionSelectionDecision({ cliValue: "ask", intent: parallelizableIntent, isTTY: true }).strategy, "prompt");
});
