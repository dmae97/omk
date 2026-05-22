import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEvent, readEvents, tailEvents } from "../dist/util/events-logger.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "omk-events-"));
}

test("appendEvent writes JSON lines to events.jsonl", async () => {
  const dir = await tempDir();
  try {
    await appendEvent(dir, { type: "node-start", runId: "r1", nodeId: "n1" });
    await appendEvent(dir, { type: "node-complete", runId: "r1", nodeId: "n1", data: { success: true } });

    const events = await readEvents(dir);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "node-start");
    assert.equal(events[0].schemaVersion, "telemetry.v1");
    assert.equal(events[0].seq, 1);
    assert.equal(events[0].runId, "r1");
    assert.equal(events[0].nodeId, "n1");
    assert.equal(events[1].type, "node-complete");
    assert.equal(events[1].seq, 2);
    assert.equal(events[1].data.success, true);
    assert.ok(events[0].timestamp);
    assert.ok(events[1].timestamp);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendEvent bounds and redacts telemetry payloads", async () => {
  const dir = await tempDir();
  try {
    const token = ["sk", "123456789012345678901234"].join("-");
    await appendEvent(dir, {
      type: "tool.completed",
      runId: "r3",
      nodeId: "n1",
      data: {
        stdout: `secret ${token}`,
        summary: "x".repeat(700),
        headers: { authorization: token },
      },
    });

    const raw = await readFile(join(dir, "events.jsonl"), "utf-8");
    assert.doesNotMatch(raw, new RegExp(token));
    assert.match(raw, /redacted|REDACTED|\*\*\*/i);
    const events = await readEvents(dir);
    assert.equal(events[0].data.stdout, "[redacted]");
    assert.match(String(events[0].data.summary), /\[truncated /);
    assert.equal(events[0].data.headers, "[redacted]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tailEvents filters by seq and limit", async () => {
  const dir = await tempDir();
  try {
    await appendEvent(dir, { type: "lane.started", runId: "r4", nodeId: "n1" });
    await appendEvent(dir, { type: "lane.heartbeat", runId: "r4", nodeId: "n1" });
    await appendEvent(dir, { type: "lane.completed", runId: "r4", nodeId: "n1" });

    const tailed = await tailEvents(dir, { afterSeq: 1, limit: 1 });
    assert.equal(tailed.length, 1);
    assert.equal(tailed[0].type, "lane.completed");
    assert.equal(tailed[0].seq, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readEvents returns empty array when file is missing", async () => {
  const dir = await tempDir();
  try {
    const events = await readEvents(dir);
    assert.deepEqual(events, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendEvent appends to existing events.jsonl", async () => {
  const dir = await tempDir();
  try {
    await appendEvent(dir, { type: "replay-start", runId: "r2", data: { mode: "full" } });
    await appendEvent(dir, { type: "replay-end", runId: "r2", data: { success: true } });

    const events = await readEvents(dir);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "replay-start");
    assert.equal(events[1].type, "replay-end");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
