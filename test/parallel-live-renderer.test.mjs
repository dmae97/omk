import test from "node:test";
import assert from "node:assert/strict";

import { ParallelLiveRenderer } from "../dist/orchestration/parallel-ui.js";

function createRunState(extra = {}) {
  return {
    schemaVersion: 1,
    runId: "r1",
    goalId: "g1",
    goal: "test",
    status: "running",
    nodes: [],
    workers: [],
    blockers: [],
    progress: { total: 0, settled: 0, done: 0, running: 0, failed: 0, blocked: 0, skipped: 0, percent: 0 },
    eta: null,
    ...extra,
  };
}

test("ParallelLiveRenderer cockpit mode is scroll-safe by default", () => {
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  const renderer = new ParallelLiveRenderer({ view: "cockpit", refreshMs: 10_000 });
  try {
    renderer.start(() => createRunState());
    renderer.stop();
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = writes.join("");
  assert.doesNotMatch(output, /\x1b\[H/);
  assert.doesNotMatch(output, /\x1b\[2J/);
  assert.doesNotMatch(output, /\x1b\[\?1049/);
});

test("ParallelLiveRenderer cockpit mode can opt into alternate screen", () => {
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  const renderer = new ParallelLiveRenderer({ view: "cockpit", refreshMs: 10_000, useAlternateScreen: true });
  try {
    renderer.start(() => createRunState());
    renderer.stop();
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = writes.join("");
  assert.match(output, /\x1b\[\?1049h/);
  assert.match(output, /\x1b\[\?1049l/);
});

test("ParallelLiveRenderer compact mode uses column-relative rewrite", () => {
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  const renderer = new ParallelLiveRenderer({ view: "compact", mode: "watch", refreshMs: 10_000 });
  try {
    renderer.start(() => createRunState());
    renderer.stop();
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = writes.join("");
  assert.doesNotMatch(output, /\x1b\[H/);
  assert.doesNotMatch(output, /\x1b\[2J/);
});
