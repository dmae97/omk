import { mkdir, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";

import { getOmkPath, getProjectRoot, pathExists, getRunPath } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { t } from "../util/i18n.js";
import { createRoutedRunState, refreshRunStateEstimate } from "../orchestration/run-state.js";
import { buildCapabilityAgentNodes, isCapabilityAgentNode } from "../orchestration/capability-agents.js";
import type { RunState } from "../contracts/orchestration.js";
import { orchestratePrompt } from "../orchestration/orchestrate-prompt.js";
import type { ProviderPolicy } from "../providers/types.js";

export async function runCommand(
  flow: string | undefined,
  goal: string | undefined,
  options: { workers?: string; runId?: string; goalId?: string; timeoutPreset?: string; provider?: ProviderPolicy }
): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);
  const providerPolicy = normalizeProviderPolicy(options.provider);

  let resolvedFlow = flow;
  let resolvedGoal = goal;
  let runId: string;
  let runDir: string;
  let startedAt: string;
  let isResume = false;
  let goalSnapshot: RunState["goalSnapshot"] | undefined;

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

    // Update files if new flow/goal provided during resume
    if (goal) {
      await writeFile(join(runDir, "goal.md"), `# Goal\n\n${resolvedGoal}\n`);
    }
    if (flow) {
      await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${resolvedFlow}\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nProvider policy: ${providerPolicy}\n`);
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
    startedAt = new Date().toISOString();
    await writeFile(join(runDir, "goal.md"), `# Goal\n\n${resolvedGoal}\n`);
    await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${resolvedFlow}\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nProvider policy: ${providerPolicy}\n`);
    const runState = createInteractiveRunState({
      runId,
      flow: resolvedFlow,
      goal: resolvedGoal,
      workerCount,
      startedAt,
      goalId: options.goalId,
      goalSnapshot,
    });
    await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));
  }

  console.log(header(isResume ? "Run resumed" : "Run started"));
  console.log(label("Run ID", runId));
  console.log(label("Flow", resolvedFlow));
  console.log(label("Goal", resolvedGoal ?? t("run.useExistingGoal")));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`) + "\n");
  console.log(label("Provider policy", providerPolicy));

  // Delegate execution to orchestratePrompt
  const rawPrompt = resolvedGoal ?? "";
  if (!rawPrompt) {
    console.error(status.error("No goal text available for orchestration."));
    process.exit(1);
  }

  if (options.timeoutPreset) {
    process.env.OMK_NODE_TIMEOUT_PRESET = options.timeoutPreset;
  }

  try {
    await orchestratePrompt(rawPrompt, {
      sourceCommand: "run",
      runId,
      workers: String(workerCount),
      goalId: options.goalId,
      timeoutPreset: options.timeoutPreset,
      provider: providerPolicy,
    });
  } catch (err) {
    console.error(status.error(String(err)));
    process.exitCode = 1;
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

function normalizeProviderPolicy(value: string | undefined): ProviderPolicy {
  return value === "kimi" ? "kimi" : "auto";
}

function createInteractiveRunState(input: {
  runId: string;
  flow: string;
  goal: string;
  workerCount: number;
  startedAt: string;
  goalId?: string;
  goalSnapshot?: RunState["goalSnapshot"];
}): RunState {
  const capabilityAgentNodes = input.workerCount > 1
    ? buildCapabilityAgentNodes({
      goal: input.goal,
      dependsOn: ["root-coordinator"],
      maxAgents: 3,
      seedId: "run-capability-routing-seed",
      seedName: `Route active MCP, skills, and hooks for: ${input.goal}`,
    })
    : [];
  const capabilityInputs = capabilityAgentNodes.map((node) => ({
    name: node.outputs?.[0]?.name ?? node.name,
    ref: "state.json",
    from: node.id,
    required: !isCapabilityAgentNode(node),
  }));
  const state = createRoutedRunState({
    runId: input.runId,
    startedAt: input.startedAt,
    workerCount: input.workerCount,
    goalId: input.goalId,
    goalSnapshot: input.goalSnapshot,
    nodes: [
      {
        id: "bootstrap",
        name: `Prepare ${input.flow} run`,
        role: "omk",
        dependsOn: [],
        maxRetries: 1,
        startedAt: input.startedAt,
        completedAt: input.startedAt,
      },
      {
        id: "root-coordinator",
        name: `Coordinate: ${input.goal}`,
        role: "orchestrator",
        dependsOn: ["bootstrap"],
        maxRetries: 1,
        startedAt: input.startedAt,
        outputs: [{ name: "worker plan", gate: "summary" }],
      },
      {
        id: "worker-fanout",
        name: `${input.workerCount} worker budget`,
        role: "router",
        dependsOn: ["root-coordinator"],
        maxRetries: 1,
        inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
        outputs: [{ name: "worker outputs", gate: "summary" }],
      },
      ...capabilityAgentNodes,
      {
        id: "review-merge",
        name: "Review, verify, and merge outputs",
        role: "reviewer",
        dependsOn: ["worker-fanout", ...capabilityAgentNodes.map((node) => node.id)],
        maxRetries: 1,
        inputs: [{ name: "worker outputs", ref: "state.json", from: "worker-fanout" }, ...capabilityInputs],
        outputs: [{ name: "verified result", gate: "review-pass" }],
      },
    ],
  });
  const bootstrap = state.nodes.find((node) => node.id === "bootstrap");
  if (bootstrap) {
    bootstrap.status = "done";
    bootstrap.startedAt = input.startedAt;
    bootstrap.completedAt = input.startedAt;
  }
  const coordinator = state.nodes.find((node) => node.id === "root-coordinator");
  if (coordinator) {
    coordinator.status = "running";
    coordinator.startedAt = input.startedAt;
  }
  return refreshRunStateEstimate(state, input.workerCount);
}
