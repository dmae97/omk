import { mkdir, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";

import { getOmkPath, getProjectRoot, pathExists, getRunPath } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { parseRuntimeScopeOption } from "../util/runtime-scope.js";
import { t } from "../util/i18n.js";
import type { RunState } from "../contracts/orchestration.js";
import { orchestratePrompt } from "../orchestration/orchestrate-prompt.js";
import type { ProviderPolicy } from "../providers/types.js";
import { normalizeProviderPolicy, parseProviderModelArg } from "../providers/model-registry.js";

import { createInteractiveRunState } from "./parallel/orchestrator.js";
import { refreshRunStateEstimate } from "../orchestration/run-state.js";
import { ensureCompletionArtifactContract } from "../orchestration/completion-artifacts.js";
interface RunCommandOptions {
  workers?: string;
  runId?: string;
  goalId?: string;
  timeoutPreset?: string;
  provider?: ProviderPolicy;
  model?: string;
  mcpScope?: string;
  execution?: string;
  dryRun?: boolean;
}

export async function runCommand(
  flow: string | undefined,
  goal: string | undefined,
  options: RunCommandOptions
): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);
  const modelArg = parseProviderModelArg(options.model);
  const providerPolicy = normalizeProviderPolicy(options.provider ?? modelArg.provider);
  const mcpScope = parseRuntimeScopeOption(options.mcpScope, resources.mcpScope, "--mcp-scope");

  let resolvedFlow = flow;
  let resolvedGoal = goal;
  let runId: string;
  let runDir: string;
  let startedAt: string;
  let isResume = false;
  let goalSnapshot: RunState["goalSnapshot"] | undefined;
  let currentState: RunState | undefined;

  // Load goal if --goal is provided
  if (options.goalId) {
    const { createGoalPersister } = await import("../goal/persistence.js");
    const goalPersister = createGoalPersister(join(root, ".omk", "goals"));
    const goalSpec = await goalPersister.load(options.goalId);
    if (!goalSpec) {
      console.error(status.error(`Goal not found: ${options.goalId}`));
      process.exit(1);
    }
    goalSnapshot = {
      title: goalSpec.title,
      objective: goalSpec.objective,
      successCriteria: goalSpec.successCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        requirement: c.requirement,
      })),
    };
    if (!resolvedGoal) {
      resolvedGoal = goalSpec.objective;
    }
  }

  if (options.runId) {
    isResume = true;
    runId = options.runId;
    runDir = getRunPath(runId);

    if (!(await pathExists(runDir))) {
      console.error(status.error(t("run.runNotFound", runId)));
      process.exit(1);
    }
    await ensureCompletionArtifactContract(root, runId);

    const [existingGoal, existingPlan] = await Promise.all([
      readFile(join(runDir, "goal.md"), "utf-8").catch(() => null),
      readFile(join(runDir, "plan.md"), "utf-8").catch(() => null),
    ]);
    const flowMatch = existingPlan?.match(/Flow:\s*(.+)/);
    const existingFlow = flowMatch ? flowMatch[1].trim() : null;

    if (!resolvedFlow) {
      if (!existingFlow) {
        console.error(status.error(t("run.flowRequired")));
        process.exit(1);
      }
      resolvedFlow = existingFlow;
    }
    if (!resolvedGoal && existingGoal) {
      resolvedGoal = existingGoal.replace(/^# Goal\n\n?/, "").trim();
    }

    startedAt = new Date().toISOString();
    currentState = await readRunState(runDir);

    // Update files if new flow/goal provided during resume
    if (goal) {
      await writeFile(join(runDir, "goal.md"), `# Goal\n\n${resolvedGoal}\n`);
    }
    if (flow) {
      await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${resolvedFlow}\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nMCP scope: ${mcpScope}\nSkills scope: ${resources.skillsScope}\nHooks scope: ${resources.hooksScope}\nCapability assignment: goal-scoped MCP/skills/hooks per worker lane\nProvider policy: ${providerPolicy}\n`);
    }
  } else {
    if (!resolvedFlow || !resolvedGoal) {
      console.error(status.error(t("run.flowGoalRequired")));
      process.exit(1);
    }
    runId = new Date().toISOString().replace(/[:.]/g, "-");
    runDir = getRunPath(runId);

    const flowPath = getOmkPath(`flows/${resolvedFlow}/SKILL.md`);
    const kimiFlowPath = join(root, ".kimi/skills", `omk-flow-${resolvedFlow}`, "SKILL.md");
    let resolvedFlowPath: string | null = null;
    if (await pathExists(flowPath)) {
      resolvedFlowPath = flowPath;
    } else if (await pathExists(kimiFlowPath)) {
      resolvedFlowPath = kimiFlowPath;
    }

    if (!resolvedFlowPath) {
      console.error(status.error(t("run.flowNotFound", resolvedFlow)));
      console.error(style.gray(t("run.availableFlows")));
      const flowsDir = getOmkPath("flows");
      try {
        const entries = await readdir(flowsDir, { withFileTypes: true });
        for (const e of entries.filter((d) => d.isDirectory())) {
          console.error(`   - ${e.name}`);
        }
      } catch {
        // ignore
      }
      const kimiFlowsDir = join(root, ".kimi/skills");
      try {
        const entries = await readdir(kimiFlowsDir, { withFileTypes: true });
        for (const e of entries.filter((d) => d.isDirectory() && d.name.startsWith("omk-flow-"))) {
          console.error(`   - ${e.name.replace("omk-flow-", "")}`);
        }
      } catch {
        // ignore
      }
      process.exit(1);
    }

    await mkdir(runDir, { recursive: true });
    await ensureCompletionArtifactContract(root, runId);
    startedAt = new Date().toISOString();
    await writeFile(join(runDir, "goal.md"), `# Goal\n\n${resolvedGoal}\n`);
    await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${resolvedFlow}\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nMCP scope: ${mcpScope}\nSkills scope: ${resources.skillsScope}\nHooks scope: ${resources.hooksScope}\nCapability assignment: goal-scoped MCP/skills/hooks per worker lane\nProvider policy: ${providerPolicy}\n`);
    const runState = createInteractiveRunState({
      runId,
      flow: resolvedFlow,
      goal: resolvedGoal,
      workerCount,
      startedAt,
      approvalPolicy: options.execution ?? "ask",
      goalId: options.goalId,
      goalSnapshot,
      profile: resources.profile,
      providerPolicy,
      executionStrategy: workerCount > 1 ? "parallel" : "sequential",
    });
    currentState = runState;
    await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));
  }

  console.log(header(isResume ? "Run resumed" : "Run started"));
  console.log(label("Run ID", runId));
  console.log(label("Flow", resolvedFlow));
  console.log(label("Goal", resolvedGoal ?? t("run.useExistingGoal")));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`));
  console.log(label("MCP scope", mcpScope));
  console.log(label("Provider policy", providerPolicy) + "\n");

  // Delegate execution to orchestratePrompt
  const rawPrompt = resolvedGoal ?? "";
  if (!rawPrompt) {
    console.error(status.error("No goal text available for orchestration."));
    process.exit(1);
  }

  if (options.dryRun) {
    currentState ??= await readRunState(runDir);
    if (currentState) {
      finalizeDryRunState(currentState, new Date().toISOString(), workerCount);
      await writeFile(join(runDir, "state.json"), JSON.stringify(currentState, null, 2));
    }
    const dryRunReport = buildRunDryRunReport({
      runId,
      flow: resolvedFlow ?? "unknown",
      goal: rawPrompt,
      workerCount,
      mcpScope,
      providerPolicy,
      timeoutPreset: options.timeoutPreset,
      state: currentState,
      runDir,
    });
    await writeFile(join(runDir, "dry-run.json"), `${JSON.stringify(dryRunReport, null, 2)}\n`);
    renderRunDryRunReport(dryRunReport);
    return;
  }

  if (options.timeoutPreset) {
    process.env.OMK_NODE_TIMEOUT_PRESET = options.timeoutPreset;
  }

  const abortController = new AbortController();
  let shuttingDown = false;
  let forceExitTimer: ReturnType<typeof setTimeout> | undefined;
  function handleSignal(): void {
    if (shuttingDown) {
      process.exit(1);
    }
    shuttingDown = true;
    abortController.abort();
    forceExitTimer = setTimeout(() => process.exit(1), 10_000);
    forceExitTimer.unref?.();
  }
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await orchestratePrompt(rawPrompt, {
      sourceCommand: "run",
      runId,
      workers: String(workerCount),
      goalId: options.goalId,
      timeoutPreset: options.timeoutPreset,
      provider: providerPolicy,
      model: modelArg.model,
      mcpScope,
      execution: options.execution,
      signal: abortController.signal,
    });
  } catch (err) {
    console.error(status.error(String(err)));
    process.exitCode = 1;
  } finally {
    if (forceExitTimer) clearTimeout(forceExitTimer);
  }
}

export function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  const effective = (value ?? process.env.OMK_WORKERS)?.trim();
  if (!effective || effective === "auto") return fallback;
  if (!/^\d+$/.test(effective)) return fallback;
  const parsed = Number(effective);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 6);
}

async function readRunState(runDir: string): Promise<RunState | undefined> {
  try {
    return JSON.parse(await readFile(join(runDir, "state.json"), "utf-8")) as RunState;
  } catch {
    return undefined;
  }
}

function finalizeDryRunState(state: RunState, completedAt: string, workerCount: number): void {
  state.completedAt = completedAt;
  state.updatedAt = completedAt;
  for (const node of state.nodes) {
    if (node.id === "bootstrap" || node.role === "omk") {
      node.status = "done";
      node.startedAt ??= state.startedAt;
      node.completedAt ??= state.startedAt;
      continue;
    }
    if (node.status === "done") continue;
    node.status = "skipped";
    delete node.startedAt;
    node.completedAt = completedAt;
    node.blockedReason = "dry-run: provider/runtime execution skipped";
  }
  refreshRunStateEstimate(state, workerCount);
}

function buildRunDryRunReport(input: {
  runId: string;
  flow: string;
  goal: string;
  workerCount: number;
  mcpScope: string;
  providerPolicy: ProviderPolicy;
  timeoutPreset?: string;
  state?: RunState;
  runDir: string;
}): Record<string, unknown> {
  return {
    ok: true,
    mode: "dry-run",
    providerFree: true,
    runId: input.runId,
    flow: input.flow,
    goal: input.goal,
    workerCount: input.workerCount,
    mcpScope: input.mcpScope,
    providerPolicy: input.providerPolicy,
    timeoutPreset: input.timeoutPreset ?? null,
    artifacts: {
      runDir: input.runDir,
      state: join(input.runDir, "state.json"),
      plan: join(input.runDir, "plan.md"),
      dryRun: join(input.runDir, "dry-run.json"),
    },
    nodes: (input.state?.nodes ?? []).map((node) => {
      const routing = node.routing as Record<string, unknown> | undefined;
      return {
        id: node.id,
        role: node.role,
        status: node.status,
        dependsOn: node.dependsOn,
        requiredCapabilities:
          routing?.assignedProviderCapabilities ?? routing?.assignedCapabilities ?? [],
        provider: routing?.assignedProvider ?? routing?.provider ?? input.providerPolicy,
        evidenceGates: (node.outputs ?? []).map((output) => output.gate ?? "none"),
        dryRunAction: node.id === "bootstrap" || node.role === "omk"
          ? "local-system-complete"
          : "would-route-to-runtime",
      };
    }),
    nextActions: [
      "Run `omk doctor --providers --json` to inspect live provider availability.",
      "Re-run without `--dry-run` once a live provider/runtime is configured.",
      "Inspect state.json and dry-run.json before enabling live execution.",
    ],
  };
}

function renderRunDryRunReport(report: Record<string, unknown>): void {
  const artifacts = report.artifacts as Record<string, string>;
  const nodes = report.nodes as Array<Record<string, unknown>>;
  console.log(header("Run dry-run"));
  console.log(label("Mode", "dry-run (provider-free)"));
  console.log(label("State", artifacts.state));
  console.log(label("Dry-run artifact", artifacts.dryRun));
  console.log(style.gray("DAG nodes:"));
  for (const node of nodes) {
    console.log(
      style.gray(`  - ${String(node.id)} [${String(node.role)}] ${String(node.dryRunAction)}`)
    );
  }
  console.log(status.ok("Provider/runtime execution skipped; artifacts are inspectable."));
}

