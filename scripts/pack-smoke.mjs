#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const stepTimeoutMs = Number.parseInt(process.env.OMK_PACK_SMOKE_TIMEOUT_MS ?? "", 10) || DEFAULT_STEP_TIMEOUT_MS;
const evidence = [];
let tarball;
let exitCode = 0;

function record(label, status, detail = "") {
  evidence.push({ label, status, detail });
}

function printEvidenceSummary() {
  console.log("\n## Pack Smoke Evidence");
  for (const item of evidence) {
    const icon = item.status === "pass" ? "PASS" : "FAIL";
    const detail = item.detail ? ` — ${item.detail}` : "";
    console.log(`- ${icon}: ${item.label}${detail}`);
  }
}

function buildIsolatedPackEnv() {
  const env = { ...process.env };
  if (!env.OMK_SMOKE_TMPDIR && process.platform === "linux") env.OMK_SMOKE_TMPDIR = "/tmp";
  const tmpRoot = env.OMK_SMOKE_TMPDIR || env.TMPDIR || env.TMP || env.TEMP;
  if (tmpRoot) {
    env.TMPDIR ??= tmpRoot;
    env.TMP ??= tmpRoot;
    env.TEMP ??= tmpRoot;
    env.npm_config_cache ??= `${tmpRoot.replace(/\/+$/, "")}/omk-npm-cache`;
  }
  return env;
}

function runNpmPack() {
  const result = spawnSync(npmCmd, ["pack", "--ignore-scripts", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: stepTimeoutMs,
    killSignal: "SIGKILL",
    env: buildIsolatedPackEnv(),
  });
  if (result.status !== 0) {
    record("npm pack", "fail", result.error?.message ?? `exit ${result.status ?? `signal ${result.signal}`}`);
    throw new Error("npm pack failed");
  }
  const packed = JSON.parse(result.stdout);
  const filename = packed?.[0]?.filename;
  if (!filename || typeof filename !== "string") {
    record("npm pack", "fail", "missing tarball filename");
    throw new Error("npm pack did not return a tarball filename.");
  }
  record("npm pack", "pass", filename);
  return filename;
}

function runNodeStep(label, args) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    timeout: stepTimeoutMs,
    killSignal: "SIGKILL",
    env: buildIsolatedPackEnv(),
  });
  if (result.status !== 0) {
    record(label, "fail", result.error?.message ?? `exit ${result.status ?? `signal ${result.signal}`}`);
    return false;
  }
  record(label, "pass");
  return true;
}

try {
  tarball = runNpmPack();
  console.log(`Packed ${tarball}`);

  const auditOk = runNodeStep("package audit", ["scripts/package-audit.mjs", "--tarball", tarball]);
  const smokeOk = auditOk
    ? runNodeStep("install smoke", ["scripts/smoke-test.mjs", "--tarball", tarball])
    : false;

  if (!auditOk || !smokeOk) exitCode = 1;
} catch (err) {
  exitCode = 1;
  console.error(err instanceof Error ? err.message : String(err));
} finally {
  printEvidenceSummary();
  if (tarball) rmSync(tarball, { force: true });
}

process.exit(exitCode);
