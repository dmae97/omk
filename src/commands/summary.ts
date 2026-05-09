import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join } from "path";
import type { RunState } from "../contracts/orchestration.js";
import { getProjectRoot, pathExists, getRunsDir, getRunPath } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";

interface RunSummary {
  runId: string;
  goalId?: string;
  goalSnapshot?: {
    title: string;
    objective: string;
    successCriteria: Array<{ id: string; description: string; requirement: string }>;
  };
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  totalNodes: number;
  done: number;
  failed: number;
  blocked: number;
  pending: number;
  running: number;
  successRate: number;
  providerRouting: {
    attempts: number;
    byProvider: Record<string, number>;
    fallbacks: Array<{
      nodeId: string;
      from: string;
      to: string;
      reason?: string;
    }>;
  };
  nodes: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    durationMs?: number;
    retries: number;
    blockedReason?: string;
    evidence?: Array<{ gate: string; passed: boolean }>;
  }>;
}

function computeProviderRouting(nodes: RunState["nodes"]): RunSummary["providerRouting"] {
  const byProvider: Record<string, number> = {};
  const fallbacks: RunSummary["providerRouting"]["fallbacks"] = [];
  let attempts = 0;

  for (const node of nodes) {
    for (const attempt of node.attempts ?? []) {
      if (!attempt.provider && !attempt.requestedProvider && !attempt.fallbackFrom) continue;
      attempts += 1;
      const provider = attempt.provider ?? attempt.requestedProvider ?? "unknown";
      byProvider[provider] = (byProvider[provider] ?? 0) + 1;
      if (attempt.fallbackFrom) {
        fallbacks.push({
          nodeId: node.id,
          from: attempt.fallbackFrom,
          to: attempt.provider ?? "unknown",
          reason: attempt.fallbackReason,
        });
      }
    }
  }

  return { attempts, byProvider, fallbacks };
}

async function findLatestRunId(root: string): Promise<string | null> {
  const dir = getRunsDir(root);
  if (!(await pathExists(dir))) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  const runs = await Promise.all(entries
    .filter((e) => e.isDirectory() && e.name !== "latest")
    .map(async (e) => {
      const runDir = join(dir, e.name);
      const state = await loadRunState(root, e.name);
      const timestamp = newestRunTimestamp(state) ?? (await stat(runDir).catch(() => null))?.mtimeMs ?? 0;
      return { id: e.name, timestamp };
    }));
  runs.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
  return runs[0]?.id ?? null;
}

function newestRunTimestamp(state: RunState | null): number | null {
  if (!state) return null;
  const candidates = [state.completedAt, state.startedAt]
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter((value) => Number.isFinite(value));
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

async function loadRunState(root: string, runId: string): Promise<RunState | null> {
  const filePath = getRunPath(runId, "state.json", root);
  if (!(await pathExists(filePath))) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as RunState;
  } catch {
    return null;
  }
}

function computeSummary(state: RunState): RunSummary {
  const nodes = state.nodes;
  const done = nodes.filter((n) => n.status === "done").length;
  const failed = nodes.filter((n) => n.status === "failed").length;
  const blocked = nodes.filter((n) => n.status === "blocked").length;
  const running = nodes.filter((n) => n.status === "running").length;
  const pending = nodes.filter((n) => n.status === "pending").length;
  const total = nodes.length;
  const completedAt = state.completedAt;
  const started = new Date(state.startedAt).getTime();
  const ended = completedAt ? new Date(completedAt).getTime() : Date.now();
  const durationMs = ended - started;
  const successRate = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    runId: state.runId,
    goalId: state.goalId,
    goalSnapshot: state.goalSnapshot,
    startedAt: state.startedAt,
    completedAt,
    durationMs,
    totalNodes: total,
    done,
    failed,
    blocked,
    pending,
    running,
    successRate,
    providerRouting: computeProviderRouting(nodes),
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      role: n.role,
      status: n.status,
      durationMs: n.durationMs,
      retries: n.retries ?? 0,
      blockedReason: n.blockedReason,
      evidence: n.evidence?.map((e) => ({ gate: e.gate, passed: e.passed })),
    })),
  };
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function generateSummaryMd(s: RunSummary): string {
  const lines: string[] = [
    `# Run Summary — ${s.runId}`,
    "",
    `- **Started:** ${s.startedAt}`,
    `- **Completed:** ${s.completedAt ?? "(in progress)"}`,
    `- **Duration:** ${formatDuration(s.durationMs)}`,
    "",
    "## Stats",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total nodes | ${s.totalNodes} |`,
    `| Done | ${s.done} |`,
    `| Failed | ${s.failed} |`,
    `| Blocked | ${s.blocked} |`,
    `| Running | ${s.running} |`,
    `| Pending | ${s.pending} |`,
    `| Success rate | ${s.successRate}% |`,
    "",
    "## Provider Routing",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Provider attempts | ${s.providerRouting.attempts} |`,
    `| Provider fallbacks | ${s.providerRouting.fallbacks.length} |`,
    ...Object.entries(s.providerRouting.byProvider)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, count]) => `| ${provider} attempts | ${count} |`),
    "",
    ...(s.providerRouting.fallbacks.length > 0
      ? [
          `| Node | From | To | Reason |`,
          `|------|------|----|--------|`,
          ...s.providerRouting.fallbacks.map(
            (fallback) => `| ${fallback.nodeId} | ${fallback.from} | ${fallback.to} | ${fallback.reason ?? "—"} |`
          ),
          "",
        ]
      : []),
    "## Nodes",
    "",
    `| ID | Name | Role | Status | Duration | Retries |`,
    `|----|------|------|--------|----------|---------|`,
  ];

  for (const n of s.nodes) {
    const dur = n.durationMs ? formatDuration(n.durationMs) : "—";
    lines.push(`| ${n.id} | ${n.name} | ${n.role} | ${n.status} | ${dur} | ${n.retries} |`);
  }

  lines.push("");
  return lines.join("\n");
}

function generateReportMd(s: RunSummary): string {
  const lines: string[] = [
    `# Run Report — ${s.runId}`,
    "",
    `**Duration:** ${formatDuration(s.durationMs)} · **Success rate:** ${s.successRate}%`,
    "",
    "## Executive Summary",
    "",
  ];

  if (s.goalSnapshot) {
    lines.push(`**Goal:** ${s.goalSnapshot.title}`);
    lines.push("");
  }

  if (s.failed === 0 && s.blocked === 0 && s.pending === 0 && s.running === 0) {
    lines.push(`All ${s.totalNodes} nodes completed successfully.`);
  } else if (s.pending > 0 || s.running > 0) {
    lines.push(`${s.done}/${s.totalNodes} nodes completed. ${s.pending} pending, ${s.running} running.`);
    lines.push(`${s.done}/${s.totalNodes} nodes completed. ${s.failed} failed, ${s.blocked} blocked.`);
  } else if (s.failed > 0) {
    lines.push(`${s.done}/${s.totalNodes} nodes completed. ${s.failed} node(s) failed.`);
  } else if (s.blocked > 0) {
    lines.push(`${s.done}/${s.totalNodes} nodes completed. ${s.blocked} node(s) blocked.`);
  } else {
    lines.push(`${s.done}/${s.totalNodes} nodes completed. Run is in progress.`);
  }

  lines.push("");

  if (s.providerRouting.attempts > 0) {
    const providerCounts = Object.entries(s.providerRouting.byProvider)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, count]) => `${provider}=${count}`)
      .join(", ");
    lines.push("## Provider Routing");
    lines.push("");
    lines.push(`- Attempts: ${s.providerRouting.attempts}`);
    lines.push(`- Provider counts: ${providerCounts || "none"}`);
    lines.push(`- Fallbacks: ${s.providerRouting.fallbacks.length}`);
    for (const fallback of s.providerRouting.fallbacks) {
      lines.push(`  - ${fallback.nodeId}: ${fallback.from} → ${fallback.to}${fallback.reason ? ` (${fallback.reason})` : ""}`);
    }
    lines.push("");
  }

  if (s.goalSnapshot && s.goalSnapshot.successCriteria.length > 0) {
    lines.push("## Goal Success Criteria");
    lines.push("");
    for (const c of s.goalSnapshot.successCriteria) {
      lines.push(`- **${c.id}** (${c.requirement}): ${c.description}`);
    }
    lines.push("");
  }

  const failedNodes = s.nodes.filter((n) => n.status === "failed");
  if (failedNodes.length > 0) {
    lines.push("## Failed Nodes");
    lines.push("");
    for (const n of failedNodes) {
      lines.push(`### ${n.id} — ${n.name}`);
      lines.push(`- Role: ${n.role}`);
      lines.push(`- Retries: ${n.retries}`);
      if (n.evidence && n.evidence.length > 0) {
        lines.push(`- Evidence:`);
        for (const e of n.evidence) {
          lines.push(`  - ${e.gate}: ${e.passed ? "PASS" : "FAIL"}`);
        }
      }
      lines.push("");
    }
  }

  const blockedNodes = s.nodes.filter((n) => n.status === "blocked");
  if (blockedNodes.length > 0) {
    lines.push("## Blocked Nodes");
    lines.push("");
    for (const n of blockedNodes) {
      lines.push(`- **${n.id}** — ${n.name}: ${n.blockedReason ?? "dependency failure"}`);
    }
    lines.push("");
  }

  const doneNodes = s.nodes.filter((n) => n.status === "done" && n.evidence && n.evidence.length > 0);
  if (doneNodes.length > 0) {
    lines.push("## Evidence Gates");
    lines.push("");
    for (const n of doneNodes) {
      const gates = n.evidence!.map((e) => `${e.gate}=${e.passed ? "✓" : "✗"}`).join(", ");
      lines.push(`- **${n.id}**: ${gates}`);
    }
    lines.push("");
  }

  lines.push("## Node Details");
  lines.push("");
  lines.push(`| ID | Name | Role | Status | Duration | Retries |`);
  lines.push(`|----|------|------|--------|----------|---------|`);
  for (const n of s.nodes) {
    const dur = n.durationMs ? formatDuration(n.durationMs) : "—";
    lines.push(`| ${n.id} | ${n.name} | ${n.role} | ${n.status} | ${dur} | ${n.retries} |`);
  }
  lines.push("");

  return lines.join("\n");
}

export async function summaryLatestCommand(): Promise<void> {
  const root = await getProjectRoot();
  const latestId = await findLatestRunId(root);
  if (!latestId) {
    console.error(status.error("No runs found."));
    process.exit(1);
  }

  const state = await loadRunState(root, latestId);
  if (!state) {
    console.error(status.error(`Run state not found for ${latestId}`));
    process.exit(1);
  }

  if (state.schemaVersion !== 1) {
    console.warn(status.warn(`Run state schemaVersion is missing or outdated for ${latestId}. Continuing with summary generation.`));
  }

  const summary = computeSummary(state);
  const summaryMd = generateSummaryMd(summary);
  const reportMd = generateReportMd(summary);

  const runDir = getRunPath(latestId, undefined, root);
  await writeFile(join(runDir, "summary.md"), summaryMd);
  await writeFile(join(runDir, "report.md"), reportMd);

  console.log(header("Run Summary Generated"));
  console.log(label("Run ID", summary.runId));
  console.log(label("Duration", formatDuration(summary.durationMs)));
  console.log(label("Nodes", `${summary.done}/${summary.totalNodes} done`));
  if (summary.providerRouting.attempts > 0) {
    console.log(label("Provider attempts", String(summary.providerRouting.attempts)));
    console.log(label("Provider fallbacks", String(summary.providerRouting.fallbacks.length)));
  }
  if (summary.failed > 0) console.log(label("Failed", String(summary.failed)));
  if (summary.blocked > 0) console.log(label("Blocked", String(summary.blocked)));
  console.log("");
  console.log(status.success(`summary.md → ${join(runDir, "summary.md")}`));
  console.log(status.success(`report.md → ${join(runDir, "report.md")}`));
}

export async function summaryShowCommand(runId?: string): Promise<void> {
  const root = await getProjectRoot();
  const targetId = runId ?? (await findLatestRunId(root));
  if (!targetId) {
    console.error(status.error("No runs found."));
    process.exit(1);
  }

  const state = await loadRunState(root, targetId);
  if (!state) {
    console.error(status.error(`Run state not found for ${targetId}`));
    process.exit(1);
  }

  if (state.schemaVersion !== 1) {
    console.warn(status.warn(`Run state schemaVersion is missing or outdated for ${targetId}. Continuing with summary generation.`));
  }

  const summary = computeSummary(state);
  console.log(header(`Run: ${summary.runId}`));
  console.log("");
  console.log(label("Duration", formatDuration(summary.durationMs)));
  console.log(label("Success rate", `${summary.successRate}%`));
  console.log(label("Done", String(summary.done)));
  console.log(label("Failed", String(summary.failed)));
  console.log(label("Blocked", String(summary.blocked)));
  console.log(label("Running", String(summary.running)));
  console.log(label("Pending", String(summary.pending)));
  if (summary.providerRouting.attempts > 0) {
    const providers = Object.entries(summary.providerRouting.byProvider)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, count]) => `${provider}=${count}`)
      .join(", ");
    console.log(label("Provider attempts", `${summary.providerRouting.attempts}${providers ? ` (${providers})` : ""}`));
    console.log(label("Provider fallbacks", String(summary.providerRouting.fallbacks.length)));
  }
  console.log("");
  console.log(style.purpleBold("Nodes"));
  for (const n of summary.nodes) {
    const marker =
      n.status === "done"
        ? style.mint("✓")
        : n.status === "failed"
          ? style.pink("✗")
          : n.status === "blocked"
            ? style.orange("⊘")
            : style.gray("○");
    const dur = n.durationMs ? style.gray(`(${formatDuration(n.durationMs)})`) : "";
    console.log(`  ${marker} ${style.cream(n.id)} ${style.gray(n.name)} ${dur}`);
  }
}
