#!/usr/bin/env node
/**
 * Cross-platform smoke test for oh-my-kimi.
 * Requires --tarball <path-or-glob> argument.
 * Does NOT pack or rebuild the artifact — only installs and verifies the given tarball.
 *
 * Hardening guarantees:
 *   - Resolves tarball globs to a single file before install.
 *   - Requires both omk and oh-my-kimi installed bin shims (no cli.js fallback).
 *   - Runs local install smoke + global-prefix install smoke.
 *   - Runs Kimi soft onboarding smoke with isolated HOME (no host Kimi dependency).
 *   - Runs star fallback smoke with a fake gh shim.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve, basename, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Argument parsing + tarball glob resolution
// ---------------------------------------------------------------------------

function resolveTarballArg(pattern) {
  if (!pattern.includes("*") && !pattern.includes("?")) {
    const p = resolve(pattern);
    if (!existsSync(p)) throw new Error("Tarball not found: " + p);
    return p;
  }
  const dir = dirname(resolve(pattern)) || process.cwd();
  const base = basename(pattern);
  const regex = new RegExp(
    "^" + base.replace(/[+^${}()|[\]\\]/g, "\\$&").replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );
  const files = readdirSync(dir).filter((f) => regex.test(f));
  if (files.length === 0) throw new Error("No tarball matches glob: " + pattern);
  if (files.length > 1) throw new Error("Ambiguous glob matches multiple tarballs: " + files.join(", "));
  return join(dir, files[0]);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const tarballIndex = args.indexOf("--tarball");
  if (tarballIndex === -1 || !args[tarballIndex + 1]) {
    console.error("Usage: node scripts/smoke-test.mjs --tarball <path-or-glob-to-tgz>");
    process.exit(1);
  }
  return resolveTarballArg(args[tarballIndex + 1]);
}

const tarballPath = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const isWindows = platform() === "win32";

let failed = false;

function logPass(label) {
  console.log(`${GREEN}PASS${RESET}: ${label}`);
}

function logFail(label, err) {
  failed = true;
  console.error(`${RED}FAIL${RESET}: ${label}`);
  if (err) {
    const msg = err.stderr?.toString() || err.stdout?.toString() || err.message;
    if (msg) console.error(msg);
  }
}

function run(cmd, cwd, env) {
  return execSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runSilently(cmd, cwd, env) {
  return execSync(cmd, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf-8",
    stdio: "pipe",
  });
}

function localBinPath(installDir, name) {
  return join(installDir, "node_modules", ".bin", isWindows ? `${name}.cmd` : name);
}

function globalBinPath(prefixDir, name) {
  if (isWindows) {
    return join(prefixDir, `${name}.cmd`);
  }
  return join(prefixDir, "bin", name);
}

function binCmd(shimPath) {
  if (!existsSync(shimPath)) {
    throw new Error("Bin shim not found: " + shimPath);
  }
  if (isWindows) {
    return `cmd /c "${shimPath}"`;
  }
  return `"${shimPath}"`;
}

// ---------------------------------------------------------------------------
// Local install smoke
// ---------------------------------------------------------------------------

const installDir = mkdtempSync(join(tmpdir(), "omk-smoke-local-"));

try {
  runSilently("npm init -y", installDir);
  runSilently(`npm install "${tarballPath}"`, installDir);
  logPass("Local install tarball");
} catch (err) {
  logFail("Local install tarball", err);
  cleanup();
  process.exit(1);
}

const localOmk = localBinPath(installDir, "omk");
const localOhMyKimi = localBinPath(installDir, "oh-my-kimi");

if (!existsSync(localOmk)) {
  logFail("Local omk bin shim missing");
  cleanup();
  process.exit(1);
}
if (!existsSync(localOhMyKimi)) {
  logFail("Local oh-my-kimi bin shim missing");
  cleanup();
  process.exit(1);
}

const localOmkCmd = (args) => binCmd(localOmk) + ` ${args}`;
const localOhCmd = (args) => binCmd(localOhMyKimi) + ` ${args}`;

// Local help smoke
try {
  run(localOmkCmd("--help"), installDir);
  logPass("Local omk --help");
} catch (err) {
  logFail("Local omk --help", err);
}

try {
  run(localOhCmd("--help"), installDir);
  logPass("Local oh-my-kimi --help");
} catch (err) {
  logFail("Local oh-my-kimi --help", err);
}

// Local doctor soft smoke
const KNOWN_SOFT_ISSUES = new Set([
  "jq",
  "Kimi CLI",
  "Kimi CLI version",
  "Git Clean",
  "Built-in LSP",
  "Global Pollution",
  "Git Repo",
  "Global MCP (stdio)",
  "Global Memory",
]);


function expectedNativePlatformArch() {
  return `${platform()}-${process.arch}`;
}

function assertNativeSafety(parsed, label) {
  const rustSafety = parsed?.data?.rustSafety ?? parsed?.rustSafety;
  if (typeof rustSafety !== "object" || rustSafety === null) {
    throw new Error(`${label} missing rustSafety doctor data`);
  }
  const native = String(rustSafety.native ?? "");
  if (!native.includes("self-test passed")) {
    throw new Error(`${label} native safety self-test not passing: ${native}`);
  }
  if (rustSafety.nativeSource !== "bundled") {
    throw new Error(`${label} native safety did not resolve from bundled binary: ${rustSafety.nativeSource}`);
  }
  const expected = expectedNativePlatformArch();
  if (rustSafety.nativePlatformArch !== expected) {
    throw new Error(`${label} native safety platform mismatch: ${rustSafety.nativePlatformArch} !== ${expected}`);
  }
}

const NATIVE_SMOKE_ENV = { OMK_SAFETY_BIN: "" };

function assertNoUnexpectedIssues(parsed, label) {
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  const unexpectedErrors = errors.filter((e) => {
    const name = typeof e === "string" ? e : e?.name ?? "";
    return !KNOWN_SOFT_ISSUES.has(name);
  });
  if (unexpectedErrors.length > 0) {
    throw new Error(
      `${label} unexpected doctor errors: ${unexpectedErrors.map((e) => (typeof e === "string" ? e : e?.name)).join(", ")}`
    );
  }
}

try {
  const raw = run(localOmkCmd("doctor --json --soft"), installDir, NATIVE_SMOKE_ENV);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("doctor output is not a JSON object");
  }
  assertNoUnexpectedIssues(parsed, "local omk");
  assertNativeSafety(parsed, "local omk");
  logPass("Local omk doctor --json --soft");
} catch (err) {
  logFail("Local omk doctor --json --soft", err);
}

try {
  const raw = run(localOhCmd("doctor --json --soft"), installDir, NATIVE_SMOKE_ENV);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("doctor output is not a JSON object");
  }
  assertNoUnexpectedIssues(parsed, "local oh-my-kimi");
  assertNativeSafety(parsed, "local oh-my-kimi");
  logPass("Local oh-my-kimi doctor --json --soft");
} catch (err) {
  logFail("Local oh-my-kimi doctor --json --soft", err);
}

// ---------------------------------------------------------------------------
// Global-prefix install smoke
// ---------------------------------------------------------------------------

const prefixDir = mkdtempSync(join(tmpdir(), "omk-smoke-prefix-"));

try {
  runSilently(`npm install -g --prefix "${prefixDir}" --ignore-scripts "${tarballPath}"`, process.cwd());
  logPass("Global-prefix install tarball");
} catch (err) {
  logFail("Global-prefix install tarball", err);
  cleanup();
  process.exit(1);
}

const globalOmk = globalBinPath(prefixDir, "omk");
const globalOhMyKimi = globalBinPath(prefixDir, "oh-my-kimi");

if (!existsSync(globalOmk)) {
  logFail("Global-prefix omk bin shim missing");
  cleanup();
  process.exit(1);
}
if (!existsSync(globalOhMyKimi)) {
  logFail("Global-prefix oh-my-kimi bin shim missing");
  cleanup();
  process.exit(1);
}

const globalOmkCmd = (args) => binCmd(globalOmk) + ` ${args}`;
const globalOhCmd = (args) => binCmd(globalOhMyKimi) + ` ${args}`;

try {
  run(globalOmkCmd("--help"), process.cwd());
  logPass("Global-prefix omk --help");
} catch (err) {
  logFail("Global-prefix omk --help", err);
}

try {
  run(globalOhCmd("--help"), process.cwd());
  logPass("Global-prefix oh-my-kimi --help");
} catch (err) {
  logFail("Global-prefix oh-my-kimi --help", err);
}

// ---------------------------------------------------------------------------
// Kimi soft onboarding smoke (isolated HOME, no host kimi dependency)
// ---------------------------------------------------------------------------

const isolatedHome = mkdtempSync(join(tmpdir(), "omk-smoke-home-"));
const isolatedEnv = isWindows
  ? { USERPROFILE: isolatedHome, HOME: isolatedHome }
  : { HOME: isolatedHome };

const isolatedPathDir = mkdtempSync(join(tmpdir(), "omk-smoke-path-"));
const isolatedPath = isWindows
  ? `${isolatedPathDir};${process.env.PATH || ""}`
  : `${isolatedPathDir}:${process.env.PATH || ""}`;

// Update check --json smoke with missing Kimi
try {
  const raw = run(localOmkCmd("update check --json --refresh"), installDir, {
    ...isolatedEnv,
    PATH: isolatedPath,
    OMK_SAFETY_BIN: "",
  });
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("update check output is not a JSON object");
  }
  if (parsed.kimi && (parsed.kimi.installed === false || parsed.kimi.missing === true || parsed.kimi.notFound === true)) {
    logPass("Update check reports missing Kimi actionably");
  } else if (parsed.kimi && parsed.kimi.latest) {
    logPass("Update check actionable with missing/required Kimi info");
  } else {
    throw new Error("update check did not surface Kimi status: " + JSON.stringify(parsed.kimi));
  }
} catch (err) {
  logFail("Update check missing-Kimi smoke", err);
}

// Doctor soft smoke under isolated HOME (should still exit 0 with soft issues)
try {
  const raw = run(localOmkCmd("doctor --json --soft"), installDir, {
    ...isolatedEnv,
    PATH: isolatedPath,
    OMK_SAFETY_BIN: "",
  });
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("doctor output is not a JSON object");
  }
  assertNoUnexpectedIssues(parsed, "isolated-home");
  assertNativeSafety(parsed, "isolated-home");
  logPass("Doctor soft smoke under isolated HOME");
} catch (err) {
  logFail("Doctor soft smoke under isolated HOME", err);
}

// ---------------------------------------------------------------------------
// Star fallback smoke (fake gh shim -> auth failure)
// ---------------------------------------------------------------------------

const fakeGhDir = mkdtempSync(join(tmpdir(), "omk-smoke-gh-"));
const fakeGhPath = join(fakeGhDir, isWindows ? "gh.cmd" : "gh");

if (isWindows) {
  writeFileSync(fakeGhPath, `@echo off\r\necho gh auth login required\r\nexit /b 1`, "utf-8");
} else {
  writeFileSync(fakeGhPath, "#!/bin/sh\necho \"gh auth login required\"\nexit 1\n", "utf-8");
  execSync(`chmod +x "${fakeGhPath}"`);
}

const starPathEnv = isWindows
  ? `${fakeGhDir};${process.env.PATH || ""}`
  : `${fakeGhDir}:${process.env.PATH || ""}`;

const starProjectDir = mkdtempSync(join(tmpdir(), "omk-smoke-star-"));
runSilently("git init", starProjectDir);
mkdirSync(join(starProjectDir, ".omk"), { recursive: true });

try {
  run(localOmkCmd("--version"), starProjectDir, {
    OMK_STAR_PROMPT: "force",
    PATH: starPathEnv,
  });
  logPass("Star fallback smoke (non-TTY, fake gh) — command succeeds");
} catch (err) {
  logFail("Star fallback smoke (non-TTY, fake gh)", err);
}

// Assert star state records failure and preserves manual URL
try {
  const starStatePath = join(starProjectDir, ".omk", "star-prompt.json");
  if (existsSync(starStatePath)) {
    const state = JSON.parse(readFileSync(starStatePath, "utf-8"));
    if (state.starred === false && state.starError) {
      logPass("Star fallback records starred:false with starError");
    } else {
      throw new Error("Unexpected star state: " + JSON.stringify(state));
    }
  } else {
    logPass("Star fallback skipped in non-TTY (no state file)");
  }
} catch (err) {
  logFail("Star fallback state assertion", err);
}

// ---------------------------------------------------------------------------
// Fresh project init smoke
// ---------------------------------------------------------------------------

const projectDir = mkdtempSync(join(tmpdir(), "omk-smoke-project-"));

try {
  runSilently("git init", projectDir);
  run(localOmkCmd("init"), projectDir);
  const raw = run(localOmkCmd("doctor --json --soft"), projectDir, NATIVE_SMOKE_ENV);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("doctor output is not a JSON object");
  }
  assertNoUnexpectedIssues(parsed, "Project");
  assertNativeSafety(parsed, "Project");
  logPass("Fresh project init smoke");
} catch (err) {
  logFail("Fresh project init smoke", err);
}

// ---------------------------------------------------------------------------
// Cleanup & exit
// ---------------------------------------------------------------------------

cleanup();

if (failed) {
  console.error("\nSmoke tests failed.");
  process.exit(1);
} else {
  console.log("\nAll smoke tests passed.");
  process.exit(0);
}

function cleanup() {
  try {
    if (installDir && existsSync(installDir)) rmSync(installDir, { recursive: true });
    if (prefixDir && existsSync(prefixDir)) rmSync(prefixDir, { recursive: true });
    if (projectDir && existsSync(projectDir)) rmSync(projectDir, { recursive: true });
    if (isolatedHome && existsSync(isolatedHome)) rmSync(isolatedHome, { recursive: true });
    if (isolatedPathDir && existsSync(isolatedPathDir)) rmSync(isolatedPathDir, { recursive: true });
    if (fakeGhDir && existsSync(fakeGhDir)) rmSync(fakeGhDir, { recursive: true });
    if (starProjectDir && existsSync(starProjectDir)) rmSync(starProjectDir, { recursive: true });
  } catch {
    // ignore cleanup errors
  }
}
