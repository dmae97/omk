import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdir, rm, writeFile, readFile, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const {
  createOmkSessionId,
  createOmkSessionEnv,
  ensureSessionDir,
  writeSessionMeta,
  readSessionMeta,
  listActiveSessions,
} = await import("../dist/util/session.js");

const {
  writeTodos,
  readTodos,
  updateTodoStatus,
  deriveTodosFromState,
  parseSetTodoListFromOutput,
  normalizeTodoWriteInput,
  applyTodoWriteOperations,
  loadTodos,
} = await import("../dist/util/todo-sync.js");

describe("session and todo-sync utilities", () => {
  let projectRoot;
  let previousRoot;

  before(async () => {
    previousRoot = process.env.OMK_PROJECT_ROOT;
    projectRoot = await mkdtemp(join(tmpdir(), "omk-session-todo-"));
    process.env.OMK_PROJECT_ROOT = projectRoot;
  });

  after(async () => {
    if (previousRoot === undefined) {
      delete process.env.OMK_PROJECT_ROOT;
    } else {
      process.env.OMK_PROJECT_ROOT = previousRoot;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("createOmkSessionId generates IDs with correct prefix and format", () => {
    const id = createOmkSessionId();
    assert.ok(id.startsWith("session-"), "default prefix should be session");
    assert.ok(id.includes(String(process.pid)), "should include process pid");

    const chatId = createOmkSessionId("chat");
    assert.ok(chatId.startsWith("chat-"), "custom prefix should be chat");

    const planId = createOmkSessionId("plan");
    assert.ok(planId.startsWith("plan-"));
    assert.ok(!planId.slice(5).includes(":"), "timestamp should not contain colons");
    assert.ok(!planId.slice(5).includes("."), "timestamp should not contain dots");
  });

  it("createOmkSessionEnv returns correct env variables", () => {
    const env = createOmkSessionEnv("/some/project", "run-123");
    assert.strictEqual(env.OMK_PROJECT_ROOT, "/some/project");
    assert.strictEqual(env.OMK_SESSION_ID, "run-123");
  });

  it("ensureSessionDir creates .omk/runs/<runId>/ directory", async () => {
    const runId = "test-ensure-dir";
    const dir = await ensureSessionDir(runId);
    const expected = join(projectRoot, ".omk", "runs", runId);
    assert.strictEqual(dir, expected);

    await writeFile(join(dir, "check.txt"), "ok");
    const content = await readFile(join(dir, "check.txt"), "utf-8");
    assert.strictEqual(content, "ok");
  });

  it("writeSessionMeta + readSessionMeta roundtrip", async () => {
    const runId = "test-roundtrip";
    const meta = {
      runId,
      type: "chat",
      status: "active",
      startedAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      todoCount: 3,
      todoDoneCount: 1,
    };
    await writeSessionMeta(runId, meta);
    const read = await readSessionMeta(runId);
    assert.ok(read);
    assert.strictEqual(read.runId, runId);
    assert.strictEqual(read.type, meta.type);
    assert.strictEqual(read.status, meta.status);
    assert.strictEqual(read.startedAt, meta.startedAt);
    assert.strictEqual(read.todoCount, meta.todoCount);
    assert.strictEqual(read.todoDoneCount, meta.todoDoneCount);
    assert.notStrictEqual(read.updatedAt, meta.updatedAt, "updatedAt should be overwritten");
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(read.updatedAt), "updatedAt should be an ISO string");
  });

  it("readSessionMeta returns null for non-existent run", async () => {
    const result = await readSessionMeta("test-nonexistent-99999");
    assert.strictEqual(result, null);
  });

  it("listActiveSessions filters only active sessions and sorts by startedAt desc", async () => {
    const runsDir = join(projectRoot, ".omk", "runs");
    await rm(runsDir, { recursive: true, force: true });

    const fixtures = [
      { id: "run-active-older", status: "active", startedAt: "2024-01-01T10:00:00.000Z" },
      { id: "run-active-newer", status: "active", startedAt: "2024-01-02T10:00:00.000Z" },
      { id: "run-completed", status: "completed", startedAt: "2024-01-03T10:00:00.000Z" },
      { id: "run-failed", status: "failed", startedAt: "2024-01-04T10:00:00.000Z" },
    ];

    for (const f of fixtures) {
      const dir = join(runsDir, f.id);
      await mkdir(dir, { recursive: true });
      const meta = {
        runId: f.id,
        type: "run",
        status: f.status,
        startedAt: f.startedAt,
        updatedAt: f.startedAt,
        todoCount: 0,
        todoDoneCount: 0,
      };
      await writeFile(join(dir, "session.json"), JSON.stringify(meta, null, 2));
    }

    const active = await listActiveSessions();
    const ids = active.map((s) => s.runId);
    assert.strictEqual(active.length, 2);
    assert.deepStrictEqual(ids, ["run-active-newer", "run-active-older"]);
  });

  it("writeTodos + readTodos roundtrip", async () => {
    const runId = "test-todo-roundtrip";
    const todos = [
      { title: "Task A", status: "pending" },
      { title: "Task B", status: "in_progress", agent: "coder-1" },
    ];
    await writeTodos(runId, todos);
    const read = await readTodos(runId);
    assert.ok(read);
    assert.strictEqual(read.length, 2);
    assert.strictEqual(read[0].title, "Task A");
    assert.strictEqual(read[0].status, "pending");
    assert.strictEqual(read[1].title, "Task B");
    assert.strictEqual(read[1].status, "in_progress");
    assert.strictEqual(read[1].agent, "coder-1");
  });

  it("readTodos normalizes status values", async () => {
    const runId = "test-todo-normalize";
    await writeTodos(runId, [
      { title: "T1", status: "running" },
      { title: "T2", status: "completed" },
      { title: "T3", status: "FAILED" },
      { title: "T4", status: "unknown" },
    ]);
    const read = await readTodos(runId);
    assert.ok(read);
    assert.strictEqual(read[0].status, "in_progress");
    assert.strictEqual(read[1].status, "done");
    assert.strictEqual(read[2].status, "failed");
    assert.strictEqual(read[3].status, "pending");
  });

  it("updateTodoStatus updates status and sets completedAt for terminal states", async () => {
    const runId = "test-update-status";
    const startTime = new Date(Date.now() - 1000).toISOString();
    await writeTodos(runId, [
      { title: "Task X", status: "in_progress", startedAt: startTime },
      { title: "Task Y", status: "pending" },
    ]);

    await updateTodoStatus(runId, "Task X", "done");
    let read = await readTodos(runId);
    const taskX = read.find((t) => t.title === "Task X");
    assert.strictEqual(taskX.status, "done");
    assert.ok(typeof taskX.completedAt === "string");
    assert.ok(typeof taskX.elapsedMs === "number");
    assert.ok(taskX.elapsedMs >= 0);

    await updateTodoStatus(runId, "Task Y", "failed");
    read = await readTodos(runId);
    const taskY = read.find((t) => t.title === "Task Y");
    assert.strictEqual(taskY.status, "failed");
    assert.ok(typeof taskY.completedAt === "string");
    assert.strictEqual(taskY.elapsedMs, undefined);

    // skipped is also a terminal state
    await writeTodos(runId, [{ title: "Task Z", status: "pending" }]);
    await updateTodoStatus(runId, "Task Z", "skipped");
    read = await readTodos(runId);
    const taskZ = read.find((t) => t.title === "Task Z");
    assert.strictEqual(taskZ.status, "skipped");
    assert.ok(typeof taskZ.completedAt === "string");

    // in_progress sets startedAt if missing
    await writeTodos(runId, [{ title: "Task W", status: "pending" }]);
    await updateTodoStatus(runId, "Task W", "in_progress");
    read = await readTodos(runId);
    const taskW = read.find((t) => t.title === "Task W");
    assert.strictEqual(taskW.status, "in_progress");
    assert.ok(typeof taskW.startedAt === "string");
  });

  it("parseSetTodoListFromOutput extracts todos from various stdout formats", () => {
    // Format 1: name='SetTodoList', arguments='...'
    const fmt1 = `name='SetTodoList', arguments='{"todos":[{"title":"Fix bug","status":"in_progress"}]}'`;
    let result = parseSetTodoListFromOutput(fmt1);
    assert.ok(result);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "Fix bug");
    assert.strictEqual(result[0].status, "in_progress");

    // Format 2: <tool>set_todo_list</tool> followed by JSON
    const fmt2 = `<tool>set_todo_list</tool>\n{"todos":[{"title":"Deploy","status":"done"}]}`;
    result = parseSetTodoListFromOutput(fmt2);
    assert.ok(result);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "Deploy");
    assert.strictEqual(result[0].status, "done");

    // Format 3: Plain JSON with "todos" array
    const fmt3 = `Some output before\n{"todos":[{"title":"Review","status":"pending"},{"title":"Audit","status":"blocked"}]}\nAfter`;
    result = parseSetTodoListFromOutput(fmt3);
    assert.ok(result);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].title, "Review");
    assert.strictEqual(result[0].status, "pending");
    assert.strictEqual(result[1].title, "Audit");
    assert.strictEqual(result[1].status, "blocked");

    assert.strictEqual(parseSetTodoListFromOutput("no todos here"), null);

    const todoWrite = `name='TodoWrite', arguments='{"todos":[{"content":"Implement schema","status":"in_progress","activeForm":"Implementing schema"},{"content":"Ship","status":"completed"}]}'`;
    result = parseSetTodoListFromOutput(todoWrite);
    assert.ok(result);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].title, "Implement schema");
    assert.strictEqual(result[0].status, "in_progress");
    assert.strictEqual(result[0].activeForm, "Implementing schema");
    assert.strictEqual(result[1].status, "done");
  });

  it("normalizeTodoWriteInput maps Claude TodoWrite items into internal TODO items", () => {
    const result = normalizeTodoWriteInput({
      todos: [
        { content: "Implement schema", status: "pending" },
        { content: "Run tests", status: "in_progress", activeForm: "Running tests" },
        { content: "Report", status: "completed" },
      ],
    });

    assert.deepStrictEqual(result.map((todo) => todo.title), ["Implement schema", "Run tests", "Report"]);
    assert.deepStrictEqual(result.map((todo) => todo.status), ["pending", "in_progress", "done"]);
    assert.strictEqual(result[1].activeForm, "Running tests");
  });

  it("applyTodoWriteOperations supports phased init, completion, append, note, and removal", () => {
    const now = () => "2026-06-06T00:00:00.000Z";
    let result = applyTodoWriteOperations([], [
      {
        op: "init",
        list: [
          { phase: "Discovery", items: ["Map surfaces", "Read docs"] },
          { phase: "Implementation", items: ["Patch code"] },
        ],
      },
    ], now);

    assert.deepStrictEqual(result.todos.map((todo) => [todo.phase, todo.title, todo.status]), [
      ["Discovery", "Map surfaces", "in_progress"],
      ["Discovery", "Read docs", "pending"],
      ["Implementation", "Patch code", "pending"],
    ]);

    result = applyTodoWriteOperations(result.todos, [
      { op: "done", task: "Map surfaces" },
      { op: "append", phase: "Implementation", items: ["Run tests"] },
      { op: "note", task: "Read docs", text: "Use Claude Agent SDK TodoWrite schema" },
      { op: "rm", task: "Patch code" },
    ], now);

    assert.deepStrictEqual(result.todos.map((todo) => [todo.phase, todo.title, todo.status]), [
      ["Discovery", "Map surfaces", "done"],
      ["Discovery", "Read docs", "in_progress"],
      ["Implementation", "Run tests", "pending"],
    ]);
    assert.deepStrictEqual(result.todos[1].notes, ["Use Claude Agent SDK TodoWrite schema"]);
  });

  it("loadTodos falls back to deriveTodosFromState when todos.json is missing", async () => {
    const runId = "test-load-fallback";
    const dir = join(projectRoot, ".omk", "runs", runId);
    await mkdir(dir, { recursive: true });
    const state = {
      nodes: [
        { id: "node-1", name: "Compile", status: "done", startedAt: "2024-01-01T00:00:00.000Z", completedAt: "2024-01-01T00:05:00.000Z" },
        { id: "node-2", name: "Test", status: "running", startedAt: "2024-01-01T00:05:00.000Z" },
        { id: "bootstrap", name: "Bootstrap", status: "done" },
      ],
    };
    await writeFile(join(dir, "state.json"), JSON.stringify(state));

    const todos = await loadTodos(runId);
    assert.ok(todos);
    assert.strictEqual(todos.length, 2);
    const titles = todos.map((t) => t.title);
    assert.ok(titles.includes("Compile"));
    assert.ok(titles.includes("Test"));
    assert.ok(!titles.includes("Bootstrap"));
  });

  it("loadTodos treats an empty todos.json as canonical no TODOs", async () => {
    const runId = "test-empty-todos-canonical";
    const dir = join(projectRoot, ".omk", "runs", runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "todos.json"), JSON.stringify([]));
    await writeFile(join(dir, "state.json"), JSON.stringify({
      nodes: [
        { id: "node-1", name: "Should stay in AGENTS", status: "running" },
      ],
    }));

    const todos = await loadTodos(runId);
    assert.deepStrictEqual(todos, []);
  });

  it("deriveTodosFromState returns null when state.json is missing", async () => {
    const result = await deriveTodosFromState("test-missing-state-99999");
    assert.strictEqual(result, null);
  });
});
