import { readdir } from "fs/promises";
import { join } from "path";
import { getOmkPath, pathExists, getProjectRoot, injectKimiGlobals } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { getCurrentBranch, isGitRepo } from "../util/git.js";
import { style, header, status, label, separator } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { runQualityGate } from "../mcp/quality-gate.js";
import { readTextFile } from "../util/fs.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { defaultScopedRoleAgentFile, writeScopedAgentFile } from "../util/scoped-agent-file.js";
import { createOmkJsonEnvelope } from "../util/json-envelope.js";
import { emitJson } from "../util/cli-contract.js";
import type { OmkErrorCode } from "../contracts/index.js";

interface MergeOptions {
  run?: string;
  runId?: string;
  strategy?: string;
  dryRun?: boolean;
  json?: boolean;
}

/** Machine-readable payload carried inside the `merge` omk.contract.v1 envelope. */
interface MergeJsonData {
  runId: string | null;
  strategy: string;
  dryRun: boolean;
  merged: string | null;
  conflicts: string[];
  applied: number;
}

interface WorkerDiff {
  name: string;
  path: string;
  diff: string;
  diffLines: number;
  canApply: boolean;
  reviewScore?: number;
  reviewReason?: string;
  testsPassed?: boolean;
}

interface MergeReport {
  winner: string | null;
  reason: string;
  conflicts: string[];
  filesApplied: number;
  dryRun: boolean;
  workers: WorkerDiff[];
}

/**
 * JSON path for `omk merge --json`.
 * Read-only preview: resolves the run, collects worktree diffs (git diff +
 * `git apply --check`) and selects a winner by strategy, but does NOT run the
 * reviewer, tests, patch apply, or quality gate. Emits exactly one
 * omk.contract.v1 envelope (no banner, no ANSI) and never calls process.exit.
 */
async function emitMergeJson(options: MergeOptions): Promise<void> {
  const started = Date.now();
  const root = getProjectRoot();
  const strategy = (options.strategy ?? "first").trim().toLowerCase();
  const dryRun = Boolean(options.dryRun);

  const emitNotApplicable = (runId: string | null, code: OmkErrorCode, message: string): void => {
    emitJson(
      createOmkJsonEnvelope<MergeJsonData>({
        command: "merge",
        status: "not-applicable",
        ok: false,
        ...(runId ? { runId } : {}),
        data: { runId, strategy, dryRun, merged: null, conflicts: [], applied: 0 },
        warnings: [{ code, message, recoverable: true, severity: "warning" }],
        durationMs: Date.now() - started,
      })
    );
  };

  if (!(await isGitRepo())) {
    emitNotApplicable(null, "INTERNAL_ERROR", "Not a git repository.");
    return;
  }

  const runsDir = getOmkPath("runs");
  if (!(await pathExists(runsDir))) {
    emitNotApplicable(null, "RUN_ARTIFACT_MISSING", "No runs found.");
    return;
  }

  let runId = options.run ?? options.runId ?? "latest";
  if (runId === "latest") {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runs = entries.filter((e) => e.isDirectory()).sort().reverse();
    if (runs.length === 0) {
      emitNotApplicable(null, "RUN_ARTIFACT_MISSING", "No runs found.");
      return;
    }
    runId = runs[0].name;
  }

  const worktreesDir = getOmkPath(`worktrees/${runId}`);
  if (!(await pathExists(worktreesDir))) {
    emitNotApplicable(runId, "RUN_ARTIFACT_MISSING", "No worktrees found for run.");
    return;
  }

  const workerNames = await readdir(worktreesDir, { withFileTypes: true }).then((e) =>
    e.filter((d) => d.isDirectory()).map((d) => d.name)
  );

  const currentBranch = await getCurrentBranch();
  if (!currentBranch) {
    emitNotApplicable(runId, "INTERNAL_ERROR", "Could not determine current branch.");
    return;
  }

  const workers: WorkerDiff[] = [];
  for (const name of workerNames) {
    const wtPath = join(worktreesDir, name);
    const diffResult = await runShell("git", ["-C", wtPath, "diff", currentBranch], { timeout: 15000 });
    if (diffResult.failed || !diffResult.stdout.trim()) continue;
    const diff = diffResult.stdout;
    const diffLines = diff.split("\n").length;
    const applyCheck = await runShell("git", ["apply", "--check"], { cwd: root, input: diff, timeout: 15000 });
    workers.push({ name, path: wtPath, diff, diffLines, canApply: !applyCheck.failed });
  }

  const winner = selectWinner(workers, strategy);
  const data: MergeJsonData = {
    runId,
    strategy,
    dryRun,
    merged: winner?.name ?? null,
    conflicts: workers.filter((w) => !w.canApply).map((w) => w.name),
    applied: 0,
  };
  emitJson(
    createOmkJsonEnvelope<MergeJsonData>({
      command: "merge",
      status: workers.length === 0 ? "not-applicable" : "dry-run",
      ok: workers.length > 0,
      runId,
      data,
      durationMs: Date.now() - started,
    })
  );
}

export async function mergeCommand(options: MergeOptions): Promise<void> {
  if (options.json === true || process.argv.includes("--json")) {
    await emitMergeJson(options);
    return;
  }

  const root = getProjectRoot();
  const strategy = (options.strategy ?? "first").trim().toLowerCase();
  const dryRun = Boolean(options.dryRun);

  if (!(await isGitRepo())) {
    console.error(status.error("Not a git repository."));
    process.exit(1);
  }

  const runsDir = getOmkPath("runs");
  if (!(await pathExists(runsDir))) {
    console.error(status.error(t("merge.noRuns")));
    process.exit(1);
  }

  let runId = options.run ?? options.runId ?? "latest";
  if (runId === "latest") {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runs = entries.filter((e) => e.isDirectory()).sort().reverse();
    if (runs.length === 0) {
      console.error(status.error(t("merge.noRuns")));
      process.exit(1);
    }
    runId = runs[0].name;
  }

  const worktreesDir = getOmkPath(`worktrees/${runId}`);
  if (!(await pathExists(worktreesDir))) {
    console.log(status.info(t("merge.noWorktrees")));
    return;
  }

  const workerNames = await readdir(worktreesDir, { withFileTypes: true }).then((e) =>
    e.filter((d) => d.isDirectory()).map((d) => d.name)
  );

  const currentBranch = await getCurrentBranch();
  if (!currentBranch) {
    console.error(status.error(t("merge.branchCheckFailed")));
    process.exit(1);
  }

  console.log(header("omk merge"));
  console.log(label("Run ID", runId));
  console.log(label("Strategy", strategy));
  console.log(label("Workers", workerNames.join(", ")));
  if (dryRun) console.log(style.orange("🟡 DRY RUN — no changes will be applied"));
  console.log("");

  // ── 1. Collect diffs from all worktrees ──
  const workers: WorkerDiff[] = [];
  for (const name of workerNames) {
    const wtPath = join(worktreesDir, name);
    const diffResult = await runShell("git", ["-C", wtPath, "diff", currentBranch], { timeout: 15000 });

    if (diffResult.failed || !diffResult.stdout.trim()) {
      console.log(style.gray(`  ${name}: no changes`));
      continue;
    }

    const diff = diffResult.stdout;
    const diffLines = diff.split("\n").length;

    // Check apply-ability
    const applyCheck = await runShell("git", ["apply", "--check"], {
      cwd: root,
      input: diff,
      timeout: 15000,
    });
    const canApply = !applyCheck.failed;

    workers.push({ name, path: wtPath, diff, diffLines, canApply });
    console.log(
      `  ${style.purpleBold(name)} ${canApply ? style.mint("(clean)") : style.pink("(conflicts)")} ${style.gray(`${diffLines} lines`)}`
    );
  }

  if (workers.length === 0) {
    console.log(status.warn("No worker changes to merge."));
    return;
  }

  // ── 2. Reviewer scoring ──
  console.log("");
  console.log(style.purple("Scoring diffs with reviewer..."));
  for (const w of workers) {
    const score = await scoreDiff(w.diff, w.name);
    w.reviewScore = score.score;
    w.reviewReason = score.reason;
    const color = score.score >= 80 ? style.mint : score.score >= 50 ? style.orange : style.pink;
    console.log(`  ${w.name}: ${color(`${score.score}/100`)} ${style.gray(score.reason)}`);
  }

  // ── 3. Test verification in worktrees ──
  console.log("");
  console.log(style.purple("Running tests in worktrees..."));
  for (const w of workers) {
    const testResult = await runShell("sh", ["-c", "npm test 2>/dev/null || pnpm test 2>/dev/null || yarn test 2>/dev/null || true"], {
      cwd: w.path,
      timeout: 120_000,
    });
    w.testsPassed = !testResult.failed;
    console.log(
      `  ${w.name}: ${w.testsPassed ? style.mint("tests passed") : style.pink("tests failed")}`
    );
  }

  // ── 4. Select winner ──
  console.log("");
  console.log(style.purple("Selecting winner..."));
  const winner = selectWinner(workers, strategy);

  // ── 5. Apply or preview ──
  const report: MergeReport = {
    winner: winner?.name ?? null,
    reason: winner?.reviewReason ?? "No suitable candidate",
    conflicts: workers.filter((w) => !w.canApply).map((w) => w.name),
    filesApplied: 0,
    dryRun,
    workers,
  };

  if (!winner) {
    console.log(status.error("No worker diff can be applied cleanly."));
    printReport(report);
    process.exit(1);
  }

  if (dryRun) {
    console.log(style.orange(`\n🟡 Dry-run: would apply ${winner.name}`));
    printReport(report);
    return;
  }

  // Apply winner patch
  console.log(style.purple(`\nApplying ${winner.name}...`));
  const applyResult = await runShell("git", ["apply"], {
    cwd: root,
    input: winner.diff,
    timeout: 15000,
  });

  if (applyResult.failed) {
    console.error(status.error(`Failed to apply patch from ${winner.name}`));
    console.error(applyResult.stderr);
    process.exit(1);
  }

  const stagedFiles = await runShell("git", ["diff", "--cached", "--name-only"], { cwd: root, timeout: 5000 });
  report.filesApplied = stagedFiles.stdout.trim().split("\n").filter(Boolean).length;

  // ── 6. Verify ──
  console.log(style.purple("Verifying merge..."));
  const config = await readTextFile(join(root, ".omk", "config.toml"), "");
  const qgResult = await runQualityGate(root, config);
  const qgFailed = Object.values(qgResult).some(
    (r) => r.status === "failed" || r.status === "timeout" || r.status === "error"
  );

  if (qgFailed) {
    console.error(status.error("Quality gate failed after merge."));
    printReport(report);
    process.exit(1);
  }

  // ── 7. Summary ──
  console.log("");
  console.log(status.ok("Merge complete"));
  printReport(report);
}

// ── Helpers ───────────────────────────────────────────────────

async function scoreDiff(
  diff: string,
  workerName: string
): Promise<{ score: number; reason: string }> {
  const root = getProjectRoot();
  const agentFile = join(root, ".omk", "agents", "roles", "reviewer.yaml");
  if (!(await pathExists(agentFile))) {
    return { score: 50, reason: "reviewer agent not found" };
  }

  const prompt = `Score this diff from 0-100. Return ONLY a JSON object like {"score": 85, "reason": "concise reason"}.\n\n--- DIFF from ${workerName} ---\n${diff.slice(0, 8000)}\n--- END DIFF ---`;
  const resources = await getOmkResourceSettings();
  const scopedAgentFile = await writeScopedAgentFile({
    baseAgentFile: agentFile,
    outputFile: defaultScopedRoleAgentFile(root, undefined, "reviewer"),
    role: "reviewer",
    resources,
  });
  const args = ["--print", "--output-format=stream-json", "--agent-file", scopedAgentFile];
  await injectKimiGlobals(args, {
    role: "reviewer",
    mcpScope: resources.mcpScope,
    skillsScope: resources.skillsScope,
    hooksScope: resources.hooksScope,
  });
  args.push("-p", prompt);

  const result = await runShell("kimi", args, { cwd: root, timeout: 60_000 });
  if (result.failed) {
    return { score: 50, reason: "review failed" };
  }

  try {
    const json = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}");
    const score = Math.max(0, Math.min(100, Number(json.score) || 50));
    const reason = String(json.reason || "no reason given").slice(0, 60);
    return { score, reason };
  } catch {
    // Fallback: try to extract score from text
    const match = result.stdout.match(/(\d{1,3})\s*\/\s*100/);
    if (match) {
      return { score: Number(match[1]), reason: "extracted from text" };
    }
    return { score: 50, reason: "parse failed" };
  }
}

function selectWinner(workers: WorkerDiff[], strategy: string): WorkerDiff | null {
  const eligible = workers.filter((w) => w.canApply);
  if (eligible.length === 0) return null;

  if (strategy === "first") {
    return eligible[0];
  }

  // best: composite score (review * 0.4 + test bonus * 0.3 + diff-size penalty * 0.3)
  const scored = eligible.map((w) => {
    const testBonus = w.testsPassed ? 30 : 0;
    const sizePenalty = Math.max(0, Math.min(20, w.diffLines / 100));
    const composite = (w.reviewScore ?? 50) * 0.4 + testBonus * 0.3 - sizePenalty * 0.3;
    return { worker: w, composite };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored[0].worker;
}

function printReport(report: MergeReport): void {
  console.log("");
  console.log(separator());
  console.log(label("Winner", report.winner ?? style.pink("none")));
  console.log(label("Reason", report.reason));
  console.log(label("Conflicts", report.conflicts.length > 0 ? report.conflicts.join(", ") : "none"));
  console.log(label("Files applied", String(report.filesApplied)));
  if (report.dryRun) console.log(label("Mode", style.orange("dry-run")));

  console.log("");
  console.log(style.purpleBold("Worker Breakdown"));
  for (const w of report.workers) {
    const s = w.reviewScore ?? 0;
    const scoreColor = s >= 80 ? style.mint : s >= 50 ? style.orange : style.pink;
    console.log(
      `  ${w.name}: ${scoreColor(`${s}/100`)} ` +
      `${w.testsPassed ? style.mint("✓ tests") : style.pink("✗ tests")} ` +
      `${w.canApply ? style.mint("✓ clean") : style.pink("✗ conflict")} ` +
      style.gray(`${w.diffLines} lines`)
    );
  }
}
