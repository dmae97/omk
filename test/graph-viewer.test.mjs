import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGraphView, materializeEdges } from "../dist/memory/graph-viewer.js";

const CLI = join(process.cwd(), "dist", "cli.js");

test("graph viewer materializes relation lines and hides MemoryVersion by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omk-graph-view-"));
  const inputPath = join(dir, "graph-state.json");
  const outputPath = join(dir, "graph-view.html");

  try {
    await writeFile(inputPath, JSON.stringify(sampleGraphState(), null, 2));

    const result = await createGraphView({
      inputPath,
      outputPath,
      maxNodes: 20,
    });
    const html = await readFile(outputPath, "utf-8");

    assert.equal(result.nodeCount, 6);
    assert.ok(result.edgeCount >= 5);
    assert.match(html, /OMK Ontology Graph/);
    assert.match(html, /TOUCHES_FILE/);
    assert.match(html, /HAS_TASK/);
    assert.doesNotMatch(html, /MemoryVersion/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("graph viewer supports type filters and MemoryVersion opt-in", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omk-graph-filter-"));
  const inputPath = join(dir, "graph-state.json");
  const outputPath = join(dir, "graph-view.html");

  try {
    await writeFile(inputPath, JSON.stringify(sampleGraphState(), null, 2));

    const result = await createGraphView({
      inputPath,
      outputPath,
      typeFilter: ["Memory", "MemoryVersion", "File", "Topic"],
      includeMemoryVersions: true,
    });
    const html = await readFile(outputPath, "utf-8");

    assert.equal(result.nodeCount, 4);
    assert.match(html, /MemoryVersion/);
    assert.match(html, /UPDATES/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("materializeEdges preserves explicit graph-state edges and adds derived edges", () => {
  const state = sampleGraphState();
  const edges = materializeEdges(state, state.nodes.filter((node) => node.type !== "MemoryVersion"));

  assert.ok(edges.some((edge) => edge.source === "project" && edge.target === "session" && edge.type === "HAS_SESSION"));
  assert.ok(edges.some((edge) => edge.source === "memory" && edge.target === "file" && edge.type === "TOUCHES_FILE"));
});

test("materializeEdges expands audit trail links to runs and reports", () => {
  const state = sampleGraphState();
  state.nodes.push(
    { id: "run", type: "Run", label: "graph-audit-run" },
    {
      id: "run-relation",
      type: "Topic",
      label: "Run ID: graph-audit-run",
      properties: { generatedFrom: "memory" },
    },
    {
      id: "audit-link",
      type: "AuditLink",
      label: "Audit link: .omk/runs/graph-audit-run/report.md",
      properties: { generatedFrom: "memory" },
    },
    {
      id: "report",
      type: "File",
      label: ".omk/runs/graph-audit-run/report.md",
      path: ".omk/runs/graph-audit-run/report.md",
    }
  );

  const edges = materializeEdges(state, state.nodes.filter((node) => node.type !== "MemoryVersion"));

  assert.ok(edges.some((edge) => edge.source === "memory" && edge.target === "run" && edge.type === "HAS_RUN"));
  assert.ok(edges.some((edge) => edge.source === "memory" && edge.target === "audit-link" && edge.type === "HAS_AUDIT_LINK"));
  assert.ok(edges.some((edge) => edge.source === "memory" && edge.target === "report" && edge.type === "HAS_AUDIT_LINK"));
});

test("omk graph view CLI generates the requested output file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omk-graph-cli-"));
  const inputPath = join(dir, "graph-state.json");
  const outputPath = join(dir, "graph-view.html");

  try {
    await writeFile(inputPath, JSON.stringify(sampleGraphState(), null, 2));
    const result = spawnSync(
      process.execPath,
      [CLI, "graph", "view", "--input", inputPath, "--output", outputPath, "--limit", "10"],
      {
        cwd: process.cwd(),
        encoding: "utf-8",
        env: {
          ...process.env,
          OMK_STAR_PROMPT: "0",
          OMK_RENDER_LOGO: "0",
        },
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Graph HTML generated/);
    assert.match(await readFile(outputPath, "utf-8"), /cytoscape/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("graph-view slash command template is packaged", async () => {
  const template = await readFile("templates/skills/kimi/graph-view/SKILL.md", "utf-8");

  assert.match(template, /# \/graph-view/);
  assert.match(template, /omk graph view --open/);
});

function sampleGraphState() {
  return {
    ontology: {
      version: "omk-ontology-mindmap-v1",
      classes: ["Project", "Session", "Memory", "MemoryVersion", "Task", "Topic", "File"],
      relationTypes: ["HAS_SESSION", "HAS_MEMORY", "HAS_TASK", "TOUCHES_FILE", "UPDATES"],
    },
    project: { key: "test", name: "Graph Test", root: "/tmp/graph-test" },
    nodes: [
      { id: "project", type: "Project", label: "Graph Test" },
      { id: "session", type: "Session", label: "session-1" },
      { id: "memory", type: "Memory", label: "project.md", path: "project.md" },
      { id: "version", type: "MemoryVersion", label: "project.md version", path: "project.md" },
      {
        id: "task",
        type: "Task",
        label: "Implement graph viewer",
        properties: { generatedFrom: "memory" },
      },
      {
        id: "relation",
        type: "Topic",
        label: "TOUCHES_FILE: src/memory/graph-viewer.ts",
        properties: { generatedFrom: "memory" },
      },
      {
        id: "file",
        type: "File",
        label: "src/memory/graph-viewer.ts",
        path: "src/memory/graph-viewer.ts",
      },
    ],
    edges: [
      { id: "edge-session", type: "HAS_SESSION", from: "project", to: "session" },
      { id: "edge-memory", type: "HAS_MEMORY", from: "project", to: "memory" },
    ],
  };
}
