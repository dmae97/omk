import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { style, status, header, label, bullet } from "../util/theme.js";
import { getProjectRoot, pathExists, injectKimiGlobals, readTextFile, getRunPath } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { isGitRepo, getGitStatus } from "../util/git.js";
import { createOmkSessionEnv, createOmkSessionId } from "../util/session.js";
import { detectSpecKitContext, injectSpecKitPrompt } from "./spec.js";
import { runQualityGate } from "../mcp/quality-gate.js";
import { saveCheckpoint } from "../util/checkpoint.js";
import { createWorktree } from "../util/worktree.js";
import { successResult, failureResult, type CommandResult } from "../util/cli-contract.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { defaultScopedRoleAgentFile, writeScopedAgentFile } from "../util/scoped-agent-file.js";

const root = getProjectRoot();

interface WorkflowOptions {
  runId?: string;
  specKit?: boolean;
  noSpecKit?: boolean;
  ci?: boolean;
  soft?: boolean;
}

// ── Helper: run an agent role with a prompt ──────────────────
async function runAgentStep(
  role: string,
  prompt: string,
  opts: { timeout?: number; env?: Record<string, string>; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; failed: boolean }> {
  const agentFile = join(root, ".omk", "agents", "roles", `${role}.yaml`);
  if (!(await pathExists(agentFile))) {
    throw new Error(`Agent role not found: ${agentFile}`);
  }
  const sessionEnv = createOmkSessionEnv(root, createOmkSessionId("run"));
  const env = { ...sessionEnv, ...opts.env };
  const resources = await getOmkResourceSettings();
  const scopedAgentFile = await writeScopedAgentFile({
    baseAgentFile: agentFile,
    outputFile: defaultScopedRoleAgentFile(root, env.OMK_RUN_ID ?? env.OMK_SESSION_ID, role),
    role,
    resources,
  });
  const args = [
    "--print",
    "--output-format=stream-json",
    "--agent-file",
    scopedAgentFile,
  ];
  await injectKimiGlobals(args, {
    role,
    mcpScope: resources.mcpScope,
    skillsScope: resources.skillsScope,
    hooksScope: resources.hooksScope,
  });
  args.push("-p", prompt);
  const result = await runShell("kimi", args, {
    cwd: opts.cwd ?? root,
    timeout: opts.timeout ?? 300_000,
    env,
  });
  return result;
}

function shouldUseSpecKit(options: WorkflowOptions): "yes" | "no" | "auto" {
  if (options.noSpecKit) return "no";
  if (options.specKit) return "yes";
  return "auto";
}

async function saveRunArtifacts(
  runId: string,
  artifacts: { goal?: string; plan?: string; tasks?: string }
): Promise<string> {
  const runDir = getRunPath(runId, undefined, root);
  await mkdir(runDir, { recursive: true });
  if (artifacts.goal) {
    await writeFile(join(runDir, "goal.md"), artifacts.goal, "utf-8");
  }
  if (artifacts.plan) {
    await writeFile(join(runDir, "plan.md"), artifacts.plan, "utf-8");
  }
  if (artifacts.tasks) {
    await writeFile(join(runDir, "tasks.md"), artifacts.tasks, "utf-8");
  }
  return runDir;
}

async function runWorkflowQualityGate(): Promise<boolean> {
  const config = await readTextFile(join(root, ".omk", "config.toml"), "");
  const qgResult = await runQualityGate(root, config);
  const qgFailed = Object.values(qgResult).some(
    (r) => r.status === "failed" || r.status === "timeout" || r.status === "error"
  );
  return !qgFailed;
}

// ── omk feature ───────────────────────────────────────────────
// spec init/check → plan → dag from-spec → parallel → verify → summary
export async function featureCommand(
  goal: string,
  options: WorkflowOptions = {}
): Promise<void> {
  console.log(header("omk feature"));
  console.log(label("Goal", goal));
  const runId = createOmkSessionId("feature");

  // 1. Git + spec kit check (parallel)
  const [specCtx, gitOk] = await Promise.all([
    detectSpecKitContext(shouldUseSpecKit(options)),
    isGitRepo(),
  ]);
  if (!gitOk) {
    console.error(status.error("Not a git repository. Run 'git init' first."));
    process.exit(1);
  }

  // 2. Plan with architect / planner
  let planPrompt = `Goal: ${goal}\n\nCreate a detailed implementation plan. Break it into small, verifiable steps. Output the plan as markdown with concrete files, functions, and test expectations.`;
  if (specCtx.useSpecKit) {
    planPrompt = injectSpecKitPrompt(planPrompt, specCtx);
    console.log(bullet("Spec-kit context loaded", "mint"));
  }
  console.log(style.purple("Planning..."));
  const planResult = await runAgentStep("planner", planPrompt, { timeout: 120_000 });
  if (planResult.failed) {
    console.error(status.error("Planning failed"));
    process.exit(1);
  }
  const planText = planResult.stdout;
  console.log(planText);

  // 3. Save artifacts
  const runDir = await saveRunArtifacts(runId, {
    goal: `# Goal\n\n${goal}\n`,
    plan: planText,
  });
  console.log(label("Run Dir", runDir));

  // 4. Parallel implementation (coder + explorer)
  console.log(style.purple("Implementing..."));
  const implPrompt = `Plan:\n${planText}\n\nImplement the plan. Produce concrete, working code. Run tests after changes.`;
  const explorePrompt = `Explore repo changes related to: ${goal}\nSummarize affected files and any architectural concerns.`;
  const [coderResult, exploreResult] = await Promise.all([
    runAgentStep("coder", implPrompt, { timeout: 300_000 }),
    runAgentStep("explorer", explorePrompt, { timeout: 60_000 }),
  ]);
  console.log(coderResult.stdout);
  if (exploreResult.stdout.trim()) {
    console.log(style.gray("--- Explorer Summary ---"));
    console.log(exploreResult.stdout);
  }

  // 5. Verify (quality gate)
  console.log(style.purple("Verifying..."));
  const qgPassed = await runWorkflowQualityGate();
  if (!qgPassed) {
    console.error(status.error("Quality gate failed"));
    process.exit(1);
  }

  // 6. Summary
  console.log();
  console.log(status.ok("Feature workflow complete"));
  console.log(label("Run ID", runId));
  console.log(label("Run Dir", runDir));
}

// ── omk bugfix ────────────────────────────────────────────────
// repo index → failing command reproduce → patch → verify
export async function bugfixCommand(
  description: string,
  _options: WorkflowOptions = {}
): Promise<void> {
  console.log(header("omk bugfix"));
  console.log(label("Description", description));

  // 1. Quick repo health check (parallel)
  const [gitOk, changes] = await Promise.all([isGitRepo(), getGitStatus()]);
  if (!gitOk) {
    console.error(status.error("Not a git repository."));
    process.exit(1);
  }
  if (changes.changes > 0) {
    console.log(status.warn(`${changes.changes} uncommitted changes detected`));
  }

  // 2. Try to reproduce if description looks like a command
  const looksLikeCommand = /^(npm|yarn|pnpm|cargo|pytest|go|python|node|tsc|vite|next|docker)\s/.test(description.trim());
  let reproduceOutput = "";
  if (looksLikeCommand) {
    console.log(style.purple("Reproducing..."));
    const reproResult = await runShell("sh", ["-c", description.trim()], { cwd: root, timeout: 120_000 });
    reproduceOutput = reproResult.stdout + reproResult.stderr;
    if (reproduceOutput.trim()) {
      console.log(style.gray("--- Reproduction Output ---"));
      console.log(reproduceOutput.slice(0, 2000));
    }
  }

  // 3. Investigate
  console.log(style.purple("Investigating..."));
  const investigatePrompt = `Bug: ${description}\n\n${reproduceOutput ? `Reproduction output:\n${reproduceOutput}\n\n` : ""}1. Find the root cause by examining relevant files and test output.\n2. Create a minimal reproduction if possible.\n3. Explain the fix strategy before implementing.`;
  const investigateResult = await runAgentStep("explorer", investigatePrompt, { timeout: 120_000 });
  console.log(investigateResult.stdout);

  // 4. Patch
  console.log(style.purple("Patching..."));
  const patchPrompt = `${investigateResult.stdout}\n\nApply the fix. Keep changes minimal. Add or update tests to prevent regression.`;
  const patchResult = await runAgentStep("coder", patchPrompt, { timeout: 300_000 });
  console.log(patchResult.stdout);

  // 5. Verify
  console.log(style.purple("Verifying..."));
  const qgPassed = await runWorkflowQualityGate();
  if (!qgPassed) {
    console.error(status.error("Quality gate failed — fix incomplete"));
    process.exit(1);
  }

  console.log();
  console.log(status.ok("Bugfix workflow complete"));
}

// ── omk refactor ──────────────────────────────────────────────
// checkpoint → worktree split → verify → merge
export async function refactorCommand(
  description: string,
  _options: WorkflowOptions = {}
): Promise<void> {
  console.log(header("omk refactor"));
  console.log(label("Description", description));

  const gitOk = await isGitRepo();
  if (!gitOk) {
    console.error(status.error("Not a git repository."));
    process.exit(1);
  }

  // 1. Checkpoint
  console.log(style.purple("Creating checkpoint..."));
  const runId = createOmkSessionId("refactor");
  try {
    const cp = await saveCheckpoint(runId, `pre-refactor: ${description}`, {});
    console.log(label("Checkpoint", cp.checkpointId));
  } catch {
    console.log(status.warn("Checkpoint creation skipped"));
  }

  // 2. Worktree split for isolation
  console.log(style.purple("Creating worktree..."));
  let worktreePath: string | undefined;
  try {
    worktreePath = await createWorktree(runId, "refactor");
    console.log(label("Worktree", worktreePath));
  } catch (err) {
    console.log(status.warn(`Worktree creation skipped: ${err instanceof Error ? err.message : String(err)}`));
  }

  // 3. Plan refactor
  console.log(style.purple("Planning refactor..."));
  const planPrompt = `Refactor goal: ${description}\n\n1. Analyze current code.\n2. Identify the smallest safe refactoring steps.\n3. Preserve all external behavior.\n4. Plan test updates if needed.`;
  const planResult = await runAgentStep("architect", planPrompt, { timeout: 120_000 });
  console.log(planResult.stdout);

  // 4. Execute refactor (in worktree if available)
  console.log(style.purple("Refactoring..."));
  const implPrompt = `${planResult.stdout}\n\nExecute the refactoring step by step. Run tests after each significant change.`;
  const implResult = await runAgentStep("coder", implPrompt, {
    timeout: 300_000,
    cwd: worktreePath,
  });
  console.log(implResult.stdout);

  // 5. Verify
  console.log(style.purple("Verifying..."));
  const qgPassed = await runWorkflowQualityGate();
  if (!qgPassed) {
    console.error(status.error("Quality gate failed — refactor incomplete"));
    process.exit(1);
  }

  // 6. Merge summary
  console.log();
  console.log(status.ok("Refactor workflow complete"));
  if (worktreePath) {
    console.log(style.gray(`Worktree: ${worktreePath}`));
    console.log(style.gray("Review the diff and merge when ready:"));
    console.log(style.cream(`  git diff ${worktreePath}`));
  } else {
    console.log(style.gray("Review the diff and commit when ready."));
  }
}

// ── omk review ────────────────────────────────────────────────
// git diff → reviewer + security (parallel) → evidence → summary
// CI mode: skips Kimi agents, runs local checks + quality gate only
export async function reviewCommand(
  options: WorkflowOptions = {}
): Promise<CommandResult> {
  console.log(header(options.ci ? "omk review --ci" : "omk review"));

  const gitOk = await isGitRepo();
  if (!gitOk) {
    console.error(status.error("Not a git repository."));
    process.exit(1);
  }

  // 1. Get diff (parallel with status)
  const [diffResult, gitStatus, branchResult] = await Promise.all([
    runShell("git", ["diff", "HEAD"], { cwd: root, timeout: 10_000 }),
    getGitStatus(),
    runShell("git", ["branch", "--show-current"], { cwd: root, timeout: 5_000 }),
  ]);
  const diff = diffResult.stdout;
  if (!diff.trim()) {
    console.log(status.warn("No changes to review (git diff HEAD is empty)"));
    return successResult();
  }
  console.log(label("Changes", `${gitStatus.changes} files`));

  // CI mode: run local checks without Kimi API
  if (options.ci) {
    return await runCiReview(diff, {
      changes: gitStatus.changes,
      branch: branchResult.stdout.trim() || "unknown",
    }, options.soft);
  }

  // 2. Review (parallel security + code review)
  const reviewPrompt = `Review the following diff. Focus on:\n1. Logic correctness\n2. Type safety\n3. Security risks\n4. Maintainability\n5. Test coverage gaps\n\n--- DIFF ---\n${diff}\n--- END DIFF ---`;
  console.log(style.purple("Reviewing (code + security)..."));
  const [codeReview, securityReview] = await Promise.all([
    runAgentStep("reviewer", reviewPrompt, { timeout: 120_000 }),
    runAgentStep("security", reviewPrompt, { timeout: 120_000 }),
  ]);

  // 3. Evidence check (quality gate)
  console.log(style.purple("Checking evidence..."));
  const qgPassed = await runWorkflowQualityGate();

  // 4. Summary
  console.log();
  console.log(style.purple("=== Code Review ==="));
  console.log(codeReview.stdout);
  console.log();
  console.log(style.purple("=== Security Review ==="));
  console.log(securityReview.stdout);
  console.log();

  if (qgPassed) {
    console.log(status.ok("Quality gates passed"));
    return successResult();
  }
  console.log(status.error("Quality gates failed — do not merge"));
  const result = failureResult(1, ["Quality gates failed"]);
  if (options.soft) {
    // Soft mode: exit 0 but preserve failed result so callers can inspect diagnostics.
    return { ...result, exitCode: 0 };
  }
  return result;
}

async function runCiReview(
  diff: string,
  gitStatus: { changes: number; branch: string },
  soft?: boolean
): Promise<CommandResult> {
  const lines = diff.split("\n").filter((l) => l.startsWith("diff --git"));
  const files = lines.map((l) => {
    const m = l.match(/diff --git a\/(.+?) b\/(.+?)$/);
    return m ? m[2] : l;
  });

  console.log(label("Branch", gitStatus.branch));
  console.log(label("Files changed", files.join(", ")));

  // Local checks
  let dagValid = true;
  let specOk = true;

  // DAG validation (if dag.json exists)
  const dagPath = join(root, ".omk", "dag.json");
  if (await pathExists(dagPath)) {
    console.log(style.purple("Validating DAG..."));
    try {
      const { dagValidateCommand } = await import("./dag.js");
      await dagValidateCommand(dagPath);
    } catch {
      dagValid = false;
    }
  }

  // Spec-kit check
  console.log(style.purple("Checking spec-kit..."));
  try {
    const { specCheckCommand } = await import("./spec.js");
    await specCheckCommand();
  } catch {
    specOk = false;
  }

  // Quality gate
  console.log(style.purple("Running quality gate..."));
  const qgPassed = await runWorkflowQualityGate();

  // Summary for GitHub Actions step summary
  const summary = [
    "## OMK Review (CI)",
    "",
    `- **Branch:** ${gitStatus.branch}`,
    `- **Files changed:** ${files.length}`,
    `- **DAG valid:** ${dagValid ? "✅" : "❌"}`,
    `- **Spec-kit:** ${specOk ? "✅" : "⚠️"}`,
    `- **Quality gate:** ${qgPassed ? "✅ passed" : "❌ failed"}`,
    "",
    "### Changed files",
    ...files.map((f) => `- \`${f}\``),
    "",
    "### Diff stats",
    diff
      .split("\n")
      .filter((l) => l.startsWith("@@"))
      .slice(0, 10)
      .map((l) => `> ${l}`)
      .join("\n") || "> (no hunk headers)",
    "",
  ].join("\n");

  // Write to GITHUB_STEP_SUMMARY if available
  const ghSummary = process.env.GITHUB_STEP_SUMMARY;
  if (ghSummary) {
    await writeFile(ghSummary, summary, "utf-8");
  }

  console.log();
  console.log(style.purple("=== CI Review Summary ==="));
  console.log(summary);
  console.log();

  if (qgPassed && dagValid) {
    console.log(status.ok("CI review passed"));
    return successResult();
  }
  console.log(status.error("CI review failed — check logs above"));
  const result = failureResult(1, [
    ...(qgPassed ? [] : ["Quality gate failed"]),
    ...(dagValid ? [] : ["DAG validation failed"]),
  ]);
  if (soft) {
    return { ...result, exitCode: 0 };
  }
  return result;
}
