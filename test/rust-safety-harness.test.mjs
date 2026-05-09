import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { validateRunArtifactPath } from "../dist/util/run-store.js";

function cargoAvailable() {
  return spawnSync("cargo", ["--version"], { encoding: "utf-8" }).status === 0;
}

function runSafety(args) {
  return spawnSync("cargo", ["run", "-q", "-p", "omk-safety", "--", ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 120000,
  });
}

test("Rust safety harness validates run IDs with the TS run-store contract", { skip: !cargoAvailable() }, () => {
  const ok = runSafety(["validate-run-id", "run-123"]);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.deepEqual(JSON.parse(ok.stdout), { ok: true, value: "run-123" });

  const traversal = runSafety(["validate-run-id", "../bad"]);
  assert.equal(traversal.status, 1);
  assert.equal(JSON.parse(traversal.stdout).ok, false);

  const reserved = runSafety(["validate-run-id", "latest"]);
  assert.equal(reserved.status, 1);
  assert.match(JSON.parse(reserved.stdout).error, /reserved/);
});

test("Rust safety harness sanitizes generated run IDs deterministically", { skip: !cargoAvailable() }, () => {
  const unsafe = runSafety(["sanitize-run-id", "cron:nightly/job", "cron"]);
  assert.equal(unsafe.status, 0, unsafe.stderr || unsafe.stdout);
  assert.deepEqual(JSON.parse(unsafe.stdout), { ok: true, value: "cron-nightly-job" });

  const fallback = runSafety(["sanitize-run-id", "latest", "run"]);
  assert.equal(fallback.status, 0, fallback.stderr || fallback.stdout);
  assert.deepEqual(JSON.parse(fallback.stdout), { ok: true, value: "run" });
});

test("Rust safety harness matches TS artifact path validation", { skip: !cargoAvailable() }, () => {
  const validArtifacts = ["state.json", "logs/node-1.log", "evidence_v1/report.md"];
  for (const artifact of validArtifacts) {
    const rust = runSafety(["validate-artifact-path", artifact]);
    assert.equal(rust.status, 0, rust.stderr || rust.stdout);
    assert.deepEqual(JSON.parse(rust.stdout), { ok: true, value: validateRunArtifactPath(artifact) });
  }

  const invalidArtifacts = ["../state.json", "logs/../state.json", "/etc/passwd", "C:\\tmp", "logs\\state.json", "bad:name.json"];
  for (const artifact of invalidArtifacts) {
    assert.throws(() => validateRunArtifactPath(artifact));
    const rust = runSafety(["validate-artifact-path", artifact]);
    assert.equal(rust.status, 1, `${artifact}: ${rust.stderr || rust.stdout}`);
    assert.equal(JSON.parse(rust.stdout).ok, false);
  }
});

test("Rust safety harness validates run artifact pairs", { skip: !cargoAvailable() }, () => {
  const ok = runSafety(["validate-run-artifact", "run-123", "logs/node-1.log"]);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.deepEqual(JSON.parse(ok.stdout), { ok: true, runId: "run-123", artifact: "logs/node-1.log" });

  const badRun = runSafety(["validate-run-artifact", "latest", "state.json"]);
  assert.equal(badRun.status, 1);
  assert.match(JSON.parse(badRun.stdout).error, /reserved/);

  const badArtifact = runSafety(["validate-run-artifact", "run-123", "../state.json"]);
  assert.equal(badArtifact.status, 1);
  assert.match(JSON.parse(badArtifact.stdout).error, /artifact path/);
});

test("Rust safety harness self-test and resolver expose native safety contract", { skip: !cargoAvailable() }, () => {
  const selfTest = runSafety(["self-test"]);
  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  assert.deepEqual(JSON.parse(selfTest.stdout), { ok: true, checks: 6 });

  const resolved = runSafety(["resolve-run-artifact", ".omk/runs", "run-123", "logs/node-1.log"]);
  assert.equal(resolved.status, 0, resolved.stderr || resolved.stdout);
  const parsed = JSON.parse(resolved.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.runId, "run-123");
  assert.equal(parsed.artifact, "logs/node-1.log");
  assert.match(parsed.path, /\.omk[/\\]runs[/\\]run-123[/\\]logs[/\\]node-1\.log$/);

  const traversal = runSafety(["resolve-run-artifact", ".omk/runs", "run-123", "../state.json"]);
  assert.equal(traversal.status, 1);
  assert.equal(JSON.parse(traversal.stdout).ok, false);
});
