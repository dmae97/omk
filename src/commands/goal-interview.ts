import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { getProjectRoot } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";
import { NotFoundError, UsageError, emitError } from "../util/cli-contract.js";

import { createGoalPersister } from "../goal/persistence.js";
import { createGoalSpec, updateGoalStatus } from "../goal/intake.js";
import { buildInterviewSession, ingestAnswers } from "../goal/interview-session.js";
import { applyInterviewDelta } from "../goal/interview-assimilation.js";
import { redactSecretText } from "../goal/intent-frame.js";
import type {
  InterviewAnswer,
  InterviewDepth,
  InterviewMode,
  InterviewSeed,
  InterviewSession,
  InterviewSpecDelta,
} from "../contracts/interview.js";
import type { GoalSpec } from "../contracts/goal.js";

interface GoalInterviewOptions {
  goalId?: string;
  mode?: string;
  depth?: string;
  maxQuestions?: string;
  answers?: string;
  writeSpec?: boolean;
  json?: boolean;
}

interface GoalRefineOptions {
  fromInterview?: string;
  plan?: boolean;
  json?: boolean;
}

function getGoalBasePath(): string {
  return join(getProjectRoot(), ".omk", "goals");
}

function printAlphaWarning(json?: boolean): void {
  if (json) return;
  if (!process.env.OMK_GOAL_ALPHA) {
    console.log(style.orange("⚠️  Goal interview is alpha. Set OMK_GOAL_ALPHA=1 to suppress this warning."));
  }
}

function parseDepth(value: string | undefined): InterviewDepth | undefined {
  if (!value) return undefined;
  if (value === "light" || value === "standard" || value === "deep") return value;
  throw new UsageError(`Invalid depth: ${value} (expected light | standard | deep)`);
}

function parseMode(value: string | undefined): InterviewMode {
  if (!value || value === "create") return "create";
  if (value === "refine") return "refine";
  throw new UsageError(`Invalid mode: ${value} (expected create | refine)`);
}

async function loadAnswersFile(root: string, filePath: string): Promise<InterviewAnswer[]> {
  const abs = join(root, filePath);
  let content: string;
  try {
    content = await readFile(abs, "utf-8");
  } catch {
    throw new NotFoundError(`Answers file not found: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new UsageError(`Answers file is not valid JSON: ${filePath}`);
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as { answers?: unknown }).answers)
      ? (parsed as { answers: unknown[] }).answers
      : null);
  if (!rows) {
    throw new UsageError(`Answers file must be an array or { "answers": [...] }: ${filePath}`);
  }
  const now = new Date().toISOString();
  const answers: InterviewAnswer[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as { questionId?: unknown; answer?: unknown; skipped?: unknown; answeredAt?: unknown };
    if (typeof r.questionId !== "string") continue;
    answers.push({
      questionId: r.questionId,
      answer: typeof r.answer === "string" ? r.answer : "",
      answeredAt: typeof r.answeredAt === "string" ? r.answeredAt : now,
      skipped: r.skipped === true ? true : undefined,
    });
  }
  return answers;
}

function renderQuestionsMarkdown(session: InterviewSession): string {
  const lines: string[] = [
    `# Interview Questions — ${session.sessionId}`,
    "",
    `**Mode:** ${session.mode}  |  **Depth:** ${session.depth}  |  **Ambiguity:** ${session.ambiguity}`,
    "",
    "| # | Score | Req | Target | Kind | Prompt |",
    "|---|-------|-----|--------|------|--------|",
  ];
  session.questions.forEach((q, i) => {
    const req = q.required ? "✓" : "";
    lines.push(`| ${i + 1} | ${q.score} | ${req} | ${q.targetField} | ${q.kind} | ${q.prompt.replace(/\|/g, "\\|")} |`);
  });
  lines.push("");
  return lines.join("\n");
}

function renderReportMarkdown(session: InterviewSession): string {
  const c = session.completeness;
  const lines: string[] = [
    `# Interview Report — ${session.sessionId}`,
    "",
    `**Status:** ${session.status}  |  **Mode:** ${session.mode}  |  **Depth:** ${session.depth}`,
    `**Ambiguity:** ${session.ambiguity}  |  **Completeness:** ${c.overall}`,
    "",
    "## Completeness by axis",
    "",
    `- objective: ${c.objective}`,
    `- successCriteria: ${c.successCriteria}`,
    `- evidence: ${c.evidence}`,
    `- artifacts: ${c.artifacts}`,
    `- constraints: ${c.constraints}`,
    `- risks: ${c.risks}`,
    `- authority: ${c.authority}`,
    "",
  ];
  if (c.criticalMissing.length > 0) {
    lines.push("## Critical missing fields", "", ...c.criticalMissing.map((m) => `- ${m}`), "");
  }
  if (c.contradictions.length > 0) {
    lines.push("## Unresolved contradictions", "", ...c.contradictions.map((m) => `- ${m}`), "");
  }
  lines.push("## Answers", "");
  if (session.answers.length === 0) {
    lines.push("_No answers recorded yet._", "");
  } else {
    for (const a of session.answers) {
      if (a.skipped) {
        lines.push(`- **${a.questionId}**: _(skipped)_`);
      } else {
        lines.push(`- **${a.questionId}**: ${a.answer}`);
      }
    }
    lines.push("");
  }
  lines.push("## Spec delta", "");
  if (session.specDelta.changes.length === 0) {
    lines.push("_No structured changes derived._", "");
  } else {
    for (const ch of session.specDelta.changes) {
      lines.push(`- \`${ch.op}\` **${String(ch.field)}** (conf ${ch.confidence}): ${JSON.stringify(ch.value)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function writeSessionArtifacts(dir: string, session: InterviewSession): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "interview.json"), `${JSON.stringify(session, null, 2)}\n`);
  await writeFile(join(dir, "spec-delta.json"), `${JSON.stringify(session.specDelta, null, 2)}\n`);
  await writeFile(join(dir, "questions.md"), renderQuestionsMarkdown(session));
  await writeFile(join(dir, "interview-report.md"), renderReportMarkdown(session));
  const answersJsonl = session.answers.map((a) => JSON.stringify(a)).join("\n");
  await writeFile(join(dir, "answers.jsonl"), answersJsonl.length > 0 ? `${answersJsonl}\n` : "");
}

function printSessionSummary(session: InterviewSession, sessionDir: string): void {
  console.log(header("Goal Interview"));
  console.log(label("Session", session.sessionId));
  console.log(label("Mode", session.mode));
  console.log(label("Depth", session.depth));
  console.log(label("Ambiguity", String(session.ambiguity)));
  console.log(label("Completeness", String(session.completeness.overall)));
  console.log(label("Status", session.status));
  console.log(label("Questions", String(session.questions.length)));
  console.log(label("Answers", String(session.answers.length)));
  if (session.completeness.criticalMissing.length > 0) {
    console.log(label("Missing", session.completeness.criticalMissing.join(", ")));
  }
  if (session.completeness.contradictions.length > 0) {
    console.log(style.pink(`Contradictions: ${session.completeness.contradictions.join("; ")}`));
  }
  console.log("");
  if (session.answers.length === 0) {
    console.log(style.purpleBold("Top questions"));
    for (const q of session.questions.slice(0, 6)) {
      const req = q.required ? style.pink("[required]") : style.gray("[optional]");
      console.log(`  ${req} (${q.score}) ${q.prompt}`);
    }
    console.log("");
    console.log(style.gray("Answer via: omk goal interview \"<prompt>\" --answers answers.json --write-spec"));
  }
  console.log(status.success(`interview.json → ${join(sessionDir, "interview.json")}`));
}

export async function goalInterviewCommand(
  input: string | undefined,
  options: GoalInterviewOptions
): Promise<void> {
  printAlphaWarning(options.json);
  const root = getProjectRoot();
  const persister = createGoalPersister(getGoalBasePath());

  const mode = parseMode(options.mode);
  const depth = parseDepth(options.depth);
  const maxQuestions = options.maxQuestions ? Number.parseInt(options.maxQuestions, 10) : undefined;
  if (maxQuestions !== undefined && (!Number.isFinite(maxQuestions) || maxQuestions <= 0)) {
    throw new UsageError(`Invalid --max-questions: ${options.maxQuestions}`);
  }

  // Resolve existing goal for refine mode or when --goal-id / id positional is given.
  const goalIdHint = options.goalId ?? (mode === "refine" ? input : undefined);
  let existingGoal: GoalSpec | null = null;
  if (goalIdHint) {
    existingGoal = await persister.load(goalIdHint);
    if (!existingGoal) {
      const msg = `Goal not found: ${goalIdHint}`;
      emitError(msg, Boolean(options.json));
      throw new NotFoundError(msg);
    }
  }

  const rawPrompt = existingGoal
    ? (existingGoal.rawPrompt || existingGoal.objective || existingGoal.title)
    : (input ?? "");
  if (!rawPrompt.trim()) {
    throw new UsageError("A raw goal prompt or an existing --goal-id is required.");
  }

  // Redact secrets from the prompt before it reaches the session, the GoalSpec,
  // persisted artifacts, or --json output.
  const safePrompt = redactSecretText(rawPrompt);
  const seed: InterviewSeed = {
    rawPrompt: safePrompt,
    riskLevel: existingGoal?.riskLevel,
    goal: existingGoal ?? undefined,
  };

  let session = buildInterviewSession({
    seed,
    mode: existingGoal ? "refine" : mode,
    depth,
    maxQuestions,
    goalId: existingGoal?.goalId,
  });

  if (options.answers) {
    const answers = await loadAnswersFile(root, options.answers);
    session = ingestAnswers(session, seed, answers);
  }

  // Optionally apply the delta to a GoalSpec.
  let savedGoalId: string | undefined = existingGoal?.goalId;
  if (options.writeSpec) {
    let goal: GoalSpec;
    if (existingGoal) {
      const result = applyInterviewDelta(existingGoal, session.specDelta);
      goal = updateGoalStatus(result.goal, result.goal.status, { planRevision: result.goal.planRevision + 1 });
    } else {
      const base = createGoalSpec(safePrompt);
      goal = applyInterviewDelta(base, session.specDelta).goal;
    }
    await persister.save(goal);
    await persister.appendHistory(goal.goalId, {
      at: new Date().toISOString(),
      action: existingGoal ? "interview-refine" : "interview-create",
      detail: {
        sessionId: session.sessionId,
        ambiguity: session.ambiguity,
        completeness: session.completeness.overall,
        changes: session.specDelta.changes.length,
      },
    });
    savedGoalId = goal.goalId;
    session.goalId = goal.goalId;
    session.specDelta.goalId = goal.goalId;
  }

  // Persist interview artifacts. With a goal id, store under the goal dir.
  const sessionDir = savedGoalId
    ? join(getGoalBasePath(), savedGoalId, "interviews", session.sessionId)
    : join(root, ".omk", "interviews", session.sessionId);
  await writeSessionArtifacts(sessionDir, session);

  if (options.json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  printSessionSummary(session, sessionDir);
  if (savedGoalId) {
    console.log(status.success(`goal spec written → ${savedGoalId}`));
    console.log(style.gray(`Next: omk goal plan ${savedGoalId}`));
  }
}

async function findLatestInterviewSessionId(goalDir: string): Promise<string | null> {
  const interviewsDir = join(goalDir, "interviews");
  try {
    const entries = await readdir(interviewsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    return dirs.length > 0 ? dirs[dirs.length - 1] : null;
  } catch {
    return null;
  }
}

export async function goalRefineCommand(goalId: string, options: GoalRefineOptions): Promise<void> {
  printAlphaWarning(options.json);
  const persister = createGoalPersister(getGoalBasePath());
  const goal = await persister.load(goalId);
  if (!goal) {
    const msg = `Goal not found: ${goalId}`;
    emitError(msg, Boolean(options.json));
    throw new NotFoundError(msg);
  }

  const goalDir = join(getGoalBasePath(), goalId);
  const from = options.fromInterview ?? "latest";
  const sessionId = from === "latest" ? await findLatestInterviewSessionId(goalDir) : from;
  if (!sessionId) {
    const msg = `No interview session found for goal: ${goalId}. Run: omk goal interview ${goalId} --mode refine --answers answers.json`;
    emitError(msg, Boolean(options.json));
    throw new NotFoundError(msg);
  }

  const deltaPath = join(goalDir, "interviews", sessionId, "spec-delta.json");
  let delta: InterviewSpecDelta;
  try {
    delta = JSON.parse(await readFile(deltaPath, "utf-8")) as InterviewSpecDelta;
  } catch {
    const msg = `Interview spec-delta not found: ${deltaPath}`;
    emitError(msg, Boolean(options.json));
    throw new NotFoundError(msg);
  }

  const result = applyInterviewDelta(goal, delta);
  const refined = updateGoalStatus(result.goal, result.goal.status, { planRevision: result.goal.planRevision + 1 });
  await persister.save(refined);
  await persister.appendHistory(goalId, {
    at: new Date().toISOString(),
    action: "refine",
    detail: {
      sessionId,
      applied: result.appliedChanges.length,
      skipped: result.skippedChanges.length,
      contradictions: result.contradictions.length,
      planRevision: refined.planRevision,
    },
  });

  if (options.plan) {
    const { goalPlanCommand } = await import("./goal.js");
    await goalPlanCommand(goalId, { json: options.json });
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      goalId,
      sessionId,
      applied: result.appliedChanges.length,
      skipped: result.skippedChanges.length,
      contradictions: result.contradictions,
      planRevision: refined.planRevision,
      status: refined.status,
    }, null, 2));
    return;
  }

  console.log(header("Goal Refined"));
  console.log(label("ID", goalId));
  console.log(label("From interview", sessionId));
  console.log(label("Applied changes", String(result.appliedChanges.length)));
  console.log(label("Skipped changes", String(result.skippedChanges.length)));
  console.log(label("Plan revision", String(refined.planRevision)));
  if (result.contradictions.length > 0) {
    console.log(style.pink(`Contradictions: ${result.contradictions.join("; ")}`));
  }
  console.log(style.gray(`Next: omk goal plan ${goalId}`));
}
