import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import readline from "readline";

import { getOmkPath, getProjectRoot, getRunPath, sanitizeRunId } from "../util/fs.js";
import { style, header, status, label, kimicatCliHero, bullet } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { createRoutedRunState, createDagFromRunState, refreshRunStateEstimate, routeRunState } from "../orchestration/run-state.js";
import { createExecutor } from "../orchestration/executor.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { buildCapabilityAgentNodes, isCapabilityAgentNode } from "../orchestration/capability-agents.js";

import { ParallelLiveRenderer, renderCompactParallelFrame, type ParallelViewMode } from "../orchestration/parallel-ui.js";
import { formatOmkVersionFooter } from "../util/version.js";
import { UsageError } from "../util/cli-contract.js";
import { captureTerminalInputState, restoreTerminalInputState } from "../util/terminal-input.js";
import {
  createProviderBackedTaskRunner,
  type ProviderPolicy,
} from "../providers/index.js";
import type { DeepSeekModelTier } from "../providers/types.js";
import type { RunState, UserIntent } from "../contracts/orchestration.js";
import type { Dag, DagNodeDefinition } from "../orchestration/dag.js";

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
  /** Analyzed user intent for dynamic DAG construction and role routing. */
  intent?: UserIntent;
}

export async function parallelCommand(
  goal: string | undefined,
  options: ParallelCommandOptions = {}
): Promise<{ runId: string; success: boolean }> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);
  const providerPolicy = normalizeProviderPolicy(options.provider);

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
  await writeFile(
    join(runDir, "plan.md"),
    `# Plan\n\nFlow: parallel\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nApproval policy: ${approvalPolicy}\nProvider policy: ${providerPolicy}\n`
  );

  let runState: RunState;
  let effectiveGoal = goal ?? "";

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
    }
  }

  if (hasFromSpec) {
    const { loadSpecDag } = await import("./dag-from-spec.js");
    const specDag = await loadSpecDag(options.fromSpec!, { parallel: true });
    effectiveGoal = goal ?? `spec: ${specDag.nodes[0]?.name ?? options.fromSpec!}`;

    const specNodes = specDag.nodes.map((node) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { status, retries, ...def } = node;
      return def;
    });

    runState = createRoutedRunState({
      runId,
      startedAt,
      nodes: specNodes,
      workerCount,
      goalId,
      goalSnapshot,
    });
  } else {
    runState = createInteractiveRunState({
      runId,
      flow: "parallel",
      goal: effectiveGoal,
      workerCount,
      startedAt,
      approvalPolicy,
      goalId,
      goalSnapshot,
      intent: options.intent,
    });
  }

  await writeFile(join(runDir, "goal.md"), `# Goal\n\n${effectiveGoal}\n`);
  await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));

  console.log(header("Parallel Execution"));
  console.log(label("Run ID", runId));
  console.log(label("Goal", effectiveGoal));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`));
  console.log(label("Approval policy", approvalPolicy) + "\n");
  console.log(label("Provider policy", providerPolicy));

  const agentFile = getOmkPath("agents/root.yaml");
  const promptText = buildPromptText(effectiveGoal, runId, resources.profile, workerCount, options.intent);
  const statePath = join(runDir, "state.json");

  const routedState = routeRunState(runState, workerCount);
  await writeFile(statePath, JSON.stringify(routedState, null, 2));

  const dag = createExecutableDagFromState(routedState);
  const abortController = new AbortController();
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

  const runner = await createProviderBackedTaskRunner({
    providerPolicy,
    deepseekPromptPrefix: buildDeepSeekPromptPrefix(effectiveGoal, runId, workerCount, options.intent),
    allowDeepSeekAdvisoryFileNodes: true,
    kimi: {
      cwd: root,
      timeout: 0,
      agentFile,
      promptPrefix: promptText,
      mcpScope: resources.mcpScope,
      skillsScope: resources.skillsScope,
      roleAgentFiles: true,
      env: {
        ...createOmkSessionEnv(root, runId),
        OMK_RUN_ID: runId,
        OMK_FLOW: "parallel",
        OMK_GOAL: effectiveGoal,
        OMK_WORKERS: String(workerCount),
        OMK_DAG_ROUTING: "1",
        OMK_DAG_STATE_PATH: statePath,
        OMK_MCP_SCOPE: resources.mcpScope,
        OMK_SKILLS_SCOPE: resources.skillsScope,
        OMK_APPROVAL_POLICY: approvalPolicy,
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

function normalizeProviderPolicy(value: string | undefined): ProviderPolicy {
  return value === "kimi" ? "kimi" : "auto";
}

function buildPromptText(
  goal: string,
  runId: string,
  profile: string,
  workerCount: number,
  intent?: UserIntent
): string {
  const taskType = intent?.taskType ?? "general";
  const lines: string[] = [
    `# Kimi DAG Execution Envelope`,
    ``,
    `Kimi must transform the orchestration context into node-level action. Do not echo the prompt, restart completed work, or ask for generic continuation.`,
    ``,
    `## Orchestrated Goal Context`,
    goal.trim(),
    ``,
    `## Run Metadata`,
    `Run ID: ${runId}`,
    `Resource profile: ${profile}`,
    `Worker budget: ${workerCount}`,
    `Task type: ${taskType}`,
  ];

  if (intent) {
    lines.push(
      `Complexity: ${intent.complexity}`,
      `Parallelizable: ${intent.parallelizable}`,
      `Required roles: ${intent.requiredRoles.join(", ")}`,
      `Read-only: ${intent.isReadOnly}`,
      ``
    );
  }

  lines.push(
    `Execute the goal using parallel agents.`,
    `- The coordinator plans and delegates.`,
    `- Workers execute scoped sub-tasks in parallel.`,
    `- The reviewer verifies and merges outputs.`,
    `- Produce concrete evidence, changed files, and verification results.`
  );

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
    `- Before planning, the coordinator MUST call omk_memory_mindmap or omk_search_memory to load relevant project context.`,
    `- Workers MUST only use skills and MCP servers relevant to their assigned role.`,
    ``,
    `SKILLS & MCP USAGE (MANDATORY):`,
    `- Activate relevant skills from the routing hints for each node.`,
    `- Use MCP servers (omk-project, memory, quality-gate, etc.) when they fit the task.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`
  );

  return lines.join("\n");
}

function buildDeepSeekPromptPrefix(
  goalContext: string,
  runId: string,
  workerCount: number,
  intent?: UserIntent
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
    `## Current Kimi/Goal Context`,
    limitPromptSection(goalContext, 8_000)
  );

  return lines.join("\n");
}

function limitPromptSection(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n[truncated: ${trimmed.length - maxChars} chars omitted]`;
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
  workerCount: number;
  startedAt: string;
  approvalPolicy: string;
  goalId?: string;
  goalSnapshot?: RunState["goalSnapshot"];
  intent?: UserIntent;
}): RunState {
  const intent = input.intent;
  const effectiveWorkers = intent?.estimatedWorkers === undefined
    ? input.workerCount
    : normalizeWorkerCount(String(intent.estimatedWorkers), input.workerCount);

  // Build dynamic nodes based on intent
  const nodes = buildDynamicNodes({
    flow: input.flow,
    goal: input.goal,
    startedAt: input.startedAt,
    workerCount: effectiveWorkers,
    intent,
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
  startedAt: string;
  workerCount: number;
  intent?: UserIntent;
}

export function buildDynamicNodes(input: DynamicNodeBuildInput): DagNodeDefinition[] {
  const { flow, goal, startedAt, workerCount, intent } = input;
  const taskType = intent?.taskType ?? "general";
  const roles = intent?.requiredRoles ?? ["planner", "coder", "reviewer"];
  const effectiveWorkerCount = normalizeWorkerCount(String(workerCount), 1);

  const bootstrap: DagNodeDefinition = {
    id: "bootstrap",
    name: `Prepare ${flow} run`,
    role: "omk",
    dependsOn: [],
    maxRetries: 1,
    startedAt,
    completedAt: startedAt,
  };

  // Determine coordinator / planner node based on task type
  const coordinatorRole = taskType === "plan" || taskType === "migrate" || taskType === "security" ? "architect" : "orchestrator";
  const coordinator: DagNodeDefinition = {
    id: "root-coordinator",
    name: `Coordinate: ${goal}`,
    role: coordinatorRole,
    dependsOn: ["bootstrap"],
    maxRetries: 1,
    startedAt,
    outputs: [{ name: "worker plan", gate: "summary" }],
  };

  // Create worker nodes with role specialization
  const workerRoles = roles.filter((r) => r !== "planner" && r !== "orchestrator" && r !== "architect" && r !== "router");
  if (workerRoles.length === 0) workerRoles.push("coder");

  const deepseekAgentNodes = buildDeepSeekAgentNodes({
    goal,
    taskType,
    intent,
  });
  const capabilityAgentNodes = shouldSpawnCapabilityAgents(effectiveWorkerCount, taskType, intent)
    ? buildCapabilityAgentNodes({
      goal,
      dependsOn: ["root-coordinator"],
      maxAgents: 3,
      seedId: "parallel-capability-routing-seed",
      seedRole: coordinatorRole,
      seedName: `Route active MCP, skills, and hooks for: ${goal}`,
    })
    : [];

  const workerNodes: DagNodeDefinition[] = Array.from(
    { length: effectiveWorkerCount },
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
      };
    }
  );

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
    });
  }

  return [bootstrap, coordinator, ...deepseekAgentNodes, ...capabilityAgentNodes, ...workerNodes, ...tailNodes];
}

function shouldSpawnCapabilityAgents(workerCount: number, taskType: string, intent?: UserIntent): boolean {
  if (workerCount < 2) return false;
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
      name: `DeepSeek Flash quick decomposition: ${input.goal}`,
      role: "planner",
      tier: "flash",
      outputName: "deepseek flash decomposition",
      rationale: "Flash handles fast first-pass context slicing from the original user input before Kimi synthesis.",
    }),
    createDeepSeekAgentNode({
      id: "deepseek-pro-agent",
      name: `DeepSeek Pro critical model review: ${input.goal}`,
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
    priority: 2,
    cost: input.tier === "pro" ? 2 : 1,
    failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
    inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
    outputs: [{ name: input.outputName, gate: "none", required: false }],
    routing: {
      provider: "deepseek",
      fallbackProvider: "kimi",
      providerModelTier: input.tier,
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
