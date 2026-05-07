#!/usr/bin/env node
import { createInterface } from "readline";
import { writeSync } from "fs";
import { readFile, writeFile, readdir, access, realpath } from "fs/promises";
import { join, resolve, relative } from "path";
import { execFileSync } from "child_process";
import { MemoryStore } from "../memory/memory-store.js";
import { canWriteConfig, configWriteDeniedMessage } from "./config-permissions.js";
import { runQualityGate, type QualityGateResults } from "./quality-gate.js";
import { saveCheckpoint, listCheckpoints, restoreCheckpoint } from "../util/checkpoint.js";
import { getOmkVersionSync } from "../util/version.js";
import { saveSnippet, getSnippet, deleteSnippet, searchSnippets } from "../util/snippet.js";
import { normalizeGoal } from "../goal/intake.js";
import { createGoalPersister } from "../goal/persistence.js";
import { checkGoalEvidence, checkGoalConstraints } from "../goal/evidence.js";
import { scoreGoal } from "../goal/scoring.js";
import { suggestNextAction, evaluateMissingCriteria } from "../goal/eval-criteria.js";
import type { MemoryOntology, MemoryMindmap } from "../memory/local-graph-memory-store.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { writeTodos, type TodoItem } from "../util/todo-sync.js";
import { listActiveSessions, readSessionMeta, type SessionMeta } from "../util/session.js";

// ─── Types ──────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpTextContent {
  type: "text";
  text: string;
}

interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface Resource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

interface Prompt {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

// ─── Constants ──────────────────────────────────────────────────────────

const PROJECT_ROOT = process.env.OMK_PROJECT_ROOT || process.cwd();
const OMK_DIR = join(PROJECT_ROOT, ".omk");
const OMK_MEMORY_DIR = join(OMK_DIR, "memory");
const OMK_AGENTS_DIR = join(OMK_DIR, "agents", "roles");
const OMK_RUNS_DIR = join(OMK_DIR, "runs");
const OMK_CONFIG_PATH = join(OMK_DIR, "config.toml");
const OMK_GOALS_DIR = join(OMK_DIR, "goals");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "omk-project";
const SERVER_VERSION = getOmkVersionSync();
const MEMORY_STORE = new MemoryStore(OMK_MEMORY_DIR, {
  projectRoot: PROJECT_ROOT,
  source: "omk-project-mcp",
});
const GOAL_PERSISTER = createGoalPersister(OMK_GOALS_DIR);
const STATE_PERSISTER = createStatePersister(OMK_RUNS_DIR);

// ─── JSON-RPC / MCP error helpers ───────────────────────────────────────

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_OMK_SERVER_ERROR = -32000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function writeDiagnostic(message: string, data: Record<string, unknown>): void {
  const payload = JSON.stringify({ message, ...data });
  process.stderr.write(`[omk-project-mcp] ${payload}\n`);
}

function buildErrorData(
  req: JsonRpcRequest,
  err: unknown,
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    requestId: req.id,
    method: req.method,
    errorName: errorName(err),
    ...context,
  };
}

function formatToolErrorText(toolName: string, err: unknown): string {
  return JSON.stringify({
    ok: false,
    source: "omk-project-mcp",
    tool: toolName,
    error: {
      message: errorMessage(err),
      name: errorName(err),
    },
    hint: "This is an OMK tool-level failure, not a JSON-RPC transport failure. Fix the input or inspect the referenced OMK project state, then retry the tool.",
  }, null, 2);
}

function toolResultFromValue(result: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

function toolErrorResult(toolName: string, err: unknown): McpToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: formatToolErrorText(toolName, err) }],
  };
}

// ─── Security helpers ───────────────────────────────────────────────────

async function safePath(inputPath: string, baseDir: string): Promise<string> {
  // 1. Reject null bytes
  if (inputPath.includes("\0")) {
    throw new Error(`Invalid path: null byte detected`);
  }

  // 2. Normalize backslashes to forward slashes
  let normalized = inputPath.replace(/\\/g, "/");

  // 3. Decode percent-encoded sequences
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    throw new Error(`Invalid path: malformed percent-encoding`);
  }

  // Re-check null bytes after decoding
  if (normalized.includes("\0")) {
    throw new Error(`Invalid path: null byte detected after decoding`);
  }

  const full = resolve(join(baseDir, normalized));

  // 4. Resolve symlinks with realpath
  const realFull = await realpath(full).catch(() => full);

  // 5. Final guard: ensure resolved path is still under baseDir
  const rel = relative(baseDir, realFull);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`Path traversal detected: ${inputPath}`);
  }

  return realFull;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sanitizeGoalId(goalId: string): string {
  const sanitized = goalId.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (sanitized !== goalId || sanitized.length === 0 || sanitized.length > 128) {
    throw new Error(`Invalid goalId: ${goalId}`);
  }
  return sanitized;
}

function validateMemoryWrite(content: string): void {
  if (!content || content.trim().length === 0) {
    throw new Error("Memory write rejected: content is empty");
  }
  const trimmed = content.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
    } catch {
      throw new Error("Memory write rejected: content looks like JSON but is not valid");
    }
  }
}

function sanitizeMemoryQuery(query: string): string {
  return query.replace(/[^\p{L}\p{N}\s\-_./:@#]/gu, "").slice(0, 200);
}

// ─── Resource handlers ──────────────────────────────────────────────────

async function handleReadGoalResource(goalId: string): Promise<{ content: string }> {
  const goal = await GOAL_PERSISTER.load(sanitizeGoalId(goalId));
  if (!goal) throw new Error(`Goal not found: ${goalId}`);
  return { content: JSON.stringify(goal, null, 2) };
}

async function handleReadRunResource(runId: string): Promise<{ content: string }> {
  const state = await STATE_PERSISTER.load(runId);
  if (!state) throw new Error(`Run state not found: ${runId}`);
  return { content: JSON.stringify(state, null, 2) };
}

async function handleReadOntologyResource(): Promise<{ content: string }> {
  const ontology = await MEMORY_STORE.ontology();
  if (!ontology) {
    const status = await MEMORY_STORE.status();
    return { content: JSON.stringify({ backend: status.backend, note: "Ontology is available when backend=local_graph" }, null, 2) };
  }
  return { content: JSON.stringify(ontology, null, 2) };
}

// ─── Prompt handlers ────────────────────────────────────────────────────

function handleGetGoalIntakePrompt(args?: Record<string, string>): {
  description: string;
  messages: Array<{ role: string; content: { type: string; text: string } }>;
} {
  const rawGoal = args?.rawGoal ?? "<paste the raw user goal here>";
  return {
    description: "Normalize a raw goal into a structured GoalSpec",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a goal-intake agent. Normalize the following raw goal into a structured GoalSpec (JSON).

Raw goal:
"""
${rawGoal}
"""

Output a JSON object with these fields:
- title: concise title (max 120 chars)
- objective: one-paragraph objective
- successCriteria: array of { id, description, requirement: "required"|"optional", weight, inferred: false }
- constraints: array of { id, description }
- nonGoals: array of strings
- expectedArtifacts: array of { name, path?, gate? }
- riskLevel: "low" | "medium" | "high"

Only return valid JSON.`,
        },
      },
    ],
  };
}

function handleGetEvidenceReviewPrompt(args?: Record<string, string>): {
  description: string;
  messages: Array<{ role: string; content: { type: string; text: string } }>;
} {
  const goalId = args?.goalId ?? "<goalId>";
  return {
    description: "Review evidence against success criteria for a goal",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are an evidence-review agent. Review the collected evidence for goal ${goalId}.

For each success criterion:
1. State whether evidence exists and is sufficient.
2. Identify gaps or risks.
3. Recommend next steps (add evidence, re-run tests, or mark blocked).

Use the omk_goal_show and omk_evidence_check tools to fetch current state before writing your review.`,
        },
      },
    ],
  };
}

function handleGetQualityGatePrompt(args?: Record<string, string>): {
  description: string;
  messages: Array<{ role: string; content: { type: string; text: string } }>;
} {
  const scope = args?.scope ?? "all";
  return {
    description: "Run lint, typecheck, test, and build quality gates",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a quality-gate agent. Run the quality gates for scope: ${scope}.

Steps:
1. Call omk_quality_gate to execute lint, typecheck, test, and build.
2. For any failure, read the saved log and propose a fix.
3. Do not proceed with downstream tasks until required gates pass.
4. Summarize results in a concise pass/fail table.`,
        },
      },
    ],
  };
}

// ─── Tool handlers (Goal) ───────────────────────────────────────────────

async function handleGoalCreate(args: {
  rawPrompt: string;
  title?: string;
  objective?: string;
  successCriteria?: Array<{
    id: string;
    description: string;
    requirement: "required" | "optional";
    weight: number;
  }>;
  constraints?: string[];
  nonGoals?: string[];
  expectedArtifacts?: Array<{ name: string; path?: string }>;
  riskLevel?: "low" | "medium" | "high";
}): Promise<{ goalId: string; spec: unknown }> {
  const spec = normalizeGoal({
    rawPrompt: args.rawPrompt,
    title: args.title,
    objective: args.objective,
    successCriteria: args.successCriteria?.map((c) => ({ ...c, inferred: false })),
    constraints: args.constraints,
    nonGoals: args.nonGoals,
    expectedArtifacts: args.expectedArtifacts,
    riskLevel: args.riskLevel,
  });
  await GOAL_PERSISTER.save(spec);
  return { goalId: spec.goalId, spec };
}

async function handleGoalShow(args: { goalId: string }): Promise<{ spec: unknown }> {
  const spec = await GOAL_PERSISTER.load(sanitizeGoalId(args.goalId));
  if (!spec) throw new Error(`Goal not found: ${args.goalId}`);
  return { spec };
}

async function handleGoalList(): Promise<{ goals: string[] }> {
  const goals = await GOAL_PERSISTER.list();
  return { goals };
}

async function handleGoalVerify(args: { goalId: string; runId?: string }): Promise<{
  goalId: string;
  evidence: unknown[];
  score: unknown;
  constraints: { passed: boolean; violations: string[] };
}> {
  const goal = await GOAL_PERSISTER.load(sanitizeGoalId(args.goalId));
  if (!goal) throw new Error(`Goal not found: ${args.goalId}`);

  let evidence: import("../contracts/goal.js").GoalEvidence[] = [];
  if (args.runId) {
    const runState = await STATE_PERSISTER.load(args.runId);
    if (!runState) throw new Error(`Run state not found: ${args.runId}`);
    evidence = await checkGoalEvidence(goal, { root: PROJECT_ROOT, runState });
    await GOAL_PERSISTER.saveEvidence(goal.goalId, evidence);
  } else {
    evidence = await GOAL_PERSISTER.loadEvidence(goal.goalId);
  }

  const constraints = checkGoalConstraints(goal);
  const score = scoreGoal(goal, evidence);
  return { goalId: goal.goalId, evidence, score, constraints };
}

async function handleGoalClose(args: { goalId: string }): Promise<{ success: boolean; goalId: string }> {
  const goal = await GOAL_PERSISTER.load(sanitizeGoalId(args.goalId));
  if (!goal) throw new Error(`Goal not found: ${args.goalId}`);
  goal.status = "closed";
  goal.updatedAt = new Date().toISOString();
  await GOAL_PERSISTER.save(goal);
  return { success: true, goalId: goal.goalId };
}

// ─── Tool handlers (Evidence) ───────────────────────────────────────────

async function handleEvidenceAdd(args: {
  goalId: string;
  criterionId: string;
  passed: boolean;
  message?: string;
  ref?: string;
}): Promise<{ success: boolean; goalId: string; criterionId: string }> {
  const goalId = sanitizeGoalId(args.goalId);
  const goal = await GOAL_PERSISTER.load(goalId);
  if (!goal) throw new Error(`Goal not found: ${args.goalId}`);

  const evidence = await GOAL_PERSISTER.loadEvidence(goalId);
  evidence.push({
    criterionId: args.criterionId,
    passed: args.passed,
    message: args.message,
    ref: args.ref,
    checkedAt: new Date().toISOString(),
  });
  await GOAL_PERSISTER.saveEvidence(goalId, evidence);
  return { success: true, goalId, criterionId: args.criterionId };
}

async function handleEvidenceCheck(args: {
  goalId: string;
  runId?: string;
}): Promise<{
  goalId: string;
  evidence: unknown[];
  score: unknown;
  constraints: { passed: boolean; violations: string[] };
}> {
  const goal = await GOAL_PERSISTER.load(sanitizeGoalId(args.goalId));
  if (!goal) throw new Error(`Goal not found: ${args.goalId}`);

  let evidence: import("../contracts/goal.js").GoalEvidence[] = [];
  if (args.runId) {
    const runState = await STATE_PERSISTER.load(args.runId);
    if (!runState) throw new Error(`Run state not found: ${args.runId}`);
    evidence = await checkGoalEvidence(goal, { root: PROJECT_ROOT, runState });
  } else {
    evidence = await checkGoalEvidence(goal, {
      root: PROJECT_ROOT,
      runState: {
        schemaVersion: 1,
        runId: "none",
        nodes: [],
        startedAt: new Date().toISOString(),
      },
    });
  }
  await GOAL_PERSISTER.saveEvidence(goal.goalId, evidence);
  const constraints = checkGoalConstraints(goal);
  const score = scoreGoal(goal, evidence);
  return { goalId: goal.goalId, evidence, score, constraints };
}

// ─── Tool handlers (Run) ────────────────────────────────────────────────

async function handleRunState(args: { runId: string }): Promise<{ state: unknown }> {
  const state = await STATE_PERSISTER.load(args.runId);
  if (!state) throw new Error(`Run state not found: ${args.runId}`);
  return { state };
}

// ─── Tool handlers (Quality Gate) ───────────────────────────────────────

async function handleQualityGate(): Promise<QualityGateResults> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  return runQualityGate(PROJECT_ROOT, config);
}

// ─── Tool handlers (Memory) ─────────────────────────────────────────────

async function handleMemoryRead(args: { path: string }): Promise<{ content: string }> {
  await safePath(args.path, OMK_MEMORY_DIR);
  const content = await MEMORY_STORE.read(args.path);
  return { content };
}

async function handleMemoryWrite(args: { path: string; content: string }): Promise<{ success: boolean }> {
  await safePath(args.path, OMK_MEMORY_DIR);
  validateMemoryWrite(args.content);
  await MEMORY_STORE.write(args.path, args.content);
  return { success: true };
}

// ─── Tool handlers (Graph) ──────────────────────────────────────────────

async function handleGraphQuery(args: { query: string }): Promise<unknown> {
  return MEMORY_STORE.graphQuery(args.query);
}

// ─── Tool handlers (Memory Search / Status / Ontology / Mindmap) ─────────

async function handleSearchMemory(args: { query: string; limit?: number }): Promise<{
  results: Array<{ type: string; name: string; snippet: string }>;
}> {
  const query = sanitizeMemoryQuery(args.query);
  const limit = typeof args.limit === "number" ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 10;
  const searchResults = await MEMORY_STORE.search(query, limit);
  return {
    results: searchResults.map((r) => ({
      type: "Memory",
      name: r.path,
      snippet: r.content.slice(0, 500),
    })),
  };
}

async function handleMemoryStatus(): Promise<{
  backend: string;
  healthy: boolean;
  nodeCounts: Record<string, number>;
  lastSync: string | null;
}> {
  const status = await MEMORY_STORE.status();
  let healthy = status.backend === "local_graph" && status.localGraph.configured;

  let nodeCounts: Record<string, number> = {};
  const lastSync: string | null = null;

  try {
    const mindmap = await MEMORY_STORE.mindmap("", 1);
    if (mindmap) {
      if (status.backend === "kuzu") healthy = true;
      nodeCounts = mindmap.nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      // lastSync not available from mindmap structure; set to null
    }
  } catch {
    // Fallback: node counts unavailable
  }

  return {
    backend: status.backend,
    healthy,
    nodeCounts,
    lastSync,
  };
}

async function handleMemoryOntology(args: { nodeType?: string }): Promise<{
  ontology: MemoryOntology | null;
  nodeType?: string;
}> {
  const ontology = await MEMORY_STORE.ontology();
  return { ontology, nodeType: args.nodeType };
}

async function handleMemoryMindmap(args: { query?: string; depth?: number }): Promise<{
  mindmap: MemoryMindmap | null;
}> {
  const query = args.query ? sanitizeMemoryQuery(args.query) : undefined;
  const limit = typeof args.depth === "number" ? Math.max(1, Math.min(250, args.depth * 20)) : 80;
  const mindmap = await MEMORY_STORE.mindmap(query, limit);
  return { mindmap };
}

// ─── Tool handlers (Goal Next Action) ────────────────────────────────────

async function handleGoalNext(args: { goalId?: string }): Promise<{
  goal: { goalId: string; title: string; objective: string; status: string } | null;
  missingCriteria: Array<{
    criterionId: string;
    description: string;
    requirement: string;
    priority: number;
  }>;
  latestEvidence: Array<{
    criterionId: string;
    passed: boolean;
    message?: string;
    checkedAt: string;
  }>;
  suggestedNextAction: { type: string; targetId: string; description: string; reason: string };
  recommendedCommands: string[];
  recommendedSkills: string[];
}> {
  let goalId = args.goalId;
  if (!goalId) {
    const goals = await GOAL_PERSISTER.list();
    for (const id of goals) {
      const g = await GOAL_PERSISTER.load(id);
      if (g && g.status !== "closed" && g.status !== "done" && g.status !== "cancelled") {
        goalId = g.goalId;
        break;
      }
    }
  }
  if (!goalId) {
    throw new Error("No active goal found");
  }
  const goal = await GOAL_PERSISTER.load(sanitizeGoalId(goalId));
  if (!goal) throw new Error(`Goal not found: ${goalId}`);

  const evidence = await GOAL_PERSISTER.loadEvidence(goal.goalId);
  const missingCriteria = evaluateMissingCriteria(goal, evidence);
  const suggestion = suggestNextAction(goal, evidence);

  const recommendedCommands: string[] = [];
  const recommendedSkills: string[] = [];
  if (goal.riskLevel === "high") {
    recommendedCommands.push("omk_quality_gate", "omk_save_checkpoint");
    recommendedSkills.push("omk-plan-first", "omk-quality-gate");
  } else {
    recommendedCommands.push("omk_quality_gate");
    recommendedSkills.push("omk-quality-gate");
  }
  if (missingCriteria.some((c) => c.requirement === "required")) {
    recommendedSkills.push("omk-test-debug-loop");
  }

  return {
    goal: {
      goalId: goal.goalId,
      title: goal.title,
      objective: goal.objective,
      status: goal.status,
    },
    missingCriteria,
    latestEvidence: evidence.slice(-10),
    suggestedNextAction: suggestion,
    recommendedCommands,
    recommendedSkills,
  };
}

// ─── Context compression with ontology grounding ─────────────────────────

async function handleCompressContext(args: { query: string; limit?: number }): Promise<{
  briefing: string;
  sources: Array<{ type: string; label: string; content: string }>;
}> {
  const limit = Math.max(1, Math.min(50, args.limit ?? 20));
  const sources: Array<{ type: string; label: string; content: string }> = [];

  // 1. Pull ontology schema
  try {
    const ontology = await MEMORY_STORE.ontology();
    if (ontology) {
      sources.push({
        type: "ontology",
        label: `Project Ontology (${ontology.version})`,
        content: `Classes: ${ontology.classes.join(", ")}\nRelations: ${ontology.relationTypes.join(", ")}`,
      });
    }
  } catch {
    // ignore ontology failures
  }

  // 2. Pull mindmap centered on query
  try {
    const mindmap = await MEMORY_STORE.mindmap(args.query, limit);
    if (mindmap && mindmap.nodes.length > 0) {
      const relevant = mindmap.nodes
        .filter((n) => n.type === "Goal" || n.type === "Task" || n.type === "Decision" || n.type === "Evidence" || n.type === "Concept")
        .slice(0, limit)
        .map((n) => `- ${n.label} (${n.type})${n.summary ? `: ${n.summary}` : ""}`)
        .join("\n");
      if (relevant) {
        sources.push({
          type: "mindmap",
          label: `Mindmap: ${args.query}`,
          content: relevant,
        });
      }
    }
  } catch {
    // ignore mindmap failures
  }

  // 3. Search memory for related facts
  try {
    const searchResults = await MEMORY_STORE.search(args.query, limit);
    if (searchResults.length > 0) {
      const relevant = searchResults
        .slice(0, Math.min(10, limit))
        .map((r) => `- ${r.path}: ${r.content.slice(0, 200)}`)
        .join("\n");
      sources.push({
        type: "search",
        label: `Memory Search: ${args.query}`,
        content: relevant,
      });
    }
  } catch {
    // ignore search failures
  }

  // 4. Fetch recent ensemble decisions if query looks like a goal
  try {
    const { recallRecentEnsembleDecisions } = await import("../goal/ensemble-memory.js");
    const recent = await recallRecentEnsembleDecisions(args.query, PROJECT_ROOT, 3);
    if (recent.length > 0) {
      const content = recent
        .map((d) => `- [${d.timestamp}] action=${d.action}, confidence=${d.confidence.toFixed(2)}\n  ${d.candidateVotes.map((v) => `  ${v.id}: ${v.action} (weight=${v.weight}) — ${v.reason}`).join("\n")}`)
        .join("\n");
      sources.push({
        type: "ensemble",
        label: "Recent Ensemble Decisions",
        content,
      });
    }
  } catch {
    // ignore ensemble recall failures
  }

  // 5. Build grounded briefing
  const briefingLines = [
    `# Ground Truth Briefing for Context Compression`,
    ``,
    `> Query: ${args.query}`,
    `> Sources: ${sources.length} (ontology, mindmap, memory search, ensemble decisions)`,
    ``,
    `## Rules for compression`,
    `- Preserve every class, relation, and decision listed below.`,
    `- Do not invent nodes, files, or APIs that are not present in the sources.`,
    `- When summarizing, anchor statements to specific source types (ontology / mindmap / search / ensemble).`,
    ``,
  ];

  for (const src of sources) {
    briefingLines.push(`## ${src.label} [${src.type}]`, src.content, ``);
  }

  briefingLines.push(
    `## End of Ground Truth Briefing`,
    `Compress the conversation context above, keeping these grounded facts as immovable anchors.`
  );

  return {
    briefing: briefingLines.join("\n"),
    sources,
  };
}

// ─── Legacy tool handlers (kept for internal use, not exported) ─────────

async function handleReadConfig(): Promise<{ content: string }> {
  const content = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  return { content };
}

async function handleWriteConfig(args: { content: string }): Promise<{ success: boolean }> {
  if (!canWriteConfig()) {
    throw new Error(configWriteDeniedMessage());
  }
  await writeFile(OMK_CONFIG_PATH, args.content, "utf-8");
  return { success: true };
}

async function handleListAgents(): Promise<{ agents: string[] }> {
  if (!(await pathExists(OMK_AGENTS_DIR))) return { agents: [] };
  const entries = await readdir(OMK_AGENTS_DIR, { withFileTypes: true });
  const agents = entries.filter((e) => e.isFile() && e.name.endsWith(".yaml")).map((e) => e.name.replace(/\.yaml$/, ""));
  return { agents };
}

async function handleReadAgent(args: { name: string }): Promise<{ content: string }> {
  const full = await safePath(`${args.name}.yaml`, OMK_AGENTS_DIR);
  const content = await readFile(full, "utf-8").catch(() => "");
  return { content };
}

async function handleListRuns(): Promise<{ runs: Array<{ id: string; createdAt: string }> }> {
  if (!(await pathExists(OMK_RUNS_DIR))) return { runs: [] };
  const entries = await readdir(OMK_RUNS_DIR, { withFileTypes: true });
  const runs = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      id: e.name,
      createdAt: parseRunDate(e.name),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { runs };
}

function parseRunDate(runId: string): string {
  try {
    const parts = runId.split("T");
    if (parts.length === 2) {
      const date = parts[0];
      const time = parts[1].replace(/-/g, ":").replace(/:(\d+)Z$/, ".$1Z");
      return `${date}T${time}`;
    }
    return runId;
  } catch {
    return runId;
  }
}

async function handleReadRun(args: { runId: string }): Promise<{ goal: string; plan: string }> {
  const runDir = await safePath(args.runId, OMK_RUNS_DIR);
  const [goal, plan] = await Promise.all([
    readFile(join(runDir, "goal.md"), "utf-8").catch(() => ""),
    readFile(join(runDir, "plan.md"), "utf-8").catch(() => ""),
  ]);
  return { goal, plan };
}

async function handleGetProjectInfo(): Promise<{
  name: string;
  description?: string;
  gitBranch?: string;
  gitClean?: boolean;
  gitChanges?: number;
}> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  const nameMatch = config.match(/^name\s*=\s*"([^"]+)"/m);
  const descMatch = config.match(/^description\s*=\s*"([^"]*)"/m);

  let gitBranch: string | undefined;
  let gitClean = true;
  let gitChanges = 0;

  try {
    gitBranch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    const lines = status.split("\n").filter((l) => l.trim().length > 0);
    gitChanges = lines.length;
    gitClean = lines.length === 0;
  } catch {
    // ignore git errors
  }

  return {
    name: nameMatch?.[1] ?? "my-project",
    description: descMatch?.[1] ?? undefined,
    gitBranch,
    gitClean,
    gitChanges,
  };
}

async function handleGetQualitySettings(): Promise<{
  lint: string;
  test: string;
  typecheck: string;
  build: string;
}> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  const lint = config.match(/^lint\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  const test = config.match(/^test\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  const typecheck = config.match(/^typecheck\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  const build = config.match(/^build\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  return { lint, test, typecheck, build };
}

async function handleGetApprovalPolicy(): Promise<{ policy: string }> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  const policy = config.match(/^approval_policy\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  return { policy };
}

async function handleListWorktrees(): Promise<{ worktrees: string[] }> {
  const worktreesDir = join(OMK_DIR, "worktrees");
  if (!(await pathExists(worktreesDir))) return { worktrees: [] };

  const result: string[] = [];
  const runEntries = await readdir(worktreesDir, { withFileTypes: true });
  for (const runEntry of runEntries) {
    if (!runEntry.isDirectory()) continue;
    const runPath = join(worktreesDir, runEntry.name);
    const nodeEntries = await readdir(runPath, { withFileTypes: true });
    for (const nodeEntry of nodeEntries) {
      if (nodeEntry.isDirectory()) {
        result.push(join(runPath, nodeEntry.name));
      }
    }
  }
  return { worktrees: result };
}

async function handleRunQualityGatePrint(): Promise<{ text: string }> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  const results = await runQualityGate(PROJECT_ROOT, config);
  const { printQualityGateResults } = await import("./quality-gate.js");
  return { text: printQualityGateResults(results, true) };
}

async function handleSaveCheckpoint(args: { runId: string; label: string; metadata?: Record<string, unknown> }): Promise<{ checkpointId: string; path: string }> {
  return saveCheckpoint(args.runId, args.label, args.metadata);
}

async function handleListCheckpoints(args: { runId?: string }): Promise<{ checkpoints: Array<{ checkpointId: string; runId: string; label: string; createdAt: string }> }> {
  const checkpoints = await listCheckpoints(args.runId);
  return { checkpoints };
}

async function handleRestoreCheckpoint(args: { checkpointId: string; runId: string }): Promise<{ success: boolean; restoredFiles: string[]; message: string }> {
  return restoreCheckpoint(args.checkpointId, args.runId);
}

// ─── Tool handlers (Session / TODO) ─────────────────────────────────────

async function handleListSessions(args: { status?: string }): Promise<{ sessions: SessionMeta[] }> {
  const status = args.status;
  if (!status || status === "active") {
    const sessions = await listActiveSessions();
    return { sessions };
  }

  const runsDir = join(OMK_DIR, "runs");
  if (!(await pathExists(runsDir))) return { sessions: [] };

  const entries = await readdir(runsDir, { withFileTypes: true });
  const sessions: SessionMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readSessionMeta(entry.name).catch(() => null);
    if (meta && meta.status === status) {
      sessions.push(meta);
    }
  }

  return { sessions: sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
}

async function handleReadTodos(args: { runId: string }): Promise<{ todos: TodoItem[]; source: "todos.json" | "state.json" | null }> {
  const { readTodos, deriveTodosFromState } = await import("../util/todo-sync.js");
  const fromFile = await readTodos(args.runId);
  if (fromFile && fromFile.length > 0) {
    return { todos: fromFile, source: "todos.json" };
  }
  const fromState = await deriveTodosFromState(args.runId);
  if (fromState && fromState.length > 0) {
    return { todos: fromState, source: "state.json" };
  }
  return { todos: [], source: null };
}

async function handleWriteTodos(args: { runId: string; todos: TodoItem[] }): Promise<{ written: number }> {
  await writeTodos(args.runId, args.todos);
  return { written: args.todos.length };
}

// ─── Resource registry ──────────────────────────────────────────────────

const RESOURCES: Resource[] = [
  {
    uri: "omk://goal/{goalId}",
    name: "GoalSpec",
    description: "Structured goal specification JSON by goal ID",
    mimeType: "application/json",
  },
  {
    uri: "omk://run/{runId}",
    name: "RunState",
    description: "Run state JSON by run ID",
    mimeType: "application/json",
  },
  {
    uri: "omk://ontology/project",
    name: "ProjectOntology",
    description: "Project ontology graph summary from the memory backend",
    mimeType: "application/json",
  },
];

// ─── Prompt registry ────────────────────────────────────────────────────

const PROMPTS: Prompt[] = [
  {
    name: "goal-intake",
    description: "Prompt template for normalizing a raw goal into GoalSpec",
    arguments: [{ name: "rawGoal", description: "The raw user goal text", required: false }],
  },
  {
    name: "evidence-review",
    description: "Prompt template for reviewing evidence against criteria",
    arguments: [{ name: "goalId", description: "Goal ID to review", required: false }],
  },
  {
    name: "quality-gate",
    description: "Prompt template for running lint/test/build/audit",
    arguments: [{ name: "scope", description: "Scope of gates to run (default: all)", required: false }],
  },
];

// ─── Tool registry ──────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  // ── Goal lifecycle ──
  {
    name: "omk_goal_create",
    description: "Create a GoalSpec from a raw prompt. Infers title, objective, criteria, and risk level.",
    inputSchema: {
      type: "object",
      properties: {
        rawPrompt: { type: "string", description: "Raw user goal text" },
        title: { type: "string", description: "Optional explicit title" },
        objective: { type: "string", description: "Optional explicit objective" },
        successCriteria: {
          type: "array",
          description: "Optional explicit success criteria",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              requirement: { type: "string", enum: ["required", "optional"] },
              weight: { type: "number" },
            },
            required: ["id", "description", "requirement", "weight"],
          },
        },
        constraints: { type: "array", description: "Optional constraint descriptions", items: { type: "string" } },
        nonGoals: { type: "array", description: "Explicit out-of-scope items", items: { type: "string" } },
        expectedArtifacts: {
          type: "array",
          description: "Expected deliverables",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              path: { type: "string" },
            },
            required: ["name"],
          },
        },
        riskLevel: { type: "string", enum: ["low", "medium", "high"], description: "Optional risk override" },
      },
      required: ["rawPrompt"],
    },
  },
  {
    name: "omk_goal_show",
    description: "Read a GoalSpec by ID",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "omk_goal_list",
    description: "List all goal IDs",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_goal_verify",
    description: "Verify goal evidence and compute a pass/fail score",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        runId: { type: "string", description: "Optional run ID to pull node-level evidence from" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "omk_goal_close",
    description: "Close a goal by ID",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
      },
      required: ["goalId"],
    },
  },
  // ── Evidence ──
  {
    name: "omk_evidence_add",
    description: "Add evidence to a success criterion",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        criterionId: { type: "string", description: "Criterion identifier" },
        passed: { type: "boolean", description: "Whether the criterion is satisfied" },
        message: { type: "string", description: "Human-readable evidence summary" },
        ref: { type: "string", description: "Reference (URL, commit, file path)" },
      },
      required: ["goalId", "criterionId", "passed"],
    },
  },
  {
    name: "omk_evidence_check",
    description: "Check evidence gates for a goal (artifact gates + criterion stubs)",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        runId: { type: "string", description: "Optional run ID to pull node-level evidence from" },
      },
      required: ["goalId"],
    },
  },
  // ── Run ──
  {
    name: "omk_run_state",
    description: "Get run state by ID",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run identifier" },
      },
      required: ["runId"],
    },
  },
  // ── Quality gate ──
  {
    name: "omk_quality_gate",
    description: "Run quality gates: lint, typecheck, test, and build",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Memory ──
  {
    name: "omk_memory_read",
    description: "Read project memory/ontology from the graph or filesystem mirror",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path under .omk/memory/" },
      },
      required: ["path"],
    },
  },
  {
    name: "omk_memory_write",
    description: "Write to project memory with validation (non-empty, JSON-checked)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path under .omk/memory/" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  // ── Graph ──
  {
    name: "omk_graph_query",
    description:
      "Run read-only queries over the graph memory backend. local_graph supports GraphQL-lite (ontology, memory, memories, mindmap, nodes). kuzu supports read-only Cypher queries.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'GraphQL-lite example: query { mindmap(query: "decision", limit: 20) { root nodes edges } }. Cypher example: MATCH (n:OmkTask {projectId: $projectId}) RETURN n LIMIT 10',
        },
      },
      required: ["query"],
    },
  },
  // ── Memory search / status / ontology / mindmap ──
  {
    name: "omk_search_memory",
    description: "Search the configured local graph or Kuzu memory backend for nodes matching query",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        limit: { type: "number", description: "Max results (1-50, default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "omk_memory_status",
    description: "Return current memory backend status, connection health, node counts, and last sync timestamp",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_memory_ontology",
    description: "Return the ontology schema for the requested node type, or all node types if not specified",
    inputSchema: {
      type: "object",
      properties: {
        nodeType: { type: "string", description: "Optional node type to filter schema" },
      },
    },
  },
  {
    name: "omk_memory_mindmap",
    description: "Return a mindmap-style subgraph centered on the query term, or project-level root graph if no query",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional center query term" },
        depth: { type: "number", description: "Optional exploration depth (maps to result limit)" },
      },
    },
  },
  // ── Goal next action ──
  {
    name: "omk_goal_next",
    description: "Get the next recommended action for a goal. Uses the latest active goal if goalId is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Optional goal identifier" },
      },
    },
  },
  // ── Context compression with ontology grounding ──
  {
    name: "omk_compress_context",
    description:
      "Prepare a hallucination-resistant context briefing by pulling the ontology, mindmap, and recent ensemble decisions before calling ctx_compress. Returns a grounded summary that should be prepended to the ctx_compress call.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic or goal to center the briefing on" },
        limit: { type: "number", description: "Max nodes to fetch (default 20)" },
      },
      required: ["query"],
    },
  },
  // ── Session / TODO ──
  {
    name: "omk_list_sessions",
    description: "List active or recent chat sessions with metadata",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional filter by status (active, completed, failed, idle)" },
      },
    },
  },
  {
    name: "omk_read_todos",
    description: "Read TODO items for a run",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run identifier" },
      },
      required: ["runId"],
    },
  },
  {
    name: "omk_write_todos",
    description: "Write or update TODO items for a run",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run identifier" },
        todos: {
          type: "array",
          description: "TODO items to write",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string" },
              agent: { type: "string" },
              role: { type: "string" },
              startedAt: { type: "string" },
              completedAt: { type: "string" },
              elapsedMs: { type: "number" },
              evidence: { type: "string" },
              description: { type: "string" },
            },
            required: ["title", "status"],
          },
        },
      },
      required: ["runId", "todos"],
    },
  },
];

async function handleToolCall(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    // Goal lifecycle
    case "omk_goal_create":
      return handleGoalCreate(args as { rawPrompt: string; title?: string; objective?: string; successCriteria?: Array<{ id: string; description: string; requirement: "required" | "optional"; weight: number }>; constraints?: string[]; nonGoals?: string[]; expectedArtifacts?: Array<{ name: string; path?: string }>; riskLevel?: "low" | "medium" | "high" });
    case "omk_goal_show":
      return handleGoalShow(args as { goalId: string });
    case "omk_goal_list":
      return handleGoalList();
    case "omk_goal_verify":
      return handleGoalVerify(args as { goalId: string; runId?: string });
    case "omk_goal_close":
      return handleGoalClose(args as { goalId: string });
    // Evidence
    case "omk_evidence_add":
      return handleEvidenceAdd(args as { goalId: string; criterionId: string; passed: boolean; message?: string; ref?: string });
    case "omk_evidence_check":
      return handleEvidenceCheck(args as { goalId: string; runId?: string });
    // Run
    case "omk_run_state":
      return handleRunState(args as { runId: string });
    // Quality gate
    case "omk_quality_gate":
      return handleQualityGate();
    // Memory
    case "omk_memory_read":
      return handleMemoryRead(args as { path: string });
    case "omk_memory_write":
      return handleMemoryWrite(args as { path: string; content: string });
    // Graph
    case "omk_graph_query":
      return handleGraphQuery(args as { query: string });
    // Memory search / status / ontology / mindmap
    case "omk_search_memory":
      return handleSearchMemory(args as { query: string; limit?: number });
    case "omk_memory_status":
      return handleMemoryStatus();
    case "omk_memory_ontology":
      return handleMemoryOntology(args as { nodeType?: string });
    case "omk_memory_mindmap":
      return handleMemoryMindmap(args as { query?: string; depth?: number });
    // Goal next action
    case "omk_goal_next":
      return handleGoalNext(args as { goalId?: string });
    // Context compression with ontology grounding
    case "omk_compress_context":
      return handleCompressContext(args as { query: string; limit?: number });
    // Session / TODO
    case "omk_list_sessions":
      return handleListSessions(args as { status?: string });
    case "omk_read_todos":
      return handleReadTodos(args as { runId: string });
    case "omk_write_todos":
      return handleWriteTodos(args as { runId: string; todos: TodoItem[] });
    // Legacy aliases (still callable for backward compatibility)
    case "omk_read_memory":
      return handleMemoryRead(args as { path: string });
    case "omk_write_memory":
      return handleMemoryWrite(args as { path: string; content: string });
    case "omk_read_config":
      return handleReadConfig();
    case "omk_write_config":
      return handleWriteConfig(args as { content: string });
    case "omk_list_agents":
      return handleListAgents();
    case "omk_read_agent":
      return handleReadAgent(args as { name: string });
    case "omk_list_runs":
      return handleListRuns();
    case "omk_read_run":
      return handleReadRun(args as { runId: string });
    case "omk_get_project_info":
      return handleGetProjectInfo();
    case "omk_get_quality_settings":
      return handleGetQualitySettings();
    case "omk_get_approval_policy":
      return handleGetApprovalPolicy();
    case "omk_list_worktrees":
      return handleListWorktrees();
    case "omk_run_quality_gate":
      return handleQualityGate();
    case "omk_run_quality_gate_print":
      return handleRunQualityGatePrint();
    case "omk_save_checkpoint":
      return handleSaveCheckpoint(args as { runId: string; label: string; metadata?: Record<string, unknown> });
    case "omk_list_checkpoints":
      return handleListCheckpoints(args as { runId?: string });
    case "omk_restore_checkpoint":
      return handleRestoreCheckpoint(args as { checkpointId: string; runId: string });
    case "omk_save_snippet":
      return saveSnippet((args as { name: string; content: string; tags?: string[] }).name, (args as { name: string; content: string; tags?: string[] }).content, (args as { name: string; content: string; tags?: string[] }).tags);
    case "omk_search_snippets":
      return searchSnippets((args as { query?: string; limit?: number }).query ?? "", (args as { query?: string; limit?: number }).limit);
    case "omk_get_snippet":
      return getSnippet((args as { name: string }).name);
    case "omk_delete_snippet":
      return deleteSnippet((args as { name: string }).name);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Server loop ────────────────────────────────────────────────────────

function sendResponse(res: JsonRpcResponse): void {
  const data = JSON.stringify(res) + "\n";
  try {
    writeSync(process.stdout.fd ?? 1, data);
  } catch {
    process.stdout.write(data);
  }
}

function sendError(id: string | number, code: number, message: string, data?: unknown): void {
  sendResponse({ jsonrpc: "2.0", id, error: { code, message, data } });
}

function sendResult(id: string | number, result: unknown): void {
  sendResponse({ jsonrpc: "2.0", id, result });
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  switch (req.method) {
    case "initialize": {
      sendResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      return;
    }

    case "notifications/initialized":
      // No response needed for notifications
      return;

    case "resources/list": {
      sendResult(req.id, { resources: RESOURCES });
      return;
    }

    case "resources/read": {
      const resourceParams = req.params as { uri?: string } | undefined;
      const uri = resourceParams?.uri;
      if (!uri || typeof uri !== "string") {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Invalid params: missing 'uri'");
        return;
      }
      try {
        let result: { content: string };
        if (uri.startsWith("omk://goal/")) {
          const goalId = uri.slice("omk://goal/".length);
          result = await handleReadGoalResource(goalId);
        } else if (uri.startsWith("omk://run/")) {
          const runId = uri.slice("omk://run/".length);
          result = await handleReadRunResource(runId);
        } else if (uri === "omk://ontology/project") {
          result = await handleReadOntologyResource();
        } else {
          sendError(req.id, JSON_RPC_INVALID_PARAMS, `Resource not found: ${uri}`);
          return;
        }
        sendResult(req.id, {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: result.content,
            },
          ],
        });
      } catch (err) {
        const data = buildErrorData(req, err, { uri });
        writeDiagnostic("resource_read_failed", data);
        sendError(req.id, JSON_RPC_OMK_SERVER_ERROR, `OMK MCP resource read failed: ${errorMessage(err)}`, data);
      }
      return;
    }

    case "prompts/list": {
      sendResult(req.id, { prompts: PROMPTS });
      return;
    }

    case "prompts/get": {
      const promptParams = req.params as { name?: string; arguments?: Record<string, string> } | undefined;
      const promptName = promptParams?.name;
      const promptArgs = promptParams?.arguments ?? {};
      if (!promptName || typeof promptName !== "string") {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Invalid params: missing 'name'");
        return;
      }
      try {
        let result: { description: string; messages: Array<{ role: string; content: { type: string; text: string } }> };
        switch (promptName) {
          case "goal-intake":
            result = handleGetGoalIntakePrompt(promptArgs);
            break;
          case "evidence-review":
            result = handleGetEvidenceReviewPrompt(promptArgs);
            break;
          case "quality-gate":
            result = handleGetQualityGatePrompt(promptArgs);
            break;
          default:
            sendError(req.id, JSON_RPC_INVALID_PARAMS, `Prompt not found: ${promptName}`);
            return;
        }
        sendResult(req.id, result);
      } catch (err) {
        const data = buildErrorData(req, err, { promptName });
        writeDiagnostic("prompt_get_failed", data);
        sendError(req.id, JSON_RPC_OMK_SERVER_ERROR, `OMK MCP prompt get failed: ${errorMessage(err)}`, data);
      }
      return;
    }

    case "tools/list": {
      sendResult(req.id, { tools: TOOLS });
      return;
    }

    case "tools/call": {
      const params = req.params as { name?: string; arguments?: unknown } | undefined;
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      if (!toolName || typeof toolName !== "string") {
        sendError(req.id, JSON_RPC_INVALID_PARAMS, "Invalid params: missing 'name'");
        return;
      }
      try {
        const result = await handleToolCall(toolName, toolArgs);
        sendResult(req.id, toolResultFromValue(result));
      } catch (err) {
        writeDiagnostic("tool_call_failed", buildErrorData(req, err, { toolName }));
        sendResult(req.id, toolErrorResult(toolName, err));
      }
      return;
    }

    default: {
      sendError(req.id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`);
      return;
    }
  }
}

async function main(): Promise<void> {
  // Ensure synchronous stdout in piped environments (MCP stdio)
  try {
    // @ts-expect-error Node internal API not in types
    process.stdout._handle?.setBlocking?.(true);
  } catch {
    // ignore if unavailable
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpcRequest | undefined;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      // Not valid JSON — can't reply without an id, so ignore
      continue;
    }
    if (req.jsonrpc !== "2.0") continue;
    try {
      await handleRequest(req);
    } catch (err) {
      const data = buildErrorData(req, err);
      writeDiagnostic("request_failed", data);
      sendError(req.id, JSON_RPC_OMK_SERVER_ERROR, `OMK MCP request failed while handling ${req.method}: ${errorMessage(err)}`, data);
    }
  }

  // Gracefully flush remaining stdout before the process exits
  try {
    process.stdout.end?.();
  } catch {
    // ignore
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  // Do NOT process.exit(1) — MCP clients treat hard exits as failures.
  // The error has already been logged to stderr; let the event loop drain.
});
