import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cliPath = resolve("dist/cli.js");

function tempProject() {
  const cwd = mkdtempSync(join(tmpdir(), "omk-cli-v2-gate-"));
  mkdirSync(join(cwd, ".omk"), { recursive: true });
  return cwd;
}

function runCli(args, extraEnv = {}) {
  const cwd = tempProject();
  try {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        OMK_PROJECT_ROOT: cwd,
        NO_COLOR: "1",
        FORCE_COLOR: undefined,
        ...extraEnv,
      },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("CLI v2 envelope runtime is opt-in and does not shadow Commander workflows by default", () => {
  const result = runCli(["run", "definitely-missing-flow", "goal"]);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, "default run command should stay on existing Commander workflow path");
  assert.doesNotMatch(output, /"placeholder"\s*:\s*true/u);
  assert.doesNotMatch(output, /"command"\s*:\s*"run"/u);
});

test("CLI v2 envelope runtime can still be enabled explicitly", () => {
  const result = runCli(["run", "smoke goal"], { OMK_CLI_V2: "1" });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.result.placeholder, true);
});
