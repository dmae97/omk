import type { DagNode } from "./dag.js";
import type {
  EvaluateLoopDecisionInput,
  LoopDecision,
  OrchestrationLoopState,
} from "./loop-state.js";

export const DEFAULT_LOOP_MAX_ITERATIONS = 3;
export const HARD_LOOP_MAX_ITERATIONS = 8;

export function evaluateLoopDecision(
  input: EvaluateLoopDecisionInput,
): LoopDecision {
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const iteration = Math.max(1, input.iteration ?? input.runState.iterationCount ?? 1);
  const maxIterations = resolveMaxIterations(input.maxIterations ?? input.runState.maxIterations);
  const failedNodes = input.runState.nodes.filter((node) => node.status === "failed");
  const blockedNodes = input.runState.nodes.filter((node) => node.status === "blocked");
  const failedGates = collectFailedGates(input.runState.nodes);
  const pendingNodes = input.runState.nodes.filter((node) => node.status === "pending" || node.status === "running");
  const requiredEvidenceMissing = collectMissingRequiredEvidence(input.runState.nodes);

  if (
    iteration >= maxIterations &&
    (failedNodes.length > 0 ||
      blockedNodes.length > 0 ||
      pendingNodes.length > 0 ||
      requiredEvidenceMissing.length > 0)
  ) {
    return buildDecision(input, {
      action: "block",
      reason: "Maximum loop iterations reached before required evidence closed",
      confidence: 0.9,
      failedNodes: failedNodes.map((node) => node.id),
      blockedNodes: blockedNodes.map((node) => node.id),
      pendingNodes: pendingNodes.map((node) => node.id),
      failedGates,
      requiredEvidenceMissing,
      iteration,
      createdAt,
    });
  }

  if (input.requestedAction === "verify") {
    return buildDecision(input, {
      action: "verify-only",
      reason: "Operator requested verification-only loop action",
      confidence: 0.85,
      failedNodes: failedNodes.map((node) => node.id),
      blockedNodes: blockedNodes.map((node) => node.id),
      pendingNodes: pendingNodes.map((node) => node.id),
      failedGates,
      requiredEvidenceMissing,
      iteration,
      createdAt,
    });
  }

  if (
    input.requestedAction === "replan" ||
    failedNodes.length > 0 ||
    blockedNodes.length > 0 ||
    failedGates.length > 0
  ) {
    return buildDecision(input, {
      action: "replan",
      reason: failedNodes.length + blockedNodes.length > 0
        ? `Run has failed or blocked nodes: ${[...failedNodes, ...blockedNodes].map((node) => node.id).join(", ")}`
        : "Operator requested replan or gate failures require a new plan",
      confidence: 0.86,
      failedNodes: failedNodes.map((node) => node.id),
      blockedNodes: blockedNodes.map((node) => node.id),
      pendingNodes: pendingNodes.map((node) => node.id),
      failedGates,
      requiredEvidenceMissing,
      iteration,
      createdAt,
    });
  }

  if (input.requestedAction === "continue" || pendingNodes.length > 0 || requiredEvidenceMissing.length > 0) {
    return buildDecision(input, {
      action: "continue",
      reason: pendingNodes.length > 0
        ? `Run still has active or pending nodes: ${pendingNodes.map((node) => node.id).join(", ")}`
        : "Required evidence is not yet recorded",
      confidence: 0.8,
      failedNodes: failedNodes.map((node) => node.id),
      blockedNodes: blockedNodes.map((node) => node.id),
      pendingNodes: pendingNodes.map((node) => node.id),
      failedGates,
      requiredEvidenceMissing,
      iteration,
      createdAt,
    });
  }

  return buildDecision(input, {
    action: "close",
    reason: "All required nodes and evidence gates are closed",
    confidence: 0.92,
    failedNodes: [],
    blockedNodes: [],
    pendingNodes: [],
    failedGates,
    requiredEvidenceMissing,
    iteration,
    createdAt,
  });
}

export function createLoopState(input: {
  runId: string;
  inputId: string;
  runState: EvaluateLoopDecisionInput["runState"];
  decision: LoopDecision;
  parentRunId?: string;
  maxIterations?: number;
  now?: () => Date;
}): OrchestrationLoopState {
  const now = (input.now ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: 1,
    runId: input.runId,
    parentRunId: input.parentRunId,
    inputId: input.inputId,
    iteration: input.decision.iteration,
    maxIterations: resolveMaxIterations(input.maxIterations ?? input.runState.maxIterations),
    status: statusFromDecision(input.decision),
    decisions: [input.decision],
    stateSnapshot: {
      runId: input.runState.runId,
      iterationCount: input.runState.iterationCount,
      maxIterations: input.runState.maxIterations,
      completedAt: input.runState.completedAt,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function buildDecision(
  input: EvaluateLoopDecisionInput,
  decision: Omit<LoopDecision, "schemaVersion" | "runId" | "inputId">,
): LoopDecision {
  return {
    schemaVersion: 1,
    runId: input.runId,
    inputId: input.inputId,
    ...decision,
  };
}

function statusFromDecision(decision: LoopDecision): OrchestrationLoopState["status"] {
  if (decision.action === "close") return "closed";
  if (decision.action === "block" || decision.action === "handoff") return "blocked";
  if (
    decision.action === "replan" &&
    (decision.failedNodes.length > 0 ||
      decision.blockedNodes.length > 0 ||
      decision.failedGates.length > 0)
  ) {
    return "failed";
  }
  return "running";
}

function resolveMaxIterations(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LOOP_MAX_ITERATIONS;
  return Math.min(HARD_LOOP_MAX_ITERATIONS, Math.max(1, Math.trunc(value)));
}

function collectFailedGates(nodes: DagNode[]): string[] {
  return nodes.flatMap((node) =>
    (node.evidence ?? [])
      .filter((evidence) => evidence.passed === false)
      .map((evidence) => `${node.id}:${evidence.gate}`),
  );
}

function collectMissingRequiredEvidence(nodes: DagNode[]): string[] {
  const missing: string[] = [];
  for (const node of nodes) {
    for (const output of node.outputs ?? []) {
      if (output.required === false || !output.gate || output.gate === "none") continue;
      if (node.status !== "done") continue;
      const hasPassedEvidence = (node.evidence ?? []).some((evidence) => evidence.gate === output.gate && evidence.passed);
      if (!hasPassedEvidence) missing.push(`${node.id}:${output.gate}`);
    }
  }
  return missing;
}
