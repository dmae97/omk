// mem-durability-recovery.test.mjs — Lane A FIX (delta mode only)
//
// Run: node --test test/mem-durability-recovery.test.mjs
//
// Tests:
//  1. Raw-array order golden — delta cold-replay reproduces the EXACT raw
//     nodes/edges array order of the legacy full-rewrite (deepStrictEqual on
//     stored-order arrays, NOT sorted/Set/count projections). A deterministic
//     clock makes legacy and delta runs produce identical timestamps so the
//     raw objects compare byte-for-byte; the only machine-specific field
//     (absolute project root) is normalized. Exercises replaceGeneratedMindmap
//     filter+repush repositioning via repeated writes/appends to the same path.
//  2. Resume-after-torn — write N records, tear the trailing record, cold
//     reload (=> state at N-1 with PHYSICAL truncation of the torn bytes), then
//     a NEW write + reload is intact with no record interleaving or loss.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..");
const distBase = pathToFileURL(join(repoRoot, "dist") + "/").href;

const { LocalGraphMemoryStore } = await import(`${distBase}memory/local-graph-memory-store.js`);
const { loadStateViaDelta } = await import(`${distBase}memory/graph-delta-log.js`);

// ── Deterministic clock ──────────────────────────────────────────────────────
// Legacy and delta runs must observe identical timestamps so the raw node/edge
// objects (createdAt/updatedAt + timestamp-derived ids/labels) compare equal.
const FIXED_ISO = "2026-06-10T00:00:00.000Z";
const FIXED_MS = Date.parse(FIXED_ISO);
const RealDate = Date;

function installFixedClock() {
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(FIXED_MS);
      } else {
        super(...args);
      }
    }
    static now() {
      return FIXED_MS;
    }
  }
  globalThis.Date = FixedDate;
}
function restoreClock() {
  globalThis.Date = RealDate;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), "omk-recovery-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function baseEnv(root) {
  return {
    OMK_MEMORY_BACKEND: "local_graph",
    OMK_MEMORY_STRICT: "true",
    OMK_MEMORY_FORCE: "false",
    OMK_MEMORY_MIRROR_FILES: "false",
    OMK_MEMORY_MIGRATE_FILES: "false",
    OMK_LOCAL_GRAPH_PATH: join(root, ".omk", "memory", "graph-state.json"),
    OMK_PROJECT_ID: "test-project-id",
    OMK_PROJECT_NAME: "test-project",
    // OMK_MEMORY_DURABILITY intentionally unset here → legacy default
  };
}
function deltaEnv(root) {
  const env = baseEnv(root);
  env.OMK_MEMORY_DURABILITY = "delta";
  return env;
}

async function createStore(root, env, source) {
  return LocalGraphMemoryStore.create({
    projectRoot: root,
    sessionId: "recovery-session",
    source,
    env: { ...process.env, ...env },
  });
}

const graphPathOf = (root) => join(root, ".omk", "memory", "graph-state.json");
const deltaLogOf = (root) => join(root, ".omk", "memory", "graph.delta.jsonl");

function emptyState() {
  return {
    version: 1,
    ontology: { version: "", classes: [], relationTypes: [], description: "" },
    project: { key: "", name: "", root: "" },
    updatedAt: FIXED_ISO,
    nodes: [],
    edges: [],
  };
}

// Replace the only machine-specific field (absolute project root) so raw arrays
// compare by structure + order without temp-dir noise. Order is NOT changed.
function normalizeNodes(nodes) {
  return nodes.map((n) => {
    if (n.type !== "Project") return n;
    return { ...n, summary: "<root>", properties: { ...n.properties, root: "<root>" } };
  });
}

// Corpus with repeated writes/appends to the same path → triggers
// replaceGeneratedMindmap filter+repush repositioning of generated nodes.
const CORPUS = [
  { op: "write", path: "a.md", content: "# Goal: Test\n\n- Decision: use delta log\n- Task: implement" },
  { op: "write", path: "b.md", content: "# Risks\n\n- Risk: corruption\n- Risk: concurrency\n- Evidence: tested" },
  { op: "append", path: "a.md", content: "- Decision: keep order\n- Task: golden test" },
  { op: "write", path: "c.md", content: "# Concepts\n\n" + Array.from({ length: 12 }, (_, i) => `- Concept ${i}: c`).join("\n") },
  { op: "append", path: "b.md", content: "## More\n- Risk: torn tail" },
  { op: "append", path: "c.md", content: "- Concept X: repositioned\n- Decision: re-add" },
  { op: "write", path: "a.md", content: "# Goal v2\n- Decision: rewrite\n- Task: verify order\n- Risk: divergence" },
];

async function runCorpus(store) {
  for (const { op, path, content } of CORPUS) {
    if (op === "write") await store.write(path, content);
    else await store.append(path, content);
  }
}

// ── Test 1: Raw-array order golden ──────────────────────────────────────────
test("raw-array order golden: delta replay reproduces EXACT legacy nodes/edges order", async () => {
  installFixedClock();
  try {
    await withTempProject(async (legacyRoot) => {
      const legacy = await createStore(legacyRoot, baseEnv(legacyRoot), "order-test");
      assert.ok(legacy, "legacy store must be created");
      await runCorpus(legacy);
      const legacyState = JSON.parse(await readFile(graphPathOf(legacyRoot), "utf-8"));

      await withTempProject(async (deltaRoot) => {
        const delta = await createStore(deltaRoot, deltaEnv(deltaRoot), "order-test");
        assert.ok(delta, "delta store must be created");
        await runCorpus(delta);

        // Cold replay: snapshot + delta tail (manifest exists after the run).
        const replay = await loadStateViaDelta(graphPathOf(deltaRoot), true, emptyState());

        const Lnodes = normalizeNodes(legacyState.nodes);
        const Dnodes = normalizeNodes(replay.state.nodes);

        // RAW stored order — exact id sequence, not sorted / Set / count.
        assert.deepStrictEqual(
          Dnodes.map((n) => n.id),
          Lnodes.map((n) => n.id),
          "node RAW array order must match legacy full-rewrite"
        );
        assert.deepStrictEqual(
          replay.state.edges.map((e) => e.id),
          legacyState.edges.map((e) => e.id),
          "edge RAW array order must match legacy full-rewrite"
        );

        // Full RAW arrays deep-equal in stored order (structure + order).
        assert.deepStrictEqual(Dnodes, Lnodes, "node RAW arrays must deep-equal in stored order");
        assert.deepStrictEqual(replay.state.edges, legacyState.edges, "edge RAW arrays must deep-equal in stored order");

        // Sanity: the corpus actually exercised repositioning (>1 generated node).
        const generated = replay.state.nodes.filter((n) => n.properties && n.properties.generatedFrom);
        assert.ok(generated.length > 1, "corpus must produce repositioned generated nodes");
      });
    });
  } finally {
    restoreClock();
  }
});

// ── Test 2: Resume-after-torn ───────────────────────────────────────────────
test("resume-after-torn: torn tail truncated, new write intact, no interleave/loss", async () => {
  await withTempProject(async (root) => {
    const N = 5;

    // Write N records (one delta record per write).
    const writer = await createStore(root, deltaEnv(root), "torn-write");
    assert.ok(writer, "writer store must be created");
    for (let i = 1; i <= N; i += 1) {
      await writer.write(`m${i}.md`, `# Memory ${i}\n- seq ${i}`);
    }

    const logPath = deltaLogOf(root);
    const original = await readFile(logPath, "utf-8");
    const lines = original.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, N, `expected ${N} delta records before crash injection`);

    // Simulate a crash mid-append of record N: keep R1..R(N-1) framed, leave RN
    // as a torn (non-newline-terminated) partial fragment.
    const head = lines.slice(0, N - 1).map((l) => `${l}\n`).join("");
    const tornFragment = lines[N - 1].slice(0, Math.max(8, Math.floor(lines[N - 1].length / 2)));
    await writeFile(logPath, head + tornFragment); // no trailing newline → torn tail

    // Cold reload #1: recover to state at N-1 and PHYSICALLY truncate torn bytes.
    const recovered = await createStore(root, deltaEnv(root), "torn-recover");
    assert.ok(recovered, "recovered store must be created");
    assert.equal(await recovered.read(`m${N}.md`), "", "torn last record (mN) must be dropped => state at N-1");
    for (let i = 1; i <= N - 1; i += 1) {
      assert.ok((await recovered.read(`m${i}.md`)).includes(`Memory ${i}`), `m${i} must survive recovery`);
    }

    // Physical truncation: torn fragment removed, log ends on a clean record frame.
    const afterRecovery = await readFile(logPath, "utf-8");
    assert.ok(afterRecovery.endsWith("\n"), "recovered log must end on a clean newline frame");
    assert.ok(!afterRecovery.includes(tornFragment.slice(-16)), "torn fragment tail must be physically removed");
    const recoveredLines = afterRecovery.split("\n").filter((l) => l.length > 0);
    assert.equal(recoveredLines.length, N - 1, "log must be truncated to N-1 valid records");
    for (const l of recoveredLines) JSON.parse(l); // every remaining line is a complete record

    // Resume: a NEW write must append on a clean frame (never merge into a half line).
    const resumeStore = await createStore(root, deltaEnv(root), "torn-resume");
    assert.ok(resumeStore, "resume store must be created");
    await resumeStore.write("resumed.md", "# Resumed write\n- intact after torn tail");

    // Cold reload #2: new write intact, mN still absent, earlier records preserved.
    const final = await createStore(root, deltaEnv(root), "torn-final");
    assert.ok(final, "final store must be created");
    assert.ok((await final.read("resumed.md")).includes("Resumed write"), "resumed write must be intact");
    assert.equal(await final.read(`m${N}.md`), "", "torn mN must remain absent (no resurrection)");
    for (let i = 1; i <= N - 1; i += 1) {
      assert.ok((await final.read(`m${i}.md`)).includes(`Memory ${i}`), `m${i} must still be present`);
    }

    // No interleaving / loss: every delta line is a complete, parseable v2 frame.
    const finalLog = await readFile(logPath, "utf-8");
    const finalLines = finalLog.split("\n").filter((l) => l.length > 0);
    assert.equal(finalLines.length, N, "expected N-1 surviving + 1 resumed record");
    for (const l of finalLines) {
      const rec = JSON.parse(l);
      assert.equal(rec.v, 2, "each delta line must be a complete v2 record (no interleave)");
    }
  });
});
