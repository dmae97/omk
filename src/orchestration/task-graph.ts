import { dependsOnRequiredOutput, type Dag, type DagNode } from "./dag.js";

export interface RunnableNodePlan {
  readonly node: DagNode;
  readonly nodeId: string;
  readonly rank: number;
  readonly score: number;
  readonly criticalPathDepth: number;
  readonly downstreamCount: number;
  readonly priority: number;
  readonly cost: number;
  readonly evidenceProducer: boolean;
  readonly evidenceRequired: boolean;
  readonly reason: string;
}

export class TaskDagGraph {
  private readonly nodeById = new Map<string, DagNode>();
  private readonly predecessorIds = new Map<string, string[]>();
  private readonly successorIds = new Map<string, string[]>();
  private readonly order = new Map<string, number>();
  private readonly criticalPathDepthCache = new Map<string, number>();
  private readonly downstreamCountCache = new Map<string, number>();
  private topologicalIds?: string[];

  constructor(nodes: DagNode[]) {
    nodes.forEach((node, index) => {
      if (this.nodeById.has(node.id)) {
        throw new Error(`DAG duplicate node id: ${node.id}`);
      }
      this.nodeById.set(node.id, node);
      this.predecessorIds.set(node.id, [...node.dependsOn]);
      this.successorIds.set(node.id, []);
      this.order.set(node.id, index);
    });

    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        if (!this.nodeById.has(dep)) {
          throw new Error(`DAG missing dependency: node "${node.id}" depends on unknown "${dep}"`);
        }
        this.successorIds.get(dep)?.push(node.id);
      }
    }

    // Validate once up front. The cached order is reused by the scheduler.
    this.topologicalOrder();
  }

  getNode(id: string): DagNode | undefined {
    return this.nodeById.get(id);
  }

  predecessors(id: string): DagNode[] {
    return (this.predecessorIds.get(id) ?? [])
      .map((depId) => this.nodeById.get(depId))
      .filter((node): node is DagNode => node !== undefined);
  }

  successors(id: string): DagNode[] {
    return (this.successorIds.get(id) ?? [])
      .map((nodeId) => this.nodeById.get(nodeId))
      .filter((node): node is DagNode => node !== undefined);
  }

  topologicalOrder(): DagNode[] {
    if (!this.topologicalIds) {
      this.topologicalIds = this.computeTopologicalIds();
    }
    return this.topologicalIds
      .map((id) => this.nodeById.get(id))
      .filter((node): node is DagNode => node !== undefined);
  }

  runnableNodes(): DagNode[] {
    return this.topologicalOrder()
      .filter((node) => (
        node.status === "pending" && this.predecessors(node.id).every((dep) => {
          if (!this.isRequiredReadinessDependency(node, dep)) return true;
          if (dep.status === "done") return true;
          if (dep.status === "skipped") {
            return !dependsOnRequiredOutput(node, dep.id);
          }
          if (dep.status === "failed") {
            return dep.failurePolicy?.blockDependents === false ||
                   dep.outputs?.every((o) => o.required === false) ||
                   node.failurePolicy?.blockDependents === false ||
                   !dependsOnRequiredOutput(node, dep.id);
          }
          if (dep.status === "blocked") {
            return dep.failurePolicy?.blockDependents === false ||
                   dep.outputs?.every((o) => o.required === false) ||
                   node.failurePolicy?.blockDependents === false ||
                   !dependsOnRequiredOutput(node, dep.id);
          }
          return false;
        })
      ))
      .sort((a, b) => this.compareRunnable(a.id, b.id));
  }

  private isRequiredReadinessDependency(dependent: DagNode, predecessor: DagNode): boolean {
    const inputsFromPredecessor = dependent.inputs?.filter((input) => input.from === predecessor.id) ?? [];
    if (inputsFromPredecessor.length > 0) {
      return inputsFromPredecessor.some((input) => input.required !== false);
    }
    const outputs = predecessor.outputs ?? [];
    if (outputs.length > 0 && outputs.every((output) => output.required === false)) {
      return false;
    }
    return dependent.dependsOn.includes(predecessor.id);
  }

  private computeTopologicalIds(): string[] {
    const inDegree = new Map<string, number>();
    for (const id of this.nodeById.keys()) {
      inDegree.set(id, this.predecessorIds.get(id)?.length ?? 0);
    }

    const queue = [...inDegree.entries()]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id)
      .sort((a, b) => this.compareOrder(a, b));
    const result: string[] = [];

    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(id);
      for (const successor of this.successorIds.get(id) ?? []) {
        const nextDegree = (inDegree.get(successor) ?? 0) - 1;
        inDegree.set(successor, nextDegree);
        if (nextDegree === 0) {
          queue.push(successor);
          queue.sort((a, b) => this.compareOrder(a, b));
        }
      }
    }

    if (result.length !== this.nodeById.size) {
      throw new Error(`DAG circular dependency detected: ${this.findCycle().join(" -> ")}`);
    }

    return result;
  }

  private _findCycleRaw(): string[] | null {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (id: string): string[] | null => {
      if (visiting.has(id)) {
        return [...stack.slice(stack.indexOf(id)), id];
      }
      if (visited.has(id)) return null;

      visiting.add(id);
      stack.push(id);
      for (const next of this.successorIds.get(id) ?? []) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
      stack.pop();
      visiting.delete(id);
      visited.add(id);
      return null;
    };

    for (const id of this.nodeById.keys()) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
    return null;
  }

  findCycle(): string[] {
    const raw = this._findCycleRaw();
    if (!raw) return ["unknown"];
    return raw.map((id) => {
      const node = this.nodeById.get(id);
      return node ? `${node.name} (${id})` : id;
    });
  }

  findAllCycles(limit = 20): string[][] {
    const cycles: string[][] = [];
    const seen = new Set<string>();

    for (const startId of this.nodeById.keys()) {
      const dfs = (id: string, path: string[], visited: Set<string>): void => {
        if (visited.has(id)) {
          if (id === startId && path.length > 0) {
            const cycle = [...path, startId];
            const key = cycle.join("->");
            if (!seen.has(key)) {
              seen.add(key);
              cycles.push(cycle.map((cid) => {
                const node = this.nodeById.get(cid);
                return node ? `${node.name} (${cid})` : cid;
              }));
            }
          }
          return;
        }
        if (path.length > this.nodeById.size) return;

        const newVisited = new Set(visited);
        newVisited.add(id);
        const newPath = [...path, id];

        for (const nextId of this.successorIds.get(id) ?? []) {
          if (cycles.length >= limit) return;
          dfs(nextId, newPath, newVisited);
        }
      };

      dfs(startId, [], new Set());
      if (cycles.length >= limit) break;
    }

    return cycles;
  }

  getCriticalPathDepth(id: string): number {
    return this.criticalPathDepth(id);
  }

  getDownstreamCount(id: string): number {
    return this.downstreamCount(id);
  }

  getRunnableScore(id: string): number {
    return this.runnableScore(id);
  }

  runnablePlan(): RunnableNodePlan[] {
    return this.runnableNodes().map((node, index) => this.describeRunnableNode(node, index));
  }

  private compareOrder(a: string, b: string): number {
    return (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0);
  }

  private compareRunnable(a: string, b: string): number {
    return this.runnableScore(b) - this.runnableScore(a) || this.compareOrder(a, b);
  }

  private describeRunnableNode(node: DagNode, index: number): RunnableNodePlan {
    const criticalPathDepth = this.criticalPathDepth(node.id);
    const downstreamCount = this.downstreamCount(node.id);
    const evidenceProducer = (node.outputs ?? []).some((output) => output.gate && output.gate !== "none");
    const evidenceRequired = node.routing?.evidenceRequired === true;
    const priority = Number.isFinite(node.priority) ? node.priority ?? 0 : 0;
    const cost = node.cost ?? 1;
    const score = this.runnableScore(node.id);
    return {
      node,
      nodeId: node.id,
      rank: index + 1,
      score,
      criticalPathDepth,
      downstreamCount,
      priority,
      cost,
      evidenceProducer,
      evidenceRequired,
      reason: [
        `criticalDepth=${criticalPathDepth}`,
        `downstream=${downstreamCount}`,
        `priority=${priority}`,
        `cost=${cost}`,
        evidenceProducer ? "evidenceProducer" : "noEvidenceGate",
        evidenceRequired ? "evidenceRequired" : "evidenceOptional",
      ].join("; "),
    };
  }

  private runnableScore(id: string): number {
    const node = this.nodeById.get(id);
    if (!node) return 0;
    const explicitPriority = Number.isFinite(node.priority) ? node.priority ?? 0 : 0;
    const evidenceProducer = (node.outputs ?? []).some((output) => output.gate && output.gate !== "none") ? 1 : 0;
    const evidenceRequiredBoost = node.routing?.evidenceRequired ? 2 : 0;
    const costPenalty = Math.max(0, (node.cost ?? 1) - 1);

    const runningCost = [...this.nodeById.values()]
      .filter((n) => n.status === "running")
      .reduce((sum, n) => sum + (n.cost ?? 1), 0);
    const threshold = 6;
    const projectedCost = runningCost + (node.cost ?? 1);
    const overBudgetPenalty = projectedCost > threshold ? (projectedCost - threshold) * 2 : 0;

    return (
      3 * this.criticalPathDepth(id)
      + 2 * this.downstreamCount(id)
      + 1.5 * evidenceProducer
      + evidenceRequiredBoost
      + explicitPriority
      - node.retries
      - costPenalty
      - overBudgetPenalty
    );
  }

  private criticalPathDepth(id: string): number {
    const cached = this.criticalPathDepthCache.get(id);
    if (cached !== undefined) return cached;
    const successors = this.successorIds.get(id) ?? [];
    const depth = successors.length === 0 ? 0 : 1 + Math.max(...successors.map((successor) => this.criticalPathDepth(successor)));
    this.criticalPathDepthCache.set(id, depth);
    return depth;
  }

  private downstreamCount(id: string): number {
    const cached = this.downstreamCountCache.get(id);
    if (cached !== undefined) return cached;
    const visited = new Set<string>();
    const visit = (nodeId: string): void => {
      for (const successor of this.successorIds.get(nodeId) ?? []) {
        if (visited.has(successor)) continue;
        visited.add(successor);
        visit(successor);
      }
    };
    visit(id);
    const count = visited.size;
    this.downstreamCountCache.set(id, count);
    return count;
  }
}

const GRAPH_CACHE = new WeakMap<Dag, TaskDagGraph>();

export function getTaskDagGraph(dag: Dag): TaskDagGraph {
  let graph = GRAPH_CACHE.get(dag);
  if (!graph) {
    graph = new TaskDagGraph(dag.nodes);
    GRAPH_CACHE.set(dag, graph);
  }
  return graph;
}

export function invalidateTaskDagGraph(dag: Dag): void {
  GRAPH_CACHE.delete(dag);
}
