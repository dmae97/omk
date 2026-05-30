import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { buildInputEnvelope } = await import("../dist/input/input-envelope.js");
const { compileInputEnvelopeToDag } =
  await import("../dist/orchestration/dag-compiler.js");
const { persistDagCompileArtifacts, renderDagCompileReport } =
  await import("../dist/orchestration/dag-artifacts.js");

test("compileInputEnvelopeToDag creates a typed DAG compile result", async () => {
  const envelope = buildInputEnvelope({
    runId: "run-dag-compile",
    kind: "plain-prompt",
    raw: "tui harness tests 고도화하고 검증해줘",
    source: "chat",
    cwd: "/tmp/project",
    root: "/tmp/project",
    provider: "codex",
    model: "codex-cli",
    constraints: ["preserve untracked files"],
    requestedArtifacts: [
      {
        name: "test evidence",
        path: ".omk/runs/run-dag-compile/dag-compile-report.json",
      },
    ],
    now: () => new Date("2026-05-30T00:00:03.000Z"),
  });

  const compiled = await compileInputEnvelopeToDag({
    input: envelope,
    workerCount: 2,
  });

  assert.equal(compiled.schemaVersion, 1);
  assert.equal(compiled.inputId, envelope.inputId);
  assert.equal(compiled.runId, envelope.runId);
  assert.equal(compiled.workerCount, 2);
  assert.equal(compiled.dag.nodes.length, 1);
  assert.equal(compiled.dag.nodes[0].routing.provider, "codex");
  assert.equal(compiled.intent.targetSurfaces.includes("harness"), true);
  assert.equal(compiled.intentFrame.actionAtoms.length > 0, true);
});

test("persistDagCompileArtifacts writes DAG report intent and frame artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-dag-compiler-"));
  try {
    const envelope = buildInputEnvelope({
      runId: "run-dag-artifacts",
      kind: "plain-prompt",
      raw: "summarize repository state without edits",
      source: "chat",
      cwd: root,
      root,
      provider: "codex",
      now: () => new Date("2026-05-30T00:00:04.000Z"),
    });
    const compiled = await compileInputEnvelopeToDag({
      input: envelope,
      workerCount: 1,
    });
    const paths = await persistDagCompileArtifacts(compiled, { root });

    assert.equal(existsSync(paths.dagPath), true);
    assert.equal(existsSync(paths.reportPath), true);
    assert.equal(existsSync(join(paths.runDir, "intent-analysis.json")), true);
    assert.equal(existsSync(join(paths.runDir, "intent-frame.json")), true);
    const report = JSON.parse(await readFile(paths.reportPath, "utf8"));
    assert.equal(report.inputId, envelope.inputId);
    assert.equal(report.nodeCount, 1);
    assert.equal(report.nodes[0].readOnly, true);
    assert.deepEqual(renderDagCompileReport(compiled).nodeCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
