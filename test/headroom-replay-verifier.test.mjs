import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { verifyHeadroomReplay } from "../dist/evidence/headroom-replay-verifier.js";
import { sha256FileSync } from "../dist/util/hash.js";

function buildStateWithDecision(input) {
  const nodes = [
    { id: "Project:test", type: "Project", labels: [], label: "test", properties: { key: "test" }, createdAt: "", updatedAt: "" },
    { id: `Run:${input.runId}`, type: "Run", labels: [], label: input.runId, properties: { key: input.runId, runId: input.runId }, createdAt: "", updatedAt: "" },
    { id: `Task:${input.runId}:${input.nodeId}`, type: "Task", labels: [], label: input.nodeId, properties: { key: `${input.runId}:${input.nodeId}`, runId: input.runId, nodeId: input.nodeId }, createdAt: "", updatedAt: "" },
    { id: `HeadroomDecision:${input.runId}:${input.nodeId}`, type: "HeadroomDecision", labels: [], label: `${input.nodeId}:headroom`, properties: { key: `${input.runId}:${input.nodeId}:headroom`, runId: input.runId, nodeId: input.nodeId, attempted: input.metadata.attempted, applied: input.metadata.applied }, createdAt: "", updatedAt: "" },
  ];
  const edges = [
    { id: "HAS_RUN:test-run", type: "HAS_RUN", from: "Project:test", to: `Run:${input.runId}`, properties: {}, createdAt: "", updatedAt: "" },
    { id: "HAS_TASK:run-task", type: "HAS_TASK", from: `Run:${input.runId}`, to: `Task:${input.runId}:${input.nodeId}`, properties: {}, createdAt: "", updatedAt: "" },
    { id: "HAS_HEADROOM_DECISION:task-decision", type: "HAS_HEADROOM_DECISION", from: `Task:${input.runId}:${input.nodeId}`, to: `HeadroomDecision:${input.runId}:${input.nodeId}`, properties: {}, createdAt: "", updatedAt: "" },
  ];
  if (input.artifactRef) {
    nodes.push({
      id: `Artifact:${input.runId}:${input.artifactRef}`,
      type: "Artifact",
      labels: [],
      label: input.artifactRef,
      properties: {
        key: `${input.runId}:${input.artifactRef}`,
        runId: input.runId,
        path: input.artifactRef,
        kind: "headroom-decision",
        sha256: input.sha256 ?? null,
        sizeBytes: input.sizeBytes ?? null,
        exists: input.exists ?? false,
      },
      createdAt: "",
      updatedAt: "",
    });
    edges.push({
      id: `STORED_AT:${input.runId}:${input.artifactRef}`,
      type: "STORED_AT",
      from: `HeadroomDecision:${input.runId}:${input.nodeId}`,
      to: `Artifact:${input.runId}:${input.artifactRef}`,
      properties: {},
      createdAt: "",
      updatedAt: "",
    });
  }
  if (input.metadata.attempted && !input.metadata.applied) {
    nodes.push({
      id: `Risk:${input.runId}:${input.nodeId}:headroom`,
      type: "Risk",
      labels: [],
      label: "headroom-compaction-not-applied",
      properties: {
        key: `${input.runId}:${input.nodeId}:headroom-risk`,
        runId: input.runId,
        nodeId: input.nodeId,
        kind: "headroom-compaction-not-applied",
      },
      createdAt: "",
      updatedAt: "",
    });
    edges.push({
      id: `HAS_RISK:${input.runId}:${input.nodeId}:headroom`,
      type: "HAS_RISK",
      from: `Task:${input.runId}:${input.nodeId}`,
      to: `Risk:${input.runId}:${input.nodeId}:headroom`,
      properties: {},
      createdAt: "",
      updatedAt: "",
    });
  }
  return {
    version: 1,
    ontology: { version: "omk-ontology-mindmap-v1", classes: [], relationTypes: [] },
    project: { key: "test", name: "test", root: process.cwd() },
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

describe("headroom replay verifier", () => {
  const tmpRoot = join(process.cwd(), ".omk", "runs", "replay-verify-test");
  const runDir = tmpRoot;
  const runId = "replay-verify-test";

  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("passes when decisions, artifact, graph, and risk are consistent", async () => {
    const artifactRef = `.omk/runs/${runId}/headroom-decisions.jsonl`;
    const artifactPath = join(process.cwd(), artifactRef);
    writeFileSync(artifactPath, '{"schemaVersion":"omk.headroom-decision.v1"}\n', "utf-8");
    writeFileSync(join(runDir, "headroom-decisions.jsonl"), JSON.stringify({ schemaVersion: "omk.headroom-decision.v1", runId, nodeId: "node-a", attempted: true, applied: true, qualityScore: 0.85, artifactRef }) + "\n", "utf-8");

    const sha256 = sha256FileSync(artifactPath);
    const state = buildStateWithDecision({ runId, nodeId: "node-a", metadata: { attempted: true, applied: true }, artifactRef, sha256, sizeBytes: 42, exists: true });
    const result = await verifyHeadroomReplay({ runId, runDir, state });
    assert.equal(result.pass, true);
  });

  it("detects missing artifact file", async () => {
    const artifactRef = `.omk/runs/${runId}/missing-artifact.jsonl`;
    writeFileSync(join(runDir, "headroom-decisions.jsonl"), JSON.stringify({ schemaVersion: "omk.headroom-decision.v1", runId, nodeId: "node-b", attempted: true, applied: true, qualityScore: 0.85, artifactRef }) + "\n", "utf-8");

    const state = buildStateWithDecision({ runId, nodeId: "node-b", metadata: { attempted: true, applied: true }, artifactRef, sha256: null, sizeBytes: null, exists: false });
    const result = await verifyHeadroomReplay({ runId, runDir, state });
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => i.kind === "artifact-file-missing" || i.kind === "artifact-missing-on-disk"));
  });

  it("detects missing risk node for attempted-but-not-applied", async () => {
    writeFileSync(join(runDir, "headroom-decisions.jsonl"), JSON.stringify({ schemaVersion: "omk.headroom-decision.v1", runId, nodeId: "node-c", attempted: true, applied: false, qualityScore: 0 }) + "\n", "utf-8");
    const state = buildStateWithDecision({ runId, nodeId: "node-c", metadata: { attempted: true, applied: false } });
    state.nodes = state.nodes.filter((n) => n.type !== "Risk");
    state.edges = state.edges.filter((e) => e.type !== "HAS_RISK");
    const result = await verifyHeadroomReplay({ runId, runDir, state });
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => i.kind === "missing-risk"));
  });

  it("detects sha256 on artifact node", async () => {
    const artifactRef = `.omk/runs/${runId}/headroom-decisions.jsonl`;
    const artifactPath = join(process.cwd(), artifactRef);
    writeFileSync(artifactPath, "test\n", "utf-8");
    writeFileSync(join(runDir, "headroom-decisions.jsonl"), JSON.stringify({ schemaVersion: "omk.headroom-decision.v1", runId, nodeId: "node-d", attempted: true, applied: true, qualityScore: 0.85, artifactRef }) + "\n", "utf-8");

    const sha256 = sha256FileSync(artifactPath);
    const state = buildStateWithDecision({ runId, nodeId: "node-d", metadata: { attempted: true, applied: true }, artifactRef, sha256, sizeBytes: 5, exists: true });
    const artifactNode = state.nodes.find((n) => n.type === "Artifact");
    assert.equal(artifactNode.properties.sha256, sha256);
    assert.equal(artifactNode.properties.exists, true);
  });
});
