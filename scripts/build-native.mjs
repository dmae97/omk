#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SUPPORTED_PLATFORMS = new Set(["linux", "darwin", "win32"]);
const SUPPORTED_ARCHES = new Set(["x64", "arm64"]);

function platformArch(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function binaryName(platform = process.platform) {
  return platform === "win32" ? "omk-safety.exe" : "omk-safety";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: options.stdio ?? "inherit",
    encoding: "utf-8",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result;
}

const key = platformArch();
if (!SUPPORTED_PLATFORMS.has(process.platform) || !SUPPORTED_ARCHES.has(process.arch)) {
  throw new Error(`Unsupported native safety target: ${key}`);
}

run("cargo", ["build", "-p", "omk-safety", "--release"]);

const name = binaryName();
const source = join(process.cwd(), "target", "release", name);
const destDir = join(process.cwd(), "dist", "native", key);
const dest = join(destDir, name);

if (!existsSync(source)) {
  throw new Error(`Native safety binary not found after build: ${source}`);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
if (process.platform !== "win32") chmodSync(dest, 0o755);

const selfTest = run(dest, ["self-test"], { stdio: "pipe" });
const parsed = JSON.parse(selfTest.stdout || "{}");
if (parsed.ok !== true || typeof parsed.checks !== "number") {
  throw new Error(`Native safety self-test returned unexpected output: ${selfTest.stdout}`);
}

console.log(`native:build ${key} -> ${dest} (${parsed.checks} checks)`);
