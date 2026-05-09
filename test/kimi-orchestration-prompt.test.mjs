import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoContinueRunId,
  buildOrchestratedPrompt,
  resolveAutoContinueMaxIterations,
} from "../dist/orchestration/orchestrate-prompt.js";
import { analyzeUserIntent, normalizeGoal } from "../dist/goal/intake.js";

function buildPrompt(rawPrompt, overrides = {}) {
  const goal = normalizeGoal({ rawPrompt, title: overrides.title ?? "Kimi orchestration upgrade" });
  const intent = analyzeUserIntent(rawPrompt);
  return buildOrchestratedPrompt({
    goal,
    memorySummary: overrides.memorySummary ?? "",
    sourceCommand: overrides.sourceCommand ?? "run",
    workers: overrides.workers ?? "3",
    intent,
    currentPrompt: overrides.currentPrompt ?? rawPrompt,
    isContinuation: overrides.isContinuation ?? false,
    autoContinue: overrides.autoContinue,
  });
}

test("resolveAutoContinueMaxIterations defaults, disables, and caps safely", () => {
  assert.equal(resolveAutoContinueMaxIterations(undefined), 3);
  assert.equal(resolveAutoContinueMaxIterations(""), 3);
  assert.equal(resolveAutoContinueMaxIterations("off"), 0);
  assert.equal(resolveAutoContinueMaxIterations("false"), 0);
  assert.equal(resolveAutoContinueMaxIterations("2"), 2);
  assert.equal(resolveAutoContinueMaxIterations("99"), 8);
  assert.equal(resolveAutoContinueMaxIterations("not-a-number"), 3);
});

test("buildAutoContinueRunId creates a safe unique continuation run id", () => {
  const id = buildAutoContinueRunId("run/with spaces/and?chars", 2, new Date("2026-05-09T00:00:00.000Z"));
  assert.match(id, /^[A-Za-z0-9._-]+$/);
  assert.match(id, /auto-2-2026-05-09T00-00-00-000Z$/);
  assert.ok(id.length <= 128);
});

test("buildOrchestratedPrompt adapts initial NLP input into a Kimi contract", () => {
  const prompt = buildPrompt("현재 Input에서 NLP를 분석해서 KIMI 오케스트레이션으로 계속 자동 실행되게 고도화해주세요");

  assert.match(prompt, /# Kimi Orchestration Prompt/);
  assert.match(prompt, /## Kimi Prompt Adapter/);
  assert.match(prompt, /Treat the original user input as intent\/NLP source/);
  assert.match(prompt, /## Source NLP Intake/);
  assert.match(prompt, /## Intent Analysis/);
  assert.match(prompt, /Execution mode: parallel DAG/);
  assert.match(prompt, /verbatim source: omitted/);
});

test("buildOrchestratedPrompt preserves continuation evidence for Kimi auto-loop runs", () => {
  const currentPrompt = [
    "# Auto-Generated Context Prompt",
    "## Failed Nodes to Retry",
    "- worker-2: route follow-up prompt (Previous prompt replayed the original request)",
    "## Missing Criteria",
    "- [ ] Kimi auto-continue loop reruns until evidence closes",
  ].join("\n");
  const prompt = buildPrompt("Upgrade Kimi orchestration continue loop", {
    sourceCommand: "goal-continue",
    currentPrompt,
    isContinuation: true,
    autoContinue: {
      iteration: 2,
      maxIterations: 3,
      action: "continue",
      previousRunId: "parallel-1",
    },
  });

  assert.match(prompt, /## Current Execution Context/);
  assert.match(prompt, /### Current follow-up context/);
  assert.match(prompt, /worker-2: route follow-up prompt/);
  assert.match(prompt, /## Auto-Continue Loop/);
  assert.match(prompt, /Iteration: 2\/3/);
  assert.match(prompt, /Previous run: parallel-1/);
  assert.match(prompt, /Ensemble action: continue/);
});
