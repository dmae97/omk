import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundle the team + merge command sources with esbuild into temp files under
// node_modules/.cache (gitignored) so we verify the omk.contract.v1 JSON
// contract against TS SOURCE without a fresh `dist` build and without
// clobbering the shared `dist/` used by concurrent lanes.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
await mkdir(join(repoRoot, "node_modules", ".cache"), { recursive: true });
const bundleDir = await mkdtemp(join(repoRoot, "node_modules", ".cache", "omk-team-merge-test-"));

async function bundle(relSource, outName) {
  const outfile = join(bundleDir, outName);
  await build({
    entryPoints: [fileURLToPath(new URL(relSource, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const { teamCommand } = await bundle("../src/commands/team.ts", "team.mjs");
const { mergeCommand } = await bundle("../src/commands/merge.ts", "merge.mjs");

process.on("exit", () => {
  try {
    rmSync(bundleDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

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
  const dir = await mkdtemp(join(tmpdir(), "omk-team-merge-json-"));
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

function parseSingleStdoutJson(cap) {
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  assert.doesNotMatch(cap.stdout[0], ANSI_PATTERN, "stdout must not contain ANSI");
  return JSON.parse(cap.stdout[0]);
}

test("team --json emits one omk.contract.v1 envelope without spawning tmux", async () => {
  await withTempRoot(async () => {
    const cap = captureOutput();
    try {
      await teamCommand({ json: true, workers: "2", runId: "team-fixed" });
    } finally {
      cap.restore();
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.schemaVersion, "omk.contract.v1");
    assert.equal(env.command, "team");
    assert.equal(env.status, "passed");
    assert.equal(env.ok, true);
    assert.equal(env.runId, "team-fixed");
    assert.ok(env.metadata && typeof env.metadata.durationMs === "number");

    const data = env.data;
    assert.equal(data.teamId, "team-fixed");
    assert.ok(Array.isArray(data.members));
    // coordinator + 2 workers + reviewer
    assert.equal(data.members.length, 4);
    assert.equal(data.members[0].role, "coordinator");
    assert.ok(data.members.some((m) => m.role === "reviewer"));
    assert.equal(data.members.filter((m) => m.role === "worker").length, 2);
    assert.equal(typeof data.statePath, "string");

    assert.equal(cap.stderr.length, 0, "JSON mode must not write human/banner text to stderr");
  });
});

test("team --json detects the flag from process.argv (registration-agnostic)", async () => {
  await withTempRoot(async () => {
    const prevArgv = process.argv;
    process.argv = [...prevArgv, "--json"];
    const cap = captureOutput();
    try {
      await teamCommand({ workers: "1", runId: "team-argv" });
    } finally {
      cap.restore();
      process.argv = prevArgv;
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.command, "team");
    assert.equal(env.data.teamId, "team-argv");
    assert.equal(env.data.members.filter((m) => m.role === "worker").length, 1);
  });
});

test("merge --json emits a not-applicable envelope outside a git repo (no throw, no exit)", async () => {
  await withTempRoot(async () => {
    const cap = captureOutput();
    try {
      await mergeCommand({ json: true, strategy: "best", dryRun: true });
    } finally {
      cap.restore();
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.schemaVersion, "omk.contract.v1");
    assert.equal(env.command, "merge");
    assert.equal(env.status, "not-applicable");
    assert.equal(env.ok, false);

    const data = env.data;
    assert.equal(data.runId, null);
    assert.equal(data.strategy, "best");
    assert.equal(data.dryRun, true);
    assert.equal(data.merged, null);
    assert.deepEqual(data.conflicts, []);
    assert.equal(data.applied, 0);
    assert.ok(env.warnings.length >= 1);
    assert.notEqual(process.exitCode, 1, "merge JSON path must not set a failure exit code");
    assert.equal(cap.stderr.length, 0, "JSON mode must not write human/banner text to stderr");
  });
});

test("merge --json detects the flag from process.argv (registration-agnostic)", async () => {
  await withTempRoot(async () => {
    const prevArgv = process.argv;
    process.argv = [...prevArgv, "--json"];
    const cap = captureOutput();
    try {
      await mergeCommand({});
    } finally {
      cap.restore();
      process.argv = prevArgv;
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.command, "merge");
    assert.equal(env.data.strategy, "first");
  });
});
