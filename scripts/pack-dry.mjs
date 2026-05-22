#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const timeoutMs = Number.parseInt(process.env.OMK_PACK_DRY_TIMEOUT_MS ?? "", 10) || DEFAULT_TIMEOUT_MS;

function buildIsolatedPackEnv() {
  const env = { ...process.env };
  if (process.platform === "linux") {
    env.TMPDIR ??= "/tmp";
    env.TMP ??= env.TMPDIR;
    env.TEMP ??= env.TMPDIR;
  }
  const tmpRoot = env.OMK_SMOKE_TMPDIR || env.TMPDIR || env.TMP || env.TEMP;
  if (tmpRoot && !env.npm_config_cache) {
    env.npm_config_cache = `${tmpRoot.replace(/\/+$/, "")}/omk-npm-cache`;
  }
  return env;
}

const result = spawnSync(npmCmd, ["pack", "--dry-run", "--ignore-scripts", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  timeout: timeoutMs,
  killSignal: "SIGKILL",
  env: buildIsolatedPackEnv(),
  maxBuffer: 10 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.status !== 0) {
  const detail = result.error?.message ?? `exit ${result.status ?? `signal ${result.signal}`}`;
  console.error(`npm pack --dry-run failed: ${detail}`);
  process.exit(1);
}
