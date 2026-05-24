/**
 * OMK Chat Cockpit — telemetry/state aggregation.
 */

import { readFile } from "fs/promises";
import type { CockpitRailModel } from "../../cockpit/types.js";
import {
  type RunViewModel,
} from "../../util/run-view-model.js";
import type { RunState } from "../../contracts/orchestration.js";
import { getOmkVersionSync } from "../../util/version.js";
import { type UsageStats } from "../../kimi/usage.js";
import { type TodoItem } from "../../util/todo-sync.js";
import { type SessionMeta } from "../../util/session.js";
import { type TelemetryEvent } from "../../util/events-logger.js";
import { getRunPath } from "../../util/fs.js";
import { getSystemUsage } from "../../util/theme.js";
import {
  type CockpitDashboardSnapshot,
  type CockpitDeepSeekRunUsage,
  type CockpitDeepSeekRequest,
  type CockpitResourceSnapshot,
  type CockpitDeepSeekSnapshot,
  statusRank,
  formatElapsed,
  gitStatusPriority,
  formatDeepSeekBalance,
  isRecord,
} from "./utils.js";

export function parseHarnessRuntimeContract(value: unknown): CockpitDashboardSnapshot["runtimeContract"] {
  if (!isRecord(value)) return null;
  const resources = isRecord(value.resources) ? value.resources : null;
  const active = resources && isRecord(resources.active) ? resources.active : null;
  const scopes = resources && isRecord(resources.scopes) ? resources.scopes : null;
  const gates = Array.isArray(value.gates) ? value.gates : null;
  const maxStepsRaw = resources?.maxStepsPerTurn ?? value.maxStepsPerTurn;
  const maxStepsPerTurn = typeof maxStepsRaw === "number"
    ? maxStepsRaw
    : typeof maxStepsRaw === "string" && /^\d+$/.test(maxStepsRaw)
      ? Number.parseInt(maxStepsRaw, 10)
      : null;
  const mcpCount = active && Array.isArray(active.mcp)
    ? active.mcp.length
    : typeof value.mcpCount === "number"
      ? value.mcpCount
      : 0;
  const skillCount = active && Array.isArray(active.skills)
    ? active.skills.length
    : typeof value.skillCount === "number"
      ? value.skillCount
      : 0;
  const hookCount = active && Array.isArray(active.hooks)
    ? active.hooks.length
    : typeof value.hookCount === "number"
      ? value.hookCount
      : 0;
  const scope = scopes && typeof scopes.mcp === "string"
    ? scopes.mcp
    : typeof value.scope === "string"
      ? value.scope
      : "--";
  const workerCap = typeof resources?.workerCap === "number"
    ? resources.workerCap
    : typeof value.workerCap === "number"
      ? value.workerCap
      : null;
  const gateCount = gates ? gates.length : typeof value.gateCount === "number" ? value.gateCount : 0;
  return { mcpCount, skillCount, hookCount, scope, workerCap, maxStepsPerTurn, gateCount };
}

export async function buildCockpitSnapshot(
  vm: RunViewModel,
  todos: TodoItem[] | null,
  primaryUsage: UsageStats | null,
  resources: CockpitResourceSnapshot | null,
  deepSeek: CockpitDeepSeekSnapshot | null,
  deepSeekUsage: CockpitDeepSeekRunUsage,
  deepSeekRequests: CockpitDeepSeekRequest[],
  sysUsage: ReturnType<typeof getSystemUsage> | null,
  gitChanges: { status: string; path: string }[],
  sessionMeta: SessionMeta | null,
  stateError: RunViewModel["stateError"],
  latestRunName: string | null,
): Promise<CockpitDashboardSnapshot> {
  let runtimeContract: CockpitDashboardSnapshot["runtimeContract"] = null;
  if (latestRunName) {
    try {
      const harnessPath = getRunPath(latestRunName, "chat-agent-harness.json");
      const raw = await readFile(harnessPath, "utf-8");
      runtimeContract = parseHarnessRuntimeContract(JSON.parse(raw) as unknown);
    } catch {
      runtimeContract = null;
    }
  }

  const worktreeCounts = { M: 0, A: 0, D: 0, "?": 0, R: 0 };
  for (const change of gitChanges) {
    const normalized = change.status.replace(/\s/g, "");
    if (normalized.includes("M")) worktreeCounts.M++;
    else if (normalized.includes("A")) worktreeCounts.A++;
    else if (normalized.includes("D")) worktreeCounts.D++;
    else if (normalized === "??") worktreeCounts["?"]++;
    else if (normalized.includes("R")) worktreeCounts.R++;
  }

  const topPaths = [...gitChanges]
    .sort((a, b) => gitStatusPriority(b.status) - gitStatusPriority(a.status))
    .slice(0, 5)
    .map((c) => c.path);

  const sortedTodos = todos ? [...todos].sort((a, b) => statusRank(a.status) - statusRank(b.status)) : [];
  const todosDone = sortedTodos.filter((t) => t.status === "done").length;
  const todosTotal = sortedTodos.length;

  const activeItems = sortedTodos
    .filter((t) => t.status === "in_progress")
    .map((t) => ({ title: t.title, status: t.status, agent: t.agent }));

  const blockedItems = sortedTodos
    .filter((t) => t.status === "blocked" || t.status === "failed")
    .map((t) => ({ title: t.title, status: t.status }));

  let failedGates = 0;
  let skippedGates = 0;
  let latestVerification: string | null = null;
  for (const worker of vm.workers ?? []) {
    if (worker.lastEvidence) {
      if (!worker.lastEvidence.passed) failedGates++;
      latestVerification = worker.lastEvidence.message || worker.lastEvidence.gate;
    }
    if (worker.state === "skipped") skippedGates++;
  }

  const primaryAccount = primaryUsage
    ? primaryUsage.oauth.loggedIn
      ? primaryUsage.oauth.displayId
      : "/login"
    : "";
  const fiveHourPercent =
    primaryUsage?.quota.fiveHour?.remainingPercent != null
      ? Math.min(100, Math.max(0, 100 - primaryUsage.quota.fiveHour.remainingPercent))
      : null;
  const weeklyPercent =
    primaryUsage?.quota.weekly?.remainingPercent != null
      ? Math.min(100, Math.max(0, 100 - primaryUsage.quota.weekly.remainingPercent))
      : null;
  const fiveHour =
    fiveHourPercent != null
      ? `${fiveHourPercent}%`
      : primaryUsage
        ? `${Math.round(primaryUsage.totalSecondsLast5Hours / 60)}m`
        : "--";
  const weekly =
    weeklyPercent != null
      ? `${weeklyPercent}%`
      : primaryUsage
        ? `${Math.round(primaryUsage.totalSecondsWeek / 60)}m`
        : "--";

  const deepSeekStatus = deepSeek
    ? deepSeek.available
      ? "ok"
      : deepSeek.enabled && deepSeek.apiKeySet
        ? "warn"
        : "off"
    : "checking";

  const type: CockpitDashboardSnapshot["pulse"]["type"] =
    sessionMeta?.type === "chat" || (latestRunName ?? "").startsWith("chat-")
      ? "chat"
      : latestRunName
        ? "run"
        : "--";

  let elapsed = "--";
  if (vm.startedAt) {
    const startedMs = Date.parse(vm.startedAt);
    if (!Number.isNaN(startedMs)) {
      elapsed = formatElapsed(Date.now() - startedMs);
    }
  }

  return {
    pulse: {
      runId: latestRunName,
      type,
      health: vm.health,
      elapsed,
      activeLane: vm.activeNode?.name ?? null,
      lastActivity: vm.lastActivityAt ?? null,
      blocker: vm.blocker ? { reason: vm.blocker.reason, nodeId: vm.blocker.nodeId } : null,
      eta: vm.eta ?? null,
      goalTitle: vm.goalTitle,
      goalScore: vm.goalScore,
      nextAction: vm.nextAction,
      etaConfidence: vm.etaConfidence ?? null,
    },
    workQueue: {
      todosDone,
      todosTotal,
      activeItems,
      blockedItems,
      workerCounts: {
        running: vm.progress.running,
        done: vm.progress.done,
        failed: vm.progress.failed,
        blocked: vm.progress.blocked,
        skipped: vm.progress.skipped,
        settled: vm.progress.settled,
        total: vm.progress.total,
      },
      workers: vm.workers ?? [],
      todos: sortedTodos,
    },
    runtimeContract,
    evidence: {
      failedGates,
      skippedGates,
      latestVerification,
    },
    providers: {
      primary: primaryUsage
        ? {
            source: primaryUsage.oauth.loggedIn ? "oauth" : "none",
            status: primaryUsage.oauth.loggedIn ? "logged-in" : "unavailable",
            account: primaryAccount,
            fiveHour,
            weekly,
          }
        : null,
      deepSeek: {
        status: deepSeekStatus,
        balance: deepSeek ? formatDeepSeekBalance(deepSeek) : "n/a",
        snapshot: deepSeek,
      },
    },
    resources,
    deepSeekUsage,
    deepSeekRequests,
    worktree: {
      totalChanged: gitChanges.length,
      counts: worktreeCounts,
      topPaths,
      changes: gitChanges,
    },
    system: {
      cpuPercent: sysUsage?.cpuPercent ?? null,
      memPercent: sysUsage?.memPercent ?? null,
      workerBudget: null,
    },
    stateError,
    latestRunName,
  };
}

export function buildRailModel(
  snapshot: CockpitDashboardSnapshot,
  numstat: Map<string, { added: number | null; deleted: number | null }>,
  lspEntries: Array<{ name: string; status: "connected" | "disabled" | "failed" | "unknown" }>,
  branch: string | undefined,
  root: string,
  _primaryUsage: UsageStats | null,
  tokenBurn?: { inputTokens: number; outputTokens: number; totalTokens: number },
): CockpitRailModel {
  const modifiedFiles = snapshot.worktree.changes.map((c) => {
    const ns = numstat.get(c.path);
    return {
      path: c.path,
      status: c.status,
      added: ns?.added ?? undefined,
      deleted: ns?.deleted ?? undefined,
    };
  });

  const providers: CockpitRailModel["providers"] = [
    ...(snapshot.providers.primary
      ? [
          {
            name: "Primary",
            status: snapshot.providers.primary.status,
            detail: snapshot.providers.primary.account,
          },
        ]
      : []),
    {
      name: "DeepSeek",
      status: snapshot.providers.deepSeek.status,
      detail: snapshot.providers.deepSeek.balance,
    },
  ];

  return {
    title: snapshot.pulse.goalTitle ?? snapshot.latestRunName ?? "OMK",
    subtitle: snapshot.pulse.activeLane ?? undefined,
    context: {
      tokens: undefined,
      usedPercent: undefined,
      costUsd: undefined,
      elapsed: snapshot.pulse.elapsed === "--" ? undefined : snapshot.pulse.elapsed,
    },
    providers,
    evidence: snapshot.evidence,
    tokenBurn,
    mcp: (snapshot.resources?.mcpServers ?? []).map((s) => ({
      name: s.name,
      status: (s.status as CockpitRailModel["mcp"][number]["status"]) ?? "unknown",
      detail: s.reason,
    })),
    lsp: lspEntries,
    todos: snapshot.workQueue.todos.map((t) => ({
      title: t.title,
      status: t.status,
      agent: t.agent,
    })),
    modifiedFiles,
    cwd: root,
    branch,
    runtime: { name: "OMK", version: getOmkVersionSync() },
  };
}

export function computeDeepSeekRunUsage(state: RunState | null): CockpitDeepSeekRunUsage {
  const usage: CockpitDeepSeekRunUsage = {
    attempts: 0,
    fallbackCount: 0,
    directCount: 0,
    advisoryCount: 0,
    byModel: {},
    byTier: {},
  };
  for (const node of state?.nodes ?? []) {
    for (const attempt of node.attempts ?? []) {
      const usesDeepSeek =
        attempt.provider === "deepseek" ||
        attempt.requestedProvider === "deepseek" ||
        attempt.fallbackFrom === "deepseek";
      if (!usesDeepSeek) continue;
      usage.attempts += 1;
      if (attempt.fallbackFrom === "deepseek") usage.fallbackCount += 1;
      if (attempt.providerParticipation === "advisory") usage.advisoryCount += 1;
      if (attempt.providerParticipation === "direct" || attempt.provider === "deepseek") usage.directCount += 1;
      if (attempt.providerModel) {
        usage.byModel[attempt.providerModel] = (usage.byModel[attempt.providerModel] ?? 0) + 1;
      }
      if (attempt.providerModelTier) {
        usage.byTier[attempt.providerModelTier] = (usage.byTier[attempt.providerModelTier] ?? 0) + 1;
      }
    }
  }
  return usage;
}

export function computeDeepSeekRequests(events: TelemetryEvent[]): CockpitDeepSeekRequest[] {
  const byNodeId = new Map<string, { kind: "request" | "advisory" | "both"; events: TelemetryEvent[] }>();
  for (const event of events) {
    if (!event.nodeId) continue;
    if (
      event.type !== "provider.request.started" &&
      event.type !== "provider.request.completed" &&
      event.type !== "provider.request.failed" &&
      event.type !== "provider.advisory.started" &&
      event.type !== "provider.advisory.completed" &&
      event.type !== "provider.advisory.failed"
    ) {
      continue;
    }
    const kind = event.type.startsWith("provider.advisory.") ? "advisory" : "request";
    const existing = byNodeId.get(event.nodeId);
    if (!existing) {
      byNodeId.set(event.nodeId, { kind, events: [event] });
    } else {
      existing.events.push(event);
      if (existing.kind !== kind) {
        existing.kind = "both";
      }
    }
  }
  const requests: CockpitDeepSeekRequest[] = [];
  for (const [nodeId, nodeEvents] of byNodeId) {
    const category: CockpitDeepSeekRequest["kind"] =
      nodeEvents.kind === "both" ? "fallback" : nodeEvents.kind === "advisory" ? "advisory" : "direct";
    let currentStarted: TelemetryEvent | null = null;
    for (const event of nodeEvents.events) {
      if (event.type.endsWith(".started")) {
        currentStarted = event;
      } else if ((event.type.endsWith(".completed") || event.type.endsWith(".failed")) && currentStarted) {
        const startedAt = Date.parse(currentStarted.timestamp);
        const endedAt = Date.parse(event.timestamp);
        requests.push({
          nodeId,
          role: String(currentStarted.data?.role ?? currentStarted.agentId ?? ""),
          kind: category,
          tier: currentStarted.data?.tier ? String(currentStarted.data.tier) : undefined,
          status: event.type.endsWith(".completed") ? "completed" : "failed",
          startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
          durationMs: Number.isNaN(startedAt) || Number.isNaN(endedAt) ? undefined : endedAt - startedAt,
        });
        currentStarted = null;
      }
    }
    if (currentStarted) {
      const startedAt = Date.parse(currentStarted.timestamp);
      requests.push({
        nodeId,
        role: String(currentStarted.data?.role ?? currentStarted.agentId ?? ""),
        kind: category,
        tier: currentStarted.data?.tier ? String(currentStarted.data.tier) : undefined,
        status: "running",
        startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
      });
    }
  }
  return requests;
}
