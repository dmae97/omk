import { TaskDagGraph } from "./task-graph.js";
import { mergeDagNodeRouting, selectTaskRouting } from "./routing.js";
import type { DeepSeekModelTier, DeepSeekParticipation, ProviderId } from "../providers/types.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked" | "skipped";
export type DagContextBudget = "tiny" | "small" | "normal";
export type DagOutputGate = "file-exists" | "test-pass" | "review-pass" | "command-pass" | "summary" | "none";

export interface DagNodeInput {
  name: string;
  ref: string;
  from?: string;
  required?: boolean;
}

export interface DagNodeOutput {
  name: string;
  ref?: string;
  gate?: DagOutputGate;
  required?: boolean;
}

export interface DagNodeRouting {
  provider?: "auto" | ProviderId;
  fallbackProvider?: "kimi";
  providerReason?: string;
  providerModelTier?: DeepSeekModelTier;
  autoSpawned?: boolean;
  spawnReason?: string;
  routeSource?: "skill" | "mcp" | "hook" | "provider";
  /**
   * Skills/MCP/tools are routing hints for the Kimi runtime by default.
   * Set these booleans only when a node cannot run without live MCP/tool
   * authority; opportunistic providers can still advise from the hint list.
   */
  requiresMcp?: boolean;
  requiresToolCalling?: boolean;
  skills?: string[];
  mcpServers?: string[];
  tools?: string[];
  hooks?: string[];
  contextBudget?: DagContextBudget;
  readOnly?: boolean;
  evidenceRequired?: boolean;
  rationale?: string;
  rejected?: Array<{ id: string; reason: string }>;
}

export interface DagNodeFailurePolicy {
  retryable?: boolean;
  blockDependents?: boolean;
  fallbackRole?: string;
  skipOnFailure?: boolean;
}

export interface DagNodeEvidence {
  gate: string;
  passed: boolean;
  ref?: string;
  message?: string;
}

export interface DagNodeAttempt {
  attempt: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status?: "done" | "failed";
  provider?: ProviderId;
  requestedProvider?: ProviderId;
  fallbackFrom?: ProviderId;
  fallbackReason?: string;
  providerModel?: string;
  providerModelTier?: DeepSeekModelTier;
  providerParticipation?: DeepSeekParticipation;
}

export interface DagNode {
  id: string;
  name: string;
  role: string;
  dependsOn: string[];
  status: TaskStatus;
  worktree?: string;
  retries: number;
  maxRetries: number;
  timeoutMs?: number;
  timeoutPreset?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempts?: DagNodeAttempt[];
  priority?: number;
  cost?: 1 | 2 | 3;
  inputs?: DagNodeInput[];
  outputs?: DagNodeOutput[];
  routing?: DagNodeRouting;
  failurePolicy?: DagNodeFailurePolicy;
  blockedReason?: string;
  evidence?: DagNodeEvidence[];
  /** Live "thinking" text exposed while the node is running (e.g. ensemble progress). */
  thinking?: string;
}

export interface Dag {
  nodes: DagNode[];
}

export type DagNodeDefinition = Omit<DagNode, "status" | "retries">;

export function createDag(def: { nodes: DagNodeDefinition[] }): Dag {
  if (!def || typeof def !== "object" || !Array.isArray(def.nodes)) {
    throw new TypeError("DAG definition must have a nodes array");
  }
  const nodes = def.nodes.map((n) => {
    validateNodeDefinition(n);
    return {
      ...n,
      routing: mergeDagNodeRouting(selectTaskRouting(n), n.routing),
      failurePolicy: {
        retryable: true,
        blockDependents: true,
        skipOnFailure: false,
        ...(n.failurePolicy ?? {}),
      },
      status: "pending" as const,
      retries: 0,
    };
  });
  validateInputDependencies(nodes);
  new TaskDagGraph(nodes);
  return { nodes };
}

export function getRunnableNodes(dag: Dag): DagNode[] {
  return new TaskDagGraph(dag.nodes).runnableNodes();
}

export function getNodeById(dag: Dag, id: string): DagNode | undefined {
  return new TaskDagGraph(dag.nodes).getNode(id);
}

export function updateNodeStatus(dag: Dag, id: string, status: TaskStatus): void {
  const node = getNodeById(dag, id);
  if (node) {
    node.status = status;
    if (status === "failed") {
      node.retries += 1;
      if (node.retries < node.maxRetries) {
        node.status = "pending";
      } else {
        const shouldBlock = node.failurePolicy?.blockDependents !== false && !(node.outputs?.every((o) => o.required === false));
        if (shouldBlock) {
          blockDependents(dag, id, `dependency failed: ${id}`);
        }
      }
    }
  }
}

export function isDagComplete(dag: Dag): boolean {
  return dag.nodes.every((n) => n.status === "done" || n.status === "skipped");
}

export function isDagFailed(dag: Dag): boolean {
  return dag.nodes.some((n) => {
    if (n.status === "blocked") return true;
    if (n.status === "failed" && n.retries >= n.maxRetries) {
      if (n.failurePolicy?.blockDependents === false) return false;
      if (n.outputs?.every((o) => o.required === false)) return false;
      return true;
    }
    return false;
  });
}

export function dependsOnRequiredOutput(dependent: DagNode, failedId: string): boolean {
  const inputsFromFailed = dependent.inputs?.filter((input) => input.from === failedId) ?? [];
  if (inputsFromFailed.length > 0) {
    return inputsFromFailed.some((input) => input.required !== false);
  }
  return dependent.dependsOn.includes(failedId);
}

export function skipNode(dag: Dag, id: string): void {
  const node = getNodeById(dag, id);
  if (!node || node.status === "done" || node.status === "running") return;
  node.status = "skipped";
  node.blockedReason = `skipped because ${id} was skipped or failed with skipOnFailure`;
  const queue: Array<{ childId: string; skipSourceId: string }> = dag.nodes
    .filter((n) => n.dependsOn.includes(id))
    .map((n) => ({ childId: n.id, skipSourceId: id }));

  while (queue.length > 0) {
    const { childId, skipSourceId } = queue.shift()!;
    const child = dag.nodes.find((n) => n.id === childId);
    if (!child || child.status === "done" || child.status === "running" || child.status === "skipped") continue;
    if (!dependsOnRequiredOutput(child, skipSourceId)) continue;
    child.status = "skipped";
    child.blockedReason = `dependency skipped: ${id}`;
    for (const next of dag.nodes) {
      if (next.dependsOn.includes(childId)) queue.push({ childId: next.id, skipSourceId: childId });
    }
  }
}

function validateNodeDefinition(node: unknown): asserts node is DagNodeDefinition {
  if (!node || typeof node !== "object") {
    throw new TypeError("DAG node must be an object");
  }
  const record = node as Partial<DagNodeDefinition>;
  if (!isNonEmptyString(record.id)) {
    throw new TypeError("DAG node id must be a non-empty string");
  }
  if (!isNonEmptyString(record.name)) {
    throw new TypeError(`DAG node "${record.id}" name must be a non-empty string`);
  }
  if (!isNonEmptyString(record.role)) {
    throw new TypeError(`DAG node "${record.id}" role must be a non-empty string`);
  }
  if (!Array.isArray(record.dependsOn) || !record.dependsOn.every(isNonEmptyString)) {
    throw new TypeError(`DAG node "${record.id}" dependsOn must be an array of node ids`);
  }
  if (record.dependsOn.includes(record.id)) {
    throw new Error(`DAG node "${record.id}" cannot depend on itself`);
  }
  if (new Set(record.dependsOn).size !== record.dependsOn.length) {
    throw new Error(`DAG node "${record.id}" has duplicate dependencies`);
  }
  const maxRetries = record.maxRetries;
  if (!Number.isInteger(maxRetries) || maxRetries === undefined || maxRetries < 1) {
    throw new TypeError(`DAG node "${record.id}" maxRetries must be a positive integer`);
  }
  if (record.priority !== undefined && !Number.isFinite(record.priority)) {
    throw new TypeError(`DAG node "${record.id}" priority must be finite when provided`);
  }
  if (record.cost !== undefined && ![1, 2, 3].includes(record.cost)) {
    throw new TypeError(`DAG node "${record.id}" cost must be 1, 2, or 3 when provided`);
  }
}

function validateInputDependencies(nodes: DagNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const input of node.inputs ?? []) {
      if (input.from === undefined) continue;
      if (!ids.has(input.from)) {
        throw new Error(`DAG missing input dependency: node "${node.id}" input "${input.name}" references unknown "${input.from}"`);
      }
      if (!node.dependsOn.includes(input.from)) {
        throw new Error(`DAG hidden dependency: node "${node.id}" input "${input.name}" references "${input.from}" but dependsOn does not include it`);
      }
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function blockDependents(dag: Dag, failedId: string, reason: string): void {
  const nodeById = new Map(dag.nodes.map((node) => [node.id, node]));
  const queue: Array<{ id: string; blockerId: string }> = dag.nodes
    .filter((node) => node.dependsOn.includes(failedId))
    .map((node) => ({ id: node.id, blockerId: failedId }));

  while (queue.length > 0) {
    const { id, blockerId } = queue.shift()!;
    const node = nodeById.get(id);
    if (!node || node.status === "done" || node.status === "running" || node.status === "blocked") continue;
    if (node.failurePolicy?.blockDependents === false) continue;
    if (!dependsOnRequiredOutput(node, blockerId)) continue;
    node.status = "blocked";
    node.blockedReason = reason;
    for (const child of dag.nodes) {
      if (child.dependsOn.includes(id)) queue.push({ id: child.id, blockerId: id });
    }
  }
}
