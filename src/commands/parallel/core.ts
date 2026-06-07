import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getOmkPath, getProjectRoot, getRunPath, sanitizeRunId } from "../../util/fs.js";
import { header, label, status } from "../../util/theme.js";
import { t } from "../../util/i18n.js";
import { getActiveRuntimePreset, getOmkResourceSettings, type OmkActivePreset, type OmkRuntimeScope } from "../../util/resource-profile.js";
import { parseRuntimeScopeOption } from "../../util/runtime-scope.js";
import { createRoutedRunState, routeRunState } from "../../orchestration/run-state.js";
import { UsageError } from "../../util/cli-contract.js";
import { writeMemoryRecallSummary } from "../../util/chat-startup.js";
import { normalizeProviderPolicy, parseProviderModelArg } from "../../providers/model-registry.js";
import { parseExecutionPromptPolicy } from "../../util/execution-selection.js";
import { analyzeUserIntent } from "../../goal/intake.js";
import { buildIntentFrame } from "../../goal/intent-frame.js";
import type { ProviderPolicy } from "../../providers/index.js";
import type { ExecutionStrategy, ExecutionSelectionDecision, RunState, UserIntent } from "../../contracts/orchestration.js";
import type { IntentFrame } from "../../contracts/goal.js";
import type { DagNodeDefinition } from "../../orchestration/dag.js";
import { renderCapabilityRoutingArtifact } from "../../orchestration/capability-routing.js";

import { ensureCompletionArtifactContract } from "../../orchestration/completion-artifacts.js";
import { buildParallelRouteDecision, resolveParallelCommandExecutionDecision, createInteractiveRunState, createExecutableDagFromState } from "./orchestrator.js";
import { normalizeWorkerCount, executeParallelRun } from "./worker.js";
import { buildPromptText, buildDeepSeekPromptPrefix, normalizeApprovalPolicy } from "./utils.js";

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
  /** Full orchestration prompt from buildOrchestratedPrompt() for OMK control instructions. */
  orchestrationPrompt?: string;
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
  await ensureCompletionArtifactContract(root, runId);

  let runState: RunState;
  let effectiveGoal = goal ?? "";
  let intentFrame: IntentFrame | undefined = options.intentFrame;

  let goalId: string | undefined;
  let goalSnapshot: RunState["goalSnapshot"] | undefined;
  if (options.goalId) {
    const { createGoalPersister } = await import("../../goal/persistence.js");
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
    const { loadSpecDag } = await import("../dag-from-spec.js");
    const specDag = await loadSpecDag(options.fromSpec!, { parallel: true });
    effectiveGoal = goal ?? `spec: ${specDag.nodes[0]?.name ?? options.fromSpec!}`;
    intentFrame = buildIntentFrame(effectiveGoal);

    specNodes = specDag.nodes.map((node) => {
      const { status: _status, retries: _retries, ...def } = node;
      void _status;
      void _retries;
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

  const providerPolicy = requestedProviderPolicy;

  if (executionDecision.strategy === "plan-only") {
    await writeFile(
      join(runDir, "plan.md"),
      `# Plan\n\nFlow: parallel\nIdentity: OMK root orchestrator\nDoctrine: Models execute. OMK routes, verifies, measures, and controls.\nWorkers: 0\nResource profile: ${resources.profile}\nMCP scope: ${mcpScope}\nSkills scope: ${resources.skillsScope}\nHooks scope: ${resources.hooksScope}\nCapability assignment: goal-scoped MCP/skills/hooks per worker lane\nExecution policy: ${executionPrompt}\nExecution strategy: plan-only\nApproval policy: ${approvalPolicy}\nProvider policy: ${providerPolicy}\n`
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
    `# Plan\n\nFlow: parallel\nIdentity: OMK root orchestrator\nDoctrine: Models execute. OMK routes, verifies, measures, and controls.\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nMCP scope: ${mcpScope}\nSkills scope: ${resources.skillsScope}\nHooks scope: ${resources.hooksScope}\nCapability assignment: goal-scoped MCP/skills/hooks per worker lane\nExecution policy: ${executionPrompt}\nExecution strategy: ${executionStrategy}\nApproval policy: ${approvalPolicy}\nProvider policy: ${providerPolicy}\n`
  );

  if (specNodes) {
    runState = createRoutedRunState({
      runId,
      startedAt,
      nodes: specNodes,
      workerCount,
      goalId,
      goalObjective: effectiveGoal,
      goalSnapshot,
      routeDecision: buildParallelRouteDecision(effectiveGoal, resolvedIntent),
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
  const promptText = buildPromptText(effectiveGoal, runId, resources.profile, workerCount, mcpScope, resolvedIntent, intentFrame, memoryRecall.summary, executionStrategy, options.orchestrationPrompt);
  const statePath = join(runDir, "state.json");

  const activePreset = await getActiveRuntimePreset();
  const routedState = assignPresetCapabilitiesToWorkers(
    routeRunState(runState, workerCount),
    activePreset,
    {
      mcpScope,
      skillsScope: resources.skillsScope,
      hooksScope: resources.hooksScope,
    }
  );
  await writeFile(statePath, JSON.stringify(routedState, null, 2));

  const dag = createExecutableDagFromState(routedState);
  await writeFile(
    join(runDir, "capability-routing.json"),
    `${JSON.stringify(renderCapabilityRoutingArtifact(dag.nodes, { goal: effectiveGoal }), null, 2)}\n`
  );

  const result = await executeParallelRun({
    runId,
    dag,
    routedState,
    statePath,
    options: {
      noPause: options.noPause,
      chat: options.chat,
      signal: options.signal,
      timeoutPreset: options.timeoutPreset,
      alternateScreen: options.alternateScreen,
      compact: options.compact,
      view: options.view,
      noWatch: options.noWatch,
      watch: options.watch,
    },
    root,
    runDir,
    resources,
    effectiveGoal,
    workerCount,
    approvalPolicy,
    providerPolicy,
    modelArg,
    mcpScope,
    executionPrompt,
    agentFile,
    promptText,
    intentFrame,
    deepseekPromptPrefix: buildDeepSeekPromptPrefix(effectiveGoal, runId, workerCount, resolvedIntent, intentFrame),
    executionStrategy,
  });

  return result;
}

function assignPresetCapabilitiesToWorkers(
  state: RunState,
  preset: OmkActivePreset | undefined,
  scopes: {
    mcpScope: OmkRuntimeScope;
    skillsScope: OmkRuntimeScope;
    hooksScope: OmkRuntimeScope;
  }
): RunState {
  if (!preset) return state;

  const next: RunState = {
    ...state,
    nodes: state.nodes.map((node) => {
      if (!node.routing || node.id === "bootstrap") return node;
      const roleScopes = capabilityScopesForRole(node.role, preset, scopes);
      const routing = {
        ...node.routing,
        skills: mergeUnique(node.routing.skills, roleScopes.skills),
        mcpServers: mergeUnique(node.routing.mcpServers, roleScopes.mcpServers),
        hooks: mergeUnique(node.routing.hooks, roleScopes.hooks),
        tools: mergeUnique(node.routing.tools, roleScopes.tools),
      };
      return {
        ...node,
        routing: {
          ...routing,
          assignedCapabilities: {
            ...(node.routing.assignedCapabilities ?? {}),
            skills: mergeUnique(node.routing.assignedCapabilities?.skills, routing.skills),
            mcpServers: mergeUnique(node.routing.assignedCapabilities?.mcpServers, routing.mcpServers),
            hooks: mergeUnique(node.routing.assignedCapabilities?.hooks, routing.hooks),
            tools: mergeUnique(node.routing.assignedCapabilities?.tools, routing.tools),
          },
        },
      };
    }),
  };
  return routeRunState(next, state.estimate?.totalNodes);
}

function capabilityScopesForRole(
  role: string,
  preset: OmkActivePreset,
  scopes: {
    mcpScope: OmkRuntimeScope;
    skillsScope: OmkRuntimeScope;
    hooksScope: OmkRuntimeScope;
  }
): { skills: string[]; mcpServers: string[]; hooks: string[]; tools: string[] } {
  const normalizedRole = role.toLowerCase();
  const skillHints = roleSkillHints(normalizedRole);
  const mcpHints = roleMcpHints(normalizedRole);
  const hookHints = roleHookHints(normalizedRole);

  return {
    skills: scopes.skillsScope === "none" ? [] : filterAvailable(preset.skills, skillHints),
    mcpServers: scopes.mcpScope === "none" ? [] : filterAvailable(preset.mcpServers, mcpHints),
    hooks: scopes.hooksScope === "none" ? [] : filterAvailable(preset.hooks, hookHints),
    tools: [],
  };
}

function roleSkillHints(role: string): string[] {
  if (role === "orchestrator" || role === "architect" || role === "planner") {
    return ["omk-plan-first", "omk-context-broker", "omk-task-router", "multica"];
  }
  if (role === "coder" || role === "executor" || role === "refactorer") {
    return ["omk-repo-explorer", "omk-context-broker", "omk-test-debug-loop", "omk-quality-gate"];
  }
  if (role === "reviewer" || role === "aggregator") {
    return ["omk-code-review", "omk-quality-gate", "omk-context-broker"];
  }
  if (role === "qa" || role === "tester") {
    return ["omk-quality-gate", "omk-test-debug-loop", "omk-context-broker"];
  }
  if (role === "security") {
    return ["omk-secret-guard", "omk-security-review", "omk-quality-gate", "omk-context-broker"];
  }
  if (role === "designer") {
    return ["omk-design-system", "omk-code-review", "omk-context-broker"];
  }
  return ["omk-context-broker", "omk-repo-explorer"];
}

function roleMcpHints(role: string): string[] {
  if (role === "orchestrator" || role === "architect" || role === "planner") {
    return ["omk-project", "context7", "github", "memory", "sequential-thinking"];
  }
  if (role === "coder" || role === "executor" || role === "refactorer") {
    return ["omk-project", "filesystem-readonly", "git", "context7"];
  }
  if (role === "reviewer" || role === "aggregator" || role === "qa" || role === "tester" || role === "security") {
    return ["omk-project", "filesystem-readonly", "git", "github"];
  }
  return ["omk-project", "filesystem-readonly"];
}

function roleHookHints(role: string): string[] {
  if (role === "coder" || role === "executor" || role === "refactorer") {
    return ["pre-shell-guard.sh", "protect-secrets.sh", "post-format.sh", "stop-verify.sh", "subagent-stop-audit.sh"];
  }
  if (role === "qa" || role === "tester" || role === "reviewer" || role === "aggregator" || role === "security") {
    return ["protect-secrets.sh", "stop-verify.sh", "subagent-stop-audit.sh"];
  }
  return ["subagent-stop-audit.sh", "protect-secrets.sh"];
}

function filterAvailable(available: readonly string[], requested: readonly string[]): string[] {
  const availableSet = new Set(available);
  return requested.filter((name) => availableSet.has(name));
}

function mergeUnique(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])].filter(Boolean))];
}
