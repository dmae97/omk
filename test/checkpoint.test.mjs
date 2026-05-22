import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { restoreCheckpoint, saveCheckpoint } from "../dist/util/checkpoint.js";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("restoreCheckpoint refuses dirty worktree unless force is explicit", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-checkpoint-guard-"));
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  try {
    git(projectRoot, ["init"]);
    await writeFile(join(projectRoot, ".gitignore"), ".omk/\n", "utf-8");
    await writeFile(join(projectRoot, "app.txt"), "base\n", "utf-8");
    git(projectRoot, ["add", ".gitignore", "app.txt"]);
    git(projectRoot, ["-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-m", "base"]);

    await writeFile(join(projectRoot, "app.txt"), "checkpoint\n", "utf-8");
    const checkpoint = await saveCheckpoint("run-1", "before-risky-change");

    git(projectRoot, ["checkout", "--", "app.txt"]);
    await writeFile(join(projectRoot, "local.txt"), "untracked\n", "utf-8");

    const blocked = await restoreCheckpoint(checkpoint.checkpointId, "run-1");
    assert.equal(blocked.success, false);
    assert.match(blocked.message, /dirty worktree/i);
    assert.equal((await readFile(join(projectRoot, "app.txt"), "utf-8")).replace(/\r\n/g, "\n"), "base\n");

    const forced = await restoreCheckpoint(checkpoint.checkpointId, "run-1", { force: true });
    assert.equal(forced.success, true, forced.message);
    assert.equal((await readFile(join(projectRoot, "app.txt"), "utf-8")).replace(/\r\n/g, "\n"), "checkpoint\n");
  } finally {
    if (previousProjectRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    await rm(projectRoot, { recursive: true, force: true });
  }
});
