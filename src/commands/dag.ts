import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { style, header, status, label } from "../util/theme.js";
import { getProjectRoot, pathExists, readTextFile, getOmkPath, getRunPath, getRunsDir } from "../util/fs.js";
import { createDag } from "../orchestration/dag.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { checkEvidenceGates } from "../orchestration/evidence-gate.js";
import { createExecutor } from "../orchestration/executor.js";
import { createExecutableDagFromState, routeRunState } from "../orchestration/run-state.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { listWorktrees } from "../util/worktree.js";
import { appendEvent } from "../util/events-logger.js";
import { t } from "../util/i18n.js";
import { createProviderBackedTaskRunner } from "../providers/provider-runtime.js";
import type { ProviderPolicy } from "../providers/types.js";
import type { RunState } from "../contracts/orchestration.js";

export async function dagValidateCommand(filePath?: string): Promise<void> {
  const root = getProjectRoot();
  const target = filePath ?? join(root, ".omk", "dag.json");

  if (!(await pathExists(target))) {
    throw new Error(`DAG definition not found: ${target}`);
  }

  const content = await readFile(target, "utf-8");
  let def: unknown;
  try {
    def = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON in DAG definition");
  }

  if (!def || typeof def !== "object" || !("nodes" in def)) {
    throw new Error("DAG definition must have a 'nodes' array");
  }

  try {
    createDag(def as { nodes: import("../orchestration/dag.js").DagNodeDefinition[] });
    console.log(status.ok("DAG is valid"));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`DAG validation failed: ${message}`);
  }
}

export async function dagShowCommand(runId: string): Promise<void> {
  const root = getProjectRoot();
  const persister = createStatePersister(getRunsDir(root));
  const state = await persister.load(runId);

  if (!state) {
    console.error(status.error(`Run not found: ${runId}`));
    process.exit(1);
  }

  console.log(header(`DAG Run: ${runId}`));
  console.log(label("Started", state.startedAt));
  if (state.completedAt) {
    console.log(label("Completed", state.completedAt));
  }
  console.log(label("Nodes", String(state.nodes.length)));
  console.log("");

  const statusColor = (s: string): string => {
    switch (s) {
      case "done": return style.mint(s);
      case "running": return style.purple(s);
      case "failed": return style.pink(s);
      case "blocked": return style.skin(s);
      case "skipped": return style.gray(s);
      default: return style.blue(s);
    }
  };

  const rows = state.nodes.map((node) => [
    node.id,
    node.name,
    node.role,
    statusColor(node.status),
    node.dependsOn.join(", ") || "—",
    node.durationMs ? `${node.durationMs}ms` : "—",
    node.retries ? String(node.retries) : "—",
  ]);

  console.log(
    renderTable(
      ["ID", "Name", "Role", "Status", "Deps", "Duration", "Retries"],
      rows
    )
  );

  if (state.estimate) {
    console.log("");
    console.log(label("Progress", `${state.estimate.percentComplete}%`));
    console.log(label("ETA", state.estimate.estimatedCompletedAt ?? "—"));
    console.log(label("Confidence", state.estimate.confidence));
  }

  // Evidence summary
  const nodesWithEvidence = state.nodes.filter((n) => n.evidence && n.evidence.length > 0);
  if (nodesWithEvidence.length > 0) {
    console.log("");
    console.log(style.purpleBold("Evidence Gates"));
    for (const node of nodesWithEvidence) {
      for (const ev of node.evidence!) {
        const icon = ev.passed ? "✓" : "✗";
        const color = ev.passed ? style.mint : style.pink;
        console.log(color(`  ${icon} ${node.id}: ${ev.gate}${ev.ref ? ` (${ev.ref})` : ""} — ${ev.message}`));
      }
    }
  }
}

export async function dagReplayCommand(
  runId: string,
  target?: string,
  subtarget?: string,
  options?: { node?: string; fromFailure?: boolean; dryRun?: boolean; provider?: ProviderPolicy }
): Promise<void> {
  const root = getProjectRoot();
  const resolvedRunId = runId === "latest" ? await resolveLatestRunId(getRunsDir(root)) : runId;

  if (!resolvedRunId) {
    console.error(status.error(t("run.replayNotFound", runId)));
    process.exit(1);
  }

  const runDir = getRunPath(resolvedRunId, undefined, root);
  const persister = createStatePersister(getRunsDir(root));
  const state = await persister.load(resolvedRunId);

  if (!state) {
    console.error(status.error(t("run.replayNotFound", resolvedRunId)));
    process.exit(1);
  }

  // ── Evidence gate replay (backward compatible) ──
  if (target === "evidence" && subtarget === "gate") {
    console.log(header(`Replaying evidence gates for run: ${resolvedRunId}`));
    let passedCount = 0;
    let failedCount = 0;

    for (const node of state.nodes) {
      if (node.status !== "done" || !node.outputs || node.outputs.length === 0) continue;

      const gates: import("../orchestration/evidence-gate.js").EvidenceGate[] = [];
      for (const output of node.outputs) {
        switch (output.gate) {
          case "file-exists":
            if (output.ref) gates.push({ type: "file-exists", path: output.ref });
            break;
          case "test-pass":
            gates.push({ type: "command-pass", command: output.ref ?? "npm test" });
            break;
          case "review-pass":
          case "summary":
            gates.push({ type: "summary-present", summaryMarker: output.ref ?? "## Summary" });
            break;
          default:
            break;
        }
      }

      if (gates.length === 0) continue;

      const result = await checkEvidenceGates(gates, {
        cwd: root,
        stdout: "",
        nodeId: node.id,
      });

      for (const ev of result.evidence) {
        const icon = ev.passed ? "✓" : "✗";
        const color = ev.passed ? style.mint : style.pink;
        console.log(color(`  ${icon} ${node.id}: ${ev.gate}${ev.ref ? ` (${ev.ref})` : ""} — ${ev.message}`));
        if (ev.passed) passedCount++; else failedCount++;
      }
    }

    console.log("");
    console.log(style.mint(`Passed: ${passedCount}`));
    console.log(style.pink(`Failed: ${failedCount}`));
    if (failedCount > 0) process.exitCode = 1;
    return;
  }

  // ── DAG replay ──
  const [goalText, planText] = await Promise.all([
    readFile(join(runDir, "goal.md"), "utf-8")
      .then((c) => c.replace(/^# Goal\n\n?/, "").trim())
      .catch(() => ""),
    readFile(join(runDir, "plan.md"), "utf-8").catch(() => ""),
  ]);
  const flowMatch = planText.match(/Flow:\s*(.+)/m);
  const flow = flowMatch ? flowMatch[1].trim() : null;
  const workersMatch = planText.match(/Workers:\s*(\d+)/m);
  const workerCount = normalizeReplayWorkerCount(workersMatch?.[1]);

  // Determine which nodes to reset
  const nodesToReset = new Set<string>();
  let mode: "full" | "node" | "from-failure" = "full";

  if (options?.node) {
    mode = "node";
    const targetNode = state.nodes.find((n) => n.id === options.node);
    if (!targetNode) {
      console.error(status.error(t("run.replayNodeNotFound", options.node)));
      process.exit(1);
    }
    nodesToReset.add(options.node);
    addTransitiveDependents(state.nodes, options.node, nodesToReset);
  } else if (options?.fromFailure) {
    mode = "from-failure";
    const failedNodes = state.nodes.filter((n) => n.status === "failed" || n.status === "blocked");
    if (failedNodes.length === 0) {
      console.error(status.error(t("run.replayNoFailedNodes")));
      process.exit(1);
    }
    for (const node of failedNodes) {
      nodesToReset.add(node.id);
      addTransitiveDependents(state.nodes, node.id, nodesToReset);
    }
  } else {
    // Full replay: reset all non-bootstrap nodes
    for (const node of state.nodes) {
      if (node.id !== "bootstrap") nodesToReset.add(node.id);
    }
  }

  // Recover worktrees
  let worktreePaths: string[] = [];
  try {
    worktreePaths = await listWorktrees(resolvedRunId);
  } catch {
    // ignore
  }

  // Reset selected nodes
  for (const node of state.nodes) {
    if (!nodesToReset.has(node.id)) continue;
    node.status = "pending";
    node.retries = 0;
    node.startedAt = undefined;
    node.completedAt = undefined;
    node.durationMs = undefined;
    node.attempts = undefined;
    node.evidence = undefined;
    node.blockedReason = undefined;
    node.thinking = undefined;

    const existingWt = worktreePaths.find((wt) => wt.endsWith(`/${node.id}`));
    if (existingWt) {
      node.worktree = existingWt;
    }
  }

  const statePath = join(runDir, "state.json");
  const routedState = routeRunState(state, workerCount);
  await persister.save(routedState);

  if (options?.dryRun) {
    console.log(header(`[DRY RUN] Replay DAG run: ${resolvedRunId}`));
    console.log(label("Mode", mode));
    if (mode === "node") console.log(label("Target node", options.node!));
    console.log(label("Nodes reset", String(nodesToReset.size)));
    console.log("");
    const resetIds = state.nodes
      .filter((n) => nodesToReset.has(n.id))
      .map((n) => `  - ${n.id}: ${n.name} (${n.role})${n.worktree ? ` [worktree: ${n.worktree}]` : ""}`);
    console.log(style.cream("Nodes that would be replayed:"));
    console.log(resetIds.join("\n"));
    return;
  }

  // ── Reconstruct prompt ──
  const resources = await getOmkResourceSettings();
  const flowPath = flow ? getOmkPath(`flows/${flow}/SKILL.md`) : null;
  const kimiFlowPath = flow ? join(root, ".kimi/skills", `omk-flow-${flow}`, "SKILL.md") : null;

  let resolvedFlowPath: string | null = null;
  if (flowPath && (await pathExists(flowPath))) {
    resolvedFlowPath = flowPath;
  } else if (kimiFlowPath && (await pathExists(kimiFlowPath))) {
    resolvedFlowPath = kimiFlowPath;
  }

  const flowContent = resolvedFlowPath ? await readTextFile(resolvedFlowPath) : "";

  const promptLines = [
    `Flow: ${flow ?? "unknown"}`,
    `Goal: ${goalText}`,
    `Run ID: ${resolvedRunId}`,
    `Resource profile: ${resources.profile}`,
    `Worker budget: ${workerCount}`,
    ``,
    `🔁 REPLAY MODE: This is a forensic replay of a previous run.`,
  ];
  if (mode === "node") {
    promptLines.push(`Target node: ${options?.node} (and dependents)`);
  } else if (mode === "from-failure") {
    promptLines.push(`Target: failed/blocked nodes (and dependents)`);
  } else {
    promptLines.push(`Target: full replay`);
  }
  promptLines.push(
    ``,
    t("run.planPrompt"),
    ``,
    `SKILLS & MCP USAGE (MANDATORY):`,
    `- Activate relevant skills from the routing hints for each node.`,
    `- Use MCP servers (omk-project, memory, quality-gate, etc.) when they fit the task.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`,
    ``,
    flowContent,
  );
  const promptText = promptLines.join("\n");

  // ── Set up DAG and executor ──
  const dag = createExecutableDagFromState(routedState);
  const executor = createExecutor({
    persister: createStatePersister(getRunsDir(root)),
    resumeFromState: routedState,
  });

  // Wire event logging
  executor.onNodeStart?.((node) => {
    void appendEvent(runDir, { type: "node-start", runId: resolvedRunId, nodeId: node.id });
  });
  executor.onNodeComplete?.((node, result) => {
    void appendEvent(runDir, {
      type: "node-complete",
      runId: resolvedRunId,
      nodeId: node.id,
      data: { success: result.success, exitCode: result.exitCode },
    });
  });
  executor.onStateChange((s) => {
    void appendEvent(runDir, {
      type: "state-change",
      runId: resolvedRunId,
      data: {
        doneCount: s.nodes.filter((n) => n.status === "done").length,
        failedCount: s.nodes.filter((n) => n.status === "failed").length,
        blockedCount: s.nodes.filter((n) => n.status === "blocked").length,
      },
    });
  });

  // ── Create runner ──
  const agentFile = getOmkPath("agents/root.yaml");
  const providerPolicy = normalizeProviderPolicy(options?.provider);
  const runner = await createProviderBackedTaskRunner({
    providerPolicy,
    deepseekPromptPrefix: buildReplayDeepSeekPromptPrefix({
      goalText,
      runId: resolvedRunId,
      mode,
      targetNode: options?.node,
    }),
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
        ...createOmkSessionEnv(root, resolvedRunId),
        OMK_RUN_ID: resolvedRunId,
        OMK_FLOW: flow ?? "",
        OMK_GOAL: goalText,
        OMK_WORKERS: String(workerCount),
        OMK_DAG_ROUTING: "1",
        OMK_DAG_STATE_PATH: statePath,
        OMK_MCP_SCOPE: resources.mcpScope,
        OMK_SKILLS_SCOPE: resources.skillsScope,
      },
    },
  });

  // ── Emit replay-start event ──
  await appendEvent(runDir, {
    type: "replay-start",
    runId: resolvedRunId,
    data: { mode, targetNode: options?.node },
  });

  console.log(header(`Replaying DAG run: ${resolvedRunId}`));
  console.log(label("Mode", mode));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Provider policy", providerPolicy));
  console.log(label("Nodes reset", String(nodesToReset.size)));
  console.log("");

  const approvalPolicy = await loadApprovalPolicy(root);
  const result = await executor.execute(dag, runner, {
    runId: resolvedRunId,
    workers: workerCount,
    approvalPolicy,
  });

  // ── Emit replay-end event ──
  await appendEvent(runDir, {
    type: "replay-end",
    runId: resolvedRunId,
    data: { success: result.success },
  });

  console.log("");
  if (result.success) {
    console.log(status.ok("Replay complete"));
  } else {
    console.log(status.error("Replay failed"));
    process.exitCode = 1;
  }
  console.log(label("State", statePath));
}

// ── Helpers ──

export function normalizeReplayWorkerCount(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 6);
}

async function resolveLatestRunId(runsDir: string): Promise<string | null> {
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 0) return null;

    const withMtime = await Promise.all(
      dirs.map(async (d) => {
        const st = await stat(join(runsDir, d.name, "state.json")).catch(() => null);
        return { name: d.name, mtime: st?.mtimeMs ?? 0 };
      })
    );

    withMtime.sort((a, b) => b.mtime - a.mtime);
    return withMtime[0]!.name;
  } catch {
    return null;
  }
}

function addTransitiveDependents(
  nodes: RunState["nodes"],
  startId: string,
  out: Set<string>
): void {
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const arr = dependents.get(dep) ?? [];
      arr.push(node.id);
      dependents.set(dep, arr);
    }
  }

  const queue = [startId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const d of dependents.get(current) ?? []) {
      if (!visited.has(d)) {
        out.add(d);
        queue.push(d);
      }
    }
  }
}

async function loadApprovalPolicy(root: string): Promise<"interactive" | "auto" | "yolo" | "block"> {
  const configPath = join(root, ".omk", "config.toml");
  try {
    const content = await readFile(configPath, "utf-8");
    const match = content.match(/^approval_policy\s*=\s*["']([^"']+)["']/m);
    const value = match?.[1]?.trim().toLowerCase();
    if (value === "interactive" || value === "auto" || value === "yolo" || value === "block") {
      return value;
    }
  } catch {
    // ignore missing config
  }
  return "interactive";
}

function renderTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );

  const pad = (str: string, width: number) => str + " ".repeat(Math.max(0, width - str.length));

  const headerLine = "  " + headers.map((h, i) => style.purpleBold(pad(h, colWidths[i]))).join("  ");
  const separator = "  " + colWidths.map((w) => "─".repeat(w)).join("  ");
  const body = rows.map((row) =>
    "  " + row.map((cell, i) => pad(cell, colWidths[i])).join("  ")
  ).join("\n");

  return [headerLine, separator, body].join("\n");
}

function normalizeProviderPolicy(value: string | undefined): ProviderPolicy {
  return value === "kimi" ? "kimi" : "auto";
}

function buildReplayDeepSeekPromptPrefix(input: {
  goalText: string;
  runId: string;
  mode: string;
  targetNode?: string;
}): string {
  return [
    `Kimi DAG replay context.`,
    `Run ID: ${input.runId}`,
    `Replay mode: ${input.mode}`,
    input.targetNode ? `Target node: ${input.targetNode}` : "",
    `Goal: ${input.goalText}`,
    `DeepSeek is advisory/read-only unless the provider router selects a direct low-risk read node.`,
    `Kimi keeps write, shell, merge, MCP, and final synthesis authority.`,
  ].filter(Boolean).join("\n");
}
