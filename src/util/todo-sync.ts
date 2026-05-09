import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import { getRunPath, pathExists, ensureDir, validateRunId } from "./fs.js";

export type TodoStatus = "pending" | "in_progress" | "done" | "failed" | "blocked" | "skipped";

export interface TodoItem {
  title: string;
  status: TodoStatus;
  agent?: string;
  role?: string;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  evidence?: string;
  description?: string;
}

const LIFECYCLE_NODE_IDS = new Set(["bootstrap", "root-coordinator", "review-merge"]);

function normalizeTodoStatus(status: string): TodoStatus {
  const s = status.toLowerCase();
  switch (s) {
    case "running":
    case "in_progress":
      return "in_progress";
    case "done":
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

export async function writeTodos(runId: string, todos: TodoItem[]): Promise<void> {
  const sanitized = validateRunId(runId);
  const dir = getRunPath(sanitized);
  await ensureDir(dir);
  const todosPath = join(dir, "todos.json");
  await writeFile(todosPath, JSON.stringify(todos, null, 2), "utf-8");
}

export async function readTodos(runId: string): Promise<TodoItem[] | null> {
  const sanitized = validateRunId(runId);
  const todosPath = join(getRunPath(sanitized), "todos.json");
  if (!(await pathExists(todosPath))) return null;
  try {
    const content = await readFile(todosPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    return parseTodoArray(parsed);
  } catch {
    return null;
  }
}

export async function updateTodoStatus(runId: string, title: string, status: TodoStatus): Promise<void> {
  const todos = await readTodos(runId);
  if (!todos) {
    throw new Error(`No todos found for runId: ${runId}`);
  }
  const target = todos.find((t) => t.title === title);
  if (!target) {
    throw new Error(`Todo not found: ${title}`);
  }
  target.status = status;
  if (status === "done" || status === "failed" || status === "skipped") {
    target.completedAt = new Date().toISOString();
    if (target.startedAt) {
      const start = Date.parse(target.startedAt);
      if (!Number.isNaN(start)) {
        target.elapsedMs = Date.now() - start;
      }
    }
  } else if (status === "in_progress" && !target.startedAt) {
    target.startedAt = new Date().toISOString();
  }
  await writeTodos(runId, todos);
}

export async function deriveTodosFromState(runId: string): Promise<TodoItem[] | null> {
  const sanitized = validateRunId(runId);
  const statePath = join(getRunPath(sanitized), "state.json");
  try {
    const content = await readFile(statePath, "utf-8");
    const state = JSON.parse(content) as unknown;
    if (!state || typeof state !== "object" || !Array.isArray((state as Record<string, unknown>).nodes)) {
      return null;
    }
    const nodes = (state as Record<string, unknown>).nodes as unknown[];
    return deriveTodoItemsFromNodes(nodes);
  } catch {
    return null;
  }
}

function deriveTodoItemsFromNodes(nodes: unknown[]): TodoItem[] {
  return nodes
    .filter((n): n is Record<string, unknown> => n !== null && typeof n === "object")
    .filter((n) => !LIFECYCLE_NODE_IDS.has(String(n.id)))
    .map((n) => {
      const status = normalizeTodoStatus(String(n.status ?? "pending"));
      const startedAt = n.startedAt ? String(n.startedAt) : undefined;
      const completedAt = n.completedAt ? String(n.completedAt) : undefined;
      let elapsedMs: number | undefined;
      if (typeof n.durationMs === "number") {
        elapsedMs = n.durationMs;
      } else if (startedAt) {
        const end = completedAt ? Date.parse(completedAt) : Date.now();
        const start = Date.parse(startedAt);
        if (!Number.isNaN(end) && !Number.isNaN(start)) {
          elapsedMs = end - start;
        }
      }
      const lastEvidence = Array.isArray(n.evidence) && n.evidence.length > 0
        ? (n.evidence[n.evidence.length - 1] as Record<string, unknown>)
        : undefined;
      return {
        title: String(n.name ?? n.id ?? "Untitled"),
        status,
        agent: n.id ? String(n.id) : undefined,
        role: n.role ? String(n.role) : undefined,
        startedAt,
        completedAt,
        elapsedMs,
        evidence: lastEvidence?.message ? String(lastEvidence.message) : undefined,
        description: n.blockedReason ? String(n.blockedReason) : undefined,
      };
    })
    .filter((item) => item.title.length > 0 && item.title !== "Untitled");
}

export function parseSetTodoListFromOutput(output: string): TodoItem[] | null {
  if (!output || typeof output !== "string") return null;

  // Strategy 1: look for name='SetTodoList' or name="SetTodoList" with arguments JSON
  const toolCallPattern = /name\s*=\s*['"]SetTodoList['"]\s*,\s*arguments\s*=\s*['"](\{[\s\S]*?\})['"]/g;
  const toolCallPatternAlt = /name\s*=\s*['"]SetTodoList['"]\s*[;,]?\s*arguments\s*[:=]\s*['"](\{[\s\S]*?\})['"]/g;

  for (const pattern of [toolCallPattern, toolCallPatternAlt]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output)) !== null) {
      const jsonStr = match[1]
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\n/g, "\n")
        .replace(/\\/g, "\\");
      const result = tryParseTodosJson(jsonStr);
      if (result && result.length > 0) return result;
    }
  }

  // Strategy 2: look for <tool>set_todo_list</tool> with JSON arguments nearby
  const xmlPattern = /<tool>\s*set_todo_list\s*<\/tool>[\s\S]*?(\{[\s\S]*?\})/g;
  let xmlMatch: RegExpExecArray | null;
  while ((xmlMatch = xmlPattern.exec(output)) !== null) {
    const result = tryParseTodosJson(xmlMatch[1]);
    if (result && result.length > 0) return result;
  }

  // Strategy 3: look for any JSON object with a "todos" array near a SetTodoList mention
  const setTodoListIndex = output.indexOf("SetTodoList");
  if (setTodoListIndex !== -1) {
    const nearby = output.slice(Math.max(0, setTodoListIndex - 200), setTodoListIndex + 2000);
    const jsonPattern = /\{[\s\S]*?"todos"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/g;
    let jsonMatch: RegExpExecArray | null;
    while ((jsonMatch = jsonPattern.exec(nearby)) !== null) {
      const result = tryParseTodosJson(jsonMatch[0]);
      if (result && result.length > 0) return result;
    }
  }

  // Strategy 4: broad search for JSON with "todos" array anywhere in output
  const broadPattern = /\{[\s\S]*?"todos"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/g;
  let broadMatch: RegExpExecArray | null;
  while ((broadMatch = broadPattern.exec(output)) !== null) {
    const result = tryParseTodosJson(broadMatch[0]);
    if (result && result.length > 0) return result;
  }

  return null;
}

function tryParseTodosJson(jsonStr: string): TodoItem[] | null {
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).todos)) {
      return parseTodoArray((parsed as Record<string, unknown>).todos);
    }
    if (Array.isArray(parsed)) {
      return parseTodoArray(parsed);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function parseTodoArray(value: unknown): TodoItem[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => {
      const status = normalizeTodoStatus(String(item.status ?? item.state ?? "pending"));
      const startedAt = item.startedAt ? String(item.startedAt) : undefined;
      const completedAt = item.completedAt ? String(item.completedAt) : undefined;
      let elapsedMs: number | undefined;
      if (typeof item.elapsedMs === "number") {
        elapsedMs = item.elapsedMs;
      } else if (startedAt) {
        const end = completedAt ? Date.parse(completedAt) : Date.now();
        const start = Date.parse(startedAt);
        if (!Number.isNaN(end) && !Number.isNaN(start)) {
          elapsedMs = end - start;
        }
      }
      return {
        title: String(item.title ?? item.label ?? item.name ?? item.id ?? "Untitled"),
        status,
        agent: item.agent ? String(item.agent) : undefined,
        role: item.role ? String(item.role) : undefined,
        startedAt,
        completedAt,
        elapsedMs,
        evidence: item.evidence ? String(item.evidence) : undefined,
        description: item.description ? String(item.description) : undefined,
      };
    })
    .filter((item) => item.title.length > 0 && item.title !== "Untitled");
}

/**
 * Load todos for a run, trying todos.json first then falling back to state.json nodes.
 * This is the canonical read path used by cockpit and HUD renderers.
 */
export async function loadTodos(runId: string | null): Promise<TodoItem[] | null> {
  if (!runId) return null;
  const fromFile = await readTodos(runId);
  if (fromFile && fromFile.length > 0) return fromFile;
  return deriveTodosFromState(runId);
}
