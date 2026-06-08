import test from "node:test";
import assert from "node:assert/strict";

// Import COMPILED dist modules (project is pre-built).
import { assimilateAnswers, applyInterviewDelta } from "../dist/goal/interview-assimilation.js";
import { createGoalSpec } from "../dist/goal/intake.js";

// Minimal valid InterviewQuestion factory (includes `score`).
function question(overrides) {
  return {
    id: "q",
    kind: "objective",
    prompt: "p",
    required: false,
    targetField: "objective",
    informationGain: 0,
    riskReduction: 0,
    dagImpact: 0,
    evidenceImpact: 0,
    userCost: 0,
    score: 0,
    ...overrides,
  };
}

test("high-risk answer escalates goal.riskLevel to high", () => {
  const questions = [question({ id: "q-risk", kind: "risk", targetField: "risks" })];
  const answers = [
    { questionId: "q-risk", answer: "production database migration 포함", answeredAt: new Date().toISOString() },
  ];
  const { specDelta } = assimilateAnswers({ seed: { rawPrompt: "x" }, questions, answers });
  const base = createGoalSpec("do something");
  const r = applyInterviewDelta(base, specDelta);
  assert.equal(r.goal.riskLevel, "high");
});

test("artifact answers map to path/gate (file-exists vs command-pass)", () => {
  const questions = [question({ id: "q-art", kind: "artifact", targetField: "expectedArtifacts" })];
  const answers = [
    { questionId: "q-art", answer: "create src/commands/goal-interview.ts", answeredAt: "t" },
    { questionId: "q-art", answer: "verify with npm test", answeredAt: "t" },
  ];
  const { specDelta } = assimilateAnswers({ seed: { rawPrompt: "x" }, questions, answers });
  const base = createGoalSpec("do something");
  const r = applyInterviewDelta(base, specDelta);

  const fileArtifact = r.goal.expectedArtifacts.find((a) => a.path === "src/commands/goal-interview.ts");
  assert.ok(fileArtifact, "expected an artifact with the source path");
  assert.equal(fileArtifact.gate, "file-exists");

  const commandArtifact = r.goal.expectedArtifacts.find((a) => a.gate === "command-pass");
  assert.ok(commandArtifact, "expected an artifact with a command-pass gate");
});

test("conflicting objective answer is recorded and not overwritten", () => {
  const base = createGoalSpec("Build a brand new login page");
  assert.ok(base.objective.trim().length > 0, "base must have a non-empty objective");

  const questions = [question({ id: "q-objective", kind: "objective", targetField: "objective", required: true })];
  const answers = [
    {
      questionId: "q-objective",
      answer: "Completely different unrelated objective about database backups",
      answeredAt: new Date().toISOString(),
    },
  ];
  const { specDelta, contradictions } = assimilateAnswers({
    seed: { rawPrompt: base.rawPrompt },
    questions,
    answers,
    goal: base,
  });
  assert.ok(contradictions.length > 0, "assimilation should report a contradiction");

  const r = applyInterviewDelta(base, specDelta);
  assert.equal(r.goal.objective, base.objective, "explicit objective must not be overwritten");
  assert.ok(
    r.contradictions.length > 0 || r.skippedChanges.length > 0,
    "apply must record the skipped/contradicting change",
  );
});

test("success criteria from answers receive unique ids", () => {
  const questions = [question({ id: "q-sc", kind: "success-criteria", targetField: "successCriteria", required: true })];
  const answers = [
    { questionId: "q-sc", answer: "criterion alpha must hold", answeredAt: "t" },
    { questionId: "q-sc", answer: "criterion beta must hold", answeredAt: "t" },
  ];
  const { specDelta } = assimilateAnswers({ seed: { rawPrompt: "x" }, questions, answers });
  const base = createGoalSpec("do something");
  const r = applyInterviewDelta(base, specDelta);

  const ids = r.goal.successCriteria.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `criterion ids must be unique: ${ids.join(",")}`);
});

test("applyInterviewDelta does not mutate the input goal", () => {
  const questions = [question({ id: "q-sc", kind: "success-criteria", targetField: "successCriteria", required: true })];
  const answers = [{ questionId: "q-sc", answer: "another criterion to append", answeredAt: "t" }];
  const { specDelta } = assimilateAnswers({ seed: { rawPrompt: "x" }, questions, answers });

  const base = createGoalSpec("do something");
  const beforeLen = base.successCriteria.length;
  applyInterviewDelta(base, specDelta);
  assert.equal(base.successCriteria.length, beforeLen, "input goal successCriteria must be unchanged");
});
