/**
 * AdaptOrch-style topology router — pure TS, no IO, no python dependency.
 *
 * Extracts 5 structural features from a DAG and selects an execution topology
 * using threshold-based rules matching the AdaptOrch TopologyRouter spec.
 */

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export type DagTopology =
  | "singleton"
  | "parallel"
  | "pipeline"
  | "map_reduce"
  | "hierarchical"
  | "dag"
  | "hybrid";

export interface TopologyFeatures {
  nodeCount: number;
  edgeCount: number;
  width: number;
  criticalDepth: number;
  couplingDensity: number;
  parallelRatio: number;
}

export interface TopologyDecision {
  topology: DagTopology;
  reason: string;
  features: TopologyFeatures;
  waves: string[][];
}

export interface TopologyThresholds {
  /** θ_ω — parallel ratio threshold (default 0.5) */
  parallelRatio: number;
  /** θ_γ — coupling density considered "high" (default 0.6) */
  highCoupling: number;
  /** θ_δ — node count threshold for hierarchical (default 5) */
  hierarchicalSubtasks: number;
}

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

const DEFAULT_THRESHOLDS: TopologyThresholds = {
  parallelRatio: 0.5,
  highCoupling: 0.6,
  hierarchicalSubtasks: 5,
};

// ─────────────────────────────────────────────
// Env gate
// ─────────────────────────────────────────────

/**
 * Returns `true` unless OMK_ADAPTORCH_ROUTING is explicitly off/0/false.
 */
export function isAdaptorchRoutingEnabled(env?: Record<string, string | undefined>): boolean {
  const val = (env ?? process.env)["OMK_ADAPTORCH_ROUTING"];
  if (val === undefined) return true;
  const norm = val.trim().toLowerCase();
  return norm !== "0" && norm !== "off" && norm !== "false";
}

// ─────────────────────────────────────────────
// Feature extraction
// ─────────────────────────────────────────────

/**
 * Compute structural features of a DAG via Kahn topological sort.
 * Returns layers (waves) and derived metrics.  If a cycle is detected,
 * all nodes collapse into a single wave.
 */
export function computeTopologyFeatures(
  nodes: string[],
  edges: Array<{ from: string; to: string }>,
): TopologyFeatures & { layers: string[][] } {
  const n = nodes.length;
  if (n === 0) {
    return {
      nodeCount: 0,
      edgeCount: 0,
      width: 0,
      criticalDepth: 0,
      couplingDensity: 0,
      parallelRatio: 0,
      layers: [],
    };
  }

  // Build adjacency + in-degree
  const inDeg = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of nodes) {
    inDeg.set(id, 0);
    adjacency.set(id, []);
  }
  for (const e of edges) {
    adjacency.get(e.from)?.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  // Kahn topological sort
  const layers: string[][] = [];
  const visited = new Set<string>();

  // Seed: zero-in-degree nodes
  let frontier = nodes.filter((id) => (inDeg.get(id) ?? 0) === 0);
  if (frontier.length === 0) {
    // All nodes are in a cycle — single wave fallback
    return {
      nodeCount: n,
      edgeCount: edges.length,
      width: n,
      criticalDepth: 1,
      couplingDensity: computeCouplingDensity(n, edges.length),
      parallelRatio: 1,
      layers: [nodes.slice()],
    };
  }

  while (frontier.length > 0) {
    layers.push(frontier.slice());
    for (const id of frontier) visited.add(id);

    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const child of adjacency.get(id) ?? []) {
        const newDeg = (inDeg.get(child) ?? 1) - 1;
        inDeg.set(child, newDeg);
        if (newDeg === 0 && !visited.has(child)) {
          nextFrontier.push(child);
        }
      }
    }
    frontier = nextFrontier;
  }

  // Cycle detection: if any nodes remain unvisited, collapse to single wave
  if (visited.size < n) {
    return {
      nodeCount: n,
      edgeCount: edges.length,
      width: n,
      criticalDepth: 1,
      couplingDensity: computeCouplingDensity(n, edges.length),
      parallelRatio: 1,
      layers: [nodes.slice()],
    };
  }

  const width = Math.max(...layers.map((l) => l.length));
  const criticalDepth = layers.length;
  const couplingDensity = computeCouplingDensity(n, edges.length);
  const parallelRatio = n > 0 ? width / n : 0;

  return {
    nodeCount: n,
    edgeCount: edges.length,
    width,
    criticalDepth,
    couplingDensity,
    parallelRatio,
    layers,
  };
}

// ─────────────────────────────────────────────
// Topology selection
// ─────────────────────────────────────────────

/**
 * Select a topology and emit layered execution waves.
 *
 * Selection rules (in priority order):
 *   0 nodes       → singleton
 *   1 node        → singleton
 *   high coupling → dag (if depth==1) or hierarchical (if depth>1)
 *   parallelRatio ≥ θ_ω and nodes > 1 → parallel / map_reduce
 *   criticalDepth == nodes → pipeline
 *   otherwise     → hybrid
 */
export function routeTopology(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
  thresholds?: Partial<TopologyThresholds>,
): TopologyDecision {
  const t: TopologyThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const features = computeTopologyFeatures(nodeIds, edges);
  const { nodeCount, width, criticalDepth, couplingDensity, parallelRatio } = features;

  // 0 or 1 node → singleton
  if (nodeCount <= 1) {
    return {
      topology: "singleton",
      reason: nodeCount === 0 ? "empty DAG" : "single-node DAG",
      features,
      waves: features.layers,
    };
  }

  // High coupling check
  if (couplingDensity >= t.highCoupling) {
    const topology: DagTopology = criticalDepth > 1 ? "hierarchical" : "dag";
    return {
      topology,
      reason: `high coupling density ${couplingDensity.toFixed(2)} ≥ θ_γ=${t.highCoupling}`,
      features,
      waves: features.layers,
    };
  }

  // Parallel / map_reduce — wide low-coupling DAG
  if (parallelRatio >= t.parallelRatio && nodeCount > 1) {
    // map_reduce when enough nodes form ≥2 layers with fan-out then fan-in
    const topology: DagTopology =
      features.layers.length >= 2 && width >= t.hierarchicalSubtasks
        ? "map_reduce"
        : "parallel";
    return {
      topology,
      reason: `parallel ratio ${parallelRatio.toFixed(2)} ≥ θ_ω=${t.parallelRatio}, width=${width}`,
      features,
      waves: features.layers,
    };
  }

  // Linear chain → pipeline
  if (criticalDepth === nodeCount) {
    return {
      topology: "pipeline",
      reason: `linear chain: critical depth (${criticalDepth}) equals node count`,
      features,
      waves: features.layers,
    };
  }

  // Fall-through → hybrid
  return {
    topology: "hybrid",
    reason: `mixed structure: depth=${criticalDepth}, width=${width}, coupling=${couplingDensity.toFixed(2)}`,
    features,
    waves: features.layers,
  };
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

function computeCouplingDensity(n: number, edgeCount: number): number {
  if (n <= 1) return 0;
  const maxEdges = (n * (n - 1)) / 2;
  return maxEdges > 0 ? edgeCount / maxEdges : 0;
}
