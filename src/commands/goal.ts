import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getProjectRoot, getRunsDir, getRunPath } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";
import { NotFoundError, VerificationError, emitError } from "../util/cli-contract.js";

import { createGoalPersister } from "../goal/persistence.js";
import { normalizeGoal, updateGoalStatus } from "../goal/intake.js";
import { checkGoalEvidence } from "../goal/evidence.js";
import { scoreGoal } from "../goal/scoring.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { generateNextPrompt } from "../goal/control-loop.js";
import { orchestratePrompt } from "../orchestration/orchestrate-prompt.js";
import { compileGoalToDagNodes } from "../goal/compiler.js";
import type { GoalSpec, GoalEvidence } from "../contracts/goal.js";
import type { RunState } from "../contracts/orchestration.js";
import type { DagNodeDefinition } from "../orchestration/dag.js";

function getGoalBasePath(): string {
  return join(getProjectRoot(), ".omk", "goals");
}

function printAlphaWarning(json?: boolean): void {
  if (json) return;
  if (!process.env.OMK_GOAL_ALPHA) {
    console.log(style.orange("⚠️  Goal feature is alpha. Set OMK_GOAL_ALPHA=1 to suppress this warning."));
  }
}

function createPersister() {
  return createGoalPersister(getGoalBasePath());
}

function formatGoalTable(goals: Array<{ spec: GoalSpec; evidenceCount: number }>): string {
  const lines: string[] = [
    `  ${style.creamBold("ID")}                    ${style.creamBold("Status")}       ${style.creamBold("Risk")}   ${style.creamBold("Updated")}              ${style.creamBold("Title")}`,
  ];
  for (const { spec } of goals) {
    const id = spec.goalId.slice(0, 22).padEnd(22);
    const st = spec.status.padEnd(10);
    const risk = spec.riskLevel.padEnd(6);
    const updated = spec.updatedAt.slice(0, 19).padEnd(20);
    const title = spec.title.slice(0, 36);
    lines.push(`  ${style.gray(id)} ${style.gray(st)} ${style.gray(risk)} ${style.gray(updated)} ${title}`);
  }
  return lines.join("\n");
}

function renderGoalDetail(spec: GoalSpec): string {
  const lines: string[] = [
    header(`Goal: ${spec.title}`),
    label("ID", spec.goalId),
    label("Status", spec.status),
    label("Risk", spec.riskLevel),
    label("Plan revision", String(spec.planRevision)),
    label("Created", spec.createdAt),
    label("Updated", spec.updatedAt),
    "",
    style.purpleBold("Objective"),
    spec.objective,
    "",
    style.purpleBold("Success Criteria"),
  ];
  for (const c of spec.successCriteria) {
    const req = c.requirement === "required" ? style.pink("[required]") : style.gray("[optional]");
    const inf = c.inferred ? style.gray("(inferred)") : "";
    lines.push(`  ${req} ${c.description} ${inf}`);
  }
  if (spec.constraints.length > 0) {
    lines.push("", style.purpleBold("Constraints"));
    for (const c of spec.constraints) {
      lines.push(`  • ${c.description}`);
    }
  }
  if (spec.nonGoals.length > 0) {
    lines.push("", style.purpleBold("Non-Goals"));
    for (const ng of spec.nonGoals) {
      lines.push(`  • ${ng}`);
    }
  }
  if (spec.expectedArtifacts.length > 0) {
    lines.push("", style.purpleBold("Expected Artifacts"));
    for (const a of spec.expectedArtifacts) {
      lines.push(`  • ${a.name}${a.path ? ` → ${a.path}` : ""}`);
    }
  }
  if (spec.runIds.length > 0) {
    lines.push("", style.purpleBold("Runs"));
    for (const rid of spec.runIds) {
      lines.push(`  • ${rid}`);
    }
  }
  return lines.join("\n");
}

export async function goalCreateCommand(
  rawPrompt: string,
  options: { json?: boolean; title?: string; objective?: string; risk?: string }
): Promise<void> {
  printAlphaWarning(options.json);
  const root = getProjectRoot();
  await mkdir(join(root, ".omk", "goals"), { recursive: true });

  const spec = normalizeGoal({
    rawPrompt,
    title: options.title,
    objective: options.objective,
    riskLevel: options.risk as GoalSpec["riskLevel"] | undefined,
  });

  const persister = createPersister();
  await persister.save(spec);

  // Human-readable mirror
  const mirrorDir = join(getGoalBasePath(), spec.goalId);
  await mkdir(mirrorDir, { recursive: true });
  await writeFile(
    join(mirrorDir, "goal.md"),
    [`# Goal: ${spec.title}`, "", spec.objective, "", `**Status:** ${spec.status}`, `**Risk:** ${spec.riskLevel}`].join("\n")
  );

  if (options.json) {
    console.log(JSON.stringify(spec, null, 2));
    return;
  }

  console.log(header("Goal Created"));
  console.log(label("ID", spec.goalId));
  console.log(label("Title", spec.title));
  console.log(label("Status", spec.status));
  console.log(label("Risk", spec.riskLevel));
  console.log("");
  console.log(status.success(`goal.json → ${join(mirrorDir, "goal.json")}`));
}

export async function goalListCommand(options: { json?: boolean }): Promise<void> {
  printAlphaWarning(options.json);
  const persister = createPersister();
  const ids = await persister.list();

  const goals = await Promise.all(
    ids.map(async (id) => {
      const spec = await persister.load(id);
      const evidence = spec ? await persister.loadEvidence(id) : [];
      return { spec: spec!, evidenceCount: evidence.length };
    })
  );

  if (options.json) {
    console.log(JSON.stringify(goals.map((g) => g.spec), null, 2));
    return;
  }

  if (goals.length === 0) {
    console.log(style.gray("No goals found. Create one with: omk goal create \"<prompt>\""));
    return;
  }

  console.log(header("Goals"));
  console.log(formatGoalTable(goals));
}

export async function goalShowCommand(goalId: string, options: { json?: boolean }): Promise<void> {
  printAlphaWarning(options.json);
  const persister = createPersister();
  const spec = await persister.load(goalId);

  if (!spec) {
    const msg = `Goal not found: ${goalId}`;
    emitError(msg, Boolean(options.json));
    throw new NotFoundError(msg);
  }

  if (options.json) {
    console.log(JSON.stringify(spec, null, 2));
    return;
  }

  console.log(renderGoalDetail(spec));
}

export async function goalPlanCommand(goalId: string): Promise<void> {
  printAlphaWarning();
  const persister = createPersister();
  const spec = await persister.load(goalId);

  if (!spec) {
    const msg = `Goal not found: ${goalId}`;
    console.error(status.error(msg));
    throw new NotFoundError(msg);
  }

  const updated = updateGoalStatus(spec, "planned", { planRevision: spec.planRevision + 1 });
  await persister.save(updated);
  await persister.appendHistory(goalId, {
    at: new Date().toISOString(),
    action: "plan",
    detail: { planRevision: updated.planRevision, plannerNode: "goal-coordinator" },
  });

  const nodes = compileGoalToDagNodes(updated);
  const mirrorDir = join(getGoalBasePath(), goalId);
  await mkdir(mirrorDir, { recursive: true });
  await writeFile(join(mirrorDir, "plan.md"), renderGoalPlan(updated, nodes), "utf-8");

  console.log(header("Goal Planned"));
  console.log(label("ID", updated.goalId));
  console.log(label("Status", updated.status));
  console.log(label("Plan revision", String(updated.planRevision)));
  console.log(label("Planner", "goal-coordinator (planner)"));
}

function renderGoalPlan(spec: GoalSpec, nodes: DagNodeDefinition[]): string {
  const lines: string[] = [
    `# Plan: ${spec.title}`,
    "",
    `**Objective:** ${spec.objective}`,
    `**Risk:** ${spec.riskLevel}`,
    `**Plan revision:** ${spec.planRevision}`,
    "",
    "## Planner",
    "",
    "- `goal-coordinator` uses the `planner` role and writes `plan.md` before implementation nodes run.",
    "",
    "## Execution DAG",
    "",
    "| Step | Node | Role | Depends on | Evidence gate |",
    "|------|------|------|------------|---------------|",
  ];

  for (const [index, node] of nodes.entries()) {
    const gate = node.outputs?.map((output) => output.gate ?? "summary").join(", ") || "summary";
    lines.push(`| ${index + 1} | ${node.id} | ${node.role} | ${node.dependsOn.join(", ") || "—"} | ${gate} |`);
  }

  lines.push("", "## Acceptance Criteria", "");
  for (const criterion of spec.successCriteria) {
    lines.push(`- [ ] **${criterion.id}** (${criterion.requirement}): ${criterion.description}`);
  }

  if (spec.expectedArtifacts.length > 0) {
    lines.push("", "## Expected Artifacts", "");
    for (const artifact of spec.expectedArtifacts) {
      lines.push(`- ${artifact.name}${artifact.path ? ` → \`${artifact.path}\`` : ""}${artifact.gate ? ` (${artifact.gate})` : ""}`);
    }
  }

  if (spec.constraints.length > 0) {
    lines.push("", "## Constraints", "");
    for (const constraint of spec.constraints) {
      lines.push(`- ${constraint.description}`);
    }
  }

  if (spec.nonGoals.length > 0) {
    lines.push("", "## Non-goals", "");
    for (const nonGoal of spec.nonGoals) {
      lines.push(`- ${nonGoal}`);
    }
  }

  lines.push("", "## Evidence Gates", "");
  for (const node of nodes) {
    for (const output of node.outputs ?? []) {
      lines.push(`- ${node.id}: ${output.name}${output.ref ? ` → \`${output.ref}\`` : ""} (${output.gate ?? "summary"})`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export async function goalRunCommand(
  goalId: string,
  options: { workers?: string; runId?: string }
): Promise<void> {
  printAlphaWarning();
  const root = getProjectRoot();
  const persister = createPersister();
  const spec = await persister.load(goalId);

  if (!spec) {
    const msg = `Goal not found: ${goalId}`;
    console.error(status.error(msg));
    throw new NotFoundError(msg);
  }

  const updated = updateGoalStatus(spec, "running");
  await persister.save(updated);
  await persister.appendHistory(goalId, {
    at: new Date().toISOString(),
    action: "run",
    detail: { workers: options.workers },
  });

  // Load evidence and latest run state for continue engine
  const evidence = await persister.loadEvidence(goalId);
  let runState: RunState | undefined;
  if (updated.runIds.length > 0) {
    const latestRunId = updated.runIds[updated.runIds.length - 1];
    const statePersister = createStatePersister(getRunsDir(root));
    runState = (await statePersister.load(latestRunId)) ?? undefined;
  }

  // Generate enriched next-prompt
  const nextResult = await generateNextPrompt(updated, evidence, runState, undefined, root);
  const mirrorDir = join(getGoalBasePath(), goalId);
  await mkdir(mirrorDir, { recursive: true });
  await writeFile(join(mirrorDir, "next-prompt.md"), nextResult.prompt);

  // Delegate to orchestration with enriched prompt
  await orchestratePrompt(nextResult.prompt, {
    sourceCommand: "goal-run",
    runId: options.runId,
    workers: options.workers,
    goalId,
  });
}

export async function goalVerifyCommand(goalId: string, options: { json?: boolean }): Promise<void> {
  printAlphaWarning(options.json);
  const root = getProjectRoot();
  const persister = createPersister();
  const spec = await persister.load(goalId);

  if (!spec) {
    const msg = `Goal not found: ${goalId}`;
    emitError(msg, Boolean(options.json));
    throw new NotFoundError(msg);
  }

  const updated = updateGoalStatus(spec, "verifying");
  await persister.save(updated);

  // Load run state for the latest run associated with the goal
  let runState: import("../contracts/orchestration.js").RunState | undefined;
  if (spec.runIds.length > 0) {
    const latestRunId = spec.runIds[spec.runIds.length - 1];
    const statePersister = createStatePersister(getRunsDir(root));
    runState = (await statePersister.load(latestRunId)) ?? undefined;
  }

  const evidence = await checkGoalEvidence(updated, { root, runState: runState ?? { schemaVersion: 1, runId: "none", nodes: [], startedAt: new Date().toISOString() } });
  const score = scoreGoal(updated, evidence);

  let finalStatus: GoalSpec["status"];
  let verifyFailed = false;
  if (score.overall === "pass") {
    finalStatus = "done";
  } else if (score.overall === "fail") {
    finalStatus = "failed";
    verifyFailed = true;
  } else {
    finalStatus = "verifying";
  }

  const closed = updateGoalStatus(updated, finalStatus);
  await persister.save(closed);
  await persister.saveEvidence(goalId, evidence);
  await persister.appendHistory(goalId, {
    at: new Date().toISOString(),
    action: "verify",
    detail: { score, status: finalStatus },
  });

  if (options.json) {
    console.log(JSON.stringify({ goalId, score, status: closed.status, evidence }, null, 2));
  } else {
    console.log(header("Goal Verification"));
    console.log(label("ID", closed.goalId));
    console.log(label("Status", closed.status));
    console.log(label("Overall", score.overall));
    console.log(label("Required", `${score.requiredPassed}/${score.requiredTotal}`));
    if (score.optionalScore > 0) {
      console.log(label("Optional", String(score.optionalScore)));
    }
    console.log(label("Quality gate", score.qualityGatePassed ? "passed" : "failed"));
    console.log("");
    console.log(style.purpleBold("Evidence"));
    for (const ev of evidence) {
      const icon = ev.passed ? style.mint("✓") : style.pink("✗");
      console.log(`  ${icon} ${ev.criterionId}: ${ev.message ?? ""}`);
    }
  }

  if (verifyFailed) {
    throw new VerificationError("Goal verification failed", [`overall: ${score.overall}`]);
  }
}

export async function goalCloseCommand(
  goalId: string,
  options: { force?: boolean; reason?: string }
): Promise<void> {
  printAlphaWarning();
  const persister = createPersister();
  const spec = await persister.load(goalId);

  if (!spec) {
    const msg = `Goal not found: ${goalId}`;
    console.error(status.error(msg));
    throw new NotFoundError(msg);
  }

  const evidence = await persister.loadEvidence(goalId);
  const hasPassedEvidence = evidence.some((e: GoalEvidence) => e.passed);

  if (spec.status !== "done" && !hasPassedEvidence && !options.force) {
    console.error(
      status.error(
        `⚠️  No passed evidence gates found for this goal. Use --force to close anyway.`
      )
    );
    process.exit(1);
  }

  const updated = updateGoalStatus(spec, "closed");
  await persister.save(updated);
  await persister.appendHistory(goalId, {
    at: new Date().toISOString(),
    action: "close",
    detail: { reason: options.reason, force: options.force },
  });

  console.log(header("Goal Closed"));
  console.log(label("ID", updated.goalId));
  console.log(label("Status", updated.status));
  if (options.reason) {
    console.log(label("Reason", options.reason));
  }
}

export async function goalBlockCommand(goalId: string, options: { reason: string }): Promise<void> {
  printAlphaWarning();
  const persister = createPersister();
  const spec = await persister.load(goalId);

  if (!spec) {
    const msg = `Goal not found: ${goalId}`;
    console.error(status.error(msg));
    throw new NotFoundError(msg);
  }

  const updated = updateGoalStatus(spec, "blocked");
  await persister.save(updated);
  await persister.appendHistory(goalId, {
    at: new Date().toISOString(),
    action: "block",
    detail: { reason: options.reason },
  });

  console.log(header("Goal Blocked"));
  console.log(label("ID", updated.goalId));
  console.log(label("Reason", options.reason));
}

export async function goalContinueCommand(
  goalId: string | undefined,
  options: { workers?: string; runId?: string }
): Promise<void> {
  printAlphaWarning();
  const root = getProjectRoot();
  const persister = createPersister();

  let spec: GoalSpec | null;
  if (goalId) {
    spec = await persister.load(goalId);
  } else {
    spec = await persister.loadLatestActive();
  }

  if (!spec) {
    const msg = goalId ? `Goal not found: ${goalId}` : "No active goal found.";
    console.error(status.error(msg));
    throw new NotFoundError(msg);
  }

  const effectiveGoalId = spec.goalId;

  // Load evidence and latest run state
  const evidence = await persister.loadEvidence(effectiveGoalId);
  let runState: RunState | undefined;
  let effectiveRunId = options.runId;
  if (!effectiveRunId && spec.runIds.length > 0) {
    effectiveRunId = spec.runIds[spec.runIds.length - 1];
  }
  if (effectiveRunId) {
    const statePersister = createStatePersister(getRunsDir(root));
    runState = (await statePersister.load(effectiveRunId)) ?? undefined;
  }

  // Generate enriched next-prompt via continue engine
  const nextResult = await generateNextPrompt(spec, evidence, runState, undefined, root);

  // Write next-prompt.md to goal directory
  const goalDir = join(getGoalBasePath(), effectiveGoalId);
  await mkdir(goalDir, { recursive: true });
  const nextPromptPath = join(goalDir, "next-prompt.md");
  await writeFile(nextPromptPath, nextResult.prompt);

  // Write plan.md to run directory if runId is available
  if (effectiveRunId) {
    const runDir = getRunPath(effectiveRunId, undefined, root);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "plan.md"), nextResult.prompt);
  }

  // Print summary
  console.log(header("Goal Continue"));
  console.log(label("ID", effectiveGoalId));
  console.log(label("Status", spec.status));
  console.log(label("Missing criteria", String(nextResult.missingCriteria.length)));
  console.log(label("Next action", `${nextResult.suggestion.type}: ${nextResult.suggestion.description}`));
  console.log(label("Next prompt", nextPromptPath));
  console.log("");

  // Update status to running
  const updated = updateGoalStatus(spec, "running");
  await persister.save(updated);
  await persister.appendHistory(effectiveGoalId, {
    at: new Date().toISOString(),
    action: "continue",
    detail: { runId: effectiveRunId, workers: options.workers },
  });

  // Delegate to orchestration with generated prompt as goal text
  await orchestratePrompt(nextResult.prompt, {
    sourceCommand: "goal-continue",
    runId: effectiveRunId,
    workers: options.workers,
    goalId: effectiveGoalId,
  });
}
