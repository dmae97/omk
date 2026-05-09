import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getProjectRoot, getRunPath, sanitizeRunId } from "../util/fs.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { normalizeGoal, analyzeUserIntent } from "../goal/intake.js";
import { createGoalPersister } from "../goal/persistence.js";
import { evaluateGoalProgressEnsemble } from "../goal/control-loop.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";
import type { NextAction, RunState, UserIntent } from "../contracts/orchestration.js";
import { style, status } from "../util/theme.js";
import { MemoryStore } from "../memory/memory-store.js";
import type { ParallelCommandOptions } from "../commands/parallel.js";
import type { GoalSpec } from "../contracts/goal.js";
import { getCurrentMode } from "../util/mode-preset.js";
import { t } from "../util/i18n.js";

export interface OrchestrateOptions {
  runId?: string;
  workers?: string;
  approvalPolicy?: string;
  watch?: boolean;
  view?: string;
  goalId?: string;
  timeoutPreset?: string;
  provider?: "auto" | "kimi";
  maxAutoContinueIterations?: string | number;
  sourceCommand: "chat" | "run" | "parallel" | "goal-run" | "goal-continue" | "default";
}

const DEFAULT_AUTO_CONTINUE_ITERATIONS = 3;
const HARD_MAX_AUTO_CONTINUE_ITERATIONS = 8;

const ADMIN_COMMANDS = new Set([
  "doctor",
  "init",
  "hud",
  "sync",
  "merge",
  "verify",
  "design",
  "lsp",
  "mcp",
  "skill",
  "star",
  "agent",
  "summary",
  "index",
  "snip",
  "specify",
  "spec",
  "dag",
  "cockpit",
  "plan",
  "feature",
  "bugfix",
  "refactor",
  "review",
  "team",
  "google",
  "workflow",
  "goal list",
  "goal show",
  "goal plan",
  "goal verify",
  "goal close",
  "goal block",
]);

function looksLikeAdminCommand(rawPrompt: string): boolean {
  const first = rawPrompt.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const firstTwo = rawPrompt
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .toLowerCase();
  return ADMIN_COMMANDS.has(first) || ADMIN_COMMANDS.has(firstTwo);
}

export function resolveAutoContinueMaxIterations(value: string | number | undefined): number {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_AUTO_CONTINUE_ITERATIONS;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) return 0;
  const parsed = Math.floor(Number(normalized));
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_AUTO_CONTINUE_ITERATIONS;
  return Math.min(parsed, HARD_MAX_AUTO_CONTINUE_ITERATIONS);
}

export function buildAutoContinueRunId(baseRunId: string, iteration: number, now = new Date()): string {
  const base = sanitizeRunId(baseRunId || "parallel", "parallel").slice(0, 80);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return sanitizeRunId(`${base}-auto-${iteration}-${stamp}`, "parallel-auto");
}

function shouldAutoContinue(action: NextAction, prompt: string | undefined): boolean {
  return (action === "continue" || action === "replan") && Boolean(prompt?.trim());
}

export async function orchestratePrompt(
  rawPrompt: string,
  options: OrchestrateOptions
): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();

  if (looksLikeAdminCommand(rawPrompt)) {
    throw new Error(
      `Admin commands must be routed through the CLI. ` +
      `Use the top-level CLI command instead: omk ${rawPrompt.trim().split(/\s+/)[0]}`
    );
  }

  // ── Intake: normalize goal + analyze intent from raw prompt ──
  const goalBasePath = join(root, ".omk", "goals");
  await mkdir(goalBasePath, { recursive: true });
  const goalPersister = createGoalPersister(goalBasePath);

  let goal: GoalSpec;
  let goalId: string | undefined = options.goalId;

  if (goalId) {
    const existing = await goalPersister.load(goalId);
    if (existing) {
      goal = existing;
    } else {
      goal = normalizeGoal({ rawPrompt });
      await goalPersister.save(goal);
      goalId = goal.goalId;
    }
  } else {
    goal = normalizeGoal({ rawPrompt });
    await goalPersister.save(goal);
    goalId = goal.goalId;
  }

  // ── NLP Intent Analysis ──
  const intent = analyzeUserIntent(rawPrompt);

  // ── Memory recall: load relevant project context ──
  const memoryStore = new MemoryStore(join(root, ".omk", "memory"), {
    projectRoot: root,
    source: "orchestrate-prompt",
  });

  let memorySummary = "";
  try {
    const mindmap = await memoryStore.mindmap(goal.title, 40);
    if (mindmap && mindmap.nodes.length > 0) {
      const relevant = mindmap.nodes
        .filter((n) => n.type === "Goal" || n.type === "Task" || n.type === "Decision" || n.type === "Evidence")
        .slice(0, 10)
        .map((n) => `- ${n.label} (${n.type})`)
        .join("\n");
      memorySummary = relevant;
    }
  } catch {
    // ignore memory recall failures
  }

  if (!memorySummary) {
    try {
      const searchResults = await memoryStore.search(goal.title, 10);
      if (searchResults.length > 0) {
        memorySummary = searchResults
          .slice(0, 5)
          .map((r) => `- ${r.path}: ${r.content.slice(0, 120)}`)
          .join("\n");
      }
    } catch {
      // ignore
    }
  }

  // ── Build enriched prompt ──
  const enrichedPrompt = buildOrchestratedPrompt({
    goal,
    memorySummary,
    sourceCommand: options.sourceCommand,
    workers: options.workers ?? String(resources.maxWorkers),
    intent,
    currentPrompt: rawPrompt,
    isContinuation: options.sourceCommand === "goal-run" || options.sourceCommand === "goal-continue",
  });

  // ── Persist next-prompt to goal directory ──
  const goalDir = join(goalBasePath, goalId);
  await mkdir(goalDir, { recursive: true });
  await writeFile(join(goalDir, "next-prompt.md"), enrichedPrompt);

  // ── Mode-aware execution ──
  const currentMode = await getCurrentMode();

  if (currentMode === "chat") {
    // Chat mode: skip orchestration, go straight to interactive chat
    console.log(style.purpleBold("💬 Chat mode — starting interactive session"));
    const { chatCommand } = await import("../commands/chat.js");
    await chatCommand({
      runId: goalId,
      workers: options.workers,
    });
    return;
  }

  if (currentMode === "plan") {
    // Plan mode: save enriched prompt and wait for approval
    console.log(style.purpleBold("📐 Plan mode — review the generated plan"));
    console.log("");
    console.log(enrichedPrompt);
    console.log("");
    console.log(status.ok(`Plan saved to: ${join(goalDir, "next-prompt.md")}`));

    if (process.stdout.isTTY && process.stdin.isTTY) {
      const { select } = await import("@inquirer/prompts");
      const approve = await select(
        {
          message: t("mode.planApprovePrompt"),
          choices: [
            { name: "Yes — execute now", value: "yes" },
            { name: "No — save and exit", value: "no" },
          ],
        },
        { signal: AbortSignal.timeout(60_000) }
      );
      if (approve !== "yes") {
        console.log(status.ok(t("mode.planSkipped")));
        return;
      }
      console.log(status.ok(t("mode.planApproved")));
    } else {
      console.log(style.gray("Non-TTY: plan saved. Run with 'omk run' or 'omk parallel' to execute."));
      return;
    }
  }

  if (currentMode === "debugging") {
    console.log(style.purpleBold("🐛 Debugging mode — focused on reproduction, root-cause, and minimal fix"));
  } else if (currentMode === "review") {
    console.log(style.purpleBold("🔍 Review mode — focused on audit, security scan, and quality assessment"));
  } else if (currentMode === "agent") {
    console.log(style.purpleBold("🤖 Agent mode — full orchestration"));
  }

  // ── Always execute via parallel DAG (default + approved plan) ──
  const { parallelCommand } = await import("../commands/parallel.js");
  const parallelOpts: ParallelCommandOptions = {
    workers: options.workers ?? String(resources.maxWorkers),
    runId: options.runId,
    approvalPolicy: options.approvalPolicy ?? "interactive",
    watch: options.watch ?? true,
    view: options.view ?? "cockpit",
    goalId,
    intent,
    timeoutPreset: options.timeoutPreset,
    provider: options.provider,
  };

  const { runId: generatedRunId } = await parallelCommand(enrichedPrompt, parallelOpts);
  const effectiveRunId = generatedRunId;

  // Persist runId on goal so goal continue/verify can locate the latest run
  if (!goal.runIds.includes(effectiveRunId)) {
    goal = { ...goal, runIds: [...goal.runIds, effectiveRunId], updatedAt: new Date().toISOString() };
    await goalPersister.save(goal);
  }

  // ── Ensemble auto-decision: evaluate progress and auto-continue/replan/close ──
  const { readFile } = await import("fs/promises");
  const maxAutoContinueIterations = resolveAutoContinueMaxIterations(
    options.maxAutoContinueIterations ?? process.env.OMK_AUTO_CONTINUE_MAX_ITERATIONS
  );
  const decisionHistory: Array<{
    iteration: number;
    runId: string;
    action: NextAction;
    confidence: number;
    rationale: string;
    candidateVotes: unknown;
    timestamp: string;
  }> = [];
  const rememberRunId = async (runId: string): Promise<void> => {
    if (!goal.runIds.includes(runId)) {
      goal = { ...goal, runIds: [...goal.runIds, runId], updatedAt: new Date().toISOString() };
      await goalPersister.save(goal);
    }
  };

  let currentRunId = effectiveRunId;
  try {
    for (let iteration = 0; iteration <= maxAutoContinueIterations; iteration += 1) {
      const runStatePath = getRunPath(currentRunId, "state.json", root);
      const stateRaw = await readFile(runStatePath, "utf-8");
      const runState = JSON.parse(stateRaw) as RunState;
      const progress = await evaluateGoalProgressEnsemble(goal, runState, {
        iterationCount: iteration,
        maxIterations: maxAutoContinueIterations,
      });
      const decision = {
        iteration,
        runId: currentRunId,
        action: progress.nextAction,
        confidence: progress.ensemble.confidence,
        rationale: progress.ensemble.rationale,
        candidateVotes: progress.ensemble.candidateVotes,
        timestamp: new Date().toISOString(),
      };
      decisionHistory.push(decision);

      await writeFile(
        join(goalDir, "ensemble-decision.json"),
        JSON.stringify(decision, null, 2)
      );
      await writeFile(
        join(goalDir, "ensemble-decisions.json"),
        JSON.stringify(decisionHistory, null, 2)
      );

      if (progress.nextAction === "close") {
        console.log(status.ok("Ensemble decision: goal complete — closing run"));
        goal = { ...goal, status: "done", updatedAt: new Date().toISOString() };
        await goalPersister.save(goal);
        return;
      }

      if (progress.nextAction === "block") {
        console.log(status.error("Ensemble decision: run blocked — manual intervention required"));
        console.log(style.gray(progress.ensemble.rationale));
        goal = { ...goal, status: "blocked", updatedAt: new Date().toISOString() };
        await goalPersister.save(goal);
        return;
      }

      const autoPrompt = progress.ensemble.nextPrompt;
      if (!shouldAutoContinue(progress.nextAction, autoPrompt)) {
        if (progress.nextAction === "handoff") {
          console.log(style.gray("Ensemble decision: handoff — auto-continue stopped."));
        }
        return;
      }

      if (iteration >= maxAutoContinueIterations) {
        console.log(style.gray(`Auto-continue guard reached (${maxAutoContinueIterations}); stopping with handoff.`));
        await writeFile(
          join(goalDir, "ensemble-decision.json"),
          JSON.stringify(
            {
              ...decision,
              action: "handoff",
              reason: "max-auto-continue-iterations-reached",
            },
            null,
            2
          )
        );
        return;
      }

      const nextIteration = iteration + 1;
      const followUpPrompt = buildOrchestratedPrompt({
        goal,
        memorySummary,
        sourceCommand: "goal-continue",
        workers: options.workers ?? String(resources.maxWorkers),
        intent,
        currentPrompt: autoPrompt ?? "",
        isContinuation: true,
        autoContinue: {
          iteration: nextIteration,
          maxIterations: maxAutoContinueIterations,
          action: progress.nextAction,
          previousRunId: currentRunId,
        },
      });
      const actionLabel = progress.nextAction === "replan" ? "🔄 Replanning" : "➡️ Continuing";
      console.log(style.purpleBold(`${actionLabel} iteration ${nextIteration}/${maxAutoContinueIterations} (confidence=${progress.ensemble.confidence.toFixed(2)})`));
      await writeFile(join(goalDir, "next-prompt.md"), followUpPrompt);
      const followUp = await parallelCommand(followUpPrompt, {
        ...parallelOpts,
        runId: buildAutoContinueRunId(effectiveRunId, nextIteration),
        goalId,
      });
      currentRunId = followUp.runId;
      await rememberRunId(currentRunId);
    }
  } catch (err) {
    // If ensemble evaluation fails, silently continue (do not block the user)
    const message = err instanceof Error ? err.message : String(err);
    console.error(style.gray(`[orchestrate] ensemble decision skipped: ${message}`));
  }
}

interface BuildPromptInput {
  goal: GoalSpec;
  memorySummary: string;
  sourceCommand: string;
  workers: string;
  intent: UserIntent;
  currentPrompt: string;
  isContinuation: boolean;
  autoContinue?: {
    iteration: number;
    maxIterations: number;
    action: NextAction;
    previousRunId: string;
  };
}

export function buildOrchestratedPrompt(input: BuildPromptInput): string {
  const currentPrompt = input.currentPrompt.trim();
  const hasDistinctContinuationContext = input.isContinuation &&
    currentPrompt.length > 0 &&
    normalizePromptForComparison(currentPrompt) !== normalizePromptForComparison(input.goal.objective);

  const lines: string[] = [
    `# Kimi Orchestration Prompt: ${input.goal.title}`,
    ``,
    `## Kimi Prompt Adapter`,
    `- Treat the original user input as intent/NLP source, not text to echo back.`,
    `- Convert that intent into a Kimi-native execution contract: inspect, plan, edit, verify, and report evidence.`,
    `- Kimi owns orchestration, merge decisions, tool/MCP routing, and final synthesis.`,
    `- Continue automatically while evidence says action=continue/replan and stop only on close/block/handoff/max-iteration guard.`,
    ``,
    `## Source NLP Intake`,
    `- Source command: ${input.sourceCommand}`,
    `- Continuation: ${input.isContinuation ? "yes" : "no"}`,
    `- Workers requested: ${input.workers}`,
    ``,
    `## Goal Reference (non-verbatim)`,
    renderPromptDigest("Original objective digest", input.goal.objective),
    ``,
    `## Success Criteria`,
    ...input.goal.successCriteria.map((c) => `- [${c.requirement === "required" ? "required" : "optional"}] ${c.description}`),
    ``,
  ];

  if (hasDistinctContinuationContext) {
    lines.push(
      `## Current Execution Context`,
      `Kimi must treat this section as the operative follow-up context for this turn.`,
      `Do not restart by sending the original goal verbatim; infer the next concrete action from this context, memory, and evidence.`,
      `Preserve completed work and focus the DAG on unresolved criteria, failed gates, or blocked nodes.`,
      ``,
      renderPromptDigest("Current execution context digest", currentPrompt, { maxKeywords: 18, maxPhrases: 3 }),
      ``,
      ...renderBoundedContext("Current follow-up context", currentPrompt),
      ``
    );
  }

  if (input.autoContinue) {
    lines.push(
      `## Auto-Continue Loop`,
      `- Iteration: ${input.autoContinue.iteration}/${input.autoContinue.maxIterations}`,
      `- Previous run: ${input.autoContinue.previousRunId}`,
      `- Ensemble action: ${input.autoContinue.action}`,
      `- Re-evaluate after this DAG run; do not ask the user to continue unless blocked, destructive, or max iterations are reached.`,
      ``
    );
  }

  if (input.memorySummary) {
    lines.push(
      `## Memory Recall`,
      `Relevant project context from graph memory:`,
      input.memorySummary,
      ``
    );
  }

  const intent = input.intent;
  lines.push(
    `## Intent Analysis`,
    `- Task type: ${intent.taskType}`,
    `- Complexity: ${intent.complexity}`,
    `- Estimated workers: ${intent.estimatedWorkers}`,
    `- Required roles: ${intent.requiredRoles.join(", ")}`,
    `- Read-only: ${intent.isReadOnly}`,
    `- Needs research: ${intent.needsResearch}`,
    `- Needs security review: ${intent.needsSecurityReview}`,
    `- Needs testing: ${intent.needsTesting}`,
    `- Needs design review: ${intent.needsDesignReview}`,
    `- Parallelizable: ${intent.parallelizable}`,
    `- Rationale: ${intent.rationale}`,
    ``,
    `## Orchestration Instructions`,
    `- Source command: ${input.sourceCommand}`,
    `- Workers: ${input.workers}`,
    `- Execution mode: parallel DAG (always)`,
    ``,
    `### DAG Structure (minimum)`,
    `1. **intake** – parse and validate the goal`,
    `2. **memory-recall** – load relevant project context via omk_search_memory / omk_memory_mindmap`,
    `3. **coordinator** – plan decomposition and assign worker scopes`,
    `4. **worker-N** – execute scoped sub-tasks in parallel`,
    `5. **reviewer** – verify outputs, check evidence gates, merge results`,
    `6. **quality/evidence** – run quality gates and collect evidence`,
    `7. **memory-writeback** – write decisions, risks, and completion state to .omk/memory/`,
    ``,
    `### Dynamic Role Assignment`,
    `Based on the intent analysis above, assign workers to these roles:`,
    ...intent.requiredRoles.map((role, i) => `  - ${i + 1}. **${role}** – scoped to the task type (${intent.taskType})`),
    ``,
    `### Mandatory Rules`,
    `- Before planning, the coordinator MUST call omk_memory_mindmap or omk_search_memory to load relevant project context.`,
    `- Workers MUST only use skills and MCP servers relevant to their assigned role (routing hints).`,
    `- Use MCP servers (omk-project, memory, quality-gate) when they fit the task.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`,
    `- Kimi remains the main orchestrator, planner, merger, and final synthesis runtime.`,
    `- DeepSeek may only be hinted for low-risk read/review/QA/documentation nodes; never assign it merge, destructive shell, MCP, secret, or write authority.`,
    `- If provider availability, payment, rate limit, or confidence is uncertain, keep the node on Kimi and continue without blocking the DAG.`,
    `- Produce concrete evidence, changed files, and verification results.`,
    `- Write final decisions and risks to .omk/memory/decisions.md and .omk/memory/risks.md.`,
    ``,
    `### Continue Engine`,
    `If this is a continuation, synthesize a fresh next prompt from Current Execution Context instead of repeating the goal objective.`,
    `Do not redo completed work unless the evidence is invalid or stale.`,
    `Focus on missing success criteria, failed evidence gates, and the highest-confidence next action.`,
    `Re-select worker roles and MCP/skills based on the remaining work.`,
  );

  return lines.join("\n");
}

function normalizePromptForComparison(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function renderBoundedContext(title: string, value: string, maxChars = 6000): string[] {
  const sanitized = value.replace(/```/g, "'''").trim();
  const clipped = sanitized.length > maxChars
    ? `${sanitized.slice(0, maxChars)}\n...[truncated ${sanitized.length - maxChars} chars]`
    : sanitized;
  return [`### ${title}`, "```text", clipped, "```"];
}
