import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function runWorker(graphPath, workerId, n) {
  return new Promise((resolve, reject) => {
    const cp = spawn(
      "node",
      [join(__dirname, "fixtures/delta-lock-worker.mjs"), graphPath, workerId, String(n)],
      {
        env: { ...process.env, OMK_MEMORY_DURABILITY: "delta" },
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let out = "";
    let err = "";
    cp.stdout.on("data", (d) => {
      out += d;
    });
    cp.stderr.on("data", (d) => {
      err += d;
    });
    cp.on("close", (code) => {
      if (code !== 0) reject(new Error(`worker ${workerId} exited ${code}: ${err || out}`));
      else resolve(out.trim());
    });
  });
}

describe("delta-lock", () => {
  it("concurrent writers do not lose updates or interleave records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omk-delta-lock-"));
    const graphPath = join(dir, "graph-state.json");
    const emptyState = {
      version: 1,
      ontology: { version: "", classes: [], relationTypes: [], description: "" },
      project: { key: "test", name: "Test", root: dir },
      updatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
    };
    writeFileSync(graphPath, JSON.stringify(emptyState));

    const workers = [runWorker(graphPath, "A", 8), runWorker(graphPath, "B", 8), runWorker(graphPath, "C", 8)];
    const results = await Promise.all(workers);
    for (const r of results) {
      const parsed = JSON.parse(r);
      assert.ok(parsed.done, `worker failed: ${r}`);
    }

    const deltaPath = join(dir, "graph.delta.jsonl");
    const raw = readFileSync(deltaPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 24, `expected 24 delta lines, got ${lines.length}`);

    for (const line of lines) {
      const rec = JSON.parse(line);
      assert.ok(
        rec.v === 2 && typeof rec.seq === "number" && typeof rec.crc === "string",
        `invalid record frame: ${line.slice(0, 80)}`
      );
    }

    const { loadStateViaDelta } = await import("../dist/memory/graph-delta-log.js");
    const result = await loadStateViaDelta(graphPath, false, emptyState);
    assert.equal(result.state.nodes.length, 24, `expected 24 nodes after replay, got ${result.state.nodes.length}`);

    const ids = new Set(result.state.nodes.map((n) => n.id));
    assert.equal(ids.size, 24, `expected 24 unique node ids, got ${ids.size}`);
  });

  it("recovers a stale lock from a dead pid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omk-delta-lock-"));
    const graphPath = join(dir, "graph-state.json");
    const lockPath = `${graphPath}.delta.lock`;
    const emptyState = {
      version: 1,
      ontology: { version: "", classes: [], relationTypes: [], description: "" },
      project: { key: "test", name: "Test", root: dir },
      updatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
    };
    writeFileSync(graphPath, JSON.stringify(emptyState));

    const stale = {
      pid: 99999,
      hostname: hostname(),
      startedAt: new Date(Date.now() - 60000).toISOString(),
    };
    writeFileSync(lockPath, JSON.stringify(stale));

    const { withDeltaLock } = await import("../dist/memory/graph-delta-log.js");
    let acquired = false;
    await withDeltaLock(
      graphPath,
      async () => {
        acquired = true;
      },
      { OMK_MEMORY_DURABILITY: "delta" }
    );
    assert.ok(acquired, "lock should have been acquired after breaking stale lock");
    assert.ok(!existsSync(lockPath), "stale lockfile should be removed");
  });

  it("recovers a stale lock from an expired TTL on foreign host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omk-delta-lock-"));
    const graphPath = join(dir, "graph-state.json");
    const lockPath = `${graphPath}.delta.lock`;
    const emptyState = {
      version: 1,
      ontology: { version: "", classes: [], relationTypes: [], description: "" },
      project: { key: "test", name: "Test", root: dir },
      updatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
    };
    writeFileSync(graphPath, JSON.stringify(emptyState));

    const stale = {
      pid: process.pid,
      hostname: "other-host",
      startedAt: new Date(Date.now() - 60000).toISOString(),
    };
    writeFileSync(lockPath, JSON.stringify(stale));

    const { withDeltaLock } = await import("../dist/memory/graph-delta-log.js");
    let acquired = false;
    await withDeltaLock(
      graphPath,
      async () => {
        acquired = true;
      },
      { OMK_MEMORY_DURABILITY: "delta" }
    );
    assert.ok(acquired, "lock should have been acquired after breaking TTL-expired foreign lock");
    assert.ok(!existsSync(lockPath), "stale lockfile should be removed");
  });

  it("throws on timeout when lock is live", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omk-delta-lock-"));
    const graphPath = join(dir, "graph-state.json");
    const lockPath = `${graphPath}.delta.lock`;
    const emptyState = {
      version: 1,
      ontology: { version: "", classes: [], relationTypes: [], description: "" },
      project: { key: "test", name: "Test", root: dir },
      updatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
    };
    writeFileSync(graphPath, JSON.stringify(emptyState));

    const live = {
      pid: process.pid,
      hostname: hostname(),
      startedAt: new Date().toISOString(),
    };
    writeFileSync(lockPath, JSON.stringify(live));

    const { withDeltaLock } = await import("../dist/memory/graph-delta-log.js");
    await assert.rejects(
      withDeltaLock(
        graphPath,
        async () => {
          /* never reached */
        },
        { OMK_MEMORY_DURABILITY: "delta" },
        200
      ),
      /timed out/
    );
    assert.ok(existsSync(lockPath), "live lockfile should NOT be removed by timed-out waiter");
  });
});
