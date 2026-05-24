import type { RunProgressEstimate, RunState } from "../contracts/orchestration.js";
import type { Dag, DagNodeDefinition } from "./dag.js";
import { createDag } from "./dag.js";
import { estimateRunProgress } from "./eta.js";

export function createRoutedRunState(input: {
  runId: string;
  startedAt: string;
  nodes: DagNodeDefinition[];
  completedAt?: string;
  workerCount?: number;
  goalId?: string;
  goalSnapshot?: RunState["goalSnapshot"];
}): RunState {
  const dag = createDag({ nodes: input.nodes });
  const nodes = dag.nodes.map((node) => ({ ...node }));
  return {
    schemaVersion: 1,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    goalId: input.goalId,
    goalSnapshot: input.goalSnapshot,
    nodes,
    estimate: estimateFor(nodes, input.startedAt, input.workerCount),
  };
}

export function createDagFromRunState(state: RunState): Dag {
  return createDag({
    nodes: state.nodes.map((node): DagNodeDefinition => {
      const definition: Partial<typeof node> = { ...node };
      delete definition.status;
      delete definition.retries;
      delete definition.startedAt;
      delete definition.completedAt;
      delete definition.durationMs;
      delete definition.attempts;
      delete definition.blockedReason;
      delete definition.evidence;
      return definition as DagNodeDefinition;
    }),
  });
}

export function createExecutableDagFromState(state: RunState): Dag {
  const dag = createDagFromRunState(state);
  const runtimeById = new Map(state.nodes.map((node) => [node.id, node]));

  for (const node of dag.nodes) {
    const runtime = runtimeById.get(node.id);
    if (runtime?.status !== "done") continue;
    node.status = "done";
    node.startedAt = runtime.startedAt;
    node.completedAt = runtime.completedAt;
    node.durationMs = runtime.durationMs;
    node.attempts = runtime.attempts?.map((attempt) => ({ ...attempt }));
  }

  const bootstrap = dag.nodes.find((node) => node.id === "bootstrap");
  if (bootstrap) {
    bootstrap.status = "done";
    bootstrap.startedAt ??= state.startedAt;
    bootstrap.completedAt ??= state.startedAt;
  }

  return dag;
}

export function routeRunState(state: RunState, workerCount?: number): RunState {
  const dag = createDagFromRunState(state);
  const originalById = new Map(state.nodes.map((node) => [node.id, node]));
  const nodes = dag.nodes.map((node) => ({
    ...node,
    ...pickRuntimeFields(originalById.get(node.id)),
    routing: node.routing,
    failurePolicy: node.failurePolicy,
  }));
  return {
    ...state,
    nodes,
    estimate: state.estimate ?? estimateFor(nodes, state.startedAt, workerCount),
  };
}

export function refreshRunStateEstimate(state: RunState, workerCount = 1): RunState {
  state.estimate = estimateFor(state.nodes, state.startedAt, workerCount);
  return state;
}

function pickRuntimeFields(node: RunState["nodes"][number] | undefined): Partial<RunState["nodes"][number]> {
  if (!node) return {};
  return {
    status: node.status,
    retries: node.retries,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
    durationMs: node.durationMs,
    attempts: node.attempts,
    blockedReason: node.blockedReason,
    evidence: node.evidence,
  };
}

function estimateFor(
  nodes: RunState["nodes"],
  startedAt: string,
  workerCount = 1
): RunProgressEstimate {
  return estimateRunProgress({
    nodes,
    startedAt,
    workerCount,
  });
}
