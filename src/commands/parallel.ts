import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import readline from "readline";

import { getOmkPath, getProjectRoot, getRunPath, sanitizeRunId } from "../util/fs.js";
import { style, header, status, label, kimicatCliHero, bullet } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings, type OmkRuntimeScope, getActiveRuntimePreset } from "../util/resource-profile.js";
import { parseRuntimeScopeOption } from "../util/runtime-scope.js";
import { createRoutedRunState, createDagFromRunState, refreshRunStateEstimate, routeRunState } from "../orchestration/run-state.js";
import { createExecutor } from "../orchestration/executor.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { buildCapabilityAgentNodes, isCapabilityAgentNode } from "../orchestration/capability-agents.js";

import { ParallelLiveRenderer, renderCompactParallelFrame, type ParallelViewMode } from "../orchestration/parallel-ui.js";
import { formatOmkVersionFooter } from "../util/version.js";
import { UsageError } from "../util/cli-contract.js";
import { captureTerminalInputState, restoreTerminalInputState } from "../util/terminal-input.js";
import { writeMemoryRecallSummary } from "../util/chat-startup.js";
import {
  createProviderBackedTaskRunner,
  type ProviderPolicy,
} from "../providers/index.js";
import { normalizeProviderPolicy, parseProviderModelArg } from "../providers/model-registry.js";
import { DEFAULT_FALLBACK_PROVIDER, type DeepSeekModelTier } from "../providers/types.js";
import { SUPER_OMK_DEFAULTS, isSuperOmkEnabled } from "../providers/deepseek/deepseek-super-config.js";
import {
  EXECUTION_PROMPT_CHOICES,
  parseExecutionPromptPolicy,
  resolveExecutionSelectionDecision,
  resolvePromptExecutionDecision,
} from "../util/execution-selection.js";
import { analyzeUserIntent } from "../goal/intake.js";
import type { IntentFrame } from "../contracts/goal.js";
import type { ExecutionPromptPolicy, ExecutionSelectionDecision, ExecutionStrategy, RunState, UserIntent } from "../contracts/orchestration.js";
import type { Dag, DagNodeDefinition } from "../orchestration/dag.js";
import {
  actionAtomRouting,
  buildIntentFrame,
  makeActionAtom,
  renderActionDigest,
} from "../goal/intent-frame.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";

export interface ParallelCommandOptions {
  workers?: string;
  runId?: string;
  approvalPolicy?: string;
  watch?: boolean;
  noWatch?: boolean;
  view?: string;
  chat?: boolean;
  fromSpec?: string;
  alternateScreen?: boolean;
  noPause?: boolean;
  compact?: boolean;
  goalId?: string;
  timeoutPreset?: string;
  provider?: ProviderPolicy;
  model?: string;
  mcpScope?: string;
  execution?: string;
  executionStrategy?: ExecutionStrategy;
  executionDecision?: ExecutionSelectionDecision;
  intentFrame?: IntentFrame;
  /** Analyzed user intent for dynamic DAG construction and role routing. */
  intent?: UserIntent;
  signal?: AbortSignal;
}

export async function parallelCommand(
  goal: string | undefined,
  options: ParallelCommandOptions = {}
): Promise<{ runId: string; success: boolean }> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const modelArg = parseProviderModelArg(options.model);
  const requestedProviderPolicy = normalizeProviderPolicy(options.provider ?? modelArg.provider);
  const mcpScope = parseRuntimeScopeOption(options.mcpScope, resources.mcpScope, "--mcp-scope");
  const requestedExecutionPrompt = parseExecutionPromptPolicy(options.execution, "--execution");

  const hasFromSpec = Boolean(options.fromSpec);

  if (!goal && !hasFromSpec) {
    throw new UsageError(t("parallel.goalRequired"));
  }

  const approvalPolicy = normalizeApprovalPolicy(options.approvalPolicy, resources.profile);
  const runId = sanitizeRunId(options.runId ?? new Date().toISOString().replace(/[:.]/g, "-"), "parallel");
  const sanitized = runId;
  const runDir = getRunPath(sanitized);
  const startedAt = new Date().toISOString();

  await mkdir(runDir, { recursive: true });

  let runState: RunState;
  let effectiveGoal = goal ?? "";
  let intentFrame: IntentFrame | undefined = options.intentFrame;

  let goalId: string | undefined;
  let goalSnapshot: RunState["goalSnapshot"] | undefined;
  if (options.goalId) {
    const { createGoalPersister } = await import("../goal/persistence.js");
    const goalPersister = createGoalPersister(join(root, ".omk", "goals"));
    const goalSpec = await goalPersister.load(options.goalId);
    if (goalSpec) {
      goalId = goalSpec.goalId;
      goalSnapshot = {
        title: goalSpec.title,
        objective: goalSpec.objective,
        successCriteria: goalSpec.successCriteria.map((c) => ({
          id: c.id,
          description: c.description,
          requirement: c.requirement,
        })),
      };
      if (!effectiveGoal) {
        effectiveGoal = goalSpec.objective;
      }
      intentFrame = goalSpec.intentFrame ?? buildIntentFrame(goalSpec.rawPrompt || goalSpec.objective || goalSpec.title, {
        constraints: goalSpec.constraints.map((constraint) => constraint.description),
        successCriteria: goalSpec.successCriteria.map((criterion) => criterion.description),
        expectedArtifacts: goalSpec.expectedArtifacts,
      });
    }
  }

  let specNodes: DagNodeDefinition[] | undefined;
  if (hasFromSpec) {
    const { loadSpecDag } = await import("./dag-from-spec.js");
    const specDag = await loadSpecDag(options.fromSpec!, { parallel: true });
    effectiveGoal = goal ?? `spec: ${specDag.nodes[0]?.name ?? options.fromSpec!}`;
    intentFrame = buildIntentFrame(effectiveGoal);

    specNodes = specDag.nodes.map((node) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { status, retries, ...def } = node;
      return def;
    });
  } else {
    intentFrame = intentFrame ?? buildIntentFrame(effectiveGoal);
  }

  const resolvedIntent = options.intent ?? analyzeUserIntent(effectiveGoal);
  const executionDecision = options.executionDecision ?? await resolveParallelCommandExecutionDecision({
    requestedPolicy: requestedExecutionPrompt,
    configPolicy: resources.executionPrompt,
    strategyOverride: options.executionStrategy,
    intent: resolvedIntent,
    isTTY: Boolean(process.stdout.isTTY && process.stdin.isTTY),
  });
  await writeFile(join(runDir, "execution-selection.json"), `${JSON.stringify(executionDecision, null, 2)}\n`);
  const executionPrompt = executionDecision.policy;

  if (executionDecision.strategy === "prompt") {
    throw new Error("Execution selection prompt did not resolve to a runnable strategy.");
  }

  const providerPolicy = executionDecision.strategy === "sequential" ? "kimi" : requestedProviderPolicy;

  if (executionDecision.strategy === "plan-only") {
    await writeFile(
      join(runDir, "plan.md"),
      `# Plan\n\nFlow: parallel\nWorkers: 0\nResource profile: ${resources.profile}\nMCP scope: ${mcpScope}\nExecution policy: ${executionPrompt}\nExecution strategy: plan-only\nApproval policy: ${approvalPolicy}\nProvider policy: ${providerPolicy}\n`
    );
    await writeFile(join(runDir, "goal.md"), `# Goal\n\n${effectiveGoal}\n`);
    await writeFile(join(runDir, "intent-frame.json"), `${JSON.stringify(intentFrame, null, 2)}\n`);
    await writeFile(join(runDir, "action-atoms.json"), `${JSON.stringify(intentFrame.actionAtoms, null, 2)}\n`);
    console.log(header("Plan Saved"));
    console.log(label("Run ID", runId));
    console.log(label("Goal", effectiveGoal));
    console.log(status.ok(`Plan saved to: ${join(runDir, "plan.md")}`));
    return { runId, success: true };
  }

  const executionStrategy = executionDecision.strategy;
  const workerCount = executionStrategy === "sequential"
    ? 1
    : normalizeWorkerCount(options.workers, resources.maxWorkers);

  await writeFile(
    join(runDir, "plan.md"),
    `# Plan\n\nFlow: parallel\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nMCP scope: ${mcpScope}\nExecution policy: ${executionPrompt}\nExecution strategy: ${executionStrategy}\nApproval policy: ${approvalPolicy}\nProvider policy: ${providerPolicy}\n`
  );

  if (specNodes) {
    runState = createRoutedRunState({
      runId,
      startedAt,
      nodes: specNodes,
      workerCount,
      goalId,
      goalSnapshot,
    });
  } else {
    intentFrame = intentFrame ?? buildIntentFrame(effectiveGoal);
    runState = createInteractiveRunState({
      runId,
      flow: "parallel",
      goal: effectiveGoal,
      intentFrame,
      workerCount,
      startedAt,
      approvalPolicy,
      goalId,
      goalSnapshot,
      intent: resolvedIntent,
      profile: resources.profile,
      providerPolicy,
      executionStrategy,
    });
  }

  await writeFile(join(runDir, "goal.md"), `# Goal\n\n${effectiveGoal}\n`);
  const memoryRecall = await writeMemoryRecallSummary({ root, runId, query: effectiveGoal });
  await writeFile(join(runDir, "intent-frame.json"), `${JSON.stringify(intentFrame, null, 2)}\n`);
  await writeFile(join(runDir, "action-atoms.json"), `${JSON.stringify(intentFrame.actionAtoms, null, 2)}\n`);
  await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));

  console.log(header(executionStrategy === "sequential" ? "Sequential Execution" : "Parallel Execution"));
  console.log(label("Run ID", runId));
  console.log(label("Goal", effectiveGoal));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`));
  console.log(label("MCP scope", mcpScope));
  console.log(label("Approval policy", approvalPolicy) + "\n");
  console.log(label("Provider policy", providerPolicy));

  const agentFile = getOmkPath("agents/root.yaml");
  const promptText = buildPromptText(effectiveGoal, runId, resources.profile, workerCount, mcpScope, resolvedIntent, intentFrame, memoryRecall.summary, executionStrategy);
  const statePath = join(runDir, "state.json");

  const routedState = routeRunState(runState, workerCount);
  await writeFile(statePath, JSON.stringify(routedState, null, 2));

  const dag = createExecutableDagFromState(routedState);
  const abortController = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  }
  let shuttingDown = false;
  let forceExitTimer: ReturnType<typeof setTimeout> | undefined;
  function handleSignal(): void {
    if (shuttingDown) {
      if (options.noPause !== true) {
        process.exit(1);
      }
      return;
    }
    shuttingDown = true;
    abortController.abort();
    // Force exit if graceful shutdown hangs (e.g. long-running node)
    // In programmatic mode (noPause=true) we skip force-exit so callers can handle abort.
    if (options.noPause !== true) {
      forceExitTimer = setTimeout(() => process.exit(1), 5000);
      forceExitTimer.unref?.();
    }
  }
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  const executor = createExecutor({
    persister: createStatePersister(join(root, ".omk", "runs")),
    ensemble: resources.ensembleDefaultEnabled ? {} : false,
    resumeFromState: routedState,
    signal: abortController.signal,
  });

  console.log(kimicatCliHero(formatOmkVersionFooter()));
  console.log(style.purpleBold("🐾 omk parallel — DAG executor with live UI"));
  console.log(style.gray(t("parallel.agentsActivated")));

  // Determine TTY and mode defaults
  const isTTY = Boolean(process.stdout.isTTY);
  const useWatch = options.noWatch
    ? false
    : options.watch ?? isTTY;
  const useAlternateScreen = options.alternateScreen === true;
  const useCompact = options.compact === true || options.view === "compact";
  const shouldPause = isTTY && options.noPause !== true;

  // Build worker labels for the UI
  const workerLabels = buildWorkerLabels(routedState);

  // Enter alternate screen only when explicitly requested
  if (useAlternateScreen && isTTY) {
    process.stdout.write("\x1b[?1049h");
  }

  // ── Live parallel UI ──
  let latestState: RunState = routedState;
  const liveRenderer = new ParallelLiveRenderer({
    runId,
    approvalPolicy,
    workerCount,
    ensembleEnabled: resources.ensembleDefaultEnabled,
    refreshMs: 1500,
    goalTitle: effectiveGoal,
    mode: useWatch ? "watch" : "no-watch",
    workerLabels,
    statePath,
    view: (options.view as ParallelViewMode | undefined) ?? (useCompact ? "compact" : "cockpit"),
  });

  if (useWatch) {
    executor.onStateChange((state) => {
      latestState = state;
    });
    if (useCompact) {
      // Compact mode: render a single line on each state change
      executor.onStateChange((state) => {
        const line = renderCompactParallelFrame(state, {
          runId,
          approvalPolicy,
          workerCount,
          ensembleEnabled: resources.ensembleDefaultEnabled,
          goalTitle: effectiveGoal,
          mode: "watch",
          workerLabels,
          statePath,
        });
        console.log(line);
      });
    } else {
      liveRenderer.start(() => latestState);
    }
  } else {
    const previousStatuses = new Map<string, string>();
    executor.onStateChange((stateSnapshot) => logRunStateTransitions(stateSnapshot, previousStatuses));
  }

  const activePreset = await getActiveRuntimePreset();
  const runner = await createProviderBackedTaskRunner({
    providerPolicy,
    deepseekPromptPrefix: buildDeepSeekPromptPrefix(effectiveGoal, runId, workerCount, resolvedIntent, intentFrame),
    allowDeepSeekAdvisoryFileNodes: true,
    kimi: {
      cwd: root,
      timeout: 0,
      agentFile,
      promptPrefix: promptText,
      mcpScope,
      skillsScope: resources.skillsScope,
      roleAgentFiles: true,
      mcpNames: activePreset?.mcpServers ?? [],
      skillNames: activePreset?.skills ?? [],
      hookNames: activePreset?.hooks ?? [],
      toolNames: [],
      env: {
        ...createOmkSessionEnv(root, runId),
        OMK_RUN_ID: runId,
        OMK_FLOW: "parallel",
        OMK_GOAL: intentFrame.desiredOutcome,
        OMK_GOAL_CONTEXT: renderActionDigest(intentFrame),
        OMK_WORKERS: String(workerCount),
        OMK_DAG_ROUTING: "1",
        OMK_DAG_STATE_PATH: statePath,
        OMK_MCP_SCOPE: mcpScope,
        OMK_SKILLS_SCOPE: resources.skillsScope,
        OMK_APPROVAL_POLICY: approvalPolicy,
        ...(modelArg.model ? { OMK_PROVIDER_MODEL: modelArg.model } : {}),
      },
    },
  });

  let result: Awaited<ReturnType<typeof executor.execute>>;
  try {
    result = await executor.execute(dag, runner, {
      runId,
      workers: workerCount,
      approvalPolicy: approvalPolicy as "interactive" | "auto" | "yolo" | "block",
      nodeTimeoutMs: options.timeoutPreset ? undefined : 600_000,
      timeoutPreset: options.timeoutPreset,
      worktreeRoot: root,
    });
  } finally {
    liveRenderer.stop();

    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
      forceExitTimer = undefined;
    }

    // Restore original terminal screen before printing results/errors.
    if (useAlternateScreen && isTTY) {
      process.stdout.write("\x1b[?1049l");
    }
  }

  console.log("");
  if (result.success) {
    console.log(status.ok("Parallel DAG run complete"));
  } else {
    console.log(status.error("Parallel DAG run failed"));
  }
  console.log(label("State", statePath));

  // ── Interactive handoff ──
  if (options.chat && result.success) {
    console.log(style.purple(t("parallel.complete")));
    const { chatCommand } = await import("./chat.js");
    await chatCommand({ runId });
    return { runId, success: true };
  }

  // Pause so the user can read the result before the process exits
  if (shouldPause) {
    console.log(style.gray("\n  Press Enter to continue..."));
    const terminalInputState = captureTerminalInputState(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>((resolve) => {
      rl.once("line", () => {
        resolve();
      });
    }).finally(() => {
      rl.close();
      restoreTerminalInputState(process.stdin, terminalInputState);
    });
  }

  return { runId, success: result.success };
}

async function resolveParallelCommandExecutionDecision(input: {
  requestedPolicy: ExecutionPromptPolicy | undefined;
  configPolicy: ExecutionPromptPolicy;
  strategyOverride: ExecutionStrategy | undefined;
  intent: UserIntent;
  isTTY: boolean;
}): Promise<ExecutionSelectionDecision> {
  if (input.strategyOverride && input.strategyOverride !== "prompt") {
    return {
      policy: input.requestedPolicy ?? input.configPolicy,
      source: input.requestedPolicy ? "cli" : "config",
      strategy: input.strategyOverride,
      reason: "caller supplied an execution strategy override",
      isTTY: input.isTTY,
      isNonTrivial: input.intent.complexity !== "simple" || input.intent.estimatedWorkers > 1 || input.intent.parallelizable,
    };
  }

  if (!input.requestedPolicy) {
    return {
      policy: "parallel",
      source: "default",
      strategy: "parallel",
      reason: "direct omk parallel preserves historical parallel execution unless --execution is supplied",
      isTTY: input.isTTY,
      isNonTrivial: input.intent.complexity !== "simple" || input.intent.estimatedWorkers > 1 || input.intent.parallelizable,
    };
  }

  const base = resolveExecutionSelectionDecision({
    cliValue: input.requestedPolicy,
    intent: input.intent,
    isTTY: input.isTTY,
  });
  if (base.strategy !== "prompt") return base;

  const { select } = await import("@inquirer/prompts");
  const selected = await select(
    {
      message: "이 작업은 병렬 처리에 적합합니다. Parallel agents로 나눌까요, one by one으로 진행할까요?",
      choices: EXECUTION_PROMPT_CHOICES.map((choice) => ({
        name: choice === "parallel"
          ? "Parallel agents (Recommended)"
          : choice === "sequential"
            ? "One by one"
            : "Plan only",
        value: choice,
      })),
    },
    { signal: AbortSignal.timeout(60_000) }
  );
  return resolvePromptExecutionDecision(base, selected as Exclude<ExecutionStrategy, "prompt">);
}

export function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  const effective = (value ?? process.env.OMK_WORKERS)?.trim();
  if (!effective || effective === "auto") return fallback;
  if (!/^\d+$/.test(effective)) return fallback;
  const parsed = Number(effective);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 6);
}

function normalizeApprovalPolicy(
  value: string | undefined,
  _profile: string
): "interactive" | "auto" | "yolo" | "block" {
  const v = value?.trim().toLowerCase();
  if (v === "interactive" || v === "auto" || v === "yolo" || v === "block") return v;
  // Default: interactive for safety in parallel mode
  return "interactive";
}

function buildPromptText(
  goal: string,
  runId: string,
  profile: string,
  workerCount: number,
  mcpScope: OmkRuntimeScope,
  intent?: UserIntent,
  intentFrame: IntentFrame = buildIntentFrame(goal),
  memorySummary?: string,
  executionStrategy: ExecutionStrategy = "parallel"
): string {
  const taskType = intent?.taskType ?? "general";
  const lines: string[] = [
    `# Kimi DAG Execution Envelope`,
    ``,
    `Kimi must transform the orchestration context into node-level action. Do not echo the prompt, restart completed work, or ask for generic continuation.`,
    ``,
    `## Strict Intent / Action Digest`,
    renderActionDigest(intentFrame),
    ``,
    `## Non-verbatim Source Digest`,
    renderPromptDigest("Execution envelope digest", goal, { maxKeywords: 18, maxPhrases: 3 }),
    `- raw prompt text: audit-only in run artifacts; not available for worker prompts.`,
    ``,
    `## Run Metadata`,
    `Run ID: ${runId}`,
    `Resource profile: ${profile}`,
    `Worker budget: ${workerCount}`,
    `MCP scope: ${mcpScope}`,
    `Execution strategy: ${executionStrategy}`,
    `Task type: ${taskType}`,
  ];

  if (memorySummary?.trim()) {
    lines.push(
      ``,
      `## Initial Memory Recall Summary`,
      memorySummary.trim().slice(0, 2_000),
    );
  }

  if (intent) {
    lines.push(
      `Complexity: ${intent.complexity}`,
      `Parallelizable: ${intent.parallelizable}`,
      `Required roles: ${intent.requiredRoles.join(", ")}`,
      `Read-only: ${intent.isReadOnly}`,
      ``
    );
  }

  if (executionStrategy === "sequential") {
    lines.push(
      `Execute the goal one by one with a single Kimi-owned worker lane.`,
      `- The coordinator plans the next scoped action before execution.`,
      `- Do not spawn parallel subagent, DeepSeek, or capability fanout lanes.`,
      `- The reviewer verifies the sequential output before final reporting.`,
      `- Produce concrete evidence, changed files, and verification results.`
    );
  } else {
    lines.push(
      `Execute the goal using parallel agents.`,
      `- The coordinator plans and delegates.`,
      `- Workers execute scoped sub-tasks in parallel.`,
      `- The reviewer verifies and merges outputs.`,
      `- Produce concrete evidence, changed files, and verification results.`
    );
  }

  // Task-type specific guidance
  if (taskType === "explore" || taskType === "research") {
    lines.push(
      `- Each worker focuses on a distinct subsystem, module, or question.`,
      `- Synthesize findings across workers rather than editing code.`,
      `- Prefer read-only tools (Glob, Grep, ReadFile, SearchWeb).`
    );
  } else if (taskType === "bugfix") {
    lines.push(
      `- First worker reproduces the bug; others explore root causes in parallel.`,
      `- Fix must be minimal and include a regression test.`,
      `- Run quality gates after the fix to verify no new failures.`
    );
  } else if (taskType === "refactor") {
    lines.push(
      `- Preserve external behavior; run tests before and after.`,
      `- Each worker handles a distinct file group or abstraction layer.`,
      `- Coordinate interfaces between refactored boundaries.`
    );
  } else if (taskType === "review") {
    lines.push(
      `- Each worker audits a different dimension: correctness, security, maintainability.`,
      `- Cite specific lines and file paths for every finding.`,
      `- Rank issues by severity (critical / warning / suggestion).`
    );
  } else if (taskType === "test") {
    lines.push(
      `- Cover edge cases, failure paths, and happy paths in parallel.`,
      `- Verify test isolation and deterministic behavior.`,
      `- Report coverage delta explicitly.`
    );
  } else if (taskType === "security") {
    lines.push(
      `- Audit trust boundaries, secret handling, and input validation.`,
      `- Do NOT commit or expose any discovered secrets.`,
      `- Provide concrete remediation steps with file references.`
    );
  } else if (taskType === "implement") {
    lines.push(
      `- Follow existing code style and design conventions.`,
      `- Split work by component or file boundary when possible.`,
      `- Include tests and documentation for new surfaces.`
    );
  }

  lines.push(
    ``,
    `MEMORY RECALL (MANDATORY):`,
    `- Before planning, the coordinator MUST read memory-recall-summary.md and call omk_memory_mindmap or omk_search_memory when more detail is needed.`,
    `- Workers MUST only use skills and MCP servers relevant to their assigned role.`,
    ``,
    `SKILLS & MCP USAGE (MANDATORY):`,
    `- Activate relevant skills from the routing hints for each node.`,
    mcpScope === "none"
      ? `- MCP scope is none for this run: do not launch MCP servers; rely on local tools and skills/hooks.`
      : mcpScope === "project"
        ? `- MCP scope is project for this run: use only project-local/builtin MCP servers such as omk-project.`
        : `- MCP scope is all for this run: global and project MCP servers may be available; never expose secrets or raw config.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations when MCP is enabled.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`
  );

  return lines.join("\n");
}

function buildDeepSeekPromptPrefix(
  goalContext: string,
  runId: string,
  workerCount: number,
  intent?: UserIntent,
  intentFrame: IntentFrame = buildIntentFrame(goalContext)
): string {
  const taskType = intent?.taskType ?? "general";
  const lines = [
    `OMK DeepSeek model-agent worker.`,
    `Initial Kimi orchestration may spawn dedicated DeepSeek Flash/Pro read-only agents; opportunistic routing may also offload low-risk workers.`,
    `Direct mode is read-only. For file-affecting advisory mode, propose patch strategy only; Kimi owns actual edits, merge authority, and final synthesis.`,
    `Do not repeat or restart the user's original goal. Read the current Kimi/goal context below and answer only for the assigned DAG node.`,
    ``,
    `## Current Run Context`,
    `- Run ID: ${runId}`,
    `- Worker budget: ${workerCount}`,
    `- Task type: ${taskType}`,
  ];

  if (intent) {
    lines.push(
      `- Complexity: ${intent.complexity}`,
      `- Parallelizable: ${intent.parallelizable}`,
      `- Required roles: ${intent.requiredRoles.join(", ")}`,
      `- Read-only intent: ${intent.isReadOnly}`,
      `- Rationale: ${intent.rationale}`
    );
  }

  lines.push(
    ``,
    `## Current Kimi/Goal Action Digest`,
    renderActionDigest(intentFrame, { maxAtoms: 6 }),
    ``,
    `## Non-verbatim Context Digest`,
    renderPromptDigest("DeepSeek context digest", goalContext, { maxKeywords: 12, maxPhrases: 2 }),
    `- raw prompt text: unavailable to DeepSeek/model-advisory lanes.`
  );

  return lines.join("\n");
}

function buildWorkerLabels(state: RunState): Record<string, string> {
  const labels: Record<string, string> = {};
  const coordinator = state.nodes.find((n) => n.id === "root-coordinator" || n.id === "architect");
  if (coordinator) {
    labels[coordinator.id] = coordinator.role === "architect" ? "architect" : "planner";
  }
  const reviewer = state.nodes.find((n) => n.id === "review-merge" || n.role === "reviewer" || n.role === "aggregator");
  if (reviewer) {
    labels[reviewer.id] = reviewer.role === "aggregator" ? "aggregator" : "reviewer";
  }
  const security = state.nodes.find((n) => n.id === "security-audit");
  if (security) {
    labels[security.id] = "security";
  }
  const design = state.nodes.find((n) => n.id === "design-review");
  if (design) {
    labels[design.id] = "design";
  }
  const qa = state.nodes.find((n) => n.id === "quality-check");
  if (qa) {
    labels[qa.id] = qa.role === "tester" ? "tester" : "qa";
  }
  const workers = state.nodes.filter((n) => n.id.startsWith("worker-"));
  const roleCounts: Record<string, number> = {};
  workers.forEach((n) => {
    const role = n.role ?? "coder";
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    if (!labels[n.id]) {
      labels[n.id] = `${role}-${roleCounts[role]}`;
    }
  });
  for (const node of state.nodes.filter((n) => n.id.startsWith("deepseek-"))) {
    labels[node.id] = node.routing?.providerModelTier
      ? `deepseek-${node.routing.providerModelTier}`
      : "deepseek";
  }
  for (const node of state.nodes.filter((n) => isCapabilityAgentNode(n))) {
    labels[node.id] = node.routing?.routeSource ? `capability-${node.routing.routeSource}` : "capability";
  }
  return labels;
}

function createInteractiveRunState(input: {
  runId: string;
  flow: string;
  goal: string;
  intentFrame?: IntentFrame;
  workerCount: number;
  startedAt: string;
  approvalPolicy: string;
  goalId?: string;
  goalSnapshot?: RunState["goalSnapshot"];
  intent?: UserIntent;
  profile?: string;
  providerPolicy?: ProviderPolicy;
  executionStrategy?: ExecutionStrategy;
}): RunState {
  const intent = input.intent;
  const effectiveWorkers = input.executionStrategy === "sequential"
    ? 1
    : intent?.estimatedWorkers === undefined
    ? input.workerCount
    : normalizeWorkerCount(String(intent.estimatedWorkers), input.workerCount);

  // Build dynamic nodes based on intent
  const nodes = buildDynamicNodes({
    flow: input.flow,
    goal: input.goal,
    intentFrame: input.intentFrame,
    startedAt: input.startedAt,
    workerCount: effectiveWorkers,
    intent,
    profile: input.profile,
    providerPolicy: input.providerPolicy,
    executionStrategy: input.executionStrategy,
  });

  const state = createRoutedRunState({
    runId: input.runId,
    startedAt: input.startedAt,
    workerCount: effectiveWorkers,
    goalId: input.goalId,
    goalSnapshot: input.goalSnapshot,
    nodes,
  });

  const bootstrap = state.nodes.find((node) => node.id === "bootstrap");
  if (bootstrap) {
    bootstrap.status = "done";
    bootstrap.startedAt = input.startedAt;
    bootstrap.completedAt = input.startedAt;
  }
  const coordinator = state.nodes.find((node) => node.id === "root-coordinator" || node.id === "architect");
  if (coordinator) {
    coordinator.status = "running";
    coordinator.startedAt = input.startedAt;
  }
  return refreshRunStateEstimate(state, effectiveWorkers);
}

export interface DynamicNodeBuildInput {
  flow: string;
  goal: string;
  intentFrame?: IntentFrame;
  startedAt: string;
  workerCount: number;
  intent?: UserIntent;
  profile?: string;
  providerPolicy?: ProviderPolicy;
  executionStrategy?: ExecutionStrategy;
}

export function buildDynamicNodes(input: DynamicNodeBuildInput): DagNodeDefinition[] {
  const { flow, goal, startedAt, workerCount, intent, profile, executionStrategy } = input;
  const providerPolicy = input.providerPolicy ?? "auto";
  const intentFrame = input.intentFrame ?? buildIntentFrame(goal);
  const actionDigest = renderActionDigest(intentFrame, { maxAtoms: 6 });
  const taskType = intent?.taskType ?? "general";
  const roles = intent?.requiredRoles ?? ["planner", "coder", "reviewer"];
  const isSequential = executionStrategy === "sequential";
  const effectiveWorkerCount = isSequential ? 1 : normalizeWorkerCount(String(workerCount), 1);

  const isSuper = !isSequential && (isSuperOmkEnabled() || profile === "super");
  const kimiWorkerCount = isSuper
    ? Math.min(SUPER_OMK_DEFAULTS.kimiWorkerCap, effectiveWorkerCount)
    : effectiveWorkerCount;
  const deepseekWorkerCount = isSuper
    ? Math.min(SUPER_OMK_DEFAULTS.deepseekWorkerCap, effectiveWorkerCount - kimiWorkerCount)
    : 0;

  const bootstrap: DagNodeDefinition = {
    id: "bootstrap",
    name: `Prepare ${flow} run`,
    role: "omk",
    dependsOn: [],
    maxRetries: 1,
    startedAt,
    completedAt: startedAt,
    routing: {
      actionAtom: actionAtomRouting(makeActionAtom({
        id: "atom-bootstrap",
        label: "bootstrap",
        verb: "bootstrap",
        object: "parallel runtime",
        evidenceTarget: "state.json",
        doneCondition: "Run state is initialized",
        source: "runtime",
      })),
    },
  };

  // Determine coordinator / planner node based on task type
  const coordinatorRole = taskType === "plan" || taskType === "migrate" || taskType === "security" ? "architect" : "orchestrator";
  const coordinator: DagNodeDefinition = {
    id: "root-coordinator",
    name: "Coordinate strict intent DAG",
    role: coordinatorRole,
    dependsOn: ["bootstrap"],
    maxRetries: 1,
    startedAt,
    outputs: [{ name: "worker plan", gate: "summary" }],
    routing: {
      actionAtom: actionAtomRouting(makeActionAtom({
        id: "atom-coordinate",
        label: "coordinate-intent-dag",
        verb: "coordinate",
        object: "strict intent DAG",
        evidenceTarget: "plan.md",
        doneCondition: "Coordinator assigns scoped action atoms before delegation",
        source: "runtime",
      })),
    },
  };

  // Create worker nodes with role specialization
  const workerRoles = roles.filter((r) => r !== "planner" && r !== "orchestrator" && r !== "architect" && r !== "router");
  if (workerRoles.length === 0) workerRoles.push("coder");

  const capabilitySeed = intentFrame.actionAtoms.map((atom) => atom.label).join(", ");
  const deepseekAgentNodes = providerPolicy === "kimi" || isSequential || (providerPolicy !== "auto" && providerPolicy !== "deepseek")
    ? []
    : buildDeepSeekAgentNodes({
      goal: actionDigest,
      taskType,
      intent,
    });
  const capabilityAgentNodes = !isSequential && shouldSpawnCapabilityAgents(effectiveWorkerCount, taskType, intent)
    ? buildCapabilityAgentNodes({
      goal: capabilitySeed || actionDigest,
      dependsOn: ["root-coordinator"],
      maxAgents: 3,
      seedId: "parallel-capability-routing-seed",
      seedRole: coordinatorRole,
      seedName: "Route active MCP, skills, and hooks for action atoms",
    }).map((node) => ({
      ...node,
      routing: {
        ...node.routing,
        actionAtom: actionAtomRouting(makeActionAtom({
          id: `atom-${node.id}`,
          label: node.routing?.routeSource ? `route-${node.routing.routeSource}` : "route-capabilities",
          verb: "route",
          object: "active capability inventory",
          evidenceTarget: node.outputs?.[0]?.name ?? "capability routing plan",
          doneCondition: "Relevant MCP, skills, and hooks are bounded to the current action atom",
          source: "runtime",
        })),
      },
    }))
    : [];

  const kimiWorkerNodes: DagNodeDefinition[] = Array.from(
    { length: kimiWorkerCount },
    (_, index) => {
      const role = workerRoles[index % workerRoles.length];
      const taskName =
        taskType === "explore" || taskType === "research"
          ? `investigate area ${index + 1}`
          : taskType === "review"
          ? `audit scope ${index + 1}`
          : taskType === "test"
          ? `test scenario ${index + 1}`
          : taskType === "document"
          ? `document section ${index + 1}`
          : `execute scoped sub-task ${index + 1}`;
      return {
        id: `worker-${index + 1}`,
        name: `worker-${index + 1} (${role}): ${taskName}`,
        role,
        dependsOn: ["root-coordinator"],
        maxRetries: 1,
        failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
        inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
        outputs: [{ name: `worker-${index + 1} output`, gate: "none" }],
        routing: {
          assignedProvider: role === "coder" || providerPolicy === "auto" ? "kimi" : providerPolicy,
          candidateProviders: role === "coder" || providerPolicy === "auto" ? ["kimi"] : [providerPolicy, "kimi"],
          assignedModel: providerPolicy === "qwen"
            ? "qwen3-max"
            : providerPolicy === "codex"
            ? "codex-cli"
            : providerPolicy === "deepseek"
            ? "deepseek-v4-flash"
            : "auto",
          assignedProviderAuthority: role === "coder" ? "authority" : "advisory",
          assignedProviderCapabilities: role === "coder" ? ["write", "shell", "mcp"] : ["read", "review", "advisory"],
          actionAtom: actionAtomRouting(intentFrame.actionAtoms[(index + 2) % intentFrame.actionAtoms.length] ?? intentFrame.actionAtoms[0]),
        },
      };
    }
  );

  const deepseekWorkerNodes: DagNodeDefinition[] = Array.from(
    { length: deepseekWorkerCount },
    (_, index) => {
      const type = SUPER_OMK_DEFAULTS.deepseekNodeTypes[index % SUPER_OMK_DEFAULTS.deepseekNodeTypes.length];
      const roleMap: Record<string, string> = {
        plan: "planner",
        review: "reviewer",
        analyze: "explorer",
        research: "researcher",
        debug: "debugger",
      };
      const role = roleMap[type] ?? "explorer";
      return {
        id: `deepseek-worker-${index + 1}`,
        name: `deepseek-worker-${index + 1} (${role}): ${type} area ${index + 1}`,
        role,
        dependsOn: ["root-coordinator"],
        maxRetries: 1,
        timeoutMs: 30_000,
        priority: 2,
        cost: 1,
        failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
        inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
        outputs: [{ name: `deepseek-worker-${index + 1} output`, gate: "none" }],
        routing: {
          provider: "deepseek",
          fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
          providerModel: "deepseek-v4-pro",
          providerModelTier: "pro",
          assignedProvider: "deepseek",
          candidateProviders: ["deepseek", "kimi"],
          assignedModel: "deepseek-v4-pro",
          assignedProviderAuthority: "direct",
          assignedProviderCapabilities: ["read", "review", "qa"],
          providerReason: `Super OMK DeepSeek worker for ${type}`,
          requiresMcp: false,
          requiresToolCalling: false,
          readOnly: true,
          evidenceRequired: false,
          contextBudget: "small",
          skills: ["omk-repo-explorer", "omk-context-broker"],
          mcpServers: [],
          tools: [],
          rationale: `DeepSeek V4 Pro handles ${type} in super co-orchestration mode`,
          actionAtom: actionAtomRouting(makeActionAtom({
            id: `atom-deepseek-worker-${index + 1}`,
            label: `deepseek-${type}`,
            verb: type === "review" ? "review" : type === "research" ? "research" : type === "debug" ? "inspect" : "plan",
            object: "read-only auxiliary action",
            evidenceTarget: `deepseek-worker-${index + 1} output`,
            doneCondition: "DeepSeek advisory lane reports bounded findings",
            source: "runtime",
          })),
        },
      };
    }
  );

  const workerNodes = [...kimiWorkerNodes, ...deepseekWorkerNodes];

  // Build tail nodes based on task type
  const tailNodes: DagNodeDefinition[] = [];
  const synthesisInputNodes = [...deepseekAgentNodes, ...capabilityAgentNodes, ...workerNodes];
  const synthesisInputIds = synthesisInputNodes.map((node) => node.id);

  // Review / aggregator node
  const reviewRole = taskType === "review" ? "aggregator" : "reviewer";
  const reviewNode: DagNodeDefinition = {
    id: "review-merge",
    name: taskType === "review" ? "Aggregate review findings" : "Review, verify, and merge outputs",
    role: reviewRole,
    dependsOn: synthesisInputIds,
    maxRetries: 1,
    inputs: synthesisInputNodes.map((node) => ({
      name: node.outputs?.[0]?.name ?? node.name,
      ref: "state.json",
      from: node.id,
      required: !node.id.startsWith("deepseek-") && !isCapabilityAgentNode(node),
    })),
    outputs: [{ name: "verified result", gate: taskType === "review" ? "summary" : "review-pass" }],
    routing: {
      actionAtom: actionAtomRouting(makeActionAtom({
        id: "atom-review-merge",
        label: "review-merge",
        verb: "review",
        object: "worker outputs",
        evidenceTarget: "verified result",
        doneCondition: "Worker outputs are reviewed and merged into a verified result",
        source: "runtime",
      })),
    },
  };
  tailNodes.push(reviewNode);

  // QA / tester node (for most implementation tasks)
  if (taskType !== "explore" && taskType !== "research" && taskType !== "document") {
    const qaRole = taskType === "test" ? "tester" : "qa";
    tailNodes.push({
      id: "quality-check",
      name: taskType === "test" ? "Test coverage and regression check" : "Quality assurance check",
      role: qaRole,
      dependsOn: ["review-merge"],
      maxRetries: 1,
      outputs: [{ name: "quality result", gate: taskType === "test" ? "test-pass" : "command-pass", ref: "npm run check" }],
      failurePolicy: { blockDependents: false },
      routing: {
        actionAtom: actionAtomRouting(makeActionAtom({
          id: "atom-quality-check",
          label: "quality-check",
          verb: "verify",
          object: "quality gates",
          evidenceTarget: "quality result",
          doneCondition: "Required checks prove the DAG output is safe to report",
          source: "runtime",
        })),
      },
    });
  }

  // Security audit node (when needed)
  if (intent?.needsSecurityReview) {
    tailNodes.push({
      id: "security-audit",
      name: "Security audit and secret scan",
      role: "security",
      dependsOn: ["review-merge"],
      maxRetries: 1,
      outputs: [{ name: "security result", gate: "review-pass" }],
      failurePolicy: { blockDependents: true },
      routing: {
        actionAtom: actionAtomRouting(makeActionAtom({
          id: "atom-security-audit",
          label: "security-audit",
          verb: "review",
          object: "security boundaries",
          evidenceTarget: "security result",
          doneCondition: "Security-sensitive risks are reviewed before completion",
          source: "runtime",
        })),
      },
    });
  }

  // Design review node (when needed)
  if (intent?.needsDesignReview) {
    const designDeps = tailNodes.filter((n) => n.id !== "security-audit").map((n) => n.id);
    tailNodes.push({
      id: "design-review",
      name: "Design system and UI consistency review",
      role: "designer",
      dependsOn: designDeps.length > 0 ? designDeps : ["review-merge"],
      maxRetries: 1,
      outputs: [{ name: "design result", gate: "summary" }],
      failurePolicy: { blockDependents: false },
      routing: {
        actionAtom: actionAtomRouting(makeActionAtom({
          id: "atom-design-review",
          label: "design-review",
          verb: "review",
          object: "design consistency",
          evidenceTarget: "design result",
          doneCondition: "Design/system constraints are checked when applicable",
          source: "runtime",
        })),
      },
    });
  }

  return [bootstrap, coordinator, ...deepseekAgentNodes, ...capabilityAgentNodes, ...workerNodes, ...tailNodes];
}

function shouldSpawnCapabilityAgents(workerCount: number, taskType: string, intent?: UserIntent): boolean {
  void workerCount;
  if (intent?.parallelizable === true) return true;
  if (intent?.complexity && intent.complexity !== "simple") return true;
  return ["bugfix", "implement", "migrate", "plan", "refactor", "review", "security", "test", "general"].includes(taskType);
}

function buildDeepSeekAgentNodes(input: {
  goal: string;
  taskType: string;
  intent?: UserIntent;
}): DagNodeDefinition[] {
  if (!shouldSpawnDeepSeekModelAgents(input.taskType, input.intent)) return [];

  return [
    createDeepSeekAgentNode({
      id: "deepseek-flash-agent",
      name: "DeepSeek Flash action decomposition",
      role: "planner",
      tier: "flash",
      outputName: "deepseek flash decomposition",
      rationale: "Flash handles fast first-pass context slicing from the original user input before Kimi synthesis.",
    }),
    createDeepSeekAgentNode({
      id: "deepseek-pro-agent",
      name: "DeepSeek Pro action critique",
      role: "reviewer",
      tier: "pro",
      outputName: "deepseek pro critique",
      rationale: "Pro handles deeper read-only critique and risk detection from the original user input before Kimi synthesis.",
    }),
  ];
}

function shouldSpawnDeepSeekModelAgents(taskType: string, intent?: UserIntent): boolean {
  if (intent?.isReadOnly === true) return true;
  if (intent?.parallelizable === true) return true;
  if (intent?.complexity && intent.complexity !== "simple") return true;
  return ["bugfix", "implement", "migrate", "plan", "refactor", "review", "security", "test"].includes(taskType);
}

function createDeepSeekAgentNode(input: {
  id: string;
  name: string;
  role: string;
  tier: DeepSeekModelTier;
  outputName: string;
  rationale: string;
}): DagNodeDefinition {
  return {
    id: input.id,
    name: input.name,
    role: input.role,
    dependsOn: ["root-coordinator"],
    maxRetries: 1,
    timeoutMs: input.tier === "flash" ? 15_000 : 30_000,
    priority: 2,
    cost: input.tier === "pro" ? 2 : 1,
    failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
    inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
    outputs: [{ name: input.outputName, gate: "none", required: false }],
    routing: {
      provider: "deepseek",
      fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
      providerModel: input.tier === "flash" ? "deepseek-v4-flash" : "deepseek-v4-pro",
      providerModelTier: input.tier,
      assignedProvider: "deepseek",
      candidateProviders: ["deepseek", "kimi"],
      assignedModel: input.tier === "flash" ? "deepseek-v4-flash" : "deepseek-v4-pro",
      assignedProviderAuthority: "direct",
      assignedProviderCapabilities: ["read", "plan", "review"],
      providerReason: `Dedicated DeepSeek ${input.tier} model agent spawned from initial orchestration input`,
      requiresMcp: false,
      requiresToolCalling: false,
      readOnly: true,
      evidenceRequired: false,
      contextBudget: input.tier === "pro" ? "small" : "tiny",
      skills: ["omk-repo-explorer", "omk-context-broker"],
      mcpServers: [],
      tools: [],
      rationale: input.rationale,
      actionAtom: actionAtomRouting(makeActionAtom({
        id: `atom-${input.id}`,
        label: input.tier === "flash" ? "deepseek-action-decomposition" : "deepseek-action-critique",
        verb: input.role === "reviewer" ? "review" : "plan",
        object: "read-only model-agent lane",
        evidenceTarget: input.outputName,
        doneCondition: "Read-only model-agent output is available for Kimi synthesis",
        source: "runtime",
      })),
    },
  };
}

function createExecutableDagFromState(state: RunState): Dag {
  const dag = createDagFromRunState(state);
  const runtimeById = new Map(state.nodes.map((node) => [node.id, node]));

  for (const node of dag.nodes) {
    const runtime = runtimeById.get(node.id);
    if (runtime?.status !== "done") continue;
    node.status = "done";
    node.startedAt = runtime.startedAt;
    node.completedAt = runtime.completedAt;
    node.durationMs = runtime.durationMs;
    node.attempts = runtime.attempts?.map((attempt) => ({ ...attempt }));
  }

  const bootstrap = dag.nodes.find((node) => node.id === "bootstrap");
  if (bootstrap) {
    bootstrap.status = "done";
    bootstrap.startedAt ??= state.startedAt;
    bootstrap.completedAt ??= state.startedAt;
  }

  return dag;
}

function logRunStateTransitions(stateSnapshot: RunState, previousStatuses: Map<string, string>): void {
  for (const node of stateSnapshot.nodes) {
    const previous = previousStatuses.get(node.id);
    previousStatuses.set(node.id, node.status);
    if (previous === node.status) continue;
    if (previous === undefined && node.status === "pending") continue;
    console.log(renderNodeTransition(node.id, node.name, node.status));
  }
}

function renderNodeTransition(id: string, name: string, nodeStatus: string): string {
  const text = `${id}: ${name}`;
  if (nodeStatus === "running") return bullet(`running  ${text}`, "purple");
  if (nodeStatus === "done") return bullet(`done     ${text}`, "mint");
  if (nodeStatus === "failed") return bullet(`failed   ${text}`, "pink");
  if (nodeStatus === "blocked") return bullet(`blocked  ${text}`, "skin");
  return bullet(`${nodeStatus}  ${text}`, "blue");
}
