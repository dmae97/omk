import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { verifyCommand } = await import("../dist/commands/verify.js");

function git(projectRoot, args) {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("verify writes result.json and artifact bundle when diff/test/log evidence exists", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-verify-artifacts-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;

  try {
    git(projectRoot, ["init"]);
    await writeFile(join(projectRoot, "tracked.txt"), "before\n", "utf-8");
    git(projectRoot, ["add", "tracked.txt"]);
    git(projectRoot, ["-c", "user.email=test@example.com", "-c", "user.name=OMK Test", "commit", "-m", "init"]);
    await writeFile(join(projectRoot, "tracked.txt"), "after\n", "utf-8");
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2), "utf-8");

    const runId = "verify-artifacts-run";
    const runDir = join(projectRoot, ".omk", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "state.json"), JSON.stringify({
      schemaVersion: 1,
      runId,
      startedAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
      nodes: [
        {
          id: "worker-1",
          name: "Run focused change",
          role: "coder",
          status: "done",
          outputs: [
            { name: "summary", gate: "summary", ref: "## Summary" },
            { name: "tests", gate: "test-pass", ref: "npm test" },
          ],
        },
      ],
    }, null, 2), "utf-8");
    await writeFile(join(runDir, "summary.md"), "## Summary\n\nDone with evidence.\n", "utf-8");
    await writeFile(join(runDir, "events.jsonl"), '{"seq":1,"type":"worker.done"}\n', "utf-8");

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(" "));
    };
    try {
      await verifyCommand({ run: runId, json: true });
    } finally {
      console.log = originalLog;
    }

    const resultJson = JSON.parse(await readFile(join(runDir, "result.json"), "utf-8"));
    const verifyJson = JSON.parse(await readFile(join(runDir, "verify-result.json"), "utf-8"));
    const evidenceJson = JSON.parse(await readFile(join(runDir, "evidence.json"), "utf-8"));
    const diffPatch = await readFile(join(runDir, "artifacts", "generated-diff.patch"), "utf-8");
    const testLog = await readFile(join(runDir, "artifacts", "test.log"), "utf-8");

    assert.equal(resultJson.ok, true);
    assert.equal(verifyJson.ok, true);
    assert.equal(evidenceJson.missing, 0);
    assert.match(diffPatch, /tracked\.txt/);
    assert.match(testLog, /worker-1: npm test/);
    assert.ok(logs.join("\n").includes('"ok": true'));
  } finally {
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("verify fails when command-pass test evidence is missing", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-verify-missing-test-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;

  try {
    git(projectRoot, ["init"]);
    await writeFile(join(projectRoot, "tracked.txt"), "before\n", "utf-8");
    git(projectRoot, ["add", "tracked.txt"]);
    git(projectRoot, ["-c", "user.email=test@example.com", "-c", "user.name=OMK Test", "commit", "-m", "init"]);
    await writeFile(join(projectRoot, "tracked.txt"), "after\n", "utf-8");

    const runId = "verify-missing-test-run";
    const runDir = join(projectRoot, ".omk", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "state.json"), JSON.stringify({
      schemaVersion: 1,
      runId,
      startedAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
      nodes: [
        {
          id: "worker-1",
          name: "Run focused change",
          role: "coder",
          status: "done",
          outputs: [
            { name: "summary", gate: "summary", ref: "## Summary" },
          ],
        },
      ],
    }, null, 2), "utf-8");
    await writeFile(join(runDir, "summary.md"), "## Summary\n\nDone with evidence.\n", "utf-8");
    await writeFile(join(runDir, "events.jsonl"), '{"seq":1,"type":"worker.done"}\n', "utf-8");

    await assert.rejects(() => verifyCommand({ run: runId, json: true }), /Verification failed/);
    const resultJson = JSON.parse(await readFile(join(runDir, "result.json"), "utf-8"));
    assert.equal(resultJson.ok, false);
    assert.match(JSON.stringify(resultJson.errors), /test evidence missing/);
  } finally {
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    await rm(projectRoot, { recursive: true, force: true });
  }
});
