import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Verify the `dag from-spec --json` contract against the TS SOURCE without a
// fresh `dist` build and without clobbering the shared `dist/` used by
// concurrent lanes. We bundle src/commands/dag-from-spec.ts with esbuild into a
// temp file under node_modules/.cache (gitignored; lets Node resolve
// externalized packages against repo node_modules).
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
await mkdir(join(repoRoot, "node_modules", ".cache"), { recursive: true });
const bundleDir = await mkdtemp(join(repoRoot, "node_modules", ".cache", "omk-dag-test-"));
const bundlePath = join(bundleDir, "dag-from-spec.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../src/commands/dag-from-spec.ts", import.meta.url))],
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
const { dagFromSpecCommand } = await import(pathToFileURL(bundlePath).href);

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
  const dir = await mkdtemp(join(tmpdir(), "omk-dag-json-"));
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

const TASKS_MD = `# Tasks

## Phase 1: Setup
- [ ] T001 Implement \`src/a.ts\`
- [ ] T002 [P] Test \`src/a.test.ts\`
  > depends on: T001

## Phase 2: Review
- [ ] T003 Review the change
  > depends on: T002
`;

test("dag from-spec --json emits one omk.contract.v1 envelope with command 'dag'", async () => {
  await withTempRoot(async (root) => {
    const specDir = join(root, "specs");
    await mkdir(specDir, { recursive: true });
    await writeFile(join(specDir, "tasks.md"), TASKS_MD, "utf-8");

    const cap = captureOutput();
    try {
      await dagFromSpecCommand(specDir, { json: true });
    } finally {
      cap.restore();
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.schemaVersion, "omk.contract.v1");
    assert.equal(env.command, "dag");
    assert.equal(env.status, "passed");
    assert.equal(env.ok, true);
    assert.equal(typeof env.traceId, "string");
    assert.ok(Array.isArray(env.warnings));
    assert.ok(Array.isArray(env.errors));
    assert.ok(env.metadata && typeof env.metadata.durationMs === "number");

    const data = env.data;
    assert.equal(data.inputId, specDir);
    assert.equal(data.nodes.length, 3, "inner dag artifact nodes preserved in data");
    assert.equal(data.nodes[0].id, "T001");
    // edges derived from dependsOn graph
    assert.ok(data.edges.some((e) => e.from === "T001" && e.to === "T002"));
    assert.ok(data.edges.some((e) => e.from === "T002" && e.to === "T003"));
    // batches are topological execution waves of node ids
    assert.ok(Array.isArray(data.batches));
    assert.deepEqual(data.batches[0], ["T001"]);
    assert.equal(data.stats.nodes, 3);
    assert.equal(data.stats.edges, data.edges.length);
    assert.equal(data.stats.batches, data.batches.length);

    assert.equal(cap.stderr.length, 0, "JSON mode must not write human/banner text to stderr");
  });
});

test("dag from-spec --json with missing tasks.md emits a not-applicable envelope (no throw)", async () => {
  await withTempRoot(async (root) => {
    const specDir = join(root, "missing-specs");
    const cap = captureOutput();
    try {
      await dagFromSpecCommand(specDir, { json: true });
    } finally {
      cap.restore();
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.schemaVersion, "omk.contract.v1");
    assert.equal(env.command, "dag");
    assert.equal(env.status, "not-applicable");
    assert.equal(env.ok, false);
    assert.deepEqual(env.data.nodes, []);
    assert.deepEqual(env.data.edges, []);
    assert.ok(env.warnings.some((w) => w.code === "RUN_ARTIFACT_MISSING"));
    assert.notEqual(process.exitCode, 1, "missing-spec JSON path must not set a failure exit code");
  });
});

test("dag from-spec --json detects the flag from process.argv (registration-agnostic)", async () => {
  await withTempRoot(async (root) => {
    const specDir = join(root, "specs");
    await mkdir(specDir, { recursive: true });
    await writeFile(join(specDir, "tasks.md"), TASKS_MD, "utf-8");

    const prevArgv = process.argv;
    process.argv = [...prevArgv, "--json"];
    const cap = captureOutput();
    try {
      await dagFromSpecCommand(specDir);
    } finally {
      cap.restore();
      process.argv = prevArgv;
    }

    const env = parseSingleStdoutJson(cap);
    assert.equal(env.command, "dag");
    assert.equal(env.data.nodes.length, 3);
  });
});
