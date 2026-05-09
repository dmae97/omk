#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error && result.error.code === "ENOENT") {
    console.log("rust:check skipped — cargo not found");
    return 0;
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    return result.status ?? 1;
  }
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return 0;
}

let status = run("cargo", ["test", "-p", "omk-safety"]);
if (status === 0) {
  status = run("cargo", ["run", "-q", "-p", "omk-safety", "--", "self-test"]);
}
if (status === 0) {
  status = run("cargo", ["run", "-q", "-p", "omk-safety", "--", "resolve-run-artifact", ".omk/runs", "run-123", "logs/node-1.log"]);
}
if (status === 0) {
  const rejected = spawnSync("cargo", ["run", "-q", "-p", "omk-safety", "--", "resolve-run-artifact", ".omk/runs", "run-123", "../state.json"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (rejected.error && rejected.error.code === "ENOENT") {
    status = 0;
  } else if (rejected.status === 0) {
    process.stderr.write("rust:check failed — traversal artifact unexpectedly accepted\n");
    process.stdout.write(rejected.stdout || "");
    process.stderr.write(rejected.stderr || "");
    status = 1;
  }
}

process.exit(status);
