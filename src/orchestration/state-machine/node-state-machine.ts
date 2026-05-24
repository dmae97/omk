/**
 * Pure DAG node state transitions.
 *
 * Extracted from OrchestrationStateManager (Phase 4b).
 */

import type { DagNode } from "../dag.js";

export type NodeTransitionEvent =
  | { type: "start"; startedAt: string }
  | { type: "complete"; completedAt: string; durationMs: number; success: boolean; retries: number }
  | { type: "retry"; retries: number }
  | { type: "fail"; completedAt: string; error?: string };

export function transitionNode(node: DagNode, event: NodeTransitionEvent): DagNode {
  switch (event.type) {
    case "start":
      return {
        ...node,
        status: "running",
        startedAt: event.startedAt,
      };

    case "complete":
      return {
        ...node,
        status: event.success ? "done" : "failed",
        completedAt: event.completedAt,
        durationMs: event.durationMs,
        retries: event.retries,
      };

    case "retry":
      return {
        ...node,
        status: "pending",
        retries: event.retries,
      };

    case "fail":
      return {
        ...node,
        status: "failed",
        completedAt: event.completedAt,
      };
  }
}
