import { spawn } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { pathToFileURL } from "url";

export interface GraphState {
  ontology?: {
    version?: string;
    classes?: string[];
    relationTypes?: string[];
  };
  project?: {
    key?: string;
    name?: string;
    root?: string;
  };
  nodes: GraphNode[];
  edges?: GraphStateEdge[];
}

export interface GraphNode {
  id: string;
  type: string;
  label?: string;
  summary?: string;
  path?: string;
  content?: string;
  tags?: string[];
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface GraphStateEdge {
  id?: string;
  from?: string;
  to?: string;
  source?: string;
  target?: string;
  type?: string;
  label?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface GraphViewOptions {
  inputPath: string;
  outputPath: string;
  maxNodes?: number;
  includeMemoryVersions?: boolean;
  typeFilter?: string[];
  open?: boolean;
}

export interface GraphViewResult {
  outputPath: string;
  nodeCount: number;
  edgeCount: number;
}

const TYPE_COLORS: Record<string, string> = {
  Project: "#7c3aed",
  Session: "#2563eb",
  Memory: "#059669",
  MemoryVersion: "#6b7280",
  Run: "#14b8a6",
  Goal: "#f59e0b",
  Topic: "#64748b",
  Decision: "#dc2626",
  Task: "#ea580c",
  Risk: "#be123c",
  Command: "#0f766e",
  File: "#0891b2",
  Evidence: "#16a34a",
  Provider: "#a855f7",
  ProviderRoute: "#8b5cf6",
  ProviderFallback: "#f97316",
  AuditLink: "#eab308",
  Constraint: "#9333ea",
  Question: "#0284c7",
  Answer: "#22c55e",
  Concept: "#4f46e5",
};

const REL_BY_TYPE: Record<string, string> = {
  Session: "HAS_SESSION",
  Memory: "HAS_MEMORY",
  MemoryVersion: "UPDATES",
  Run: "HAS_RUN",
  Goal: "HAS_GOAL",
  Topic: "HAS_TOPIC",
  Decision: "HAS_DECISION",
  Task: "HAS_TASK",
  Risk: "HAS_RISK",
  Command: "HAS_COMMAND",
  File: "TOUCHES_FILE",
  Evidence: "HAS_EVIDENCE",
  Provider: "USES_PROVIDER",
  ProviderRoute: "HAS_PROVIDER_ROUTE",
  ProviderFallback: "HAS_PROVIDER_FALLBACK",
  AuditLink: "HAS_AUDIT_LINK",
  Constraint: "HAS_CONSTRAINT",
  Question: "HAS_QUESTION",
  Answer: "HAS_ANSWER",
  Concept: "HAS_CONCEPT",
};

const REL_PREFIXES: Record<string, string> = {
  PARTOF: "PART_OF",
  DEPENDSON: "DEPENDS_ON",
  BLOCKEDBY: "BLOCKED_BY",
  EVIDENCEDBY: "EVIDENCED_BY",
  TOUCHESFILE: "TOUCHES_FILE",
  ROUTESTO: "ROUTES_TO",
  FALLSBACKTO: "FALLS_BACK_TO",
  USESPROVIDER: "USES_PROVIDER",
  HASPROVIDERROUTE: "HAS_PROVIDER_ROUTE",
  HASPROVIDERFALLBACK: "HAS_PROVIDER_FALLBACK",
  RUNID: "HAS_RUN",
  HASRUN: "HAS_RUN",
  GOALID: "HAS_GOAL",
  HASGOAL: "HAS_GOAL",
  PROVIDERATTEMPT: "HAS_PROVIDER_ROUTE",
  EVIDENCEGATE: "HAS_EVIDENCE",
  AUDITLINK: "HAS_AUDIT_LINK",
  HASAUDITLINK: "HAS_AUDIT_LINK",
  LINKSTO: "LINKS_TO",
  CONCEPT: "HAS_CONCEPT",
};

export async function createGraphView(options: GraphViewOptions): Promise<GraphViewResult> {
  const raw = await readFile(options.inputPath, "utf-8");
  const state = JSON.parse(raw) as GraphState;
  if (!Array.isArray(state.nodes)) {
    throw new Error("Invalid graph state: nodes array is missing");
  }

  const visibleNodes = loadVisibleNodes(state, options);
  const edges = materializeEdges(state, visibleNodes);
  const elements = toCytoscapeElements(visibleNodes, edges);
  const html = renderGraphHtml(elements, {
    nodeCount: visibleNodes.length,
    edgeCount: edges.length,
    ontologyVersion: state.ontology?.version,
    projectName: state.project?.name,
  });

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, html, "utf-8");

  if (options.open) {
    await openFileInBrowser(options.outputPath);
  }

  return {
    outputPath: options.outputPath,
    nodeCount: visibleNodes.length,
    edgeCount: edges.length,
  };
}

export function loadVisibleNodes(state: GraphState, options: GraphViewOptions): GraphNode[] {
  const typeFilter = new Set(options.typeFilter?.filter(Boolean));
  const maxNodes = normalizeLimit(options.maxNodes, 900);
  return state.nodes
    .filter((node) => {
      if (!options.includeMemoryVersions && node.type === "MemoryVersion") return false;
      if (typeFilter.size > 0 && !typeFilter.has(node.type)) return false;
      return true;
    })
    .sort((a, b) => priorityOf(a.type) - priorityOf(b.type) || labelOf(a).localeCompare(labelOf(b)))
    .slice(0, maxNodes);
}

export function materializeEdges(state: GraphState, visibleNodes: GraphNode[]): GraphEdge[] {
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const projectId = visibleNodes.find((node) => node.type === "Project")?.id;
  const fileByPath = new Map<string, string>();
  const memoryByPath = new Map<string, string>();
  const nodeByLabel = new Map<string, string>();

  for (const node of state.nodes) {
    const normalizedLabel = normalizeLookup(labelOf(node));
    if (normalizedLabel && visibleIds.has(node.id)) nodeByLabel.set(normalizedLabel, node.id);
    if (node.type === "Memory" && node.path) memoryByPath.set(node.path, node.id);
    if (node.type === "File" && node.path && visibleIds.has(node.id)) {
      fileByPath.set(normalizePath(node.path), node.id);
    }
  }

  const addEdge = (source: string | undefined, target: string | undefined, type: string): void => {
    if (!source || !target) return;
    if (!visibleIds.has(source) || !visibleIds.has(target)) return;
    const key = `${source}->${type}->${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: `edge-${edges.length}`, source, target, type });
  };

  for (const edge of state.edges ?? []) {
    addEdge(edge.from ?? edge.source, edge.to ?? edge.target, edge.type ?? normalizeLabel(edge.label) ?? "RELATED_TO");
  }

  for (const node of visibleNodes) {
    if (projectId && node.type === "Session") addEdge(projectId, node.id, "HAS_SESSION");
    if (projectId && node.type === "Memory") addEdge(projectId, node.id, "HAS_MEMORY");
  }

  for (const node of visibleNodes) {
    const generatedFrom = node.properties?.generatedFrom;
    if (typeof generatedFrom === "string") {
      addEdge(generatedFrom, node.id, REL_BY_TYPE[node.type] ?? "HAS_CONCEPT");
    }
  }

  for (const node of visibleNodes) {
    if (node.type !== "MemoryVersion") continue;
    const target = node.path ? memoryByPath.get(node.path) : undefined;
    addEdge(node.id, target, "UPDATES");
  }

  for (const node of visibleNodes) {
    const generatedFrom = node.properties?.generatedFrom;
    if (typeof generatedFrom !== "string") continue;
    for (const line of relationCandidateLines(node)) {
      const parsed = parseRelationLine(line);
      if (!parsed) continue;
      addEdge(generatedFrom, resolveTarget(parsed.target, fileByPath, nodeByLabel), parsed.type);
    }
  }

  return edges;
}

export function toCytoscapeElements(nodes: GraphNode[], edges: GraphEdge[]): Array<{ data: Record<string, unknown> }> {
  return [
    ...nodes.map((node) => ({
      data: {
        id: node.id,
        label: sanitizeText(labelOf(node), 90),
        type: node.type,
        summary: sanitizeText(node.summary ?? node.content ?? "", 500),
        path: node.path ?? "",
        tags: (node.tags ?? []).join(", "),
        color: TYPE_COLORS[node.type] ?? "#94a3b8",
      },
    })),
    ...edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.type,
      },
    })),
  ];
}

function renderGraphHtml(
  elements: Array<{ data: Record<string, unknown> }>,
  meta: { nodeCount: number; edgeCount: number; ontologyVersion?: string; projectName?: string }
): string {
  const encodedElements = JSON.stringify(elements).replace(/</g, "\\u003c");
  const title = sanitizeText(meta.projectName ? `OMK Ontology Graph — ${meta.projectName}` : "OMK Ontology Graph", 120);
  const ontology = sanitizeText(meta.ontologyVersion ?? "unknown", 80);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <script src="https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js"></script>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e5e7eb; }
    #top { min-height: 56px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 16px; background: #111827; border-bottom: 1px solid #334155; box-sizing: border-box; }
    #cy { width: 100vw; height: calc(100vh - 72px); display: block; }
    input { background: #020617; color: #e5e7eb; border: 1px solid #475569; border-radius: 8px; padding: 8px 10px; width: min(420px, 70vw); }
    .stat { color: #94a3b8; font-size: 13px; }
    .pill { color: #c4b5fd; background: #312e81; border: 1px solid #4c1d95; border-radius: 999px; padding: 3px 8px; font-size: 12px; }
  </style>
</head>
<body>
  <div id="top">
    <strong>${escapeHtml(title)}</strong>
    <span class="pill">ontology: ${escapeHtml(ontology)}</span>
    <input id="q" placeholder="filter: File, Risk, provider, schema.prisma..." />
    <span class="stat">nodes: ${meta.nodeCount} / edges: ${meta.edgeCount}</span>
  </div>
  <div id="cy"></div>

  <script>
    const allElements = ${encodedElements};
    const cy = cytoscape({
      container: document.getElementById("cy"),
      elements: allElements,
      wheelSensitivity: 0.15,
      style: [
        { selector: "node", style: { "background-color": "data(color)", "label": "data(label)", "color": "#e5e7eb", "font-size": 9, "text-wrap": "wrap", "text-max-width": 130, "width": 24, "height": 24, "border-width": 1, "border-color": "#f8fafc" } },
        { selector: "edge", style: { "width": 1, "line-color": "#64748b", "target-arrow-color": "#64748b", "target-arrow-shape": "triangle", "curve-style": "bezier", "label": "data(label)", "font-size": 7, "color": "#94a3b8", "text-rotation": "autorotate" } },
        { selector: ":selected", style: { "border-width": 4, "border-color": "#facc15", "line-color": "#facc15", "target-arrow-color": "#facc15" } }
      ],
      layout: { name: "cose", animate: false, nodeRepulsion: 9000, idealEdgeLength: 90, edgeElasticity: 80, gravity: 0.18, numIter: 1600 }
    });

    cy.on("tap", "node", (evt) => {
      const d = evt.target.data();
      alert(["type: " + d.type, "label: " + d.label, "path: " + (d.path || ""), "tags: " + (d.tags || ""), "", d.summary || ""].join("\\n"));
    });

    document.getElementById("q").addEventListener("input", (event) => {
      const q = event.target.value.toLowerCase().trim();
      if (!q) {
        cy.elements().style("display", "element");
        return;
      }
      cy.nodes().forEach((node) => {
        const d = node.data();
        const text = [d.label, d.type, d.summary, d.path, d.tags].join(" ").toLowerCase();
        node.style("display", text.includes(q) ? "element" : "none");
      });
      cy.edges().forEach((edge) => {
        const visible = edge.source().style("display") !== "none" && edge.target().style("display") !== "none";
        edge.style("display", visible ? "element" : "none");
      });
    });
  </script>
</body>
</html>`;
}

async function openFileInBrowser(path: string): Promise<void> {
  const url = pathToFileURL(path).href;
  const candidates: Array<{ command: string; args: string[] }> = process.platform === "win32"
    ? [{ command: "cmd.exe", args: ["/c", "start", "", url] }]
    : process.platform === "darwin"
      ? [{ command: "open", args: [url] }]
      : [
          { command: "wslview", args: [url] },
          { command: "xdg-open", args: [url] },
        ];

  for (const candidate of candidates) {
    if (trySpawnDetached(candidate.command, candidate.args)) return;
  }
}

function trySpawnDetached(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function relationCandidateLines(node: GraphNode): string[] {
  return [node.label, node.summary, node.content]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/\r?\n/));
}

function parseRelationLine(line: string): { type: string; target: string } | undefined {
  const match = cleanLine(line).match(/^([A-Za-z_ -]{3,40})\s*:\s*(.+)$/);
  if (!match) return undefined;
  const type = REL_PREFIXES[normalizeRelationPrefix(match[1])];
  const target = normalizePath(match[2]);
  if (!type || !target) return undefined;
  return { type, target };
}

function resolveTarget(target: string, fileByPath: Map<string, string>, nodeByLabel: Map<string, string>): string | undefined {
  return fileByPath.get(normalizePath(target)) ?? nodeByLabel.get(normalizeLookup(target));
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function priorityOf(type: string): number {
  const priority: Record<string, number> = {
    Project: 0,
    Session: 1,
    Memory: 2,
    Run: 3,
    Goal: 3,
    Decision: 3,
    Task: 3,
    Risk: 3,
    Evidence: 3,
    Provider: 3,
    ProviderRoute: 3,
    ProviderFallback: 3,
    AuditLink: 3,
    File: 4,
    Concept: 4,
    Command: 4,
    Topic: 9,
    MemoryVersion: 10,
  };
  return priority[type] ?? 99;
}

function labelOf(node: GraphNode): string {
  return node.label ?? node.path ?? node.id;
}

function normalizePath(value: string): string {
  return cleanLine(value).replace(/^`|`$/g, "").replace(/\.$/, "");
}

function normalizeLookup(value: string): string {
  return normalizePath(value).toLowerCase();
}

function normalizeRelationPrefix(value: string): string {
  return value.toUpperCase().replace(/[_\s-]/g, "");
}

function normalizeLabel(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, "_");
  return normalized || undefined;
}

function cleanLine(value: string): string {
  return value.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/[`*_~]/g, "").trim();
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
