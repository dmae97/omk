import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Verify the contract against the TS SOURCE without a fresh `dist` build and
// without clobbering the shared `dist/` used by concurrent lanes. We bundle
// src/commands/summary.ts with esbuild into a temp file under node_modules/.cache
// (gitignored; lets Node resolve externalized packages against repo node_modules).
// A full-graph bundle elides type-only re-exports a per-file transpiler cannot.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
await mkdir(join(repoRoot, "node_modules", ".cache"), { recursive: true });
const bundleDir = await mkdtemp(join(repoRoot, "node_modules", ".cache", "omk-summary-test-"));
const bundlePath = join(bundleDir, "summary.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../src/commands/summary.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: bundlePath,
  logLevel: "silent",
});
process.on("exit", () => {
  try {
    rmSync(bundleDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});
const { summaryLatestCommand } = await import(pathToFileURL(bundlePath).href);

const ANSI_PATTERN = /\u001b\[[0-9;]*m/u;

function captureOutput() {
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  console.warn = (...args) => stderr.push(args.join(" "));
  return {
    stdout,
    stderr,
    restore() {
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
    },
  };
}

async function withTempRoot(fn) {
  const dir = await mkdtemp(join(tmpdir(), "omk-summary-json-"));
  const prevRoot = process.env.OMK_PROJECT_ROOT;
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  process.env.OMK_PROJECT_ROOT = dir;
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = prevExitCode;
    if (prevRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = prevRoot;
  }
}

async function writeRunState(root, runId, state) {
  const runDir = join(root, ".omk", "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "state.json"), JSON.stringify(state), "utf-8");
}

function parseSingleStdoutJson(cap) {
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  assert.doesNotMatch(cap.stdout[0], ANSI_PATTERN, "stdout must not contain ANSI");
  return JSON.parse(cap.stdout[0]);
}

test("summary --json emits exactly one omk.contract.v1 envelope with command 'summary'", async () => {
  await withTempRoot(async (root) => {
    await writeRunState(root, "run-json-contract", {
      schemaVersion: 1,
      runId: "run-json-contract",
      startedAt: "2026-05-08T00:00:00.000Z",
      completedAt: "2026-05-08T00:00:05.000Z",
      nodes: [
        {
          id: "n1",
          name: "implement",
          role: "coder",
          status: "done",
          retries: 0,
          attempts: [{ provider: "mimo" }],
          evidence: [{ gate: "test-pass", passed: true }],
        },
        { id: "n2", name: "review", role: "reviewer", status: "failed", retries: 1 },
      ],
    });

    const cap = captureOutput();
    try {
      await summaryLatestCommand({ json: true });
    } finally {
      cap.restore();
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.schemaVersion, "omk.contract.v1", "must be an omk.contract.v1 envelope");
    assert.equal(env.command, "summary");
    assert.equal(env.status, "passed");
    assert.equal(env.ok, true);
    assert.equal(typeof env.traceId, "string");
    assert.ok(Array.isArray(env.warnings));
    assert.ok(Array.isArray(env.errors));
    assert.ok(env.metadata && typeof env.metadata.durationMs === "number");

    const data = env.data;
    assert.equal(data.runId, "run-json-contract");
    assert.equal(data.status, "failed", "run rollup status reflects the failed node");
    assert.deepEqual(data.nodes, { total: 2, passed: 1, failed: 1 });
    assert.equal(typeof data.durationMs, "number");
    assert.equal(data.providerRoute.attempts, 1);
    assert.equal(data.providerRoute.byProvider.mimo, 1);
    assert.deepEqual(data.evidenceRefs, [{ nodeId: "n1", gate: "test-pass", passed: true }]);

    assert.equal(cap.stderr.length, 0, "JSON mode must not write human/banner text to stderr");
  });
});

test("summary --json with no runs emits a valid not-applicable envelope and exits 0", async () => {
  await withTempRoot(async () => {
    const cap = captureOutput();
    try {
      await summaryLatestCommand({ json: true });
    } finally {
      cap.restore();
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.schemaVersion, "omk.contract.v1");
    assert.equal(env.command, "summary");
    assert.equal(env.status, "not-applicable");
    assert.equal(env.ok, false);
    assert.equal(env.data.runId, null);
    assert.equal(env.data.status, "no-runs");
    assert.deepEqual(env.data.nodes, { total: 0, passed: 0, failed: 0 });
    assert.ok(env.warnings.some((w) => w.code === "RUN_ARTIFACT_MISSING"));
    assert.notEqual(process.exitCode, 1, "no-runs JSON path must not set a failure exit code");
  });
});

test("summary --json detects the flag from process.argv (registration-agnostic)", async () => {
  await withTempRoot(async (root) => {
    await writeRunState(root, "run-argv", {
      schemaVersion: 1,
      runId: "run-argv",
      startedAt: "2026-05-08T00:00:00.000Z",
      nodes: [{ id: "n1", name: "explore", role: "explorer", status: "done", retries: 0 }],
    });

    const prevArgv = process.argv;
    process.argv = [...prevArgv, "--json"];
    const cap = captureOutput();
    try {
      await summaryLatestCommand();
    } finally {
      cap.restore();
      process.argv = prevArgv;
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.command, "summary");
    assert.equal(env.data.runId, "run-argv");
    assert.equal(env.data.status, "passed");
  });
});
