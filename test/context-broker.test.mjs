import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createContextBroker } from "../dist/runtime/context-broker.js";

function testNode() {
  return {
    id: "node-1",
    name: "Context Broker Test",
    role: "coder",
    dependsOn: [],
    status: "pending",
    retries: 0,
    maxRetries: 1,
    routing: { contextBudget: "small" },
  };
}

test("context broker fail-softs invalid graph memory into a summary fact", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-context-broker-invalid-"));
  const graphPath = join(projectRoot, ".omk", "memory", "graph-state.json");

  try {
    await mkdir(join(projectRoot, ".omk", "memory"), { recursive: true });
    await writeFile(graphPath, "{not-json", "utf-8");
    const broker = createContextBroker({ projectRoot, graphMemoryPath: graphPath });
    const { capsule } = await broker.buildCapsule(testNode());

    assert.equal(capsule.graphMemory.length, 1);
    assert.equal(capsule.graphMemory[0].subject, "graph-memory");
    assert.match(capsule.graphMemory[0].value, /Graph memory unavailable/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context broker summarizes oversized graph memory without parsing", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-context-broker-large-"));
  const graphPath = join(projectRoot, ".omk", "memory", "graph-state.json");

  try {
    await mkdir(join(projectRoot, ".omk", "memory"), { recursive: true });
    await writeFile(graphPath, "x".repeat(2 * 1024 * 1024 + 1), "utf-8");
    const broker = createContextBroker({ projectRoot, graphMemoryPath: graphPath });
    const { capsule } = await broker.buildCapsule(testNode());

    assert.equal(capsule.graphMemory.length, 1);
    assert.equal(capsule.graphMemory[0].subject, "graph-memory");
    assert.match(capsule.graphMemory[0].value, /above the .* parse limit/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
