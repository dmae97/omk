import { mkdir, writeFile } from "fs/promises";

import { dirname, join, relative } from "path";
import { MemoryStore } from "../memory/memory-store.js";
import { pathExists } from "./fs.js";

type DailyDocName = "plan.md" | "improvements.md" | "critical-issues.md" | "init-checklist.md";

export interface ChatStartupOptions {
  root: string;
  runId: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface ChatStartupReport {
  date: string;
  docsDir: string;
  graphPath: string;
  memoryRecallPath: string;
  memoryRecallJsonPath: string;
  memoryRecallSummary: string;
  created: string[];
  existing: string[];
}

export interface MemoryRecallSummary {
  runId: string;
  query: string;
  graphPath: string;
  summaryPath: string;
  jsonPath: string;
  mindmapCount: number;
  searchCount: number;
  summary: string;
}

interface InitArtifact {
  path: string;
  description: string;
  critical: boolean;
}

const REQUIRED_INIT_ARTIFACTS: InitArtifact[] = [
  { path: "AGENTS.md", description: "top-level operating contract", critical: true },
  { path: ".kimi/AGENTS.md", description: "Kimi-specific operating rules", critical: true },
  { path: "DESIGN.md", description: "design/brand source of truth", critical: false },
  { path: ".omk/config.toml", description: "OMK project runtime settings", critical: true },
  { path: ".omk/agents/root.yaml", description: "root coordinator agent", critical: true },
  { path: ".kimi/mcp.json", description: "Kimi project MCP registry", critical: true },
  { path: ".omk/mcp.json", description: "legacy OMK MCP fallback", critical: false },
  { path: ".omk/lsp.json", description: "bundled TypeScript/Python LSP config", critical: false },
  { path: ".omk/hooks/pre-shell-guard.sh", description: "destructive shell guard", critical: true },
  { path: ".omk/hooks/protect-secrets.sh", description: "secret write guard", critical: true },
  { path: ".omk/memory/graph-state.json", description: "local ontology graph database", critical: true },
  { path: ".kimi/skills", description: "Kimi skill directory", critical: false },
  { path: ".agents/skills", description: "portable skill directory", critical: false },
];

const MEMORY_MIRRORS: Record<string, string> = {
  "project.md": "# Project Memory\n\nProject-local ontology graph state is stored in `.omk/memory/graph-state.json`.\n",
  "decisions.md": "# Decisions\n\nRecord architecture and workflow decisions here.\n",
  "commands.md": "# Frequently Used Commands\n\n```bash\nomk chat\nomk doctor\n```\n",
  "risks.md": "# Known Risks\n\n- Keep secrets out of memory and generated docs.\n",
};

export function formatChatStartupDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function ensureChatStartupArtifacts(options: ChatStartupOptions): Promise<ChatStartupReport> {
  const date = formatChatStartupDate(options.now ?? new Date());
  const docsDir = join(options.root, "docs", date);
  const graphPath = join(options.root, ".omk", "memory", "graph-state.json");
  const report: ChatStartupReport = {
    date,
    docsDir,
    graphPath,
    memoryRecallPath: join(options.root, ".omk", "runs", options.runId, "memory-recall-summary.md"),
    memoryRecallJsonPath: join(options.root, ".omk", "runs", options.runId, "memory-recall-summary.json"),
    memoryRecallSummary: "",
    created: [],
    existing: [],
  };

  await ensureDirectories(options.root, date, report);
  await ensureMemoryMirrors(options.root, report);
  await ensureLocalOntologyGraph({
    root: options.root,
    runId: options.runId,
    date,
    graphPath,
    docs: {},
    env: options.env,
  });

  const artifactStatuses = await readInitArtifactStatuses(options.root, graphPath);
  const docs = buildDailyDocs({
    date,
    runId: options.runId,
    artifactStatuses,
    graphPath: relativePath(options.root, graphPath),
  });

  for (const [name, content] of Object.entries(docs) as Array<[DailyDocName, string]>) {
    await writeIfMissing(join(docsDir, name), content, options.root, report);
  }

  await ensureLocalOntologyGraph({
    root: options.root,
    runId: options.runId,
    date,
    graphPath,
    docs,
    env: options.env,
  });

  const memoryRecall = await writeMemoryRecallSummary({
    root: options.root,
    runId: options.runId,
    query: options.runId,
    graphPath,
    env: options.env,
  });
  report.memoryRecallPath = memoryRecall.summaryPath;
  report.memoryRecallJsonPath = memoryRecall.jsonPath;
  report.memoryRecallSummary = memoryRecall.summary;

  return report;
}

export async function writeMemoryRecallSummary(options: {
  root: string;
  runId: string;
  query?: string;
  graphPath?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<MemoryRecallSummary> {
  const graphPath = options.graphPath ?? join(options.root, ".omk", "memory", "graph-state.json");
  const runDir = join(options.root, ".omk", "runs", options.runId);
  const summaryPath = join(runDir, "memory-recall-summary.md");
  const jsonPath = join(runDir, "memory-recall-summary.json");
  const query = options.query?.trim() || options.runId;
  const store = new MemoryStore(join(options.root, ".omk", "memory"), {
    projectRoot: options.root,
    sessionId: options.runId,
    source: "omk-memory-recall",
    env: {
      ...(options.env ?? process.env),
      OMK_MEMORY_BACKEND: "local_graph",
      OMK_MEMORY_FORCE: "0",
      OMK_MEMORY_STRICT: "false",
      OMK_MEMORY_MIRROR_FILES: "false",
      OMK_LOCAL_GRAPH_PATH: graphPath,
    },
  });

  let mindmapItems: string[] = [];
  let searchItems: string[] = [];
  try {
    const mindmap = await store.mindmap(query, 40);
    mindmapItems = (mindmap?.nodes ?? [])
      .filter((node) => ["Goal", "Task", "Decision", "Evidence", "Risk", "Memory"].includes(String(node.type)))
      .slice(0, 12)
      .map((node) => `- ${redactMemoryText(String(node.label ?? node.id ?? "memory"))} (${node.type})`);
  } catch {
    mindmapItems = [];
  }
  try {
    const search = await store.search(query, 10);
    searchItems = search
      .slice(0, 8)
      .map((result) => `- ${redactMemoryText(result.path)}: ${redactMemoryText(result.content).slice(0, 180)}`);
  } catch {
    searchItems = [];
  }

  const summary = [
    `# Memory Recall Summary`,
    "",
    `Run ID: ${options.runId}`,
    `Query: ${redactMemoryText(query)}`,
    `Graph: ${relativePath(options.root, graphPath)}`,
    "",
    "## Mindmap",
    ...(mindmapItems.length ? mindmapItems : ["- No relevant mindmap nodes found."]),
    "",
    "## Search",
    ...(searchItems.length ? searchItems : ["- No relevant search results found."]),
    "",
  ].join("\n");

  const payload: MemoryRecallSummary = {
    runId: options.runId,
    query: redactMemoryText(query),
    graphPath,
    summaryPath,
    jsonPath,
    mindmapCount: mindmapItems.length,
    searchCount: searchItems.length,
    summary,
  };
  await mkdir(runDir, { recursive: true });
  await writeFile(summaryPath, summary, "utf-8");
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return payload;
}

async function ensureDirectories(root: string, date: string, report: ChatStartupReport): Promise<void> {
  const dirs = [
    ".omk/memory",
    ".omk/runs",
    ".omk/checkpoints",
    ".omk/logs",
    ".omk/snippets",
    ".kimi/skills",
    ".agents/skills",
    "docs",
    join("docs", date),
  ];
  await Promise.all(
    dirs.map(async (dir) => {
      const full = join(root, dir);
      if (await pathExists(full)) {
        report.existing.push(normalizePath(dir));
        return;
      }
      await mkdir(full, { recursive: true });
      report.created.push(normalizePath(dir));
    })
  );
}

async function ensureMemoryMirrors(root: string, report: ChatStartupReport): Promise<void> {
  for (const [name, content] of Object.entries(MEMORY_MIRRORS)) {
    await writeIfMissing(join(root, ".omk", "memory", name), content, root, report);
  }
}

async function writeIfMissing(filePath: string, content: string, root: string, report: ChatStartupReport): Promise<void> {
  const rel = relativePath(root, filePath);
  if (await pathExists(filePath)) {
    report.existing.push(rel);
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  report.created.push(rel);
}

async function readInitArtifactStatuses(root: string, graphPath: string): Promise<Array<InitArtifact & { exists: boolean }>> {
  return Promise.all(
    REQUIRED_INIT_ARTIFACTS.map(async (artifact) => {
      const fullPath = artifact.path === ".omk/memory/graph-state.json" ? graphPath : join(root, artifact.path);
      return {
        ...artifact,
        exists: await pathExists(fullPath),
      };
    })
  );
}

function buildDailyDocs(options: {
  date: string;
  runId: string;
  artifactStatuses: Array<InitArtifact & { exists: boolean }>;
  graphPath: string;
}): Record<DailyDocName, string> {
  const missingCritical = options.artifactStatuses.filter((artifact) => artifact.critical && !artifact.exists);
  const missingOptional = options.artifactStatuses.filter((artifact) => !artifact.critical && !artifact.exists);
  const readyCritical = options.artifactStatuses.filter((artifact) => artifact.critical && artifact.exists);
  const checklist = renderChecklist(options.artifactStatuses);

  return {
    "plan.md": [
      `# ${options.date} OMK Chat Plan`,
      "",
      `**Run ID:** ${options.runId}`,
      `**Generated by:** omk chat bootstrap`,
      "",
      "## Purpose",
      "- Start every chat with a dated workspace for planning, issue triage, and verification evidence.",
      "- Keep ontology-backed memory available before the root coordinator starts.",
      "- Make required init state visible without overwriting user-authored docs.",
      "",
      "## Today Plan",
      "1. Review `init-checklist.md` and resolve missing critical init artifacts first.",
      "2. Use `improvements.md` as the active improvement backlog.",
      "3. Use `critical-issues.md` for blocking defects, safety risks, and verification gaps.",
      "4. Record command evidence before claiming work is complete.",
      "",
      "## Stop Condition",
      "- Critical init artifacts are present.",
      "- Ontology graph exists at `" + options.graphPath + "`.",
      "- Any new code/docs changes have explicit verification evidence.",
      "",
    ].join("\n"),
    "improvements.md": [
      `# ${options.date} Improvements`,
      "",
      "## Current Improvement Backlog",
      ...renderIssueList(missingOptional, "Optional init/support artifacts to add or refresh"),
      ...renderIssueList(missingCritical, "Critical init artifacts currently blocking reliable chat startup"),
      "",
      "## Suggested Focus",
      "- Keep `omk chat` startup idempotent and non-destructive.",
      "- Prefer local graph memory for default ontology state.",
      "- Keep generated daily docs small, dated, and safe to edit by hand.",
      "",
    ].join("\n"),
    "critical-issues.md": [
      `# ${options.date} Critical Issues`,
      "",
      "## Critical Init Status",
      missingCritical.length === 0
        ? "- No critical init artifacts were missing when this daily file was generated."
        : "",
      ...renderIssueList(missingCritical, "Missing critical artifacts"),
      "",
      "## Critical Artifacts Present",
      ...readyCritical.map((artifact) => `- ✅ \`${artifact.path}\` — ${artifact.description}`),
      "",
      "## Escalation Rule",
      "- Treat missing shell/secret guards, root agent config, MCP registry, or ontology graph as critical until restored.",
      "",
    ].join("\n"),
    "init-checklist.md": [
      `# ${options.date} Required Init Checklist`,
      "",
      `**Run ID:** ${options.runId}`,
      `**Ontology graph:** \`${options.graphPath}\``,
      "",
      "## Required Artifacts",
      checklist,
      "",
      "## Recovery Command",
      "```bash",
      "omk init",
      "omk doctor",
      "```",
      "",
    ].join("\n"),
  };
}

function renderChecklist(artifactStatuses: Array<InitArtifact & { exists: boolean }>): string {
  return artifactStatuses
    .map((artifact) => {
      const marker = artifact.exists ? "✅" : artifact.critical ? "🚨" : "⚠️";
      const priority = artifact.critical ? "critical" : "support";
      return `- ${marker} \`${artifact.path}\` — ${priority}; ${artifact.description}`;
    })
    .join("\n");
}

function renderIssueList(artifacts: InitArtifact[], title: string): string[] {
  if (artifacts.length === 0) return [`### ${title}`, "- None detected.", ""];
  return [
    `### ${title}`,
    ...artifacts.map((artifact) => `- \`${artifact.path}\` — ${artifact.description}`),
    "",
  ];
}

async function ensureLocalOntologyGraph(options: {
  root: string;
  runId: string;
  date: string;
  graphPath: string;
  docs: Partial<Record<DailyDocName, string>>;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = {
    ...(options.env ?? process.env),
    OMK_MEMORY_BACKEND: "local_graph",
    OMK_MEMORY_FORCE: "0",
    OMK_MEMORY_STRICT: "false",
    OMK_MEMORY_MIRROR_FILES: "false",
    OMK_LOCAL_GRAPH_PATH: options.graphPath,
  };
  const store = new MemoryStore(join(options.root, ".omk", "memory"), {
    projectRoot: options.root,
    sessionId: options.runId,
    source: "omk-chat-bootstrap",
    env,
  });

  const entries = Object.entries(options.docs).filter(
    (entry): entry is [DailyDocName, string] => typeof entry[1] === "string"
  );
  if (entries.length === 0) {
    await store.ensureGraphState();
    return;
  }
  for (const [name, content] of entries) {
    await store.write(`daily/${options.date}/${name}`, content);
  }
}

function relativePath(root: string, path: string): string {
  return normalizePath(relative(root, path));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function redactMemoryText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=***");
}
