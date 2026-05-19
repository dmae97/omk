import type { Dag, DagNode, TaskStatus } from "./dag.js";
import { skipNode, dependsOnRequiredOutput } from "./dag.js";
import { getTaskDagGraph } from "./task-graph.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";

export interface Scheduler {
  getRunnableNodes(dag: Dag): DagNode[];
  updateNodeStatus(dag: Dag, id: string, status: TaskStatus, runId?: string): void;
  isComplete(dag: Dag): boolean;
  isFailed(dag: Dag): boolean;
  getNodeStatus(dag: Dag, id: string): TaskStatus | undefined;
}

export function createScheduler(): Scheduler {
  return {
    getRunnableNodes(dag: Dag): DagNode[] {
      return getTaskDagGraph(dag).runnableNodes().slice();
    },

    updateNodeStatus(dag: Dag, id: string, status: TaskStatus, runId?: string): void {
      const node = getTaskDagGraph(dag).getNode(id);
      if (!node) return;

      const previousStatus = node.status;
      node.status = status;

      if (status === "failed") {
        node.retries += 1;
        if (node.retries < node.maxRetries) {
          node.status = "pending";
        } else if (node.failurePolicy?.skipOnFailure) {
          skipNode(dag, node.id);
        } else if (node.outputs?.every((o) => o.required === false)) {
          node.status = "skipped";
          skipNode(dag, node.id);
        } else if (node.failurePolicy?.blockDependents !== false) {
          blockDependents(dag, node.id, `dependency failed: ${node.id}`);
        }
      }

      // Record scheduler decision trace for terminal state changes
      if (runId && previousStatus !== node.status && ["failed", "skipped", "blocked", "done"].includes(node.status)) {
        const traceStore = createDecisionTraceStore();
        traceStore.record(runId, {
          component: "scheduler",
          inputSummary: `node=${node.id} previous=${previousStatus} trigger=${status}`,
          outputDecision: `status=${node.status} retries=${node.retries}/${node.maxRetries}`,
          reason: node.blockedReason ?? `Scheduler transition: ${previousStatus} → ${node.status}`,
          scores: { retries: node.retries, maxRetries: node.maxRetries },
          nodeId: node.id,
        });
      }
    },

    isComplete(dag: Dag): boolean {
      return dag.nodes.every((n) => n.status === "done" || n.status === "skipped" || (n.status === "failed" && Boolean(n.failurePolicy?.fallbackRole)));
    },

    isFailed(dag: Dag): boolean {
      return dag.nodes.some((n) => {
        if (n.status === "blocked") return true;
        if (n.status === "failed" && n.retries >= n.maxRetries && !n.failurePolicy?.skipOnFailure && !n.failurePolicy?.fallbackRole) {
          const allOptional = n.outputs?.every((o) => o.required === false) ?? false;
          return !allOptional;
        }
        return false;
      });
    },

    getNodeStatus(dag: Dag, id: string): TaskStatus | undefined {
      return getTaskDagGraph(dag).getNode(id)?.status;
    },
  };
}

function blockDependents(dag: Dag, failedId: string, reason: string): void {
  const nodeById = new Map(dag.nodes.map((node) => [node.id, node]));
  const queue: Array<{ id: string; blockerId: string }> = dag.nodes
    .filter((node) => node.dependsOn.includes(failedId))
    .map((node) => ({ id: node.id, blockerId: failedId }));

  while (queue.length > 0) {
    const { id, blockerId } = queue.shift()!;
    const node = nodeById.get(id);
    if (!node || node.status === "done" || node.status === "running" || node.status === "blocked" || node.status === "skipped") continue;
    if (node.failurePolicy?.blockDependents === false) continue;
    if (!dependsOnRequiredOutput(node, blockerId)) continue;
    node.status = "blocked";
    node.blockedReason = reason;
    for (const child of dag.nodes) {
      if (child.dependsOn.includes(id)) queue.push({ id: child.id, blockerId: id });
    }
  }
}
