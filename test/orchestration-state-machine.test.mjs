import { describe, it } from "node:test";
import assert from "node:assert";
import {
  transitionWorker,
  getRunningWorkerCount,
  getCompletedWorkerCount,
  getFailedWorkerCount,
} from "../dist/orchestration/state-machine/run-state-machine.js";
import { transitionNode } from "../dist/orchestration/state-machine/node-state-machine.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeState(overrides = {}) {
  return {
    runId: "run-1",
    status: "running",
    workers: new Map(),
    events: [],
    completedNodes: new Set(),
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTaskResult(success = true, overrides = {}) {
  return {
    success,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function makeNode(overrides = {}) {
  return {
    id: "n1",
    name: "test-node",
    role: "coder",
    dependsOn: [],
    status: "pending",
    retries: 0,
    maxRetries: 3,
    ...overrides,
  };
}

// ─── transitionWorker ───────────────────────────────────────────────────────

describe("transitionWorker", () => {
  it("initializes a worker as idle with maxRetries", () => {
    const state = makeState();
    const next = transitionWorker(state, { type: "initialize", nodeId: "a", maxRetries: 3 });

    const worker = next.workers.get("a");
    assert.ok(worker);
    assert.equal(worker.status, "idle");
    assert.equal(worker.maxRetries, 3);
    assert.equal(worker.retryCount, 0);
    assert.equal(next.workers.size, 1);
  });

  it("starts a worker and sets status to running", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "initialize", nodeId: "a", maxRetries: 3 });
    state = transitionWorker(state, { type: "start", nodeId: "a" });

    const worker = state.workers.get("a");
    assert.equal(worker.status, "running");
    assert.ok(worker.startedAt);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].type, "worker_started");
    assert.equal(state.events[0].nodeId, "a");
  });

  it("completes successfully and adds node to completedNodes", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "initialize", nodeId: "a", maxRetries: 3 });
    state = transitionWorker(state, { type: "start", nodeId: "a" });
    state = transitionWorker(state, { type: "complete", nodeId: "a", result: makeTaskResult(true) });

    const worker = state.workers.get("a");
    assert.equal(worker.status, "completed");
    assert.ok(worker.completedAt);
    assert.equal(state.completedNodes.has("a"), true);
    assert.equal(state.events.length, 2);
    assert.equal(state.events[1].type, "worker_completed");
  });

  it("completes with failure and does NOT add node to completedNodes", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "initialize", nodeId: "a", maxRetries: 3 });
    state = transitionWorker(state, { type: "start", nodeId: "a" });
    state = transitionWorker(state, { type: "complete", nodeId: "a", result: makeTaskResult(false) });

    const worker = state.workers.get("a");
    assert.equal(worker.status, "failed");
    assert.equal(state.completedNodes.has("a"), false);
    assert.equal(state.events[1].type, "worker_completed");
  });

  it("retries and then completes after failure", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "initialize", nodeId: "a", maxRetries: 2 });
    state = transitionWorker(state, { type: "start", nodeId: "a" });
    state = transitionWorker(state, { type: "complete", nodeId: "a", result: makeTaskResult(false) });

    // Retry
    state = transitionWorker(state, { type: "retry", nodeId: "a" });
    const workerAfterRetry = state.workers.get("a");
    assert.equal(workerAfterRetry.status, "retrying");
    assert.equal(workerAfterRetry.retryCount, 1);
    assert.equal(state.events[2].type, "worker_retrying");

    // Start again
    state = transitionWorker(state, { type: "start", nodeId: "a" });
    assert.equal(state.workers.get("a").status, "running");

    // Complete successfully
    state = transitionWorker(state, { type: "complete", nodeId: "a", result: makeTaskResult(true) });
    assert.equal(state.workers.get("a").status, "completed");
    assert.equal(state.completedNodes.has("a"), true);
  });

  it("returns unchanged state when retries are exhausted", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "initialize", nodeId: "a", maxRetries: 1 });
    state = transitionWorker(state, { type: "start", nodeId: "a" });
    state = transitionWorker(state, { type: "complete", nodeId: "a", result: makeTaskResult(false) });

    // First retry (count becomes 1)
    state = transitionWorker(state, { type: "retry", nodeId: "a" });
    assert.equal(state.workers.get("a").retryCount, 1);

    // Start again and fail
    state = transitionWorker(state, { type: "start", nodeId: "a" });
    state = transitionWorker(state, { type: "complete", nodeId: "a", result: makeTaskResult(false) });

    // Second retry should be blocked (count 2 >= maxRetries 1)
    const beforeRetry = state;
    state = transitionWorker(state, { type: "retry", nodeId: "a" });
    assert.equal(state.workers.get("a").retryCount, 1); // unchanged
    assert.equal(state.workers.get("a").status, "failed"); // still failed
    // state should be returned as-is (or effectively unchanged)
    assert.equal(state.events.length, beforeRetry.events.length);
  });

  it("fails a worker and records the error", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "initialize", nodeId: "a", maxRetries: 3 });
    state = transitionWorker(state, { type: "start", nodeId: "a" });
    state = transitionWorker(state, { type: "fail", nodeId: "a", error: "out of memory" });

    const worker = state.workers.get("a");
    assert.equal(worker.status, "failed");
    assert.equal(worker.error, "out of memory");
    assert.equal(state.events[1].type, "worker_failed");
    assert.equal(state.events[1].data.error, "out of memory");
  });

  it("records batch_complete event", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "batch_complete", batchIndex: 0, nodeIds: ["a", "b"] });

    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].type, "batch_completed");
    assert.equal(state.events[0].batchIndex, 0);
    assert.deepEqual(state.events[0].data.nodeIds, ["a", "b"]);
  });

  it("sets orchestration status to completed on orchestration_complete success", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "orchestration_complete", success: true });

    assert.equal(state.status, "completed");
    assert.ok(state.completedAt);
    assert.equal(state.events[0].type, "orchestration_completed");
    assert.equal(state.events[0].data.success, true);
  });

  it("sets orchestration status to failed on orchestration_complete failure", () => {
    let state = makeState();
    state = transitionWorker(state, { type: "orchestration_complete", success: false });

    assert.equal(state.status, "failed");
    assert.ok(state.completedAt);
    assert.equal(state.events[0].data.success, false);
  });
});

// ─── Helper functions ───────────────────────────────────────────────────────

describe("Worker helper functions", () => {
  function makeMixedState() {
    const workers = new Map([
      ["w1", { nodeId: "w1", status: "running", retryCount: 0, maxRetries: 3 }],
      ["w2", { nodeId: "w2", status: "completed", retryCount: 0, maxRetries: 3 }],
      ["w3", { nodeId: "w3", status: "completed", retryCount: 0, maxRetries: 3 }],
      ["w4", { nodeId: "w4", status: "failed", retryCount: 1, maxRetries: 3 }],
      ["w5", { nodeId: "w5", status: "idle", retryCount: 0, maxRetries: 3 }],
    ]);
    return makeState({ workers });
  }

  it("getRunningWorkerCount counts only running workers", () => {
    assert.equal(getRunningWorkerCount(makeMixedState()), 1);
  });

  it("getCompletedWorkerCount counts only completed workers", () => {
    assert.equal(getCompletedWorkerCount(makeMixedState()), 2);
  });

  it("getFailedWorkerCount counts only failed workers", () => {
    assert.equal(getFailedWorkerCount(makeMixedState()), 1);
  });
});

// ─── transitionNode ─────────────────────────────────────────────────────────

describe("transitionNode", () => {
  it("starts a node and sets status to running", () => {
    const node = makeNode();
    const next = transitionNode(node, { type: "start", startedAt: "2024-01-01T00:00:00.000Z" });

    assert.equal(next.status, "running");
    assert.equal(next.startedAt, "2024-01-01T00:00:00.000Z");
  });

  it("completes successfully and sets status to done", () => {
    const node = makeNode({ status: "running", startedAt: "2024-01-01T00:00:00.000Z" });
    const next = transitionNode(node, {
      type: "complete",
      completedAt: "2024-01-01T00:00:01.000Z",
      durationMs: 1000,
      success: true,
      retries: 1,
    });

    assert.equal(next.status, "done");
    assert.equal(next.completedAt, "2024-01-01T00:00:01.000Z");
    assert.equal(next.durationMs, 1000);
    assert.equal(next.retries, 1);
  });

  it("completes with failure and sets status to failed", () => {
    const node = makeNode({ status: "running" });
    const next = transitionNode(node, {
      type: "complete",
      completedAt: "2024-01-01T00:00:01.000Z",
      durationMs: 500,
      success: false,
      retries: 0,
    });

    assert.equal(next.status, "failed");
    assert.equal(next.durationMs, 500);
  });

  it("retries and sets status back to pending", () => {
    const node = makeNode({ status: "failed", retries: 1 });
    const next = transitionNode(node, { type: "retry", retries: 2 });

    assert.equal(next.status, "pending");
    assert.equal(next.retries, 2);
  });

  it("fails and sets status to failed", () => {
    const node = makeNode({ status: "running" });
    const next = transitionNode(node, {
      type: "fail",
      completedAt: "2024-01-01T00:00:02.000Z",
      error: "timeout",
    });

    assert.equal(next.status, "failed");
    assert.equal(next.completedAt, "2024-01-01T00:00:02.000Z");
  });

  it("does not mutate the original node object", () => {
    const node = makeNode({ status: "pending" });
    const originalStatus = node.status;
    const next = transitionNode(node, { type: "start", startedAt: "2024-01-01T00:00:00.000Z" });

    assert.equal(node.status, originalStatus); // original unchanged
    assert.equal(next.status, "running"); // new object changed
    assert.notStrictEqual(node, next); // different references
  });
});
