import test from "node:test";
import assert from "node:assert/strict";

// Import COMPILED dist modules (project is pre-built).
import {
  DEPTH_LIMITS,
  scoreInterviewQuestion,
  selectInterviewQuestions,
  computeAmbiguity,
  recommendDepth,
  computeCompleteness,
} from "../dist/goal/interview-scoring.js";
import { buildInterviewQuestionBank } from "../dist/goal/interview-question-bank.js";
import { createGoalSpec } from "../dist/goal/intake.js";

// A minimal valid InterviewQuestion (minus `score`) with the given signals.
function question(signals) {
  return {
    id: "q-test",
    kind: "objective",
    prompt: "p",
    required: true,
    targetField: "objective",
    informationGain: 0,
    riskReduction: 0,
    dagImpact: 0,
    evidenceImpact: 0,
    userCost: 0,
    ...signals,
  };
}

test("DEPTH_LIMITS matches light/standard/deep caps", () => {
  assert.deepEqual(DEPTH_LIMITS, { light: 5, standard: 10, deep: 18 });
});

test("scoreInterviewQuestion: full positive signals score 0.95, all-zero scores 0", () => {
  const full = scoreInterviewQuestion(
    question({ informationGain: 1, riskReduction: 1, dagImpact: 1, evidenceImpact: 1, userCost: 0 }),
  );
  assert.equal(full.score, 0.95);

  const zero = scoreInterviewQuestion(question({}));
  assert.equal(zero.score, 0);
});

test("computeAmbiguity: empty prompt is high, rich prompt is lower and < 0.5", () => {
  const empty = computeAmbiguity({ rawPrompt: "" });
  assert.ok(empty >= 0.8, `empty ambiguity should be >= 0.8, got ${empty}`);

  const rich = computeAmbiguity({
    rawPrompt:
      "Implement the objective in src/foo.ts. Success criteria: it must pass the test command. " +
      "Constraint: do not modify other files. Non-goal: out of scope is the database.",
  });
  assert.ok(rich < 0.5, `rich ambiguity should be < 0.5, got ${rich}`);
  assert.ok(rich < empty, `rich (${rich}) should be < empty (${empty})`);
});

test("recommendDepth: maps ambiguity to light/standard/deep", () => {
  assert.equal(recommendDepth(0.1), "light");
  assert.equal(recommendDepth(0.6), "standard");
  assert.equal(recommendDepth(0.9), "deep");
});

test("empty-goal ranking: required questions present and selection sorted by score desc", () => {
  const cands = buildInterviewQuestionBank({ rawPrompt: "add a feature" }).map(scoreInterviewQuestion);
  const sel = selectInterviewQuestions(undefined, cands, "deep");

  const requiredIds = ["q-objective", "q-success-criteria", "q-artifact", "q-verification"];
  for (const id of requiredIds) {
    assert.ok(sel.some((q) => q.id === id), `expected required question ${id} in selection`);
  }

  // Selection is sorted by score descending (non-increasing).
  for (let i = 1; i < sel.length; i += 1) {
    assert.ok(
      sel[i].score <= sel[i - 1].score,
      `selection not sorted desc at index ${i}: ${sel[i - 1].score} -> ${sel[i].score}`,
    );
  }
});

test("downrank: populated successCriteria reduces q-success-criteria informationGain", () => {
  const emptyBank = buildInterviewQuestionBank({ rawPrompt: "add a feature" });
  const goalWithCriteria = createGoalSpec("add a feature");
  assert.ok(goalWithCriteria.successCriteria.length > 0, "createGoalSpec should infer success criteria");

  const populatedBank = buildInterviewQuestionBank({ rawPrompt: "add a feature", goal: goalWithCriteria });

  const empty = emptyBank.find((c) => c.id === "q-success-criteria").informationGain;
  const populated = populatedBank.find((c) => c.id === "q-success-criteria").informationGain;
  assert.ok(populated < empty, `populated infoGain (${populated}) should be < empty (${empty})`);
});

test("computeCompleteness: empty goal flags critical missing axes", () => {
  const c = computeCompleteness(undefined, []);
  assert.ok(c.overall >= 0 && c.overall <= 1);
  assert.ok(c.criticalMissing.includes("objective"));
  assert.ok(c.criticalMissing.includes("successCriteria"));
});

test("selectInterviewQuestions pins required questions under a tiny max-questions limit", () => {
  const cands = buildInterviewQuestionBank({ rawPrompt: "add a feature" }).map(scoreInterviewQuestion);
  const requiredIds = new Set(cands.filter((q) => q.required).map((q) => q.id));
  const sel = selectInterviewQuestions(undefined, cands, "deep", 2);
  // Every required question must survive even though the limit is 2.
  for (const id of requiredIds) {
    assert.ok(sel.some((q) => q.id === id), `required ${id} dropped by max-questions`);
  }
  // Optional questions must not exceed the remaining slots (here: 0).
  const optionalSelected = sel.filter((q) => !q.required).length;
  assert.equal(optionalSelected, 0);
  // Output stays sorted by score (non-increasing).
  for (let i = 1; i < sel.length; i += 1) assert.ok(sel[i - 1].score >= sel[i].score);
});
