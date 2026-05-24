/**
 * Pure worker state transitions for the orchestration run state machine.
 *
 * Extracted from OrchestrationStateManager (Phase 4b).
 */

import type { OrchestrationState, WorkerState } from "../contracts/index.js";
import type { TaskResult } from "../../contracts/orchestration.js";

export type WorkerTransitionEvent =
  | { type: "initialize"; nodeId: string; maxRetries: number }
  | { type: "start"; nodeId: string; assignment?: WorkerState["assignment"] }
  | { type: "complete"; nodeId: string; result: TaskResult }
  | { type: "retry"; nodeId: string }
  | { type: "fail"; nodeId: string; error: string }
  | { type: "batch_complete"; batchIndex: number; nodeIds: string[] }
  | { type: "orchestration_complete"; success: boolean };

export function transitionWorker(state: OrchestrationState, event: WorkerTransitionEvent): OrchestrationState {
  const timestamp = new Date().toISOString();

  switch (event.type) {
    case "initialize": {
      const workers = new Map(state.workers);
      workers.set(event.nodeId, {
        nodeId: event.nodeId,
        status: "idle",
        retryCount: 0,
        maxRetries: event.maxRetries,
      });
      return { ...state, workers };
    }

    case "start": {
      const workers = new Map(state.workers);
      const worker = workers.get(event.nodeId);
      if (!worker) throw new Error(`Worker ${event.nodeId} not found`);
      workers.set(event.nodeId, {
        ...worker,
        status: "running",
        startedAt: timestamp,
        assignment: event.assignment,
      });
      const events = [
        ...state.events,
        {
          type: "worker_started" as const,
          nodeId: event.nodeId,
          timestamp,
          data: { assignment: event.assignment },
        },
      ];
      return { ...state, workers, events };
    }

    case "complete": {
      const workers = new Map(state.workers);
      const worker = workers.get(event.nodeId);
      if (!worker) throw new Error(`Worker ${event.nodeId} not found`);

      const completedAt = timestamp;
      const durationMs = worker.startedAt
        ? new Date(completedAt).getTime() - new Date(worker.startedAt).getTime()
        : 0;

      workers.set(event.nodeId, {
        ...worker,
        status: event.result.success ? "completed" : "failed",
        completedAt,
        durationMs,
        result: event.result,
      });

      const completedNodes = new Set(state.completedNodes);
      if (event.result.success) {
        completedNodes.add(event.nodeId);
      }

      const events = [
        ...state.events,
        {
          type: "worker_completed" as const,
          nodeId: event.nodeId,
          timestamp: completedAt,
          data: { success: event.result.success, durationMs },
        },
      ];

      return { ...state, workers, completedNodes, events };
    }

    case "retry": {
      const workers = new Map(state.workers);
      const worker = workers.get(event.nodeId);
      if (!worker) throw new Error(`Worker ${event.nodeId} not found`);

      if (worker.retryCount >= worker.maxRetries) {
        return state;
      }

      workers.set(event.nodeId, {
        ...worker,
        retryCount: worker.retryCount + 1,
        status: "retrying",
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
        result: undefined,
      });

      const events = [
        ...state.events,
        {
          type: "worker_retrying" as const,
          nodeId: event.nodeId,
          timestamp,
          data: { retryCount: worker.retryCount + 1 },
        },
      ];

      return { ...state, workers, events };
    }

    case "fail": {
      const workers = new Map(state.workers);
      const worker = workers.get(event.nodeId);
      if (!worker) throw new Error(`Worker ${event.nodeId} not found`);

      workers.set(event.nodeId, {
        ...worker,
        status: "failed",
        completedAt: timestamp,
        error: event.error,
      });

      const events = [
        ...state.events,
        {
          type: "worker_failed" as const,
          nodeId: event.nodeId,
          timestamp,
          data: { error: event.error },
        },
      ];

      return { ...state, workers, events };
    }

    case "batch_complete": {
      const events = [
        ...state.events,
        {
          type: "batch_completed" as const,
          batchIndex: event.batchIndex,
          timestamp,
          data: { nodeIds: event.nodeIds },
        },
      ];
      return { ...state, events };
    }

    case "orchestration_complete": {
      const completedAt = timestamp;
      const events = [
        ...state.events,
        {
          type: "orchestration_completed" as const,
          timestamp: completedAt,
          data: { success: event.success },
        },
      ];
      return {
        ...state,
        status: event.success ? "completed" : "failed",
        completedAt,
        events,
      };
    }
  }
}

export function getRunningWorkerCount(state: OrchestrationState): number {
  return Array.from(state.workers.values()).filter((w) => w.status === "running").length;
}

export function getCompletedWorkerCount(state: OrchestrationState): number {
  return Array.from(state.workers.values()).filter((w) => w.status === "completed").length;
}

export function getFailedWorkerCount(state: OrchestrationState): number {
  return Array.from(state.workers.values()).filter((w) => w.status === "failed").length;
}
