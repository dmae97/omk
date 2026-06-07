// Wave-3 p8: linkRunToGraph finalizer + `graph audit` verdict tests.
//
// To run on Node 20 without disturbing the shared dist while concurrent lanes
// build, this test compiles only its three target modules (+ their import
// closure) into a private temp dir and imports the emitted JS from there.
// Set P8_DIST to reuse an existing compiled dir and skip the compile step.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
let compiledDir;

async function resolveDistBase() {
  if (process.env.P8_DIST) {
    return pathToFileURL(join(process.cwd(), process.env.P8_DIST) + "/").href;
  }
  // Compile inside the repo so Node can resolve node_modules (e.g. execa).
  await mkdir(join(repoRoot, ".omk"), { recursive: true });
  const outDir = await mkdtemp(join(repoRoot, ".omk", "p8-dist-"));
  compiledDir = outDir;
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
      "src/memory/memory-store.ts",
      "src/memory/local-graph-memory-store.ts",
      "src/commands/graph.ts",
      "--outDir", outDir,
      "--rootDir", "src",
      "--module", "nodenext",
      "--moduleResolution", "nodenext",
      "--target", "es2022",
      "--lib", "es2022",
      "--strict",
      "--esModuleInterop",
      "--skipLibCheck",
      "--resolveJsonModule",
      "--declaration", "false",
      "--sourceMap", "false",
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  if (!existsSync(join(outDir, "memory", "memory-store.js"))) {
    throw new Error(`tsc failed to emit test modules:\n${result.stdout}\n${result.stderr}`);
  }
  return pathToFileURL(outDir + "/").href;
}

const distBase = await resolveDistBase();
const { linkRunToGraph } = await import(`${distBase}memory/memory-store.js`);
const { auditGraphRuns } = await import(`${distBase}commands/graph.js`);

after(async () => {
  if (compiledDir) await rm(compiledDir, { recursive: true, force: true });
});

const linkEnv = {
  ...process.env,
  OMK_MEMORY_BACKEND: "local_graph",
  OMK_MEMORY_STRICT: "false",
  OMK_MEMORY_MIRROR_FILES: "false",
  OMK_MEMORY_MIGRATE_FILES: "false",
  OMK_MEMORY_FORCE: "false",
};

function makeManifest(runId) {
  return {
    schemaVersion: "omk.run-manifest.v1",
    runId,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:05:00.000Z",
    status: "passed",
    promptHash: "deadbeef",
    providerPolicy: { provider: "mimo", mode: "auto" },
    nodes: [{ nodeId: "n1", status: "passed", provider: "mimo" }],
    artifacts: [
      { kind: "run-manifest", path: `.omk/runs/${runId}/run-manifest.json`, sha256: "a".repeat(64) },
      { kind: "evidence", path: `.omk/runs/${runId}/evidence.jsonl`, sha256: "b".repeat(64) },
      { kind: "decision", path: `.omk/runs/${runId}/decisions.jsonl`, sha256: "c".repeat(64) },
    ],
    evidenceSummary: { required: 3, passed: 3, failed: 0, missing: 0 },
    decisionTracePath: `.omk/runs/${runId}/decisions.jsonl`,
  };
}

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "omk-p8-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readState(root) {
  const raw = await readFile(join(root, ".omk", "memory", "graph-state.json"), "utf-8");
  return JSON.parse(raw);
}

function outgoing(state, runId, type) {
  const runNode = state.nodes.find((n) => n.type === "Run" && n.properties.runId === runId);
  assert.ok(runNode, "run node should exist");
  return state.edges.filter((e) => e.from === runNode.id && e.type === type);
}

test("linkRunToGraph emits run -> route/provider/evidence/decision/artifact and is idempotent", async () => {
  await withTempRoot(async (root) => {
    const runId = "p8-link-run";
    const manifest = makeManifest(runId);

    const linked = await linkRunToGraph(runId, manifest, { projectRoot: root, env: linkEnv });
    assert.equal(linked, true, "local_graph backend should link the run");

    const state1 = await readState(root);
    assert.equal(outgoing(state1, runId, "HAS_PROVIDER_ROUTE").length, 1);
    assert.equal(outgoing(state1, runId, "HAS_EVIDENCE").length, 1);
    assert.equal(outgoing(state1, runId, "HAS_DECISION").length, 1);
    assert.equal(outgoing(state1, runId, "TOUCHES_FILE").length, 3);

    // route -> provider
    const routeEdge = outgoing(state1, runId, "HAS_PROVIDER_ROUTE")[0];
    const routesTo = state1.edges.filter((e) => e.from === routeEdge.to && e.type === "ROUTES_TO");
    assert.equal(routesTo.length, 1);
    const providerNode = state1.nodes.find((n) => n.id === routesTo[0].to);
    assert.equal(providerNode.type, "Provider");
    assert.equal(providerNode.label, "mimo");

    // privacy: only counts/paths/sha persisted on the evidence node
    const evNode = state1.nodes.find((n) => n.type === "Evidence" && n.properties.runId === runId);
    assert.equal(evNode.properties.required, 3);
    assert.equal(evNode.properties.passed, 3);
    assert.equal(evNode.properties.path, `.omk/runs/${runId}/evidence.jsonl`);
    assert.ok(!("content" in evNode.properties), "no raw evidence body persisted");

    const nodeCount1 = state1.nodes.length;
    const edgeCount1 = state1.edges.length;

    // idempotent re-run: no duplicate nodes/edges
    await linkRunToGraph(runId, manifest, { projectRoot: root, env: linkEnv });
    const state2 = await readState(root);
    assert.equal(state2.nodes.length, nodeCount1, "no duplicate nodes on re-run");
    assert.equal(state2.edges.length, edgeCount1, "no duplicate edges on re-run");
  });
});

test("auditGraphRuns: passed when subgraph matches manifest", async () => {
  await withTempRoot(async (root) => {
    const runId = "p8-audit-pass";
    const manifest = makeManifest(runId);
    await linkRunToGraph(runId, manifest, { projectRoot: root, env: linkEnv });
    const state = await readState(root);

    const report = auditGraphRuns(state, [{ runId, manifest }]);
    assert.equal(report.verdict, "passed");
    assert.equal(report.runs[0].counts.providerRoute, 1);
    assert.equal(report.runs[0].counts.provider, 1);
    assert.equal(report.runs[0].counts.artifact, 3);
    assert.equal(report.runs[0].danglers.length, 0);
    assert.equal(report.runs[0].mismatches.length, 0);
  });
});

test("auditGraphRuns: failed when run node missing", async () => {
  await withTempRoot(async (root) => {
    await linkRunToGraph("p8-present", makeManifest("p8-present"), { projectRoot: root, env: linkEnv });
    const state = await readState(root);
    const report = auditGraphRuns(state, [{ runId: "p8-missing", manifest: null }]);
    assert.equal(report.verdict, "failed");
    assert.equal(report.runs[0].runNodeFound, false);
  });
});

test("auditGraphRuns: partial on evidence count mismatch", async () => {
  await withTempRoot(async (root) => {
    const runId = "p8-mismatch";
    await linkRunToGraph(runId, makeManifest(runId), { projectRoot: root, env: linkEnv });
    const state = await readState(root);
    const tampered = makeManifest(runId);
    tampered.evidenceSummary.passed = 99; // disagrees with graph
    const report = auditGraphRuns(state, [{ runId, manifest: tampered }]);
    assert.equal(report.verdict, "partial");
    assert.ok(report.runs[0].mismatches.some((m) => m.field === "evidence.passed"));
  });
});

test("auditGraphRuns: partial when manifest absent (structural only)", async () => {
  await withTempRoot(async (root) => {
    const runId = "p8-nomanifest";
    await linkRunToGraph(runId, makeManifest(runId), { projectRoot: root, env: linkEnv });
    const state = await readState(root);
    const report = auditGraphRuns(state, [{ runId, manifest: null }]);
    assert.equal(report.verdict, "partial");
    assert.equal(report.runs[0].manifestPresent, false);
  });
});
