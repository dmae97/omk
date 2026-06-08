import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildInterviewSession, ingestAnswers } from "../dist/goal/interview-session.js";
import { applyInterviewDelta } from "../dist/goal/interview-assimilation.js";
import { createGoalSpec } from "../dist/goal/intake.js";

const CLI = join(process.cwd(), "dist", "cli.js");
const SCHEMA_PATH = join(process.cwd(), "schemas", "omk.interview.v1.schema.json");

/**
 * Minimal JSON-Schema (draft 2020-12 subset) validator. The repo ships ajv@6
 * which only understands draft-07, so we validate the structural subset our
 * schema actually uses: type, required, properties, items, const, enum,
 * minimum, maximum, minLength.
 */
function validate(schema, data, path = "$") {
  const errors = [];
  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)} got ${JSON.stringify(data)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push(`${path}: ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  switch (schema.type) {
    case "object": {
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        errors.push(`${path}: expected object`);
        break;
      }
      for (const req of schema.required ?? []) {
        if (!(req in data)) errors.push(`${path}.${req}: required field missing`);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        // undefined own-property === absent in JSON semantics; skip optionals.
        if (key in data && data[key] !== undefined) errors.push(...validate(sub, data[key], `${path}.${key}`));
      }
      break;
    }
    case "array": {
      if (!Array.isArray(data)) {
        errors.push(`${path}: expected array`);
        break;
      }
      if (schema.items) {
        data.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
      }
      break;
    }
    case "string": {
      if (typeof data !== "string") errors.push(`${path}: expected string`);
      else if (schema.minLength && data.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
      break;
    }
    case "number": {
      if (typeof data !== "number") errors.push(`${path}: expected number`);
      else {
        if (schema.minimum != null && data < schema.minimum) errors.push(`${path}: ${data} < ${schema.minimum}`);
        if (schema.maximum != null && data > schema.maximum) errors.push(`${path}: ${data} > ${schema.maximum}`);
      }
      break;
    }
    case "boolean": {
      if (typeof data !== "boolean") errors.push(`${path}: expected boolean`);
      break;
    }
    default:
      break;
  }
  return errors;
}

async function loadSchema() {
  return JSON.parse(await readFile(SCHEMA_PATH, "utf-8"));
}

function runCli(args, workspace) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OMK_PROJECT_ROOT: workspace,
      OMK_GOAL_ALPHA: "1",
      OMK_MCP_SCOPE: "none",
      OMK_SKILLS_SCOPE: "none",
      OMK_RESOURCE_PROFILE: "lite",
      OMK_RENDER_LOGO: "0",
    },
    encoding: "utf-8",
    timeout: 120_000,
  });
}

test("in-process interview session conforms to omk.interview.v1 schema", async () => {
  const schema = await loadSchema();
  const seed = { rawPrompt: "add deep interview feature" };
  let session = buildInterviewSession({ seed, mode: "create", depth: "deep" });
  session = ingestAnswers(session, seed, [
    { questionId: "q-success-criteria", answer: "goal interview returns omk.interview.v1 JSON", answeredAt: new Date().toISOString() },
    { questionId: "q-artifact", answer: "create src/commands/goal-interview.ts", answeredAt: new Date().toISOString() },
  ]);

  const errors = validate(schema, session);
  assert.deepEqual(errors, [], `schema violations:\n${errors.join("\n")}`);
  assert.equal(session.schemaVersion, "omk.interview.v1");
  assert.equal(session.specDelta.schemaVersion, "omk.interview-delta.v1");
  assert.ok(session.specDelta.changes.length > 0, "expected at least one spec-delta change");
});

test("interview redacts secrets from the prompt, answers, and refined GoalSpec", () => {
  const token = `sk-${"A".repeat(24)}`;
  const seed = { rawPrompt: `add feature using ${token}` };
  let session = buildInterviewSession({ seed, mode: "create", depth: "deep" });
  assert.ok(!session.rawPrompt.includes(token), "prompt secret should be redacted in session");

  session = ingestAnswers(session, seed, [
    { questionId: "q-success-criteria", answer: `criteria mentioning ${token}`, answeredAt: new Date().toISOString() },
  ]);
  const stored = session.answers.find((a) => a.questionId === "q-success-criteria");
  assert.ok(stored && !stored.answer.includes(token), "answer secret should be redacted");
  assert.ok(!JSON.stringify(session.specDelta).includes(token), "spec delta must not leak the secret");

  const goal = applyInterviewDelta(createGoalSpec("add feature"), session.specDelta).goal;
  assert.ok(!JSON.stringify(goal.successCriteria).includes(token), "refined GoalSpec must not leak the secret");
});

test("goal interview --json output passes the omk.interview.v1 schema", async () => {
  const schema = await loadSchema();
  const workspace = await mkdtemp(join(tmpdir(), "omk-interview-cli-"));
  await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "ws", scripts: {} }));
  await writeFile(
    join(workspace, "answers.json"),
    JSON.stringify({
      answers: [
        { questionId: "q-objective", answer: "Add a deterministic deep interview to the goal pipeline" },
        { questionId: "q-success-criteria", answer: "goal interview returns omk.interview.v1 JSON and creates a refined GoalSpec" },
        { questionId: "q-verification", answer: "npm run build:clean && node --test test/interview-scoring.test.mjs" },
        { questionId: "q-artifact", answer: "create src/commands/goal-interview.ts" },
        { questionId: "q-risk", answer: "production database migration included" },
      ],
    })
  );

  const res = runCli(
    ["goal", "interview", "add deep interview feature", "--depth", "deep", "--answers", "answers.json", "--write-spec", "--json"],
    workspace
  );
  assert.equal(res.status, 0, `CLI failed: ${res.stderr || res.stdout}`);

  const session = JSON.parse(res.stdout);
  const errors = validate(schema, session);
  assert.deepEqual(errors, [], `schema violations:\n${errors.join("\n")}`);
  assert.equal(session.schemaVersion, "omk.interview.v1");
  assert.ok(typeof session.goalId === "string" && session.goalId.length > 0, "expected a persisted goalId");
  assert.ok(["open", "complete", "blocked"].includes(session.status));

  // The refined GoalSpec must exist and reflect the interview answers.
  const goal = JSON.parse(await readFile(join(workspace, ".omk", "goals", session.goalId, "goal.json"), "utf-8"));
  assert.ok(goal.successCriteria.length >= 2, "criteria from interview should be present");
  assert.ok(
    goal.expectedArtifacts.some((a) => a.path === "src/commands/goal-interview.ts"),
    "artifact path from interview should be present"
  );
  assert.equal(goal.riskLevel, "high", "high-risk answer should escalate riskLevel");
});

test("goal plan after --write-spec refreshes action atoms and evidence gates", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "omk-interview-plan-"));
  await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "ws", scripts: {} }));
  await writeFile(
    join(workspace, "answers.json"),
    JSON.stringify({
      answers: [
        { questionId: "q-success-criteria", answer: "goal interview returns omk.interview.v1 JSON" },
        { questionId: "q-artifact", answer: "create src/commands/goal-interview.ts" },
      ],
    })
  );

  const interview = runCli(
    ["goal", "interview", "add deep interview feature", "--answers", "answers.json", "--write-spec", "--json"],
    workspace
  );
  assert.equal(interview.status, 0, `interview failed: ${interview.stderr || interview.stdout}`);
  const goalId = JSON.parse(interview.stdout).goalId;

  const plan = runCli(["goal", "plan", goalId, "--json"], workspace);
  assert.equal(plan.status, 0, `plan failed: ${plan.stderr || plan.stdout}`);
  const planned = JSON.parse(plan.stdout);

  assert.ok(Array.isArray(planned.nodes) && planned.nodes.length > 0, "plan should produce DAG nodes");
  const gates = new Set(planned.nodes.flatMap((n) => n.evidenceGates ?? []));
  assert.ok(gates.has("review-pass"), "verify node should expose a review-pass evidence gate");
  // The interview-derived artifact should drive a file-exists evidence gate.
  const hasArtifactNode = planned.nodes.some((n) => n.id.startsWith("artifact-"));
  assert.ok(hasArtifactNode, "interview artifact should compile into an artifact DAG node");
  assert.ok(gates.has("file-exists"), "artifact answer should refresh a file-exists evidence gate");
});
