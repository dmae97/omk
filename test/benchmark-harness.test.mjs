import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { runBenchmarkSuite } = await import("../dist/benchmark/harness.js");
const { generateSyntheticTraces } = await import("../dist/benchmark/fixtures.js");
const { createShadowModeEngine, computeRouterRegret } = await import("../dist/benchmark/shadow-mode.js");

test("generateSyntheticTraces produces deterministic tasks", () => {
  const f1 = generateSyntheticTraces(1, 42, "0.1.0", "abc", "cfg");
  const f2 = generateSyntheticTraces(1, 42, "0.1.0", "abc", "cfg");
  assert.equal(f1.tasks.length, 10);
  assert.deepStrictEqual(f1.tasks.map((t) => t.taskId), f2.tasks.map((t) => t.taskId));
});

test("shadow mode evaluates v1 and v2 decisions", () => {
  const engine = createShadowModeEngine({
    runtimes: [
      {
        id: "kimi-wire",
        priority: 80,
        capabilities: { read: true, write: true, shell: true, patch: true, review: true, merge: false, vision: false, mcp: true, toolCalling: true, supportsToolCalling: true, streaming: true, supportsStreaming: true, maxTokens: 200_000, maxContextTokens: 200_000 },
        supports() { return true; },
        async runNode() { return { success: true, stdout: "", stderr: "" }; },
      },
      {
        id: "deepseek",
        priority: 70,
        capabilities: { read: true, write: true, shell: true, patch: true, review: true, merge: false, vision: false, mcp: true, toolCalling: true, supportsToolCalling: true, streaming: true, supportsStreaming: true, maxTokens: 64_000, maxContextTokens: 64_000 },
        supports() { return true; },
        async runNode() { return { success: true, stdout: "", stderr: "" }; },
      },
    ],
    history: [],
  });

  const capsule = {
    runId: "r1",
    nodeId: "n1",
    goal: "Fix a bug",
    system: "sys",
    task: "Fix bug in src/x.ts",
    dependencySummaries: [],
    relevantFiles: [{ path: "src/x.ts", startLine: 1, endLine: 5, content: "// code" }],
    graphMemory: [],
    priorAttempts: [],
    evidenceRequirements: [],
    budget: { maxInputTokens: 8000, reservedOutputTokens: 4096, maxFileTokens: 4096, maxToolResultTokens: 2048, maxMemoryFacts: 10, compression: "lossless-ish" },
    node: { id: "n1", name: "Fix bug", role: "coder", dependsOn: [], status: "running", retries: 0, maxRetries: 1 },
  };

  const record = engine.evaluate("t1", "n1", capsule);
  assert.equal(record.taskId, "t1");
  assert.equal(record.nodeId, "n1");
  assert.ok(typeof record.regretV1 === "number");
  assert.ok(typeof record.regretV2 === "number");
  assert.ok(record.regretV1 >= 0 && record.regretV1 <= 1);
  assert.ok(record.regretV2 >= 0 && record.regretV2 <= 1);
});

test("computeRouterRegret returns 0 when selected is best", () => {
  const runtimes = [
    {
      id: "a",
      priority: 90,
      capabilities: { read: true, write: true, shell: true, patch: true, review: true, merge: false, vision: false, mcp: true, toolCalling: true, supportsToolCalling: true, streaming: true, supportsStreaming: true, maxTokens: 200_000, maxContextTokens: 200_000 },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
    {
      id: "b",
      priority: 10,
      capabilities: { read: true, write: false, shell: false, patch: false, review: false, merge: false, vision: false, mcp: false, toolCalling: false, supportsToolCalling: false, streaming: false, supportsStreaming: false, maxTokens: 0, maxContextTokens: 0 },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
  ];
  const regret = computeRouterRegret(runtimes, "coding", [], "a");
  assert.equal(regret, 0);
});

test("computeRouterRegret > 0 when selected is not best", () => {
  const runtimes = [
    {
      id: "a",
      priority: 90,
      capabilities: { read: true, write: true, shell: true, patch: true, review: true, merge: false, vision: false, mcp: true, toolCalling: true, supportsToolCalling: true, streaming: true, supportsStreaming: true, maxTokens: 200_000, maxContextTokens: 200_000 },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
    {
      id: "b",
      priority: 10,
      capabilities: { read: true, write: false, shell: false, patch: false, review: false, merge: false, vision: false, mcp: false, toolCalling: false, supportsToolCalling: false, streaming: false, supportsStreaming: false, maxTokens: 0, maxContextTokens: 0 },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
  ];
  const regret = computeRouterRegret(runtimes, "coding", [], "b");
  assert.ok(regret > 0);
});

test("runBenchmarkSuite produces a summary in shadow mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omk-bench-"));
  try {
    const summary = await runBenchmarkSuite({
      config: {
        mode: "shadow",
        tasksDir: join(dir, "fixtures"),
        outputDir: dir,
        runId: "test-run",
        maxConcurrency: 1,
        pinSeed: 42,
      },
      runtimes: [
        {
          id: "kimi-wire",
          priority: 80,
          capabilities: { read: true, write: true, shell: true, patch: true, review: true, merge: false, vision: false, mcp: true, toolCalling: true, supportsToolCalling: true, streaming: true, supportsStreaming: true, maxTokens: 200_000, maxContextTokens: 200_000 },
          supports() { return true; },
          async runNode() { return { success: true, stdout: "", stderr: "" }; },
        },
      ],
    });

    assert.equal(summary.schemaVersion, "omk.benchmark.v1");
    assert.equal(summary.runId, "test-run");
    assert.equal(summary.mode, "shadow");
    assert.ok(summary.totalTasks > 0);
    assert.ok(summary.results.length > 0);
    assert.ok(typeof summary.solveRate === "number");
    assert.ok(typeof summary.evidenceTrustScoreMean === "number");
    assert.ok(typeof summary.routerRegretMean === "number");

    const written = JSON.parse(await readFile(join(dir, "test-run.json"), "utf-8"));
    assert.equal(written.runId, "test-run");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runBenchmarkSuite respects category filter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omk-bench-filter-"));
  try {
    const summary = await runBenchmarkSuite({
      config: {
        mode: "shadow",
        tasksDir: join(dir, "fixtures"),
        outputDir: dir,
        runId: "filter-run",
        maxConcurrency: 1,
        pinSeed: 42,
        categories: ["small-bug-fix", "failing-test-repair"],
      },
      runtimes: [
        {
          id: "kimi-wire",
          priority: 80,
          capabilities: { read: true, write: true, shell: true, patch: true, review: true, merge: false, vision: false, mcp: true, toolCalling: true, supportsToolCalling: true, streaming: true, supportsStreaming: true, maxTokens: 200_000, maxContextTokens: 200_000 },
          supports() { return true; },
          async runNode() { return { success: true, stdout: "", stderr: "" }; },
        },
      ],
    });

    assert.equal(summary.totalTasks, 4); // 2 categories * 2 tasks each
    const allTaskIds = summary.results.map((r) => r.taskId);
    assert.ok(allTaskIds.every((id) => id.includes("small-bug-fix") || id.includes("failing-test-repair")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
