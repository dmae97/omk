import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkCommand, runShell, runShellStreaming, which } from "../dist/util/shell.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(path, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf-8");
    } catch {
      await sleep(25);
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf-8");
      const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      if (state === "Z") return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function waitForPidExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPidAlive(pid))) return;
    await sleep(50);
  }
  assert.fail(`process ${pid} is still alive`);
}

function bestEffortKill(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

function descendantFixtureScript(pidPath) {
  return `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const child = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000);"], {
      stdio: "ignore"
    });
    child.unref();
    writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
    setInterval(() => {}, 1000);
  `;
}

function pipeHoldingGrandchildFixtureScript(pidPath) {
  return `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const child = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000);"], {
      stdio: ["ignore", "inherit", "ignore"]
    });
    writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
    child.unref();
    process.exit(0);
  `;
}

test("checkCommand detects node on PATH", async () => {
  assert.equal(await checkCommand("node"), true);
});

test("which resolves node on PATH", async () => {
  const result = await which("node");
  assert.equal(result.failed, false, result.stderr || result.stdout);
  assert.match(result.stdout, /node/i);
});


test("checkCommand and which accept absolute executable paths", async () => {
  assert.equal(await checkCommand(process.execPath), true);
  const result = await which(process.execPath);
  assert.equal(result.failed, false, result.stderr || result.stdout);
  assert.equal(result.stdout, process.execPath);
});

test("checkCommand returns false for missing commands", async () => {
  assert.equal(await checkCommand("omk-command-that-should-not-exist"), false);
});

test("runShellStreaming closes stdin when input is provided", async () => {
  const result = await runShellStreaming(
    process.execPath,
    ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('stdin-closed'));"],
    { input: "", timeout: 1000 }
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /stdin-closed/);
});

test("runShellStreaming timeout cleans descendant process tree", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "omk-shell-timeout-tree-"));
  const pidPath = join(tempDir, "child.pid");
  let childPid;
  try {
    const result = await runShellStreaming(
      process.execPath,
      ["--eval", descendantFixtureScript(pidPath)],
      { timeout: 250 }
    );
    childPid = Number((await readFile(pidPath, "utf-8")).trim());
    assert.equal(result.failed, true);
    assert.match(result.stderr, /timed out after 250ms/);
    await waitForPidExit(childPid);
  } finally {
    if (childPid) bestEffortKill(childPid);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runShell returns when parent exits and cleans pipe-holding descendant", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "omk-shell-parent-exit-"));
  const pidPath = join(tempDir, "child.pid");
  let childPid;
  try {
    const result = await runShell(
      process.execPath,
      ["--eval", pipeHoldingGrandchildFixtureScript(pidPath)],
      { timeout: 1000 }
    );
    childPid = Number((await readFile(pidPath, "utf-8")).trim());
    assert.equal(result.failed, false, result.stderr || result.stdout);
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.stderr, /timed out/);
    await waitForPidExit(childPid);
  } finally {
    if (childPid) bestEffortKill(childPid);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runShellStreaming returns when parent exits and cleans pipe-holding descendant", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "omk-shell-stream-parent-exit-"));
  const pidPath = join(tempDir, "child.pid");
  let childPid;
  try {
    const result = await runShellStreaming(
      process.execPath,
      ["--eval", pipeHoldingGrandchildFixtureScript(pidPath)],
      { timeout: 1000 }
    );
    childPid = Number((await readFile(pidPath, "utf-8")).trim());
    assert.equal(result.failed, false, result.stderr || result.stdout);
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.stderr, /timed out/);
    await waitForPidExit(childPid);
  } finally {
    if (childPid) bestEffortKill(childPid);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runShell abort cleans descendant process tree", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "omk-shell-abort-tree-"));
  const pidPath = join(tempDir, "child.pid");
  const ac = new AbortController();
  let childPid;
  try {
    const promise = runShell(
      process.execPath,
      ["--eval", descendantFixtureScript(pidPath)],
      { timeout: 5000, signal: ac.signal }
    );
    childPid = Number((await waitForFile(pidPath)).trim());
    ac.abort();
    const result = await promise;
    assert.equal(result.failed, true);
    assert.match(result.stderr, /aborted/);
    await waitForPidExit(childPid);
  } finally {
    if (childPid) bestEffortKill(childPid);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runShell redacts secret-looking output in results and logPath", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "omk-shell-redaction-"));
  const logPath = join(tempDir, "shell.log");
  const fakeToken = ["sk", "123456789012345678901234"].join("-");
  try {
    const result = await runShell(
      process.execPath,
      ["--eval", `console.log(${JSON.stringify(fakeToken)}); console.error("TOKEN=${fakeToken}")`],
      { logPath }
    );
    const logContent = await readFile(logPath, "utf-8");
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.stdout, new RegExp(fakeToken));
    assert.doesNotMatch(logContent, new RegExp(fakeToken));
    assert.match(`${result.stdout}\n${result.stderr}\n${logContent}`, /REDACTED/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runShell does not inherit ambient secret env by default", async () => {
  const previous = process.env.OMK_FAKE_SECRET_FOR_SHELL_TEST;
  process.env.OMK_FAKE_SECRET_FOR_SHELL_TEST = "fixture-secret-value";
  try {
    const result = await runShell(
      process.execPath,
      ["--eval", "console.log(process.env.OMK_FAKE_SECRET_FOR_SHELL_TEST || 'missing')"],
      { timeout: 1000 }
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "missing");
  } finally {
    if (previous === undefined) {
      delete process.env.OMK_FAKE_SECRET_FOR_SHELL_TEST;
    } else {
      process.env.OMK_FAKE_SECRET_FOR_SHELL_TEST = previous;
    }
  }
});

test("runShell ignores ambient OMK_SUDO without explicit CLI sudo request", async () => {
  const previousSudo = process.env.OMK_SUDO;
  const previousCliSudo = process.env.OMK_CLI_SUDO_REQUEST;
  process.env.OMK_SUDO = "1";
  delete process.env.OMK_CLI_SUDO_REQUEST;
  try {
    const result = await runShell(
      process.execPath,
      ["--eval", "console.log('ok')"],
      { timeout: 1000 }
    );
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), "ok");
  } finally {
    if (previousSudo === undefined) delete process.env.OMK_SUDO;
    else process.env.OMK_SUDO = previousSudo;
    if (previousCliSudo === undefined) delete process.env.OMK_CLI_SUDO_REQUEST;
    else process.env.OMK_CLI_SUDO_REQUEST = previousCliSudo;
  }
});

test("runShell refuses sudo for scriptable package managers", async () => {
  await assert.rejects(
    () => runShell("npm", ["--version"], { sudo: true }),
    /sudo allowlist/
  );
});
