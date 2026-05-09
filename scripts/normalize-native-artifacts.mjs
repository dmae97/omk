#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const nativeRoot = join(process.cwd(), "dist", "native");
const EXECUTABLE_MODE = 0o755;

function isPlatformDir(name) {
  return /^[^-]+-[^-]+$/.test(name);
}

function binaryName(platformArch) {
  return platformArch.startsWith("win32-") ? "omk-safety.exe" : "omk-safety";
}

function runSelfTest(path) {
  const result = spawnSync(path, ["self-test"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`self-test failed for ${path}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  const parsed = JSON.parse(result.stdout || "{}");
  if (parsed.ok !== true || typeof parsed.checks !== "number") {
    throw new Error(`self-test returned unexpected output for ${path}: ${result.stdout}`);
  }
  return parsed.checks;
}

if (!existsSync(nativeRoot)) {
  throw new Error(`Native artifact root missing: ${nativeRoot}`);
}

let normalized = 0;
let checked = 0;
for (const entry of readdirSync(nativeRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !isPlatformDir(entry.name)) continue;
  const file = join(nativeRoot, entry.name, binaryName(entry.name));
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  if (!entry.name.startsWith("win32-")) {
    chmodSync(file, EXECUTABLE_MODE);
    normalized += 1;
  }
  const currentKey = `${process.platform}-${process.arch}`;
  if (entry.name === currentKey) {
    runSelfTest(file);
    checked += 1;
  }
}

if (normalized === 0 && process.platform !== "win32") {
  throw new Error(`No non-Windows native safety binaries found under ${nativeRoot}`);
}

console.log(`native:normalize chmod=${normalized} selfTest=${checked}`);
