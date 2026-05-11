/**
 * ContextBroker — builds ContextCapsule from DAG state.
 *
 * Collects dependency outputs, graph memory, prior attempts,
 * evidence requirements into a bounded capsule.
 *
 * Integrates ContextBudgetOptimizer for priority-based trimming.
 */
import type { DagNode } from "../orchestration/dag.js";
import type { RunState } from "../contracts/orchestration.js";
import {
  type ContextCapsule,
  type ContextBudget,
  type FileSlice,
  type MemoryFact,
  type MemoryFactKind,
  type AttemptDigest,
  type EvidenceSpec,
  CONTEXT_BUDGET_PRESETS,
  DEFAULT_CONTEXT_BUDGET,
} from './context-capsule.js';
import { getProjectRoot } from "../util/fs.js";
import { join } from "path";
import { readFile } from "fs/promises";
import type { ContextAdjustment } from "../evidence/attempt-record.js";
import { createContextBudgetOptimizer, type ContextBudgetReport } from "./context-budget-optimizer.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";
export interface ContextBrokerOptions {
  readonly projectRoot?: string;
  readonly graphMemoryPath?: string;
  readonly goal?: string;
  readonly system?: string;
}

function resolveBudget(node: DagNode): ContextBudget {
  const preset = node.routing?.contextBudget ?? "small";
  return CONTEXT_BUDGET_PRESETS[preset] ?? DEFAULT_CONTEXT_BUDGET;
}

function collectDependencySummaries(node: DagNode, state?: RunState): string[] {
  if (!state || !node.dependsOn.length) return [];
  const summaries: string[] = [];
  for (const depId of node.dependsOn) {
    const depNode = state.nodes.find((n) => n.id === depId);
    if (!depNode) continue;
    const lastAttempt = depNode.attempts?.[depNode.attempts.length - 1];
    if (lastAttempt) {
      summaries.push(`[${depId}] provider=${lastAttempt.provider ?? "?"} status=${lastAttempt.status ?? "?"} duration=${lastAttempt.durationMs ?? "?"}ms`);
    } else {
      summaries.push(`[${depId}] status=${depNode.status}`);
    }
  }
  return summaries;
}

function collectPriorAttempts(node: DagNode): AttemptDigest[] {
  if (!node.attempts?.length) return [];
  return node.attempts.map((a) => ({
    attempt: a.attempt,
    provider: a.provider ?? "unknown",
    status: (a.status ?? "failed") as "done" | "failed",
    durationMs: a.durationMs,
    failureSummary: a.fallbackReason,
  }));
}

function collectEvidenceRequirements(node: DagNode): EvidenceSpec[] {
  if (!node.outputs?.length) return [];
  return node.outputs
    .filter((o) => o.gate && o.gate !== "none")
    .map((o) => ({
      gate: o.gate!,
      ref: o.ref,
      required: o.required !== false,
    }));
}

async function loadGraphMemory(maxFacts: number, memoryPath?: string): Promise<MemoryFact[]> {
  const filePath = memoryPath ?? join(getProjectRoot(), '.omk', 'memory', 'graph-state.json');
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const nodes = (data.nodes ?? []) as Array<Record<string, unknown>>;
    const facts: MemoryFact[] = [];
    for (const n of nodes) {
      if (facts.length >= maxFacts) break;
      const type = n.type as string | undefined;
      const kind = mapGraphTypeToKind(type);
      if (!kind) continue;
      const label = String(n.label ?? n.id ?? '');
      const summary = String(n.summary ?? n.content ?? '');
      if (!summary) continue;
      facts.push({
        kind,
        subject: label,
        predicate: summarizePredicate(kind),
        object: summary,
        confidence: 0.8,
        key: label,
        value: summary,
        category: kind,
      });
    }
    return facts;
  } catch {
    return [];
  }
}

function mapGraphTypeToKind(type: string | undefined): MemoryFactKind | undefined {
  switch (type) {
    case 'Memory': return 'file_responsibility';
    case 'Decision': return 'architecture_decision';
    case 'Goal': return 'project_constraint';
    case 'Constraint': return 'project_constraint';
    case 'Evidence': return 'failure_pattern';
    case 'Provider': return 'provider_behavior';
    case 'ProviderRoute': return 'provider_behavior';
    case 'Risk': return 'failure_pattern';
    default: return undefined;
  }
}

function summarizePredicate(kind: MemoryFactKind): string {
  switch (kind) {
    case 'project_constraint': return 'requires';
    case 'architecture_decision': return 'decided_that';
    case 'file_responsibility': return 'responsible_for';
    case 'api_contract': return 'defines';
    case 'failure_pattern': return 'fails_when';
    case 'successful_fix': return 'fixed_by';
    case 'user_preference': return 'prefers';
    case 'provider_behavior': return 'behaves_as';
  }
}

export function createContextBroker(options: ContextBrokerOptions = {}) {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const optimizer = createContextBudgetOptimizer();

  async function loadFileContent(paths: readonly string[]): Promise<FileSlice[]> {
    const slices: FileSlice[] = [];
    for (const p of paths) {
      try {
        const fullPath = p.startsWith("/") ? p : join(projectRoot, p);
        const content = await readFile(fullPath, "utf-8");
        const lineCount = content.split("\n").length;
        slices.push({ path: p, startLine: 1, endLine: lineCount, content });
      } catch {
        // File not found or unreadable — skip
      }
    }
    return slices;
  }

  async function buildCapsule(
    node: DagNode,
    state?: RunState,
    adjustment?: ContextAdjustment,
  ): Promise<{ capsule: ContextCapsule; report: ContextBudgetReport }> {
    const goal = options.goal ?? state?.goalId ?? "unknown";
    const system = options.system ?? "You are a coding agent executing a DAG node.";

    const dependencySummaries = collectDependencySummaries(node, state);
    const priorAttempts = collectPriorAttempts(node);
    const evidenceRequirements = collectEvidenceRequirements(node);
    const graphMemory = await loadGraphMemory(resolveBudget(node).maxMemoryFacts, options.graphMemoryPath);

    const task = [
      `Execute DAG node: ${node.id}`,
      `Name: ${node.name}`,
      `Role: ${node.role}`,
      node.routing?.skills?.length ? `Skills: ${node.routing.skills.join(", ")}` : undefined,
      node.routing?.mcpServers?.length ? `MCP: ${node.routing.mcpServers.join(", ")}` : undefined,
      node.routing?.tools?.length ? `Tools: ${node.routing.tools.join(", ")}` : undefined,
      node.routing?.rationale ? `Rationale: ${node.routing.rationale}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    // Guard against empty task content
    if (!task || task.trim().length === 0) {
      throw new Error(`ContextBroker: unable to build non-empty task for node ${node.id}`);
    }

    // Load actual file content for adjustment.addFiles
    let relevantFiles: readonly FileSlice[] = [];
    if (adjustment?.addFiles?.length) {
      relevantFiles = await loadFileContent(adjustment.addFiles);
    }

    let budget = resolveBudget(node);
    if (adjustment?.budgetChange) {
      budget = { ...budget, ...adjustment.budgetChange };
    }

    let finalTask = task;
    if (adjustment?.promptPatch) {
      finalTask = `${task}\n\n--- Adjustment ---\n${adjustment.promptPatch}`;
    }

    const rawCapsule: ContextCapsule = {
      runId: state?.runId ?? `local-${Date.now()}`,
      nodeId: node.id,
      goal,
      system,
      task: finalTask,
      dependencySummaries,
      relevantFiles,
      graphMemory,
      priorAttempts,
      evidenceRequirements,
      budget,
      node,
    };

    // Optimize: priority-based trimming + token accounting
    const attemptId = node.attempts?.length
      ? String(node.attempts[node.attempts.length - 1].attempt)
      : "0";
    const optimized = optimizer.optimize(rawCapsule, attemptId);

    // Record context-broker decision trace
    const runId = state?.runId;
    if (runId && !runId.startsWith("local-")) {
      const traceStore = createDecisionTraceStore();
      traceStore.record(runId, {
        component: "context-broker",
        inputSummary: `node=${node.id} budgetPreset=${node.routing?.contextBudget ?? "small"} adjustment=${adjustment ? "yes" : "no"}`,
        outputDecision: `budget=${JSON.stringify(budget)} files=${relevantFiles.length} memoryFacts=${graphMemory.length}`,
        reason: `Context capsule built with ${optimized.report.totalTokensEstimated} total tokens, ${optimized.report.toolResultTokens} tool tokens`,
        scores: {
          totalTokens: optimized.report.totalTokensEstimated,
          toolResultTokens: optimized.report.toolResultTokens,
          droppedItems: optimized.report.droppedItems.length,
        },
        nodeId: node.id,
        attemptId: `${node.id}__${attemptId}`,
      });
    }

    return { capsule: optimized.capsule, report: optimized.report };
  }

  return { buildCapsule };
}
