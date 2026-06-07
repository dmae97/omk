import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getProjectRoot, getRunPath, sanitizeRunId } from "../util/fs.js";
import { getOmkResourceSettings, type OmkRuntimeScope } from "../util/resource-profile.js";
import { parseRuntimeScopeOption } from "../util/runtime-scope.js";
import { normalizeGoal, analyzeUserIntent } from "../goal/intake.js";
import { createGoalPersister } from "../goal/persistence.js";
import { evaluateGoalProgressEnsemble } from "../goal/control-loop.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";
import type { ExecutionSelectionDecision, ExecutionStrategy, NextAction, RunState, UserIntent } from "../contracts/orchestration.js";
import {
  buildIntentFrameFromGoal,
  buildNextActionContract,
  renderActionDigest,
} from "../goal/intent-frame.js";
import { style, status } from "../util/theme.js";
import { MemoryStore } from "../memory/memory-store.js";
import type { ParallelCommandOptions } from "../commands/parallel.js";
import type { GoalSpec, IntentFrame } from "../contracts/goal.js";
import { getCurrentMode } from "../util/mode-preset.js";
import { t } from "../util/i18n.js";
import { VerificationError } from "../util/cli-contract.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";
import type { ProviderPolicy } from "../providers/types.js";
import {
  resolveExecutionSelectionDecision,
  resolvePromptExecutionDecision,
} from "../util/execution-selection.js";

export interface OrchestrateOptions {
  runId?: string;
  workers?: string;
  approvalPolicy?: string;
  watch?: boolean;
  view?: string;
  goalId?: string;
  timeoutPreset?: string;
  provider?: ProviderPolicy;
  model?: string;
  mcpScope?: string;
  execution?: string;
  maxAutoContinueIterations?: string | number;
  failOnDagFailure?: boolean;
  sourceCommand: "chat" | "run" | "parallel" | "goal-run" | "goal-continue" | "default";
  signal?: AbortSignal;
}

const DEFAULT_AUTO_CONTINUE_ITERATIONS = 3;
const HARD_MAX_AUTO_CONTINUE_ITERATIONS = 8;

const ADMIN_COMMANDS = new Set([
  "doctor",
  "web-bridge",
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

async function promptForExecutionSelectionIfNeeded(
  decision: ExecutionSelectionDecision
): Promise<ExecutionSelectionDecision> {
  if (decision.strategy !== "prompt") return decision;
  const { select } = await import("@inquirer/prompts");
  const choices: Array<{
    name: string;
    value: Exclude<ExecutionStrategy, "prompt">;
    description: string;
  }> = [
    {
      name: "Parallel agents (Recommended)",
      value: "parallel",
      description: "Split independent lanes across subagents, then synthesize and verify.",
    },
    {
      name: "One by one",
      value: "sequential",
      description: "Run a single-worker sequential DAG/Kimi lane.",
    },
    {
      name: "Plan only",
      value: "plan-only",
      description: "Save the plan and skip execution for now.",
    },
  ];
  const strategy = await select(
    {
      message: "이 작업은 병렬 처리에 적합합니다. Parallel agents로 나눌까요, one by one으로 진행할까요?",
      choices,
    },
    { signal: AbortSignal.timeout(120_000) }
  );
  return resolvePromptExecutionDecision(decision, strategy);
}

function annotatePromptForExecutionDecision(
  prompt: string,
  decision: ExecutionSelectionDecision
): string {
  const selectedLine = `- Selected execution strategy: ${decision.strategy} (${decision.reason})`;
  let updated = prompt.includes("- Selected execution strategy:")
    ? prompt.replace(/- Selected execution strategy:.*\n/, `${selectedLine}\n`)
    : prompt.replace(
      "- Execution mode: selected before execution (parallel agents, one-by-one, or plan-only)\n",
      `- Execution mode: selected before execution (parallel agents, one-by-one, or plan-only)\n${selectedLine}\n`
    );

  if (decision.strategy === "sequential") {
    updated = updated
      .replace(
        "4. **worker-N** – execute scoped sub-tasks in parallel",
        "4. **worker-1** – execute scoped tasks one by one without parallel fanout"
      )
      .replace(
        "Based on the intent analysis above, assign workers to these roles:",
        "Based on the intent analysis above, sequence these roles through one provider-neutral worker lane:"
      );
    updated += [
      "",
      "### Sequential Execution Override",
      "- Do not spawn parallel subagents, DeepSeek model lanes, or capability fanout lanes.",
      "- Execute discovery, planning, implementation, review, and QA one by one in a single lane.",
      "",
    ].join("\n");
  } else if (decision.strategy === "parallel") {
    updated += [
      "",
      "### Parallel Execution Selection",
      "- Root orchestrator must assign bounded explorer/planner/coder/reviewer/qa lanes and add security only when risk is detected.",
      "- Record each lane's skills, hooks, and MCP servers in the run harness/evidence.",
      "",
    ].join("\n");
  }

  return updated;
}

export async function orchestratePrompt(
  rawPrompt: string,
  options: OrchestrateOptions
): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const mcpScope = parseRuntimeScopeOption(options.mcpScope, resources.mcpScope, "--mcp-scope");

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

  const intentFrame = goal.intentFrame ?? buildIntentFrameFromGoal(goal);
  if (!goal.intentFrame || !goal.actionAtoms) {
    goal = { ...goal, intentFrame, actionAtoms: intentFrame.actionAtoms, updatedAt: new Date().toISOString() };
    await goalPersister.save(goal);
  }
  goalId = goalId ?? goal.goalId;
  const goalDir = join(goalBasePath, goalId);
  await mkdir(goalDir, { recursive: true });
  await writeFile(join(goalDir, "intent-frame.json"), `${JSON.stringify(intentFrame, null, 2)}\n`);
  await writeFile(join(goalDir, "action-atoms.json"), `${JSON.stringify(intentFrame.actionAtoms, null, 2)}\n`);

  // ── NLP Intent Analysis ──
  const intent = analyzeUserIntent(rawPrompt);
  let executionDecision = resolveExecutionSelectionDecision({
    cliValue: options.execution,
    configValue: resources.executionPrompt,
    intent,
    isTTY: Boolean(process.stdout.isTTY && process.stdin.isTTY),
  });

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
    mcpScope,
    intent,
    intentFrame,
    currentPrompt: rawPrompt,
    isContinuation: options.sourceCommand === "goal-continue",
  });

  // ── Persist next-prompt to goal directory ──
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
      mcpScope,
      execution: options.execution,
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

  executionDecision = await promptForExecutionSelectionIfNeeded(executionDecision);
  await writeFile(join(goalDir, "execution-selection.json"), `${JSON.stringify(executionDecision, null, 2)}\n`);
  if (executionDecision.strategy === "plan-only") {
    await writeFile(join(goalDir, "next-prompt.md"), annotatePromptForExecutionDecision(enrichedPrompt, executionDecision));
    console.log(status.ok(`Plan saved to: ${join(goalDir, "next-prompt.md")}`));
    console.log(style.gray("Execution skipped by selection: plan-only."));
    return;
  }
  const executionPromptForRun = annotatePromptForExecutionDecision(enrichedPrompt, executionDecision);
  await writeFile(join(goalDir, "next-prompt.md"), executionPromptForRun);

  if (currentMode === "debugging") {
    console.log(style.purpleBold("🐛 Debugging mode — focused on reproduction, root-cause, and minimal fix"));
  } else if (currentMode === "review") {
    console.log(style.purpleBold("🔍 Review mode — focused on audit, security scan, and quality assessment"));
  } else if (currentMode === "agent") {
    console.log(style.purpleBold("🤖 Agent mode — full orchestration"));
  }

  // ── Execute via selected strategy ──
  const { parallelCommand } = await import("../commands/parallel.js");
  const selectedWorkers = executionDecision.strategy === "sequential"
    ? "1"
    : options.workers ?? String(resources.maxWorkers);
  const selectedProvider = executionDecision.strategy === "sequential"
    ? options.provider ?? "auto"
    : options.provider;
  const parallelOpts: ParallelCommandOptions = {
    workers: selectedWorkers,
    runId: options.runId,
    approvalPolicy: options.approvalPolicy ?? "interactive",
    watch: options.watch,
    view: options.view ?? "cockpit",
    goalId,
    intent,
    timeoutPreset: options.timeoutPreset,
    provider: selectedProvider,
    model: options.model,
    mcpScope,
    intentFrame,
    execution: executionDecision.policy,
    executionStrategy: executionDecision.strategy,
    executionDecision,
    orchestrationPrompt: executionPromptForRun,
    signal: options.signal,
  };

  const { runId: generatedRunId, success: dagSucceeded } = await parallelCommand(executionPromptForRun, parallelOpts);
  const effectiveRunId = generatedRunId;

  // Persist runId on goal so goal continue/verify can locate the latest run
  if (!goal.runIds.includes(effectiveRunId)) {
    goal = { ...goal, runIds: [...goal.runIds, effectiveRunId], updatedAt: new Date().toISOString() };
    await goalPersister.save(goal);
  }

  if (!dagSucceeded) {
    goal = { ...goal, status: "failed", updatedAt: new Date().toISOString() };
    await goalPersister.save(goal);
    if (options.failOnDagFailure) {
      throw new VerificationError(`Parallel DAG run failed: ${effectiveRunId}`, [`runId: ${effectiveRunId}`]);
    }
    return;
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
      if (options.signal?.aborted) {
        console.log(style.gray("Orchestration aborted by signal during auto-continue loop."));
        break;
      }
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

      // Record ensemble-decision in unified decision trace store
      const traceStore = createDecisionTraceStore();
      traceStore.record(currentRunId, {
        component: "ensemble-decision",
        inputSummary: `iteration=${iteration} goalId=${goalId} runId=${currentRunId}`,
        outputDecision: `action=${progress.nextAction} confidence=${progress.ensemble.confidence.toFixed(2)}`,
        reason: progress.ensemble.rationale,
        scores: {
          confidence: progress.ensemble.confidence,
          candidateCount: progress.ensemble.candidateVotes?.length ?? 0,
        },
      });

      await writeFile(
        join(goalDir, "ensemble-decision.json"),
        JSON.stringify(decision, null, 2)
      );
      await writeFile(
        join(goalDir, "ensemble-decisions.json"),
        JSON.stringify(decisionHistory, null, 2)
      );
      if (progress.noveltyReport) {
        await writeFile(join(goalDir, "novelty-report.json"), `${JSON.stringify(progress.noveltyReport, null, 2)}\n`);
      }

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
        if (options.failOnDagFailure) {
          throw new VerificationError(`Goal blocked after run: ${currentRunId}`, [`runId: ${currentRunId}`]);
        }
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
        mcpScope,
        intent,
        intentFrame,
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
        signal: options.signal,
      });
      currentRunId = followUp.runId;
      await rememberRunId(currentRunId);
      if (!followUp.success) {
        goal = { ...goal, status: "failed", updatedAt: new Date().toISOString() };
        await goalPersister.save(goal);
        if (options.failOnDagFailure) {
          throw new VerificationError(`Parallel DAG run failed: ${currentRunId}`, [`runId: ${currentRunId}`]);
        }
        return;
      }
    }
  } catch (err) {
    if (options.failOnDagFailure && err instanceof VerificationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error(style.gray(`[orchestrate] ensemble decision skipped: ${message}`));
  }
}

interface BuildPromptInput {
  goal: GoalSpec;
  memorySummary: string;
  sourceCommand: string;
  workers: string;
  mcpScope?: OmkRuntimeScope;
  intent: UserIntent;
  intentFrame?: IntentFrame;
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
  const mcpScope = input.mcpScope ?? "project";
  const intentFrame = input.intentFrame ?? buildIntentFrameFromGoal(input.goal);
  const contractAtom = input.autoContinue?.action === "replan"
    ? intentFrame.actionAtoms.find((atom) => atom.label.startsWith("plan-"))
    : intentFrame.actionAtoms.find((atom) =>
      ["implement-change", "inspect-context", "test-scenario", "document-result", "produce-artifact", "verify-evidence"].includes(atom.label)
    );
  const actionContract = buildNextActionContract(
    input.autoContinue?.action ?? "continue",
    contractAtom?.id ?? intentFrame.actionAtoms[0]?.id ?? "atom-plan",
    contractAtom?.doneCondition ?? "Execute the next evidence-backed action",
    intentFrame
  );
  const hasDistinctContinuationContext = input.isContinuation &&
    currentPrompt.length > 0 &&
    normalizePromptForComparison(currentPrompt) !== normalizePromptForComparison(input.goal.objective);

  const lines: string[] = [
    `# OMK Orchestration Prompt: strict-action-dag`,
    ``,
    `## OMK Prompt Adapter`,
    `- Treat the original user input as intent/NLP source, not text to echo back.`,
    `- Convert that intent into a provider-neutral OMK execution contract: inspect, plan, edit, verify, and report evidence.`,
    `- The configured OMK authority provider owns orchestration, merge decisions, tool/MCP routing, and final synthesis.`,
    `- Continue automatically while evidence says action=continue/replan and stop only on close/block/handoff/max-iteration guard.`,
    ``,
    `## Source NLP Intake`,
    `- Source command: ${input.sourceCommand}`,
    `- Continuation: ${input.isContinuation ? "yes" : "no"}`,
    `- Workers requested: ${input.workers}`,
    `- MCP scope: ${mcpScope}`,
    ``,
    `## Strict Intent / Action Digest`,
    renderActionDigest(intentFrame),
    ``,
    `## Next Action Contract`,
    `- Action: ${actionContract.action}`,
    `- Target: ${actionContract.targetId}`,
    `- Description: ${actionContract.description}`,
    `- Evidence target: ${actionContract.evidenceTarget}`,
    `- Done condition: ${actionContract.doneCondition}`,
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
      `OMK must treat this section as the operative follow-up context for this turn.`,
      `Do not restart by sending the original goal verbatim; infer the next concrete action from this context, memory, and evidence.`,
      `Preserve completed work and focus the DAG on unresolved criteria, failed gates, or blocked nodes.`,
      ``,
      renderPromptDigest("Current execution context digest", currentPrompt, { maxKeywords: 18, maxPhrases: 3 }),
      ``,
      `### Current follow-up context`,
      `- Full follow-up text is audit-only; execution uses the digest and ActionAtom contract above.`,
      `- Selected atom: ${actionContract.actionAtom?.label ?? actionContract.targetId}`,
      `- Evidence target: ${actionContract.evidenceTarget}`,
      `- Done condition: ${actionContract.doneCondition}`,
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
    `- MCP scope: ${mcpScope}`,
    `- Execution mode: selected before execution (parallel agents, one-by-one, or plan-only)`,
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
    mcpScope === "none"
      ? `- MCP scope is none: do not launch MCP servers in this DAG; rely on local tools plus skills/hooks.`
      : mcpScope === "project"
        ? `- MCP scope is project: use only project-local/builtin MCP servers such as omk-project; do not load global MCP inventory.`
        : `- MCP scope is all: global MCP servers may be available; never expose raw env, tokens, or config.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations when MCP is enabled.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`,
    `- The configured OMK authority provider remains the main orchestrator, planner, merger, and final synthesis runtime.`,
    `- DeepSeek may only be hinted for low-risk read/review/QA/documentation nodes; never assign it merge, destructive shell, MCP, secret, or write authority.`,
    `- If provider availability, payment, rate limit, or confidence is uncertain, keep the node on the configured authority provider and continue without blocking the DAG.`,
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
