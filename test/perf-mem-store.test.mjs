// Lane PERF-MEM — behavior-preserving perf fixes for the local graph memory
// store and the orchestration state persister.
//
// Proves:
//   1. search() index returns identical results to a brute-force O(N^2)
//      reference on a generated multi-node state (Fix P2#2).
//   2. structuredClone-based save output is byte-identical to the old
//      JSON.parse(JSON.stringify(...)) clone (Fix P2#3, state-persister).
//   3. The mutateState process-local cache (Fix P2#1) is behavior-preserving:
//      cache-hit writes produce the same on-disk state as cold reads, and the
//      cache invalidates when an external writer changes file mtime/size.
//   4. Micro-bench: a TEMP 5k-node state (os.tmpdir, never the real 66MB file)
//      keeps search + N sequential writes under a generous threshold.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalGraphMemoryStore } from "../dist/memory/local-graph-memory-store.js";
import { createStatePersister, redactSecrets } from "../dist/orchestration/state-persister.js";

const SOURCE = "perf-test";

async function makeStore(root, extraEnv = {}) {
  const graphPath = join(root, ".omk", "memory", "graph-state.json");
  const env = {
    OMK_MEMORY_BACKEND: "local_graph",
    OMK_MEMORY_FORCE: "0",
    OMK_MEMORY_STRICT: "true",
    OMK_MEMORY_MIRROR_FILES: "false",
    OMK_LOCAL_GRAPH_PATH: graphPath,
    ...extraEnv,
  };
  const store = await LocalGraphMemoryStore.create({
    projectRoot: root,
    sessionId: "perf-session",
    source: SOURCE,
    env,
  });
  assert.ok(store, "expected local graph backend store");
  return { store, graphPath };
}

// ---- Brute-force O(N^2) reference (mirrors the ORIGINAL search algorithm) ----

function refReadFromState(state, path) {
  const memory = state.nodes.find((n) => n.type === "Memory" && n.path === path);
  const memoryId = memory?.id;
  const updateIds = memoryId
    ? new Set(
        state.edges
          .filter((e) => e.type === "UPDATES" && e.to === memoryId)
          .map((e) => e.from)
      )
    : undefined;
  const version = state.nodes
    .filter((n) => n.type === "MemoryVersion" && n.path === path)
    .filter((n) => !updateIds || updateIds.size === 0 || updateIds.has(n.id))
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id)
    )[0];
  return version?.content ?? memory?.content ?? "";
}

function refSearch(state, query, limit) {
  const normalizedQuery = query.trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)) || 10);
  return state.nodes
    .filter((n) => n.type === "Memory")
    .filter((n) => {
      const content = refReadFromState(state, n.path ?? n.label);
      if (!normalizedQuery) return true;
      return [n.path, n.label, n.summary, content]
        .filter((v) => typeof v === "string")
        .some((v) => v.toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, safeLimit)
    .map((n) => ({
      path: n.path ?? n.label,
      content: refReadFromState(state, n.path ?? n.label),
      sessionId: String(n.properties.sessionId ?? ""),
      updatedAt: n.updatedAt,
      source: String(n.properties.source ?? SOURCE),
    }));
}

test("search() index matches brute-force O(N^2) reference (Fix P2#2)", async () => {
  const root = await mkdtemp(join(tmpdir(), "perf-mem-search-"));
  try {
    const { store, graphPath } = await makeStore(root);

    // Generate a multi-node state with distinct paths and version histories.
    for (let i = 0; i < 30; i += 1) {
      await store.write(
        `m/${i}.md`,
        `# Mem ${i}\nalpha token-${i} ${i % 3 === 0 ? "shared" : ""}`
      );
    }
    for (let i = 0; i < 10; i += 1) {
      await store.write(`m/${i}.md`, `# Mem ${i} v2\nbeta token-${i} ${i % 2 === 0 ? "shared" : ""}`);
      await store.append(`m/${i}.md`, `appended-${i}`);
    }

    const state = JSON.parse(await readFile(graphPath, "utf-8"));
    const memoryCount = state.nodes.filter((n) => n.type === "Memory").length;
    assert.equal(memoryCount, 30, "expected 30 distinct memory nodes");

    const cases = [
      ["", 10],
      ["", 50],
      ["", 1],
      ["token", 10],
      ["shared", 50],
      ["appended", 10],
      ["alpha", 5],
      ["beta", 50],
      ["TOKEN-3", 10], // case-insensitive
      ["nonexistent-zzz", 10],
    ];
    for (const [query, limit] of cases) {
      const actual = await store.search(query, limit);
      const expected = refSearch(state, query, limit);
      assert.deepEqual(
        actual,
        expected,
        `search(${JSON.stringify(query)}, ${limit}) must equal brute-force reference`
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state-persister structuredClone save output is byte-identical to JSON-clone (Fix P2#3)", async () => {
  const base = await mkdtemp(join(tmpdir(), "perf-mem-persist-"));
  try {
    const persister = createStatePersister(base);
    const state = {
      schemaVersion: 1,
      runId: "perf-clone-run",
      startedAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:01.000Z",
      goal: { title: "clone", objective: "deep clone parity" },
      nodes: [
        {
          id: "n1",
          token: "super-secret-token",
          authorization: "Bearer abc.def",
          payload: { values: ["x", null, 1, true], note: "keep" },
        },
        { id: "n2", deps: ["n1"], extra: { service_token: "zzz" } },
      ],
    };

    await persister.save(state);
    const fileContent = await readFile(join(base, "perf-clone-run", "state.json"), "utf-8");

    // Reproduce the OLD code path exactly: JSON deep clone -> redact -> serialize.
    const oldClone = JSON.parse(JSON.stringify(state));
    const oldToSave = { ...redactSecrets(oldClone), schemaVersion: 1 };
    const oldOutput = JSON.stringify(oldToSave, null, 2);

    assert.equal(fileContent, oldOutput, "structuredClone save must match JSON-clone output");
    // Spot-check redaction still happened.
    assert.match(fileContent, /"token": "\*\*\*"/);
    assert.match(fileContent, /"authorization": "\*\*\*"/);
    assert.doesNotMatch(fileContent, /super-secret-token/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("mutateState cache: cache-hit writes equal cold reads (Fix P2#1)", async () => {
  const root = await mkdtemp(join(tmpdir(), "perf-mem-cache-"));
  try {
    const { store, graphPath } = await makeStore(root);

    // First write is a cold read (cache miss); the rest are cache hits.
    await store.write("a.md", "A1");
    await store.write("b.md", "B1");
    await store.write("c.md", "C1");
    await store.write("a.md", "A2"); // versioned update on a cache hit

    // Cold reads (read() always loads from disk) must reflect every write.
    assert.equal(await store.read("a.md"), "A2");
    assert.equal(await store.read("b.md"), "B1");
    assert.equal(await store.read("c.md"), "C1");

    // No prior write was dropped by reusing the cached object.
    const state = JSON.parse(await readFile(graphPath, "utf-8"));
    const memPaths = state.nodes
      .filter((n) => n.type === "Memory")
      .map((n) => n.path)
      .sort();
    assert.deepEqual(memPaths, ["a.md", "b.md", "c.md"]);

    // The cache-hit search result also equals the brute-force reference.
    assert.deepEqual(await store.search("", 50), refSearch(state, "", 50));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mutateState cache: invalidates when external writer changes file size/mtime (Fix P2#1)", async () => {
  const root = await mkdtemp(join(tmpdir(), "perf-mem-invalidate-"));
  try {
    const { store, graphPath } = await makeStore(root);

    await store.write("a.md", "A1"); // populates the process-local cache

    // Simulate a CONCURRENT EXTERNAL WRITER: parse current state, inject a node
    // the store does not know about, and rewrite the file. This changes the
    // file size (and mtime), which must invalidate the cache on the next write.
    const onDisk = JSON.parse(await readFile(graphPath, "utf-8"));
    onDisk.nodes.push({
      id: "Memory:external-injected",
      type: "Memory",
      labels: ["Memory"],
      label: "external.md",
      path: "external.md",
      content: "EXTERNAL-CONTENT",
      summary: "injected by external writer",
      tags: [],
      properties: { sessionId: "external", source: "external-writer" },
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
    await writeFile(graphPath, `${JSON.stringify(onDisk, null, 2)}\n`, "utf-8");

    // Next store write must re-read fresh state (cache invalidated), so the
    // externally injected node survives instead of being clobbered.
    await store.write("b.md", "B1");

    const after = JSON.parse(await readFile(graphPath, "utf-8"));
    const paths = after.nodes
      .filter((n) => n.type === "Memory")
      .map((n) => n.path)
      .sort();
    assert.deepEqual(
      paths,
      ["a.md", "b.md", "external.md"],
      "external node must survive => cache invalidated on size/mtime change"
    );
    const ext = after.nodes.find((n) => n.path === "external.md");
    assert.equal(ext.content, "EXTERNAL-CONTENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("micro-bench: 5k-node TEMP state keeps search + N writes under threshold", async () => {
  const root = await mkdtemp(join(tmpdir(), "perf-mem-bench-"));
  try {
    const { store, graphPath } = await makeStore(root);
    const N = 5000;
    const now = "2026-06-10T00:00:00.000Z";
    const nodes = [];
    const edges = [];
    for (let i = 0; i < N; i += 1) {
      const path = `bench/${i}.md`;
      const needle = i % 500 === 0 ? " needle" : "";
      const content = `content body ${i}${needle} ${"x".repeat(24)}`;
      nodes.push({
        id: `Memory:b${i}`,
        type: "Memory",
        labels: ["Memory"],
        label: path,
        path,
        content: content.slice(0, 200),
        summary: `summary ${i}`,
        tags: [],
        properties: { sessionId: "perf", source: SOURCE },
        createdAt: now,
        updatedAt: now,
      });
      nodes.push({
        id: `MemoryVersion:b${i}`,
        type: "MemoryVersion",
        labels: ["MemoryVersion"],
        label: path,
        path,
        content,
        summary: "",
        tags: [],
        properties: {},
        createdAt: now,
        updatedAt: now,
      });
      edges.push({
        id: `UPDATES:b${i}`,
        type: "UPDATES",
        from: `MemoryVersion:b${i}`,
        to: `Memory:b${i}`,
        properties: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    const bigState = {
      version: 1,
      ontology: { version: "x", classes: [], relationTypes: [], description: "" },
      project: { key: "bench", name: "bench", root },
      updatedAt: now,
      nodes,
      edges,
    };
    await mkdir(join(root, ".omk", "memory"), { recursive: true });
    await writeFile(graphPath, `${JSON.stringify(bigState)}\n`, "utf-8");

    const searchStart = performance.now();
    const results = await store.search("needle", 10);
    const searchMs = performance.now() - searchStart;
    assert.equal(results.length, 10, "expected 10 needle matches");

    const WRITES = 50;
    const writeStart = performance.now();
    for (let j = 0; j < WRITES; j += 1) {
      await store.write(`bench/extra-${j}.md`, `extra ${j} ${"y".repeat(16)}`);
    }
    const writeMs = performance.now() - writeStart;

    // Generous CI-safe thresholds (the point is asymptotic completion, not
    // micro-precision). Actuals are printed for the proof artifact.
    console.log(
      `[perf-mem bench] nodes=${nodes.length} search=${searchMs.toFixed(1)}ms ` +
        `${WRITES}writes=${writeMs.toFixed(1)}ms (avg ${(writeMs / WRITES).toFixed(1)}ms)`
    );
    assert.ok(searchMs < 5000, `search too slow: ${searchMs.toFixed(1)}ms`);
    assert.ok(writeMs < 30000, `${WRITES} writes too slow: ${writeMs.toFixed(1)}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
