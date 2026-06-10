/**
 * Adaptive runtime algorithms for the OMK hardfork.
 *
 * This module hosts pure, side-effect-free helpers that drive adaptive behaviour:
 * - Headroom thresholds (when to compact / hand off before the context limit).
 * - Topology routing (classify a task DAG into an execution topology).
 * - Ouroboros preference detection (presence-only, never throws, no secret reads).
 * - First-run adaptive plan generation (JSON-serializable artifact).
 *
 * The only non-pure helper is `writeFirstRunAdaptivePlan`, which performs an
 * idempotent, non-fatal filesystem write of the generated plan. It is kept here
 * so the behaviour stays unit-testable.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ============================================================================
// Shared types
// ============================================================================

/** Minimal environment shape consumed by adaptive helpers. */
export type AdaptiveEnv = Record<string, string | undefined>;

/** Directed edge in a task DAG. */
export interface AdaptiveEdge {
	from: string;
	to: string;
}

// ============================================================================
// Headroom thresholds
// ============================================================================

export const DEFAULT_HEADROOM_THRESHOLD = 0.9;
export const MIN_HEADROOM_THRESHOLD = 0.5;
export const MAX_HEADROOM_THRESHOLD = 0.99;

function normalizeFlag(value: string | undefined): string {
	return value?.trim().toLowerCase() ?? "";
}

/** Whether the adaptive headroom feature is explicitly disabled via OMK_HEADROOM. */
export function isHeadroomDisabled(env: AdaptiveEnv = {}): boolean {
	const raw = normalizeFlag(env.OMK_HEADROOM);
	return raw === "off" || raw === "0" || raw === "false" || raw === "no";
}

/**
 * Resolve the adaptive headroom utilization threshold.
 *
 * - Default 0.90.
 * - `OMK_HEADROOM_THRESHOLD` overrides (accepts a fraction `0.9` or percentage `90`).
 * - Clamped to [0.5, 0.99].
 * - Returns `0` when disabled via `OMK_HEADROOM=off|0|false|no`.
 */
export function resolveAdaptiveHeadroomThreshold(env: AdaptiveEnv = {}): number {
	if (isHeadroomDisabled(env)) {
		return 0;
	}
	let threshold = DEFAULT_HEADROOM_THRESHOLD;
	const raw = env.OMK_HEADROOM_THRESHOLD;
	if (raw !== undefined && raw.trim().length > 0) {
		const parsed = Number.parseFloat(raw);
		if (Number.isFinite(parsed)) {
			threshold = parsed > 1 ? parsed / 100 : parsed;
		}
	}
	return Math.min(MAX_HEADROOM_THRESHOLD, Math.max(MIN_HEADROOM_THRESHOLD, threshold));
}

/**
 * Whether to invoke headroom (compact / hand off) before hitting the hard context limit.
 * True only when the feature is enabled and utilization meets the resolved threshold.
 */
export function shouldUseHeadroomBeforeLimit(
	contextTokens: number,
	contextWindow: number,
	env: AdaptiveEnv = {},
): boolean {
	const threshold = resolveAdaptiveHeadroomThreshold(env);
	if (threshold <= 0) {
		return false;
	}
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
		return false;
	}
	if (!Number.isFinite(contextTokens) || contextTokens < 0) {
		return false;
	}
	return contextTokens / contextWindow >= threshold;
}

// ============================================================================
// Topology routing
// ============================================================================

export type AdaptiveTopology = "singleton" | "parallel" | "pipeline" | "map_reduce" | "hierarchical" | "dag" | "hybrid";

export interface AdaptiveTopologyFeatures {
	nodeCount: number;
	edgeCount: number;
	/** Maximum number of nodes in a single Kahn layer (parallel width). */
	width: number;
	/** Number of layers / longest dependency chain in node terms. */
	criticalDepth: number;
	/** Edges / possible edges (0 = fully parallel, 1 = fully sequential). */
	couplingDensity: number;
	/** width / nodeCount (inherent parallelism potential). */
	parallelRatio: number;
}

export interface AdaptiveTopologyDecision {
	topology: AdaptiveTopology;
	features: AdaptiveTopologyFeatures;
	/** Kahn layering; each entry is the set of node ids executable in that wave. */
	waves: string[][];
	reason: string;
	hasCycle: boolean;
}

/** Routing thresholds for the OMK topology router. */
const THETA_OMEGA = 0.5; // parallel ratio above this -> parallel/map_reduce
const THETA_GAMMA = 0.6; // coupling density above this -> high coupling
const THETA_DELTA = 5; // node-count / depth threshold for hierarchical

interface GraphStats {
	rootCount: number;
	hasFanInSink: boolean;
	hasFanOutRoot: boolean;
	hasCycle: boolean;
}

function classifyTopology(
	features: AdaptiveTopologyFeatures,
	stats: GraphStats,
): { topology: AdaptiveTopology; reason: string } {
	const { nodeCount, width, criticalDepth, couplingDensity, parallelRatio } = features;

	if (nodeCount === 0) {
		return { topology: "dag", reason: "empty DAG" };
	}
	if (nodeCount === 1) {
		return { topology: "singleton", reason: "single node, no parallelism" };
	}
	if (stats.hasCycle) {
		return { topology: "dag", reason: "cycle detected; treating as general DAG" };
	}

	const wide = parallelRatio >= THETA_OMEGA;
	const highCoupling = couplingDensity >= THETA_GAMMA;
	const deep = criticalDepth >= THETA_DELTA;

	if (width === 1) {
		return { topology: "pipeline", reason: "fully sequential chain (width 1)" };
	}
	if (wide && highCoupling) {
		return { topology: "hybrid", reason: "high parallelism with high coupling (mixed signals)" };
	}
	if (wide) {
		if (stats.rootCount <= 1 && stats.hasFanOutRoot && stats.hasFanInSink) {
			return { topology: "map_reduce", reason: "fan-out then fan-in with low coupling" };
		}
		return { topology: "parallel", reason: "wide DAG with low coupling" };
	}
	if (highCoupling) {
		return { topology: "pipeline", reason: "high coupling, sequential stages" };
	}
	if (deep && nodeCount > THETA_DELTA) {
		return { topology: "hierarchical", reason: "deep, large dependency tree" };
	}
	return { topology: "dag", reason: "general DAG with mixed parallelism" };
}

/**
 * Compute structural features and an execution topology for a task DAG.
 *
 * Pure: uses Kahn layering with a cycle guard. Dangling edges (endpoints not in
 * `nodes`) and duplicate edges are ignored; self loops mark the graph as cyclic.
 */
export function computeAdaptiveTopology(
	nodes: readonly string[],
	edges: readonly AdaptiveEdge[],
): AdaptiveTopologyDecision {
	// De-duplicate nodes while preserving input order for deterministic layering.
	const orderedNodes: string[] = [];
	const nodeSet = new Set<string>();
	for (const node of nodes) {
		if (!nodeSet.has(node)) {
			nodeSet.add(node);
			orderedNodes.push(node);
		}
	}
	const indexOf = new Map<string, number>();
	orderedNodes.forEach((node, index) => {
		indexOf.set(node, index);
	});

	const adjacency = new Map<string, Set<string>>();
	const inDegree = new Map<string, number>();
	const outDegree = new Map<string, number>();
	for (const node of orderedNodes) {
		adjacency.set(node, new Set());
		inDegree.set(node, 0);
		outDegree.set(node, 0);
	}

	let edgeCount = 0;
	let hasCycle = false;
	const edgeSeen = new Set<string>();
	for (const edge of edges) {
		if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
			continue; // ignore dangling edges
		}
		if (edge.from === edge.to) {
			hasCycle = true; // self loop
			continue;
		}
		const key = `${edge.from}\u0000${edge.to}`;
		if (edgeSeen.has(key)) {
			continue; // dedupe
		}
		edgeSeen.add(key);
		const targets = adjacency.get(edge.from);
		if (targets && !targets.has(edge.to)) {
			targets.add(edge.to);
			inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
			outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
			edgeCount++;
		}
	}

	// Kahn layering.
	const remaining = new Map(inDegree);
	let frontier = orderedNodes.filter((node) => (remaining.get(node) ?? 0) === 0);
	const waves: string[][] = [];
	let processed = 0;
	while (frontier.length > 0) {
		const wave = [...frontier].sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));
		waves.push(wave);
		const next: string[] = [];
		for (const node of wave) {
			processed++;
			for (const neighbor of adjacency.get(node) ?? []) {
				const degree = (remaining.get(neighbor) ?? 0) - 1;
				remaining.set(neighbor, degree);
				if (degree === 0) {
					next.push(neighbor);
				}
			}
		}
		frontier = next;
	}

	if (processed < orderedNodes.length) {
		hasCycle = true;
		const placed = new Set(waves.flat());
		const leftover = orderedNodes.filter((node) => !placed.has(node));
		if (leftover.length > 0) {
			waves.push(leftover);
		}
	}

	const nodeCount = orderedNodes.length;
	const width = waves.reduce((max, wave) => Math.max(max, wave.length), 0);
	const criticalDepth = waves.length;
	const maxEdges = nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 0;
	const couplingDensity = maxEdges > 0 ? Math.min(1, edgeCount / maxEdges) : 0;
	const parallelRatio = nodeCount > 0 ? width / nodeCount : 0;

	const features: AdaptiveTopologyFeatures = {
		nodeCount,
		edgeCount,
		width,
		criticalDepth,
		couplingDensity,
		parallelRatio,
	};

	const roots = orderedNodes.filter((node) => (inDegree.get(node) ?? 0) === 0);
	const stats: GraphStats = {
		rootCount: roots.length,
		hasFanOutRoot: roots.some((node) => (outDegree.get(node) ?? 0) > 1),
		hasFanInSink: orderedNodes.some((node) => (outDegree.get(node) ?? 0) === 0 && (inDegree.get(node) ?? 0) > 1),
		hasCycle,
	};

	const { topology, reason } = classifyTopology(features, stats);
	return { topology, features, waves, reason, hasCycle };
}

// ============================================================================
// Ouroboros preference detection
// ============================================================================

export type OuroborosMode = "always" | "auto" | "off";

export interface OuroborosIndicators {
	mcp: boolean;
	skills: boolean;
	binary: boolean;
}

export interface OuroborosPreference {
	mode: OuroborosMode;
	/** True when not off and at least one indicator is present. */
	preferred: boolean;
	/** True when any indicator is present (mcp/skills/binary). */
	available: boolean;
	fallback: "ouroboros" | "native";
	indicators: OuroborosIndicators;
	reason: string;
}

export interface OuroborosDetectionInput {
	env?: AdaptiveEnv;
	agentDir?: string;
	cwd?: string;
	home?: string;
	/** Injectable existence check (defaults to fs.existsSync); used for the binary indicator. */
	exists?: (path: string) => boolean;
}

function resolveOuroborosMode(env: AdaptiveEnv): OuroborosMode {
	const raw = normalizeFlag(env.OMK_OUROBOROS);
	if (raw === "off" || raw === "0" || raw === "false" || raw === "no") {
		return "off";
	}
	if (raw === "auto") {
		return "auto";
	}
	return "always"; // default, also "always" | "1" | "true" | "on" | unset
}

function safeExists(exists: (path: string) => boolean, path: string): boolean {
	try {
		return exists(path);
	} catch {
		return false;
	}
}

function detectMcpIndicator(agentDir: string, exists: (path: string) => boolean): boolean {
	const mcpPath = join(agentDir, "mcp.json");
	if (!safeExists(exists, mcpPath)) {
		return false;
	}
	try {
		const parsed = JSON.parse(readFileSync(mcpPath, "utf-8")) as Record<string, unknown>;
		const serversValue = parsed.mcpServers ?? parsed.servers ?? parsed;
		if (serversValue && typeof serversValue === "object") {
			return Object.keys(serversValue as Record<string, unknown>).some((key) =>
				key.toLowerCase().includes("ouroboros"),
			);
		}
		return false;
	} catch {
		return false;
	}
}

function detectSkillsIndicator(agentDir: string, exists: (path: string) => boolean): boolean {
	const skillsDir = join(agentDir, "skills");
	if (!safeExists(exists, skillsDir)) {
		return false;
	}
	try {
		return readdirSync(skillsDir).some((name) => name.toLowerCase().startsWith("ouroboros-"));
	} catch {
		return false;
	}
}

function detectBinaryIndicator(home: string, exists: (path: string) => boolean): boolean {
	return safeExists(exists, join(home, ".local", "bin", "ouroboros"));
}

/**
 * Detect whether the Ouroboros runtime should be preferred.
 *
 * Presence-only: never throws, performs no secret reads. When indicators are
 * absent the preference falls back to the native runtime.
 */
export function detectOuroborosPreference(input: OuroborosDetectionInput = {}): OuroborosPreference {
	const env = input.env ?? {};
	const exists = input.exists ?? existsSync;
	const home = input.home ?? env.HOME ?? env.USERPROFILE ?? homedir();
	const agentDir = input.agentDir;

	const mode = resolveOuroborosMode(env);

	const indicators: OuroborosIndicators = {
		mcp: agentDir ? detectMcpIndicator(agentDir, exists) : false,
		skills: agentDir ? detectSkillsIndicator(agentDir, exists) : false,
		binary: detectBinaryIndicator(home, exists),
	};

	const available = indicators.mcp || indicators.skills || indicators.binary;
	const preferred = mode !== "off" && available;
	const fallback: OuroborosPreference["fallback"] = preferred ? "ouroboros" : "native";

	let reason: string;
	if (mode === "off") {
		reason = "ouroboros disabled via OMK_OUROBOROS";
	} else if (available) {
		const present = [
			indicators.mcp ? "mcp" : undefined,
			indicators.skills ? "skills" : undefined,
			indicators.binary ? "binary" : undefined,
		].filter((value): value is string => value !== undefined);
		reason = `ouroboros preferred (${present.join(", ")})`;
	} else {
		reason = "ouroboros unavailable; falling back to native runtime";
	}

	return { mode, preferred, available, fallback, indicators, reason };
}

// ============================================================================
// First-run adaptive plan
// ============================================================================

export const ADAPTIVE_PLAN_VERSION = 1;
export const DEFAULT_ADAPTIVE_RUNTIME = "omk-parallel-orchestrator";

/** Startup DAG used to seed the first-run adaptive plan. */
export const OMK_STARTUP_DAG_NODES: readonly string[] = [
	"session_start",
	"resources_discover",
	"model_select",
	"run_loop",
];

export const OMK_STARTUP_DAG_EDGES: readonly AdaptiveEdge[] = [
	{ from: "session_start", to: "resources_discover" },
	{ from: "resources_discover", to: "model_select" },
	{ from: "model_select", to: "run_loop" },
];

export interface FirstRunAdaptivePlanInput {
	nodes?: readonly string[];
	edges?: readonly AdaptiveEdge[];
	env?: AdaptiveEnv;
	agentDir?: string;
	cwd?: string;
	home?: string;
	runtime?: string;
	/** Injectable clock (defaults to Date.now) for deterministic tests. */
	now?: () => number;
	exists?: (path: string) => boolean;
}

export interface FirstRunAdaptivePlan {
	version: number;
	runtime: string;
	createdAt: string;
	cwd: string | null;
	topology: AdaptiveTopologyDecision;
	headroom: { enabled: boolean; threshold: number };
	ouroboros: OuroborosPreference;
}

/** Build a JSON-serializable first-run adaptive plan. Pure. */
export function createFirstRunAdaptivePlan(input: FirstRunAdaptivePlanInput = {}): FirstRunAdaptivePlan {
	const env = input.env ?? {};
	const now = input.now ?? Date.now;
	const nodes = input.nodes ?? OMK_STARTUP_DAG_NODES;
	const edges = input.edges ?? OMK_STARTUP_DAG_EDGES;

	const topology = computeAdaptiveTopology(nodes, edges);
	const threshold = resolveAdaptiveHeadroomThreshold(env);
	const headroom = {
		enabled: threshold > 0,
		threshold: threshold > 0 ? threshold : DEFAULT_HEADROOM_THRESHOLD,
	};
	const ouroboros = detectOuroborosPreference({
		env,
		agentDir: input.agentDir,
		cwd: input.cwd,
		home: input.home,
		exists: input.exists,
	});

	return {
		version: ADAPTIVE_PLAN_VERSION,
		runtime: input.runtime ?? DEFAULT_ADAPTIVE_RUNTIME,
		createdAt: new Date(now()).toISOString(),
		cwd: input.cwd ?? null,
		topology,
		headroom,
		ouroboros,
	};
}

export interface WriteAdaptivePlanInput extends FirstRunAdaptivePlanInput {
	agentDir: string;
	/** Force rewrite even if the artifact already exists. */
	refresh?: boolean;
}

export interface WriteAdaptivePlanResult {
	path: string;
	written: boolean;
	plan?: FirstRunAdaptivePlan;
	reason: "created" | "refreshed" | "exists" | "error";
	error?: string;
}

/** Path of the first-run adaptive plan artifact. */
export function getAdaptivePlanPath(agentDir: string): string {
	return join(agentDir, "runs", "adaptive-runtime-plan.json");
}

function isTruthyFlag(value: string | undefined): boolean {
	const raw = normalizeFlag(value);
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Idempotently write the first-run adaptive plan. Non-fatal: any error is
 * captured in the result rather than thrown. Skips writing when the artifact
 * already exists unless `refresh` (or `OMK_ADAPTIVE_PLAN_REFRESH=1`) is set.
 */
export function writeFirstRunAdaptivePlan(input: WriteAdaptivePlanInput): WriteAdaptivePlanResult {
	const env = input.env ?? {};
	const exists = input.exists ?? existsSync;
	const path = getAdaptivePlanPath(input.agentDir);
	const refresh = input.refresh ?? isTruthyFlag(env.OMK_ADAPTIVE_PLAN_REFRESH);

	try {
		const alreadyExists = safeExists(exists, path);
		if (alreadyExists && !refresh) {
			return { path, written: false, reason: "exists" };
		}
		const plan = createFirstRunAdaptivePlan(input);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
		return { path, written: true, plan, reason: alreadyExists ? "refreshed" : "created" };
	} catch (error) {
		return { path, written: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
	}
}
