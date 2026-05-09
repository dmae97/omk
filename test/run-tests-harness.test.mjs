import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const RUN_TESTS = join(process.cwd(), "scripts", "run-tests.mjs");

function withTempProject(fn) {
  const root = mkdtempSync(join(tmpdir(), "omk-run-tests-"));
  try {
    mkdirSync(join(root, "test"), { recursive: true });
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runHarness(root, args = []) {
  return spawnSync(process.execPath, [RUN_TESTS, ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

test("run-tests removes stale failed-tests log after a fully passing run", () => {
  withTempProject((root) => {
    writeFileSync(join(root, "failed-tests.txt"), "stale.test.mjs\n", "utf-8");
    writeFileSync(join(root, "test", "pass.test.mjs"), 'import test from "node:test"; test("ok", () => {});\n', "utf-8");

    const result = runHarness(root);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Passed:\s+1/);
    assert.equal(existsSync(join(root, "failed-tests.txt")), false);
    assert.equal(existsSync(join(root, "test-summary.json")), false);
  });
});

test("run-tests refreshes failed-tests log with only current failures", () => {
  withTempProject((root) => {
    writeFileSync(join(root, "failed-tests.txt"), "stale.test.mjs\n", "utf-8");
    writeFileSync(join(root, "test", "pass.test.mjs"), 'import test from "node:test"; test("ok", () => {});\n', "utf-8");
    writeFileSync(
      join(root, "test", "fail.test.mjs"),
      'throw new Error("boom");\n',
      "utf-8"
    );

    const result = runHarness(root);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const failed = readFileSync(join(root, "failed-tests.txt"), "utf-8");
    assert.match(failed, new RegExp(`test[${sep === "\\" ? "\\\\" : sep}]fail\\.test\\.mjs`));
    assert.doesNotMatch(failed, /stale/);
    const summary = JSON.parse(readFileSync(join(root, "test-summary.json"), "utf-8"));
    assert.equal(summary.ok, false);
    assert.equal(summary.totalFiles, 2);
    assert.equal(summary.failed, 1);
    assert.deepEqual(summary.failedFiles, [join("test", "fail.test.mjs")]);
    assert.equal(summary.results.find((entry) => entry.file === join("test", "fail.test.mjs")).status, "failed");
  });
});

test("run-tests fails actionably when no test files are present", () => {
  withTempProject((root) => {
    const result = runHarness(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No test files found in test/);
    const summary = JSON.parse(readFileSync(join(root, "test-summary.json"), "utf-8"));
    assert.equal(summary.ok, false);
    assert.equal(summary.error, "No test files found in test");
  });
});


test("run-tests writes optional JSON summary after a passing run", () => {
  withTempProject((root) => {
    writeFileSync(join(root, "test", "pass.test.mjs"), 'import test from "node:test"; test("ok", () => {});\n', "utf-8");

    const result = spawnSync(process.execPath, [RUN_TESTS, "--summary-json", "custom-summary.json"], {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(readFileSync(join(root, "custom-summary.json"), "utf-8"));
    assert.equal(summary.ok, true);
    assert.equal(summary.totalFiles, 1);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 0);
  });
});

test("run-tests --only-failed reruns only the failed-tests manifest", () => {
  withTempProject((root) => {
    writeFileSync(join(root, "failed-tests.txt"), `${join("test", "pass.test.mjs")}\n`, "utf-8");
    writeFileSync(join(root, "test", "pass.test.mjs"), 'import test from "node:test"; test("ok", () => {});\n', "utf-8");
    writeFileSync(join(root, "test", "fail.test.mjs"), 'throw new Error("should not run");\n', "utf-8");

    const result = runHarness(root, ["--only-failed", "--summary-json", "retry-summary.json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Total files:\s+1/);
    assert.doesNotMatch(result.stdout, /fail\.test\.mjs/);
    assert.equal(existsSync(join(root, "failed-tests.txt")), false);
    const summary = JSON.parse(readFileSync(join(root, "retry-summary.json"), "utf-8"));
    assert.equal(summary.mode, "only-failed");
    assert.equal(summary.totalFiles, 1);
    assert.equal(summary.ok, true);
  });
});

test("run-tests --only-failed rejects unsafe manifest paths", () => {
  withTempProject((root) => {
    writeFileSync(join(root, "failed-tests.txt"), "../secret.test.mjs\n", "utf-8");
    writeFileSync(join(root, "test", "pass.test.mjs"), 'import test from "node:test"; test("ok", () => {});\n', "utf-8");

    const result = runHarness(root, ["--only-failed"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid failed test path/);
  });
});

test("run-tests --match filters the discovered test set", () => {
  withTempProject((root) => {
    writeFileSync(join(root, "test", "alpha.test.mjs"), 'import test from "node:test"; test("ok", () => {});\n', "utf-8");
    writeFileSync(join(root, "test", "beta.test.mjs"), 'throw new Error("should not run");\n', "utf-8");

    const result = runHarness(root, ["--match", "alpha", "--summary-json", "match-summary.json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Total files:\s+1/);
    assert.doesNotMatch(result.stdout, /beta\.test\.mjs/);
    const summary = JSON.parse(readFileSync(join(root, "match-summary.json"), "utf-8"));
    assert.equal(summary.filters.match, "alpha");
    assert.deepEqual(summary.results.map((entry) => entry.file), [join("test", "alpha.test.mjs")]);
  });
});

test("run-tests summary records MCP, skill, and hook harness resources without names or secrets", () => {
  withTempProject((root) => {
    mkdirSync(join(root, ".omk"), { recursive: true });
    mkdirSync(join(root, ".kimi"), { recursive: true });
    mkdirSync(join(root, ".agents", "skills", "project-skill"), { recursive: true });
    mkdirSync(join(root, ".kimi", "skills", "kimi-skill"), { recursive: true });
    mkdirSync(join(root, ".omk", "hooks"), { recursive: true });
    mkdirSync(join(root, ".kimi", "hooks"), { recursive: true });
    writeFileSync(join(root, ".omk", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": {}, railway: {} } }), "utf-8");
    writeFileSync(join(root, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": {}, github: {} } }), "utf-8");
    writeFileSync(join(root, ".agents", "skills", "project-skill", "SKILL.md"), "---\nname: project-skill\n---\n", "utf-8");
    writeFileSync(join(root, ".kimi", "skills", "kimi-skill", "SKILL.md"), "---\nname: kimi-skill\n---\n", "utf-8");
    writeFileSync(join(root, ".omk", "hooks", "pre-shell-guard.sh"), "#!/usr/bin/env sh\n", "utf-8");
    writeFileSync(join(root, ".kimi", "hooks", "stop-verify.sh"), "#!/usr/bin/env sh\n", "utf-8");
    writeFileSync(join(root, ".omk", "kimi.config.toml"), '[[hooks]]\nevent = "PreToolUse"\n[[hooks]]\nevent = "Stop"\n', "utf-8");
    writeFileSync(join(root, "test", "pass.test.mjs"), 'import test from "node:test"; test("ok", () => {});\n', "utf-8");

    const result = runHarness(root, ["--summary-json", "resource-summary.json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summaryRaw = readFileSync(join(root, "resource-summary.json"), "utf-8");
    const summary = JSON.parse(summaryRaw);
    assert.equal(summary.resources.mcpServers, 3);
    assert.equal(summary.resources.skills, 2);
    assert.equal(summary.resources.hooks, 2);
    assert.equal(summary.resources.hookEvents, 2);
    assert.equal(summary.resources.files.mcpConfigs, 2);
    assert.doesNotMatch(summaryRaw, /railway|github|project-skill|kimi-skill|pre-shell-guard|stop-verify/);
  });
});
