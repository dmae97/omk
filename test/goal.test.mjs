import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGoalSpec, normalizeGoal, updateGoalStatus } from "../dist/goal/intake.js";
import { createGoalPersister } from "../dist/goal/persistence.js";
import { compileGoalToDagNodes, attachGoalToRunState } from "../dist/goal/compiler.js";
import { evaluateGoalProgressEnsemble, generateNextPrompt } from "../dist/goal/control-loop.js";
import { scoreGoal } from "../dist/goal/scoring.js";
import { checkGoalEvidence } from "../dist/goal/evidence.js";
import { evaluateMissingCriteria, suggestNextAction } from "../dist/goal/eval-criteria.js";
import { createRoutedRunState } from "../dist/orchestration/run-state.js";
import { createDag } from "../dist/orchestration/dag.js";
import { goalCloseCommand, goalCreateCommand, goalPlanCommand } from "../dist/commands/goal.js";
import { CliError } from "../dist/util/cli-contract.js";

async function tempGoalDir() {
  return mkdtemp(join(tmpdir(), "omk-goal-"));
}

test("normalizeGoal creates a GoalSpec with inferred success criteria", () => {
  const spec = normalizeGoal({ rawPrompt: "Add a user authentication feature to the API" });

  assert.equal(spec.schemaVersion, 1);
  assert.ok(spec.goalId.length > 0);
  assert.ok(spec.title.length > 0);
  assert.ok(spec.objective.length > 0);
  assert.ok(spec.successCriteria.length > 0);
  assert.ok(spec.successCriteria.some((c) => c.inferred));
  assert.ok(["low", "medium", "high"].includes(spec.riskLevel));
  assert.equal(spec.status, "draft");
  assert.equal(spec.planRevision, 0);
  assert.deepEqual(spec.runIds, []);
});

test("normalizeGoal accepts explicit title and objective", () => {
  const spec = normalizeGoal({
    rawPrompt: "Build a thing",
    title: "My Custom Title",
    objective: "Custom objective text",
    riskLevel: "low",
  });

  assert.equal(spec.title, "My Custom Title");
  assert.equal(spec.objective, "Custom objective text");
  assert.equal(spec.riskLevel, "low");
});

test("createGoalSpec parses structured English and Korean goal sections", () => {
  const spec = createGoalSpec(`
Implement goal automation

Success Criteria:
1. Planner JSON is parseable
2. Verification suggests the next action

제약:
- 절대 시크릿을 출력하지 않는다

비목표:
- 배포는 하지 않는다

리스크:
- stale evidence can mislead continuation

산출물:
- Plan file: \`docs/goal-plan.md\`
`);

  assert.deepEqual(spec.successCriteria.map((c) => c.description), [
    "Planner JSON is parseable",
    "Verification suggests the next action",
  ]);
  assert.equal(spec.constraints[0].description, "절대 시크릿을 출력하지 않는다");
  assert.equal(spec.nonGoals[0], "배포는 하지 않는다");
  assert.equal(spec.risks[0].description, "stale evidence can mislead continuation");
  assert.deepEqual(spec.expectedArtifacts[0], { name: "Plan file", path: "docs/goal-plan.md" });
});

test("createGoalSpec falls back to inferred criteria when no criteria section exists", () => {
  const spec = createGoalSpec("Add a strict goal planner JSON contract");

  assert.ok(spec.successCriteria.length > 0);
  assert.ok(spec.successCriteria.some((criterion) => criterion.inferred));
});

test("updateGoalStatus updates status and timestamps", () => {
  const spec = normalizeGoal({ rawPrompt: "Test" });
  const updated = updateGoalStatus(spec, "running", { runId: "run-1" });

  assert.equal(updated.status, "running");
  assert.ok(updated.updatedAt >= spec.updatedAt);
  assert.deepEqual(updated.runIds, ["run-1"]);
});

test("GoalPersister saves and loads GoalSpec atomically", async () => {
  const base = await tempGoalDir();
  const persister = createGoalPersister(base);
  const spec = normalizeGoal({ rawPrompt: "Persist me" });

  await persister.save(spec);
  const loaded = await persister.load(spec.goalId);

  assert.ok(loaded);
  assert.equal(loaded.goalId, spec.goalId);
  assert.equal(loaded.title, spec.title);
  assert.equal(loaded.status, spec.status);

  // Verify no temp files left behind
  const entries = await (await import("node:fs/promises")).readdir(join(base, spec.goalId));
  assert.ok(entries.includes("goal.json"));
  assert.ok(!entries.some((e) => e.endsWith(".tmp")));

  await rm(base, { recursive: true, force: true });
});

test("GoalPersister list returns goals sorted by updatedAt desc", async () => {
  const base = await tempGoalDir();
  const persister = createGoalPersister(base);

  const a = normalizeGoal({ rawPrompt: "A" });
  const b = normalizeGoal({ rawPrompt: "B" });

  await persister.save(a);
  await new Promise((r) => setTimeout(r, 50));
  await persister.save(b);

  const ids = await persister.list();
  assert.equal(ids[0], b.goalId);
  assert.equal(ids[1], a.goalId);

  await rm(base, { recursive: true, force: true });
});

test("GoalPersister tolerates corrupt JSON gracefully", async () => {
  const base = await tempGoalDir();
  const goalId = "corrupt-goal";
  await mkdir(join(base, goalId), { recursive: true });
  await writeFile(join(base, goalId, "goal.json"), "not json");

  const persister = createGoalPersister(base);
  const loaded = await persister.load(goalId);

  assert.equal(loaded, null);
  await rm(base, { recursive: true, force: true });
});

test("GoalPersister saveEvidence and loadEvidence", async () => {
  const base = await tempGoalDir();
  const persister = createGoalPersister(base);
  const spec = normalizeGoal({ rawPrompt: "Evidence test" });

  await persister.save(spec);
  const evidence = [
    { criterionId: "c1", passed: true, checkedAt: new Date().toISOString() },
    { criterionId: "c2", passed: false, checkedAt: new Date().toISOString() },
  ];
  await persister.saveEvidence(spec.goalId, evidence);
  const loaded = await persister.loadEvidence(spec.goalId);

  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].criterionId, "c1");
  assert.equal(loaded[1].passed, false);

  await rm(base, { recursive: true, force: true });
});

test("compileGoalToDagNodes produces valid DAG with bootstrap, coordinator, and verify", () => {
  const spec = normalizeGoal({ rawPrompt: "Build auth" });
  spec.expectedArtifacts = [
    { name: "auth.ts", path: "src/auth.ts", gate: "file-exists" },
  ];

  const nodes = compileGoalToDagNodes(spec);
  const dag = createDag({ nodes });

  assert.ok(dag.nodes.some((n) => n.id === "bootstrap"));
  assert.ok(dag.nodes.some((n) => n.id === "goal-coordinator"));
  assert.ok(dag.nodes.some((n) => n.id === "artifact-1"));
  assert.ok(dag.nodes.some((n) => n.id === "goal-verify"));
  const coordinator = dag.nodes.find((n) => n.id === "goal-coordinator");
  assert.equal(coordinator?.role, "planner");
  assert.equal(coordinator?.outputs?.[0]?.ref, "plan.md");

  const verify = dag.nodes.find((n) => n.id === "goal-verify");
  assert.ok(verify?.dependsOn.includes("artifact-1"));
});

test("goal plan writes actionable planner DAG instead of placeholder", async () => {
  const root = await tempGoalDir();
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousAlpha = process.env.OMK_GOAL_ALPHA;
  process.env.OMK_PROJECT_ROOT = root;
  process.env.OMK_GOAL_ALPHA = "1";
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(" "));

  try {
    await goalCreateCommand("Build a release checklist", {
      title: "Release checklist",
      objective: "Create an actionable release checklist",
      risk: "low",
    });
    const goalsDir = join(root, ".omk", "goals");
    const goalIds = await (await import("node:fs/promises")).readdir(goalsDir);
    await goalPlanCommand(goalIds[0]);
    const plan = await readFile(join(goalsDir, goalIds[0], "plan.md"), "utf-8");

    assert.match(plan, /## Planner/);
    assert.match(plan, /goal-coordinator.*planner/);
    assert.match(plan, /## Execution DAG/);
    assert.match(plan, /## Acceptance Criteria/);
    assert.doesNotMatch(plan, /to be planned/);
    assert.match(output.join("\n"), /Planner/);
  } finally {
    console.log = originalLog;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    if (previousAlpha === undefined) delete process.env.OMK_GOAL_ALPHA;
    else process.env.OMK_GOAL_ALPHA = previousAlpha;
    await rm(root, { recursive: true, force: true });
  }
});

test("goal plan json emits a machine-readable planner contract", async () => {
  const root = await tempGoalDir();
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousAlpha = process.env.OMK_GOAL_ALPHA;
  process.env.OMK_PROJECT_ROOT = root;
  process.env.OMK_GOAL_ALPHA = "1";
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(" "));

  try {
    await goalCreateCommand("Build a JSON goal plan", {
      title: "JSON plan",
      objective: "Create a machine-readable plan output",
      risk: "low",
    });
    const goalsDir = join(root, ".omk", "goals");
    const goalIds = await (await import("node:fs/promises")).readdir(goalsDir);
    output.length = 0;
    await goalPlanCommand(goalIds[0], { json: true });
    const parsed = JSON.parse(output[0]);

    assert.equal(parsed.goalId, goalIds[0]);
    assert.equal(parsed.status, "planned");
    assert.equal(parsed.planner, "goal-coordinator");
    assert.ok(parsed.nodes.some((node) => node.id === "goal-verify"));
  } finally {
    console.log = originalLog;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    if (previousAlpha === undefined) delete process.env.OMK_GOAL_ALPHA;
    else process.env.OMK_GOAL_ALPHA = previousAlpha;
    await rm(root, { recursive: true, force: true });
  }
});

test("compileGoalToDagNodes verify depends on coordinator when no artifacts", () => {
  const spec = normalizeGoal({ rawPrompt: "Simple task" });
  const nodes = compileGoalToDagNodes(spec);
  const dag = createDag({ nodes });

  const verify = dag.nodes.find((n) => n.id === "goal-verify");
  assert.ok(verify?.dependsOn.includes("goal-coordinator"));
});

test("attachGoalToRunState injects goalId and snapshot", () => {
  const runState = createRoutedRunState({
    runId: "test-run",
    startedAt: new Date().toISOString(),
    nodes: [{ id: "a", name: "A", role: "coder", dependsOn: [], maxRetries: 1 }],
  });

  const spec = normalizeGoal({ rawPrompt: "Attach me" });
  const attached = attachGoalToRunState(runState, spec);

  assert.equal(attached.schemaVersion, 1);
  assert.equal(attached.goalId, spec.goalId);
  assert.equal(attached.goalSnapshot?.title, spec.title);
  assert.equal(attached.goalSnapshot?.successCriteria.length, spec.successCriteria.length);
});

test("scoreGoal computes pass when all required criteria pass", () => {
  const spec = normalizeGoal({ rawPrompt: "Score me" });
  spec.successCriteria = [
    { id: "c1", description: "Must pass", requirement: "required", weight: 1, inferred: false },
    { id: "c2", description: "Nice to have", requirement: "optional", weight: 0.5, inferred: false },
  ];

  const evidence = [
    { criterionId: "c1", passed: true, checkedAt: new Date().toISOString() },
    { criterionId: "c2", passed: true, checkedAt: new Date().toISOString() },
  ];

  const score = scoreGoal(spec, evidence);
  assert.equal(score.overall, "pass");
  assert.equal(score.requiredPassed, 1);
  assert.equal(score.requiredTotal, 1);
  assert.ok(score.optionalScore > 0);
});

test("scoreGoal computes fail when a required criterion fails", () => {
  const spec = normalizeGoal({ rawPrompt: "Score me" });
  spec.successCriteria = [
    { id: "c1", description: "Must pass", requirement: "required", weight: 1, inferred: false },
  ];

  const evidence = [
    { criterionId: "c1", passed: false, checkedAt: new Date().toISOString() },
  ];

  const score = scoreGoal(spec, evidence);
  assert.equal(score.overall, "fail");
  assert.equal(score.requiredPassed, 0);
});

test("scoreGoal computes incomplete when no evidence for required", () => {
  const spec = normalizeGoal({ rawPrompt: "Score me" });
  spec.successCriteria = [
    { id: "c1", description: "Must pass", requirement: "required", weight: 1, inferred: false },
  ];

  const evidence = [];
  const score = scoreGoal(spec, evidence);
  assert.equal(score.overall, "incomplete");
});

test("scoreGoal uses latest evidence for duplicate criterion IDs", () => {
  const spec = normalizeGoal({ rawPrompt: "Score me" });
  spec.successCriteria = [
    { id: "c1", description: "Must pass", requirement: "required", weight: 1, inferred: false },
    { id: "c2", description: "Nice to have", requirement: "optional", weight: 1, inferred: false },
  ];

  const score = scoreGoal(spec, [
    { criterionId: "c1", passed: true, checkedAt: "2026-05-08T00:00:00.000Z" },
    { criterionId: "c2", passed: false, checkedAt: "2026-05-08T00:00:00.000Z" },
    { criterionId: "c1", passed: false, checkedAt: "2026-05-08T00:01:00.000Z" },
    { criterionId: "c2", passed: true, checkedAt: "2026-05-08T00:01:00.000Z" },
  ]);

  assert.equal(score.overall, "fail");
  assert.equal(score.requiredPassed, 0);
  assert.equal(score.optionalScore, 1);
});

test("goal continuation helpers use latest evidence for missing criteria and artifacts", () => {
  const spec = normalizeGoal({ rawPrompt: "Score me" });
  spec.successCriteria = [
    { id: "c1", description: "Must pass", requirement: "required", weight: 1, inferred: false },
  ];
  spec.expectedArtifacts = [{ name: "report", path: "report.md", gate: "file-exists" }];

  const evidence = [
    { criterionId: "c1", passed: false, checkedAt: "2026-05-08T00:00:00.000Z" },
    { criterionId: "artifact:report", passed: false, checkedAt: "2026-05-08T00:00:00.000Z" },
    { criterionId: "c1", passed: true, checkedAt: "2026-05-08T00:01:00.000Z" },
    { criterionId: "artifact:report", passed: true, checkedAt: "2026-05-08T00:01:00.000Z" },
  ];

  assert.deepEqual(evaluateMissingCriteria(spec, evidence), []);
  assert.equal(suggestNextAction(spec, evidence).type, "close");
});

test("goal artifact evidence blocks traversal outside the project root", async () => {
  const root = await tempGoalDir();
  const spec = normalizeGoal({ rawPrompt: "Artifact containment" });
  spec.expectedArtifacts = [
    { name: "outside", path: "../outside.txt", gate: "file-exists" },
  ];

  try {
    const evidence = await checkGoalEvidence(spec, {
      root,
      runState: { schemaVersion: 1, runId: "none", nodes: [], startedAt: new Date().toISOString() },
    });
    const artifactEvidence = evidence.find((entry) => entry.criterionId === "artifact:outside");

    assert.equal(artifactEvidence?.passed, false);
    assert.match(artifactEvidence?.message ?? "", /blocked|inside the project root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("goal close rejects without process.exit when evidence is missing", async () => {
  const root = await tempGoalDir();
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousAlpha = process.env.OMK_GOAL_ALPHA;
  const originalError = console.error;
  const originalExit = process.exit;
  process.env.OMK_PROJECT_ROOT = root;
  process.env.OMK_GOAL_ALPHA = "1";
  console.error = () => {};
  process.exit = (code) => {
    throw new Error(`process.exit called with ${code}`);
  };

  try {
    const persister = createGoalPersister(join(root, ".omk", "goals"));
    const spec = normalizeGoal({ rawPrompt: "Close me without evidence" });
    await persister.save(spec);

    await assert.rejects(
      () => goalCloseCommand(spec.goalId, {}),
      (err) => err instanceof CliError && err.name === "VerificationError"
    );
  } finally {
    console.error = originalError;
    process.exit = originalExit;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    if (previousAlpha === undefined) delete process.env.OMK_GOAL_ALPHA;
    else process.env.OMK_GOAL_ALPHA = previousAlpha;
    await rm(root, { recursive: true, force: true });
  }
});

test("old RunState without schemaVersion or goalId is tolerated", () => {
  const oldState = {
    runId: "legacy-run",
    nodes: [],
    startedAt: new Date().toISOString(),
  };

  // createRoutedRunState accepts objects without schemaVersion
  assert.ok(oldState.runId);
  assert.equal(oldState.schemaVersion, undefined);
  assert.equal(oldState.goalId, undefined);
});

test("generateNextPrompt synthesizes current context instead of repeating the original goal", async () => {
  const spec = normalizeGoal({
    rawPrompt: "Improve DeepSeek and goal pipelines",
    title: "Pipeline upgrade",
    objective: "Improve DeepSeek and goal pipelines so follow-up runs use context-aware prompts",
  });
  spec.successCriteria = [
    { id: "c1", description: "DeepSeek receives current goal context", requirement: "required", weight: 1, inferred: false },
    { id: "c2", description: "Goal continuation preserves completed work", requirement: "required", weight: 1, inferred: false },
  ];

  const runState = createRoutedRunState({
    runId: "context-run",
    startedAt: new Date().toISOString(),
    nodes: [
      { id: "deepseek-context", name: "Wire DeepSeek context", role: "coder", dependsOn: [], maxRetries: 1 },
      { id: "goal-followup", name: "Repair goal follow-up prompt", role: "coder", dependsOn: ["deepseek-context"], maxRetries: 1 },
    ],
    workerCount: 1,
  });
  runState.nodes[0].status = "done";
  runState.nodes[0].evidence = [{ gate: "unit", passed: true, message: "DeepSeek context prefix covered" }];
  runState.nodes[1].status = "failed";
  runState.nodes[1].blockedReason = "Previous prompt kept repeating the original objective";
  runState.nodes[1].attempts = [{
    attempt: 1,
    startedAt: new Date().toISOString(),
    status: "failed",
    provider: "kimi",
    requestedProvider: "deepseek",
    fallbackFrom: "deepseek",
    fallbackReason: "advisory only",
  }];

  const result = await generateNextPrompt(
    spec,
    [{ criterionId: "c1", passed: true, checkedAt: new Date().toISOString(), message: "context wired" }],
    runState,
    "### Memory\n- Previous run already wired DeepSeek context."
  );

  assert.match(result.prompt, /Kimi Context Synthesis/);
  assert.match(result.prompt, /Do not repeat the original goal verbatim/);
  assert.match(result.prompt, /Goal Reference \(non-verbatim\)/);
  assert.match(result.prompt, /Original objective digest/);
  assert.doesNotMatch(
    result.prompt,
    /Improve DeepSeek and goal pipelines so follow-up runs use context-aware prompts/
  );
  assert.match(result.prompt, /goal-followup/);
  assert.match(result.prompt, /Goal continuation preserves completed work/);
  assert.match(result.prompt, /Previous run already wired DeepSeek context/);
  assert.match(result.prompt, /fallbackFrom=deepseek/);
});

test("goal progress ensemble calls DeepSeek advisory when a key is configured", async () => {
  const homeRoot = await tempGoalDir();
  const spec = normalizeGoal({
    rawPrompt: "Verify DeepSeek goal ensemble participation",
    title: "DeepSeek ensemble probe",
    objective: "Verify that a configured DeepSeek API key participates in the goal progress ensemble",
  });
  spec.successCriteria = [
    { id: "c1", description: "DeepSeek advisory vote is present", requirement: "required", weight: 1, inferred: false },
  ];

  const runState = createRoutedRunState({
    runId: "deepseek-goal-ensemble",
    startedAt: new Date().toISOString(),
    nodes: [
      { id: "goal-review", name: "Review goal progress", role: "reviewer", dependsOn: [], maxRetries: 1 },
    ],
    workerCount: 1,
  });
  runState.nodes[0].status = "failed";
  runState.nodes[0].blockedReason = "Needs another review pass";

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const headers = init.headers ?? {};
    calls.push({
      href,
      hasAuthorization: Boolean(headers.Authorization ?? headers.authorization),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (href.endsWith("/user/balance")) {
      return new Response(JSON.stringify({ is_available: true, balance_infos: [] }), { status: 200 });
    }
    if (href.endsWith("/chat/completions")) {
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "replan",
                confidence: 0.84,
                reason: "Failed reviewer node should be replanned with a narrower verification pass",
              }),
            },
          },
        ],
      }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const result = await evaluateGoalProgressEnsemble(spec, runState, undefined, {
      deepseek: {
        env: {
          DEEPSEEK_API_KEY: "fake-deepseek-key-for-test",
          HOME: homeRoot,
          OMK_PROVIDER_CONFIG_PATH: join(homeRoot, "providers.json"),
          OMK_SECRETS_ENV_PATH: join(homeRoot, "secrets.env"),
          OPENCODE_SECRETS_ENV_PATH: join(homeRoot, "opencode-secrets.env"),
        },
        fetchImpl,
        timeoutMs: 5_000,
      },
    });

    assert.deepEqual(calls.map((call) => call.href.replace(/^https:\/\/api\.deepseek\.com/, "")), [
      "/user/balance",
      "/chat/completions",
    ]);
    assert.equal(calls.every((call) => call.hasAuthorization), true);
    assert.equal(calls[1].body.model, "deepseek-v4-pro");
    const deepseekVote = result.ensemble.candidateVotes.find((vote) => vote.id === "deepseek-v4-pro");
    assert.ok(deepseekVote);
    assert.equal(deepseekVote.action, "replan");
    assert.match(deepseekVote.reason, /DeepSeek advisory/);
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});
