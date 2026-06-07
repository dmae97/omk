import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { getProjectRoot } from "../util/fs.js";
import { createGraphView } from "../memory/graph-viewer.js";
import { header, label, status } from "../util/theme.js";
import { createOmkJsonEnvelope } from "../util/json-envelope.js";
import { getRunArtifactPath, listValidRunIds, validateRunId } from "../util/run-store.js";
import { RunManifestSchema } from "../schema/run-manifest.schema.js";
import type { RunManifest } from "../contracts/run.js";
import type { GraphState } from "../memory/local-graph-memory-store.js";

export interface GraphViewCommandOptions {
  input?: string;
  output?: string;
  limit?: string;
  type?: string;
  includeMemoryVersions?: boolean;
  open?: boolean;
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

// ---------------------------------------------------------------------------
// graph audit
// ---------------------------------------------------------------------------

export type GraphAuditVerdict = "passed" | "partial" | "failed";

export interface GraphAuditCounts {
  providerRoute: number;
  provider: number;
  evidence: number;
  decision: number;
  artifact: number;
}

export interface GraphAuditMismatch {
  field: string;
  graph: number | string | null;
  manifest: number | string | null;
}

export interface GraphAuditDangler {
  edgeId: string;
  type: string;
  from: string;
  to: string;
  missing: "from" | "to";
}

export interface GraphAuditRunResult {
  runId: string;
  runNodeFound: boolean;
  orphan: boolean;
  manifestPresent: boolean;
  counts: GraphAuditCounts;
  mismatches: GraphAuditMismatch[];
  danglers: GraphAuditDangler[];
  verdict: GraphAuditVerdict;
  notes: string[];
}

export interface GraphAuditReport {
  schemaVersion: "omk.graph-audit.v1";
  verdict: GraphAuditVerdict;
  statePath?: string;
  generatedAt: string;
  summary: { total: number; passed: number; partial: number; failed: number };
  runs: GraphAuditRunResult[];
}

export interface GraphAuditCommandOptions {
  run?: string;
  input?: string;
  json?: boolean;
}

const EVIDENCE_SUMMARY_FIELDS = ["required", "passed", "failed", "missing"] as const;

/**
 * Pure auditor: cross-checks linked run subgraphs against their manifests.
 * For each run it asserts the Run node exists with >=1 provider-route, provider,
 * evidence, decision, and artifact edge, cross-checks evidence counts/artifact
 * counts/status against the manifest, and flags orphan runs and dangling edges.
 */
export function auditGraphRuns(
  state: GraphState,
  entries: ReadonlyArray<{ runId: string; manifest?: RunManifest | null }>,
  statePath?: string
): GraphAuditReport {
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  const runs = entries.map((entry) => auditSingleRun(state, nodeIds, entry.runId, entry.manifest ?? null));
  const summary = { total: runs.length, passed: 0, partial: 0, failed: 0 };
  for (const run of runs) summary[run.verdict] += 1;
  const verdict: GraphAuditVerdict = summary.failed > 0 ? "failed" : summary.partial > 0 ? "partial" : "passed";
  return {
    schemaVersion: "omk.graph-audit.v1",
    verdict,
    statePath,
    generatedAt: new Date().toISOString(),
    summary,
    runs,
  };
}

function auditSingleRun(
  state: GraphState,
  nodeIds: Set<string>,
  runId: string,
  manifest: RunManifest | null
): GraphAuditRunResult {
  const notes: string[] = [];
  const mismatches: GraphAuditMismatch[] = [];
  const danglers: GraphAuditDangler[] = [];
  const counts: GraphAuditCounts = { providerRoute: 0, provider: 0, evidence: 0, decision: 0, artifact: 0 };
  const manifestPresent = manifest !== null;

  const runNode = state.nodes.find((node) => node.type === "Run" && node.properties.runId === runId);
  if (!runNode) {
    notes.push("run node not found in graph");
    if (!manifestPresent) notes.push("run-manifest.json not found");
    return { runId, runNodeFound: false, orphan: false, manifestPresent, counts, mismatches, danglers, verdict: "failed", notes };
  }

  const outgoing = state.edges.filter((edge) => edge.from === runNode.id);
  const routeEdges = outgoing.filter((edge) => edge.type === "HAS_PROVIDER_ROUTE");
  counts.providerRoute = routeEdges.length;
  counts.evidence = outgoing.filter((edge) => edge.type === "HAS_EVIDENCE").length;
  counts.decision = outgoing.filter((edge) => edge.type === "HAS_DECISION").length;
  counts.artifact = outgoing.filter((edge) => edge.type === "TOUCHES_FILE").length;

  const routeToEdges = routeEdges.flatMap((routeEdge) =>
    state.edges.filter((edge) => edge.from === routeEdge.to && edge.type === "ROUTES_TO")
  );
  counts.provider = routeToEdges.length;

  const orphan = outgoing.length === 0;

  // Dangler detection across the run subgraph (run edges + route ROUTES_TO).
  for (const edge of [...outgoing, ...routeToEdges]) {
    if (!nodeIds.has(edge.from)) danglers.push({ edgeId: edge.id, type: edge.type, from: edge.from, to: edge.to, missing: "from" });
    if (!nodeIds.has(edge.to)) danglers.push({ edgeId: edge.id, type: edge.type, from: edge.from, to: edge.to, missing: "to" });
  }

  if (manifest) {
    const evidenceNode = outgoing
      .filter((edge) => edge.type === "HAS_EVIDENCE")
      .map((edge) => state.nodes.find((node) => node.id === edge.to))
      .find((node) => node !== undefined);
    if (evidenceNode) {
      for (const field of EVIDENCE_SUMMARY_FIELDS) {
        const graphValue = Number(evidenceNode.properties[field] ?? Number.NaN);
        const manifestValue = manifest.evidenceSummary[field];
        if (graphValue !== manifestValue) {
          mismatches.push({ field: `evidence.${field}`, graph: Number.isNaN(graphValue) ? null : graphValue, manifest: manifestValue });
        }
      }
    } else {
      notes.push("evidence node missing for cross-check");
    }
    if (counts.artifact !== manifest.artifacts.length) {
      mismatches.push({ field: "artifact.count", graph: counts.artifact, manifest: manifest.artifacts.length });
    }
    const graphStatus = String(runNode.properties.status ?? "");
    if (graphStatus !== manifest.status) {
      mismatches.push({ field: "run.status", graph: graphStatus, manifest: manifest.status });
    }
  } else {
    notes.push("run-manifest.json not found; structural audit only");
  }

  const hasAllEdges =
    counts.providerRoute >= 1 &&
    counts.provider >= 1 &&
    counts.evidence >= 1 &&
    counts.decision >= 1 &&
    counts.artifact >= 1;

  let verdict: GraphAuditVerdict;
  if (orphan || !hasAllEdges) verdict = "failed";
  else if (danglers.length > 0 || mismatches.length > 0 || !manifestPresent) verdict = "partial";
  else verdict = "passed";

  return { runId, runNodeFound: true, orphan, manifestPresent, counts, mismatches, danglers, verdict, notes };
}

async function loadGraphStateForAudit(statePath: string): Promise<GraphState> {
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GraphState>;
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return { ...(parsed as GraphState), nodes: parsed.nodes, edges: parsed.edges };
    }
  } catch {
    // fall through to an empty state
  }
  return {
    version: 1,
    ontology: { version: "", classes: [], relationTypes: [], description: "" },
    project: { key: "", name: "", root: "" },
    updatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
  };
}

async function loadRunManifestForAudit(runId: string, root: string): Promise<RunManifest | null> {
  try {
    const raw = await readFile(getRunArtifactPath(runId, "run-manifest.json", root), "utf-8");
    const parsed = RunManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function graphAuditCommand(options: GraphAuditCommandOptions = {}): Promise<void> {
  const startedAt = Date.now();
  const root = getProjectRoot();
  const statePath = options.input ? resolve(root, options.input) : join(root, ".omk", "memory", "graph-state.json");
  const state = await loadGraphStateForAudit(statePath);
  const runIds = options.run ? [validateRunId(options.run)] : await listValidRunIds(root);

  const entries: Array<{ runId: string; manifest: RunManifest | null }> = [];
  for (const runId of runIds) {
    entries.push({ runId, manifest: await loadRunManifestForAudit(runId, root) });
  }

  const report = auditGraphRuns(state, entries, statePath);

  if (options.json) {
    console.log(
      JSON.stringify(
        createOmkJsonEnvelope({
          command: "graph",
          status: report.verdict,
          data: report,
          durationMs: Date.now() - startedAt,
        })
      )
    );
    return;
  }

  printGraphAuditReport(report);
  if (report.verdict === "failed") process.exitCode = 1;
}

function printGraphAuditReport(report: GraphAuditReport): void {
  console.log(header("OMK Graph Audit"));
  if (report.statePath) console.log(label("State", report.statePath));
  console.log(
    label("Runs", `${report.summary.total} (passed ${report.summary.passed}, partial ${report.summary.partial}, failed ${report.summary.failed})`)
  );
  for (const run of report.runs) {
    const line = `${run.runId} — routes ${run.counts.providerRoute}/providers ${run.counts.provider}/evidence ${run.counts.evidence}/decisions ${run.counts.decision}/artifacts ${run.counts.artifact}`;
    if (run.verdict === "passed") console.log(status.ok(line));
    else if (run.verdict === "partial") console.log(status.warn(line));
    else console.log(status.fail(line));
    for (const mismatch of run.mismatches) {
      console.log(label("  mismatch", `${mismatch.field}: graph=${String(mismatch.graph)} manifest=${String(mismatch.manifest)}`));
    }
    for (const dangler of run.danglers) {
      console.log(label("  dangler", `${dangler.type} missing ${dangler.missing} (${dangler.from} -> ${dangler.to})`));
    }
    for (const note of run.notes) console.log(label("  note", note));
  }
  const verdictLine = `Verdict: ${report.verdict}`;
  if (report.verdict === "passed") console.log(status.ok(verdictLine));
  else if (report.verdict === "partial") console.log(status.warn(verdictLine));
  else console.log(status.fail(verdictLine));
}
