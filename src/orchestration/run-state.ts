import type {
  RunCapabilityAssignment,
  RunProgressEstimate,
  RunRouteDecision,
  RunState,
} from "../contracts/orchestration.js";
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
  goal?: RunState["goal"];
  goalObjective?: string;
  goalSnapshot?: RunState["goalSnapshot"];
  routeDecision?: RunRouteDecision;
  capabilityAssignments?: RunState["capabilityAssignments"];
}): RunState {
  const dag = createDag({ nodes: input.nodes });
  const nodes = dag.nodes.map((node) => ({ ...node }));
  return assignNodeCapabilitiesToRunState({
    schemaVersion: 1,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    goalId: input.goalId,
    goal: input.goal ?? buildRunGoalState({
      goalId: input.goalId,
      goalSnapshot: input.goalSnapshot,
      fallbackObjective: input.goalObjective,
    }),
    goalSnapshot: input.goalSnapshot,
    nodes,
    routeDecision: input.routeDecision,
    capabilityAssignments: input.capabilityAssignments,
    estimate: estimateFor(nodes, input.startedAt, input.workerCount),
  });
}

export function assignNodeCapabilitiesToRunState(
  state: RunState,
  assignments?: RunState["capabilityAssignments"]
): RunState {
  const existingAssignments = capabilityAssignmentRecord(state.capabilityAssignments);
  const explicitAssignments = capabilityAssignmentRecord(assignments);
  const computedAssignments = Object.fromEntries(
    state.nodes
      .map((node): [string, RunCapabilityAssignment] | null => {
        const routing = node.routing;
        if (!routing) return null;
        const assigned = routing.assignedCapabilities;
        const skills = uniqueCapabilityNames(assigned?.skills ?? routing.skills ?? []);
        const mcpServers = uniqueCapabilityNames(assigned?.mcpServers ?? routing.mcpServers ?? []);
        const hooks = uniqueCapabilityNames(assigned?.hooks ?? routing.hooks ?? []);
        const tools = uniqueCapabilityNames(assigned?.tools ?? routing.tools ?? []);
        if (skills.length === 0 && mcpServers.length === 0 && hooks.length === 0 && tools.length === 0) {
          return null;
        }
        return [node.id, {
          skills,
          mcpServers,
          hooks,
          ...(tools.length > 0 ? { tools } : {}),
          ...(routing.assignedProvider ?? routing.provider ? { provider: routing.assignedProvider ?? routing.provider } : {}),
          ...(routing.assignedModel ?? routing.providerModel ? { model: routing.assignedModel ?? routing.providerModel } : {}),
          source: routing.autoSpawned ? "capability-router" : "routing",
          rationale: routing.rationale,
        }];
      })
      .filter((entry): entry is [string, RunCapabilityAssignment] => entry !== null)
  );

  const capabilityAssignments = {
    ...existingAssignments,
    ...computedAssignments,
    ...explicitAssignments,
  };
  return Object.keys(capabilityAssignments).length > 0
    ? { ...state, capabilityAssignments }
    : state;
}

export function createDagFromRunState(state: RunState): Dag {
  return createDag({
    nodes: state.nodes.map((node): DagNodeDefinition => {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const {
        status,
        retries,
        startedAt,
        completedAt,
        durationMs,
        attempts,
        blockedReason,
        evidence,
        ...definition
      } = node;
      /* eslint-enable @typescript-eslint/no-unused-vars */
      return definition;
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
  return assignNodeCapabilitiesToRunState({
    ...state,
    goal: state.goal ?? buildRunGoalState({
      goalId: state.goalId,
      goalSnapshot: state.goalSnapshot,
    }),
    nodes,
    estimate: state.estimate ?? estimateFor(nodes, state.startedAt, workerCount),
  });
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

export interface RunGoalState {
  id?: string;
  title?: string;
  objective: string;
  successCriteria: Array<{ id: string; description: string; requirement: string }>;
  status: "planned";
}

export function buildRunGoalState(input: {
  goalId?: string;
  goalSnapshot?: RunState["goalSnapshot"];
  fallbackObjective?: string;
}): RunGoalState | undefined {
  const objective = input.goalSnapshot?.objective ?? firstNonEmptyLine(input.fallbackObjective);
  if (!objective) return undefined;
  return {
    id: input.goalId,
    title: input.goalSnapshot?.title ?? inferGoalTitle(objective),
    objective,
    successCriteria: input.goalSnapshot?.successCriteria?.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      requirement: criterion.requirement,
    })) ?? [],
    status: "planned",
  };
}

function capabilityAssignmentRecord(
  assignments: RunState["capabilityAssignments"] | undefined
): Record<string, RunCapabilityAssignment> {
  if (!assignments) return {};
  if (!Array.isArray(assignments)) return { ...assignments };
  return Object.fromEntries(assignments.flatMap((assignment, index) => {
    const key = assignment.nodeId ?? assignment.agent ?? assignment.role ?? `assignment-${index}`;
    return key ? [[key, assignment]] : [];
  }));
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function truncateGoalTitle(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function inferGoalTitle(objective: string): string {
  if (/critical|크리티컬|심각|위험|리스크|risk|issue|이슈/i.test(objective)) {
    return "critical_issue_scan";
  }
  return truncateGoalTitle(objective);
}

function uniqueCapabilityNames(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0).map((value) => value.trim()))];
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
