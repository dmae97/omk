import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { getProjectRoot } from "../util/fs.js";
import { createGraphView, type GraphNode, type GraphState, type GraphStateEdge } from "../memory/graph-viewer.js";
import { header, label, status } from "../util/theme.js";

export interface GraphViewCommandOptions {
  input?: string;
  output?: string;
  limit?: string;
  type?: string;
  includeMemoryVersions?: boolean;
  open?: boolean;
}

export interface GraphAuditCommandOptions {
  input?: string;
  runManifest?: string;
  evidence?: string;
  decisions?: string;
  json?: boolean;
}

interface GraphAuditRecord {
  schemaVersion: "omk.graph-audit.v1";
  ok: boolean;
  command: "graph audit";
  runId: string;
  checks: Array<{
    id: string;
    passed: boolean;
    expected: number;
    observed: number;
    missing: string[];
  }>;
  data: {
    input: {
      graph: string;
      runManifest: string;
      evidence: string;
      decisions: string;
    };
    linked: {
      runNodes: string[];
      evidenceNodes: string[];
      decisionNodes: string[];
      providerRouteNodes: string[];
      edges: string[];
    };
  };
  warnings: string[];
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

interface RunManifestArtifact {
  runId: string;
}

interface EvidenceArtifact {
  evidenceId: string;
  runId?: string;
}

interface DecisionArtifact {
  decisionId: string;
  runId?: string;
}

export async function graphViewCommand(options: GraphViewCommandOptions = {}): Promise<void> {
  const root = getProjectRoot();
  const inputPath = options.input ? resolve(root, options.input) : join(root, ".omk", "memory", "graph-state.json");
  const outputPath = options.output ? resolve(root, options.output) : join(root, ".omk", "memory", "graph-view.html");
  const typeFilter = options.type
    ? options.type.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined;

  const result = await createGraphView({
    inputPath,
    outputPath,
    maxNodes: options.limit ? Number.parseInt(options.limit, 10) : undefined,
    includeMemoryVersions: Boolean(options.includeMemoryVersions),
    typeFilter,
    open: Boolean(options.open),
  });

  console.log(header("OMK Graph View"));
  console.log(label("Input", inputPath));
  console.log(label("Output", result.outputPath));
  console.log(label("Nodes", String(result.nodeCount)));
  console.log(label("Edges", String(result.edgeCount)));
  console.log(status.ok("Graph HTML generated"));
}

export async function graphAuditCommand(options: GraphAuditCommandOptions = {}): Promise<void> {
  const root = getProjectRoot();
  const input = requiredOption(options.input, "--input");
  const runManifestPath = requiredOption(options.runManifest, "--run-manifest");
  const evidencePath = requiredOption(options.evidence, "--evidence");
  const decisionsPath = requiredOption(options.decisions, "--decisions");

  const graph = await readJson<GraphState>(resolve(root, input));
  if (!Array.isArray(graph.nodes)) throw new Error("graph audit requires input graph with nodes array");
  const runManifest = await readJson<RunManifestArtifact>(resolve(root, runManifestPath));
  if (typeof runManifest.runId !== "string" || runManifest.runId.length === 0) {
    throw new Error("graph audit requires run manifest runId");
  }
  const evidence = await readJsonl<EvidenceArtifact>(resolve(root, evidencePath), isEvidenceArtifact);
  const decisions = await readJsonl<DecisionArtifact>(resolve(root, decisionsPath), isDecisionArtifact);
  const runId = runManifest.runId;

  const runNodes = graph.nodes.filter((node) => node.type === "Run" && (nodeHasValue(node, "runId", runId) || node.id === runId || node.label === runId));
  const evidenceIds = evidence.map((record) => record.evidenceId);
  const decisionIds = decisions.map((record) => record.decisionId);
  const evidenceNodes = graph.nodes.filter((node) => evidenceIds.some((evidenceId) => nodeHasValue(node, "evidenceId", evidenceId) || node.id === evidenceId));
  const decisionNodes = graph.nodes.filter((node) => decisionIds.some((decisionId) => nodeHasValue(node, "decisionId", decisionId) || node.id === decisionId));
  const providerRouteNodes = graph.nodes.filter((node) => node.type === "ProviderRoute" && nodeHasValue(node, "runId", runId));
  const edges = graph.edges ?? [];
  const linkedEdges = edges.filter((edge) => edgeTouchesRun(edge, runNodes, evidenceNodes) || edgeTouchesRun(edge, runNodes, decisionNodes) || edgeTouchesRun(edge, runNodes, providerRouteNodes));

  const checks = [
    buildCheck("run-node-linked", [runId], runNodes.map((node) => getNodeValue(node, "runId") ?? node.id)),
    buildCheck("evidence-nodes-linked", evidenceIds, evidenceNodes.map((node) => getNodeValue(node, "evidenceId") ?? node.id)),
    buildCheck("decision-nodes-linked", decisionIds, decisionNodes.map((node) => getNodeValue(node, "decisionId") ?? node.id)),
    buildCheck("provider-route-visible", [runId], providerRouteNodes.map((node) => String(getNodeValue(node, "runId") ?? ""))),
    buildCheck("audit-edges-linked", ["run-evidence", "run-decision"], linkedEdges.map((edge) => edge.type ?? edge.label ?? edge.id ?? "edge")),
  ];
  const errors = checks.flatMap((check) => check.missing.map((item) => `${check.id}: missing ${item}`));
  const report: GraphAuditRecord = {
    schemaVersion: "omk.graph-audit.v1",
    ok: errors.length === 0,
    command: "graph audit",
    runId,
    checks,
    data: {
      input: { graph: input, runManifest: runManifestPath, evidence: evidencePath, decisions: decisionsPath },
      linked: {
        runNodes: runNodes.map((node) => node.id),
        evidenceNodes: evidenceNodes.map((node) => node.id),
        decisionNodes: decisionNodes.map((node) => node.id),
        providerRouteNodes: providerRouteNodes.map((node) => node.id),
        edges: linkedEdges.map((edge) => edge.id ?? `${edge.source ?? edge.from}->${edge.target ?? edge.to}`),
      },
    },
    warnings: [],
    errors,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  console.log(header("OMK Graph Audit"));
  console.log(label("Run", runId));
  for (const check of checks) console.log(label(check.id, check.passed ? "passed" : `missing ${check.missing.join(", ")}`));
  console.log(report.ok ? status.ok("Graph audit passed") : status.error("Graph audit failed"));
  if (!report.ok) process.exitCode = 1;
}

function requiredOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`graph audit requires ${name}`);
  return value;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonl<T>(path: string, guard: (value: unknown) => value is T): Promise<T[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line, index) => {
    const parsed = JSON.parse(line) as unknown;
    if (!guard(parsed)) throw new Error(`${path}:${index + 1}: invalid graph audit input record`);
    return parsed;
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEvidenceArtifact(value: unknown): value is EvidenceArtifact {
  return isRecord(value) && typeof value.evidenceId === "string" && (value.runId === undefined || typeof value.runId === "string");
}

function isDecisionArtifact(value: unknown): value is DecisionArtifact {
  return isRecord(value) && typeof value.decisionId === "string" && (value.runId === undefined || typeof value.runId === "string");
}

function getNodeValue(node: GraphNode, key: string): string | undefined {
  const value = node.properties?.[key];
  return typeof value === "string" ? value : undefined;
}

function nodeHasValue(node: GraphNode, key: string, expected: string): boolean {
  return getNodeValue(node, key) === expected;
}

function edgeTouchesRun(edge: GraphStateEdge, runNodes: GraphNode[], targetNodes: GraphNode[]): boolean {
  const source = edge.source ?? edge.from;
  const target = edge.target ?? edge.to;
  if (!source || !target) return false;
  const runIds = new Set(runNodes.map((node) => node.id));
  const targetIds = new Set(targetNodes.map((node) => node.id));
  return (runIds.has(source) && targetIds.has(target)) || (runIds.has(target) && targetIds.has(source));
}

function buildCheck(id: string, expected: string[], observed: string[]): GraphAuditRecord["checks"][number] {
  const observedSet = new Set(observed);
  const missing = expected.filter((item) => !observedSet.has(item));
  return { id, passed: missing.length === 0, expected: expected.length, observed: observed.length, missing };
}
