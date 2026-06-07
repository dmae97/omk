import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import { getRunPath, pathExists, ensureDir, validateRunId } from "./fs.js";

export type TodoStatus = "pending" | "in_progress" | "done" | "failed" | "blocked" | "skipped";
export type TodoWriteOperationName = "init" | "start" | "done" | "drop" | "rm" | "append" | "note";

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
  activeForm?: string;
  phase?: string;
  order?: number;
  notes?: string[];
}

export type TodoWriteStatus = "pending" | "in_progress" | "completed";

export interface TodoWriteItem {
  content: string;
  status: TodoWriteStatus;
  activeForm?: string;
}

export interface TodoWriteInput {
  todos: TodoWriteItem[];
}

export interface TodoWritePhaseInput {
  phase: string;
  items: string[];
}

export interface TodoWriteOperation {
  op: TodoWriteOperationName;
  list?: TodoWritePhaseInput[];
  task?: string;
  phase?: string;
  items?: string[];
  text?: string;
}

export interface TodoWriteOpsInput {
  ops: TodoWriteOperation[];
}

export interface TodoWriteOpsResult {
  todos: TodoItem[];
  applied: number;
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

export function normalizeTodoItems(value: unknown): TodoItem[] {
  const todos = parseTodoArray(value);
  if (!todos) {
    throw new Error("Invalid todos: expected an array of todo items");
  }
  return todos;
}

export function normalizeTodoWriteInput(input: unknown): TodoItem[] {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid TodoWrite input: expected object with todos array");
  }
  const todos = (input as Record<string, unknown>).todos;
  return normalizeTodoItems(todos);
}

export function applyTodoWriteOperations(
  existingTodos: readonly TodoItem[],
  operations: readonly TodoWriteOperation[],
  now: () => string = () => new Date().toISOString()
): TodoWriteOpsResult {
  if (!Array.isArray(operations)) {
    throw new Error("Invalid todo_write input: ops must be an array");
  }

  let todos = existingTodos.map((todo, index) => normalizeExistingTodo(todo, index));
  let applied = 0;

  for (const operation of operations) {
    applyTodoWriteOperation(operation, todos, now);
    applied += 1;
  }

  promoteNextTodo(todos, now);
  todos = sortTodos(todos);
  return { todos, applied };
}

function normalizeExistingTodo(todo: TodoItem, index: number): TodoItem {
  return {
    ...todo,
    status: normalizeTodoStatus(todo.status),
    phase: todo.phase ?? "General",
    order: typeof todo.order === "number" ? todo.order : index,
    notes: Array.isArray(todo.notes) ? todo.notes.map(String) : undefined,
  };
}

function applyTodoWriteOperation(operation: TodoWriteOperation, todos: TodoItem[], now: () => string): void {
  switch (operation.op) {
    case "init":
      replaceTodosFromPhaseList(todos, requirePhaseList(operation), now);
      return;
    case "append":
      appendTodos(todos, requirePhase(operation), requireItems(operation));
      return;
    case "start":
      markTask(todos, requireTask(operation), "in_progress", now);
      return;
    case "done":
      markDone(todos, operation, now);
      return;
    case "drop":
      markDropped(todos, operation, now);
      return;
    case "rm":
      removeTodos(todos, operation);
      return;
    case "note":
      appendTodoNote(todos, requireTask(operation), requireText(operation));
      return;
    default:
      throw new Error(`Unsupported todo_write op: ${(operation as { op?: unknown }).op}`);
  }
}

function replaceTodosFromPhaseList(todos: TodoItem[], list: readonly TodoWritePhaseInput[], now: () => string): void {
  todos.splice(0, todos.length);
  let order = 0;
  for (const group of list) {
    const phase = cleanNonEmpty(group.phase, "phase");
    const items = normalizeItems(group.items);
    for (const item of items) {
      todos.push({
        title: item,
        status: "pending",
        phase,
        order: order++,
      });
    }
  }
  promoteNextTodo(todos, now);
}

function appendTodos(todos: TodoItem[], phase: string, items: readonly string[]): void {
  const cleanItems = normalizeItems(items);
  const nextOrder = todos.reduce((max, todo) => Math.max(max, todo.order ?? 0), -1) + 1;
  cleanItems.forEach((title, index) => {
    todos.push({
      title,
      status: "pending",
      phase,
      order: nextOrder + index,
    });
  });
}

function markTask(todos: TodoItem[], title: string, status: TodoStatus, now: () => string): void {
  const target = findTodoByTitle(todos, title);
  if (status === "in_progress") {
    for (const todo of todos) {
      if (todo.status === "in_progress" && todo.title !== target.title) {
        todo.status = "pending";
      }
    }
    target.startedAt ??= now();
    target.completedAt = undefined;
    target.elapsedMs = undefined;
  }
  if (status === "done" || status === "failed" || status === "skipped") {
    completeTodo(target, status, now);
    return;
  }
  target.status = status;
}

function markDone(todos: TodoItem[], operation: TodoWriteOperation, now: () => string): void {
  if (operation.phase) {
    const phase = cleanNonEmpty(operation.phase, "phase");
    const phaseTodos = todos.filter((todo) => todo.phase === phase);
    if (phaseTodos.length === 0) throw new Error(`Todo phase not found: ${phase}`);
    for (const todo of phaseTodos) {
      if (!isTerminalTodo(todo)) completeTodo(todo, "done", now);
    }
    promoteNextTodo(todos, now);
    return;
  }
  markTask(todos, requireTask(operation), "done", now);
  promoteNextTodo(todos, now);
}

function markDropped(todos: TodoItem[], operation: TodoWriteOperation, now: () => string): void {
  if (operation.phase) {
    const phase = cleanNonEmpty(operation.phase, "phase");
    const phaseTodos = todos.filter((todo) => todo.phase === phase);
    if (phaseTodos.length === 0) throw new Error(`Todo phase not found: ${phase}`);
    for (const todo of phaseTodos) {
      if (!isTerminalTodo(todo)) completeTodo(todo, "skipped", now);
    }
    promoteNextTodo(todos, now);
    return;
  }
  markTask(todos, requireTask(operation), "skipped", now);
  promoteNextTodo(todos, now);
}

function removeTodos(todos: TodoItem[], operation: TodoWriteOperation): void {
  if (!operation.task && !operation.phase) {
    todos.splice(0, todos.length);
    return;
  }

  if (operation.phase) {
    const phase = cleanNonEmpty(operation.phase, "phase");
    const before = todos.length;
    for (let index = todos.length - 1; index >= 0; index -= 1) {
      if (todos[index]?.phase === phase) todos.splice(index, 1);
    }
    if (todos.length === before) throw new Error(`Todo phase not found: ${phase}`);
    return;
  }

  const title = requireTask(operation);
  const index = todos.findIndex((todo) => todo.title === title);
  if (index === -1) throw new Error(`Todo not found: ${title}`);
  todos.splice(index, 1);
}

function appendTodoNote(todos: TodoItem[], title: string, text: string): void {
  const target = findTodoByTitle(todos, title);
  target.notes = [...(target.notes ?? []), text];
  target.description = target.description ? `${target.description}\n${text}` : text;
}

function promoteNextTodo(todos: TodoItem[], now: () => string): void {
  if (todos.some((todo) => todo.status === "in_progress")) return;
  const next = sortTodos(todos).find((todo) => todo.status === "pending");
  if (!next) return;
  next.status = "in_progress";
  next.startedAt ??= now();
}

function completeTodo(todo: TodoItem, status: "done" | "failed" | "skipped", now: () => string): void {
  todo.status = status;
  todo.completedAt = now();
  if (todo.startedAt) {
    const start = Date.parse(todo.startedAt);
    const end = Date.parse(todo.completedAt);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      todo.elapsedMs = Math.max(0, end - start);
    }
  }
}

function isTerminalTodo(todo: TodoItem): boolean {
  return todo.status === "done" || todo.status === "failed" || todo.status === "skipped";
}

function sortTodos(todos: readonly TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function findTodoByTitle(todos: readonly TodoItem[], title: string): TodoItem {
  const target = todos.find((todo) => todo.title === title);
  if (!target) throw new Error(`Todo not found: ${title}`);
  return target;
}

function requirePhaseList(operation: TodoWriteOperation): TodoWritePhaseInput[] {
  if (!Array.isArray(operation.list)) {
    throw new Error("todo_write init requires list");
  }
  return operation.list;
}

function requirePhase(operation: TodoWriteOperation): string {
  return cleanNonEmpty(operation.phase, "phase");
}

function requireTask(operation: TodoWriteOperation): string {
  return cleanNonEmpty(operation.task, "task");
}

function requireText(operation: TodoWriteOperation): string {
  return cleanNonEmpty(operation.text, "text");
}

function requireItems(operation: TodoWriteOperation): string[] {
  return normalizeItems(operation.items);
}

function normalizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) {
    throw new Error("todo_write items must be an array");
  }
  const normalized = items.map((item) => cleanNonEmpty(String(item), "item"));
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw new Error("todo_write items must be unique");
  }
  return normalized;
}

function cleanNonEmpty(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`todo_write ${label} is required`);
  return text;
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

  // Strategy 1: look for TodoWrite/SetTodoList tool calls with arguments JSON.
  const toolCallPattern = /name\s*=\s*['"](?:TodoWrite|todo_write|SetTodoList)['"]\s*,\s*arguments\s*=\s*['"](\{[\s\S]*?\})['"]/g;
  const toolCallPatternAlt = /name\s*=\s*['"](?:TodoWrite|todo_write|SetTodoList)['"]\s*[;,]?\s*arguments\s*[:=]\s*['"](\{[\s\S]*?\})['"]/g;

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

  // Strategy 2: look for XML-ish tool markers with JSON arguments nearby.
  const xmlPattern = /<tool>\s*(?:TodoWrite|todo_write|set_todo_list)\s*<\/tool>[\s\S]*?(\{[\s\S]*?\})/g;
  let xmlMatch: RegExpExecArray | null;
  while ((xmlMatch = xmlPattern.exec(output)) !== null) {
    const result = tryParseTodosJson(xmlMatch[1]);
    if (result && result.length > 0) return result;
  }

  // Strategy 3: look for any JSON object with a "todos" array near a TodoWrite/SetTodoList mention.
  const toolMention = output.match(/TodoWrite|todo_write|SetTodoList|set_todo_list/);
  if (toolMention?.index !== undefined) {
    const nearby = output.slice(Math.max(0, toolMention.index - 200), toolMention.index + 2000);
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
      const activeForm = item.activeForm ? String(item.activeForm) : undefined;
      const status = normalizeTodoStatus(String(item.status ?? item.state ?? "pending"));
      return {
        title: String(item.title ?? item.content ?? item.label ?? item.name ?? item.id ?? "Untitled"),
        status,
        agent: item.agent ? String(item.agent) : undefined,
        role: item.role ? String(item.role) : undefined,
        startedAt,
        completedAt,
        elapsedMs,
        evidence: item.evidence ? String(item.evidence) : undefined,
        description: item.description ? String(item.description) : undefined,
        activeForm,
        phase: item.phase ? String(item.phase) : undefined,
        order: typeof item.order === "number" ? item.order : undefined,
        notes: Array.isArray(item.notes) ? item.notes.map(String) : undefined,
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
  if (fromFile !== null) return fromFile;
  return deriveTodosFromState(runId);
}
