import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { goalListCommand, goalShowCommand, goalVerifyCommand } from "../dist/commands/goal.js";
import { providerDeepSeekDisableCommand, providerDoctorCommand } from "../dist/commands/provider.js";
import { doctorCommand } from "../dist/commands/doctor.js";
import { mcpDoctorCommand } from "../dist/commands/mcp.js";
import { runsCommand } from "../dist/commands/runs.js";
import { screenshotDirCommand, screenshotListCommand } from "../dist/commands/screenshot.js";
import { verifyCommand } from "../dist/commands/verify.js";
import { reviewCommand } from "../dist/commands/workflow.js";
import { CliError } from "../dist/util/cli-contract.js"; 
import { resetKimiCapabilities } from "../dist/kimi/capability.js";

async function tempCwd() {
  const dir = await mkdtemp(join(tmpdir(), "omk-cli-"));
  await mkdir(join(dir, ".omk"), { recursive: true });
  return dir;
}


function setEnv(name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

function parseSingleStdoutJson(cap) {
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  return JSON.parse(cap.stdout[0]);
}

function captureOutput() {
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  return {
    stdout,
    stderr,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

// ── goal --json contract ──────────────────────────────────────

test("goal list --json skips alpha warning and outputs parseable JSON", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  try {
    await goalListCommand({ json: true });
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(Array.isArray(parsed), "should be an array");
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
  assert.ok(!cap.stdout[0].includes("alpha"), "should not contain alpha warning");
});

test("goal show --json on missing goal emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await goalShowCommand("nonexistent", { json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.ok(parsed.error.includes("not found"), "error should mention not found");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});

test("goal verify --json on missing goal emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await goalVerifyCommand("nonexistent", { json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});


// ── provider/deepseek --json contract ────────────────────────

test("provider deepseek disable --json emits parseable JSON without stderr", async () => {
  const cwd = await tempCwd();
  const restoreConfig = setEnv("OMK_PROVIDER_CONFIG_PATH", join(cwd, ".config", "omk", "providers.json"));
  const restoreSecrets = setEnv("OMK_SECRETS_ENV_PATH", join(cwd, ".config", "omk", "secrets.env"));
  const restoreOpenCodeSecrets = setEnv("OPENCODE_SECRETS_ENV_PATH", join(cwd, ".config", "opencode", "secrets.env"));
  const restoreDeepSeekKey = setEnv("DEEPSEEK_API_KEY", undefined);
  const cap = captureOutput();

  try {
    await providerDeepSeekDisableCommand("contract test", { json: true });
  } finally {
    cap.restore();
    restoreDeepSeekKey();
    restoreOpenCodeSecrets();
    restoreSecrets();
    restoreConfig();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.provider, "deepseek");
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.disabledReason, "contract test");
  assert.equal(parsed.disabledBy, "user");
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

test("provider doctor deepseek --json --soft is hermetic when disabled", async () => {
  const cwd = await tempCwd();
  const restoreConfig = setEnv("OMK_PROVIDER_CONFIG_PATH", join(cwd, ".config", "omk", "providers.json"));
  const restoreSecrets = setEnv("OMK_SECRETS_ENV_PATH", join(cwd, ".config", "omk", "secrets.env"));
  const restoreOpenCodeSecrets = setEnv("OPENCODE_SECRETS_ENV_PATH", join(cwd, ".config", "opencode", "secrets.env"));
  const restoreDeepSeekKey = setEnv("DEEPSEEK_API_KEY", undefined);
  const previousExitCode = process.exitCode;
  const cap = captureOutput();

  try {
    await providerDeepSeekDisableCommand("offline contract test", { json: false });
    cap.stdout.length = 0;
    cap.stderr.length = 0;
    await providerDoctorCommand("deepseek", { json: true, soft: true });
  } finally {
    cap.restore();
    process.exitCode = previousExitCode;
    restoreDeepSeekKey();
    restoreOpenCodeSecrets();
    restoreSecrets();
    restoreConfig();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.provider, "deepseek");
  assert.equal(parsed.available, false);
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.reason, "offline contract test");
  assert.equal(parsed.apiKeySet, false);
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

// ── screenshot --json contract ───────────────────────────────

test("screenshot dir --json emits project-local directory without stderr", async () => {
  const cwd = await tempCwd();
  const restoreRoot = setEnv("OMK_PROJECT_ROOT", cwd);
  const cap = captureOutput();

  try {
    await screenshotDirCommand({ json: true });
  } finally {
    cap.restore();
    restoreRoot();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.dir, join(cwd, ".omk", "screenshots"));
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

test("screenshot list --json emits saved screenshot metadata without stderr", async () => {
  const cwd = await tempCwd();
  const shotDir = join(cwd, ".omk", "screenshots", "2026-05-08");
  await mkdir(shotDir, { recursive: true });
  await writeFile(join(shotDir, "sample.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const restoreRoot = setEnv("OMK_PROJECT_ROOT", cwd);
  const cap = captureOutput();

  try {
    await screenshotListCommand({ json: true });
  } finally {
    cap.restore();
    restoreRoot();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].relativePath, ".omk/screenshots/2026-05-08/sample.png");
  assert.equal(parsed.entries[0].size, 4);
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

// ── mcp doctor --json contract ───────────────────────────────

test("mcp doctor --json emits common machine-readable fields", async () => {
  const cwd = await tempCwd();
  await mkdir(join(cwd, ".kimi"), { recursive: true });
  await writeFile(join(cwd, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
  const restoreRoot = setEnv("OMK_PROJECT_ROOT", cwd);
  const restoreHome = setEnv("HOME", cwd);
  const restoreOriginalHome = setEnv("OMK_ORIGINAL_HOME", cwd);
  const cap = captureOutput();
  const previousExitCode = process.exitCode;

  try {
    await mcpDoctorCommand({ json: true });
  } finally {
    cap.restore();
    process.exitCode = previousExitCode;
    restoreOriginalHome();
    restoreHome();
    restoreRoot();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.command, "mcp doctor");
  assert.match(parsed.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(parsed.errors));
  assert.ok(Array.isArray(parsed.warnings));
  assert.equal(parsed.data.activeScope, parsed.activeScope);
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

test("doctor --json does not flag absolute npm-global MCP binaries as npx launchers", async () => {
  const cwd = await tempCwd();
  const home = await mkdtemp(join(tmpdir(), "omk-doctor-home-"));
  await mkdir(join(home, ".kimi"), { recursive: true });
  await writeFile(
    join(home, ".kimi", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        "page-design-guide": {
          command: join(home, ".npm-global", "bin", "page-design-guide"),
          args: [],
        },
      },
    }),
    "utf-8",
  );
  await writeFile(join(home, ".kimi", "config.toml"), "default_model = \"kimi\"\n# >>> omk managed hooks\n", "utf-8");
  const restoreHome = setEnv("HOME", home);
  const restoreOriginalHome = setEnv("OMK_ORIGINAL_HOME", home);
  const prevCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const cap = captureOutput();

  process.chdir(cwd);
  try {
    await doctorCommand({ json: true, soft: true });
  } finally {
    cap.restore();
    process.exitCode = previousExitCode;
    process.chdir(prevCwd);
    restoreOriginalHome();
    restoreHome();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.globalSync.globalMcp, "1 MCPs synced (~/.kimi/mcp.json)");
  assert.equal(parsed.warnings.some((warning) => /npx-based/.test(warning.message)), false);
  assert.ok(!parsed.warnings.some((warning) => warning.name === "Global MCP (stdio)"));
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

test("doctor --json downgrades Kimi web-tools warning when agent YAML declares tools", async () => {
  const cwd = await tempCwd();
  const home = await mkdtemp(join(tmpdir(), "omk-doctor-web-home-"));
  const bin = join(home, "bin");
  await mkdir(join(cwd, ".omk", "agents"), { recursive: true });
  await mkdir(join(home, ".kimi"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(cwd, ".omk", "agents", "root.yaml"), `
version: 1
agent:
  name: test
  tools:
    - "kimi_cli.tools.web:SearchWeb"
    - "kimi_cli.tools.web:FetchURL"
`, "utf-8");
  await writeFile(join(home, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
  await writeFile(join(home, ".kimi", "config.toml"), "default_model = \"kimi\"\n# >>> omk managed hooks\n", "utf-8");
  await writeFile(join(bin, "kimi"), `#!/usr/bin/env sh
if [ "$1" = "--version" ]; then
  echo "kimi, version 1.41.0"
else
  echo "Usage: kimi [OPTIONS] COMMAND [ARGS]..."
  echo "  --agent-file FILE"
  echo "  web      Run Kimi Code CLI web interface."
fi
`, { mode: 0o755 });
  const restoreHome = setEnv("HOME", home);
  const restoreOriginalHome = setEnv("OMK_ORIGINAL_HOME", home);
  const restorePath = setEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
  const prevCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const cap = captureOutput();

  resetKimiCapabilities();
  process.chdir(cwd);
  try {
    await doctorCommand({ json: true, soft: true });
  } finally {
    cap.restore();
    process.exitCode = previousExitCode;
    process.chdir(prevCwd);
    restorePath();
    restoreOriginalHome();
    restoreHome();
    resetKimiCapabilities();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.kimi.webTools, false);
  assert.ok(!parsed.warnings.some((warning) => warning.name === "Kimi Web Tools"));
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

test("doctor --json classifies normal Kimi home files separately from pollution", async () => {
  const cwd = await tempCwd();
  const home = await mkdtemp(join(tmpdir(), "omk-doctor-pollution-home-"));
  await mkdir(join(home, ".kimi"), { recursive: true });
  for (const name of [
    "config.toml",
    "config.toml.bak",
    "mcp.json",
    "mcp.json.bak-20260508-102923",
    "mcp.manifest.json",
    "mcp.manifest.json.bak_stable_profile_20260507_094002",
    "omk.memory.toml",
    "kimi.json",
    "device_id",
    "latest_version.txt",
    "AGENTS.md",
    "setup.md",
    "user.md",
    "eggup-493323.json:Zone.Identifier",
  ]) {
    await writeFile(join(home, ".kimi", name), "ok", "utf-8");
  }
  const restoreHome = setEnv("HOME", home);
  const restoreOriginalHome = setEnv("OMK_ORIGINAL_HOME", home);
  const prevCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const cap = captureOutput();

  process.chdir(cwd);
  try {
    await doctorCommand({ json: true, soft: true });
  } finally {
    cap.restore();
    process.exitCode = previousExitCode;
    process.chdir(prevCwd);
    restoreOriginalHome();
    restoreHome();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.globalSync.globalPollution, "~/.kimi clean");
  assert.ok(!parsed.warnings.some((warning) => warning.name === "Global Pollution"));
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

test("doctor --json still warns for unexpected Kimi home pollution", async () => {
  const cwd = await tempCwd();
  const home = await mkdtemp(join(tmpdir(), "omk-doctor-polluted-home-"));
  await mkdir(join(home, ".kimi"), { recursive: true });
  await writeFile(join(home, ".kimi", "config.toml"), "default_model = \"kimi\"\n", "utf-8");
  await writeFile(join(home, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
  await writeFile(join(home, ".kimi", "debug-output.txt"), "unexpected", "utf-8");
  const restoreHome = setEnv("HOME", home);
  const restoreOriginalHome = setEnv("OMK_ORIGINAL_HOME", home);
  const prevCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const cap = captureOutput();

  process.chdir(cwd);
  try {
    await doctorCommand({ json: true, soft: true });
  } finally {
    cap.restore();
    process.exitCode = previousExitCode;
    process.chdir(prevCwd);
    restoreOriginalHome();
    restoreHome();
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.ok(parsed.warnings.some((warning) => warning.name === "Global Pollution"));
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

// ── runs --json contract ──────────────────────────────────────

test("runs --json on fresh project emits empty JSON array", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  const prevRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = cwd;
  process.chdir(cwd);
  const cap = captureOutput();

  try {
    await runsCommand({ json: true });
  } finally {
    cap.restore();
    process.chdir(prevCwd);
    if (prevRoot !== undefined) process.env.OMK_PROJECT_ROOT = prevRoot;
    else delete process.env.OMK_PROJECT_ROOT;
  }

  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(Array.isArray(parsed), "should be an array");
  assert.equal(parsed.length, 0, "should be empty");
});

// ── verify --json contract ────────────────────────────────────

test("verify --json with missing run emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await verifyCommand({ run: "missing-run", json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});

test("verify --json with missing run-id env emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  const prevRunId = process.env.OMK_RUN_ID;
  delete process.env.OMK_RUN_ID;
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await verifyCommand({ json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
    if (prevRunId !== undefined) process.env.OMK_RUN_ID = prevRunId;
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});

test("verify --json emits common machine-readable fields for a valid run", async () => {
  const cwd = await tempCwd();
  const runId = "json-contract-run";
  const runDir = join(cwd, ".omk", "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "state.json"), JSON.stringify({
    schemaVersion: 1,
    runId,
    status: "done",
    startedAt: "2026-05-08T00:00:00.000Z",
    completedAt: "2026-05-08T00:00:01.000Z",
    nodes: [],
  }), "utf-8");
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  try {
    await verifyCommand({ run: runId, json: true });
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  const parsed = parseSingleStdoutJson(cap);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "verify");
  assert.match(parsed.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.data.runId, runId);
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
});

// ── review --soft contract ────────────────────────────────────
// Note: review-options.test.mjs covers --ci --soft exit-code behavior in depth.
// The subprocess approach there correctly isolates OMK_PROJECT_ROOT.
