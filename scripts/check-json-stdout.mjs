#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
  ["version", "--json"],
];

const ansiPattern = /\u001b\[[0-9;]*m/;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

for (const args of commands) {
  const label = `omk ${args.join(" ")}`;
  const result = spawnSync(process.execPath, ["dist/cli.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OMK_MCP_PREFLIGHT: "off",
    },
  });

  if (result.status !== 0) {
    fail(`${label}: exited ${result.status}\n${result.stderr}`);
    continue;
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    fail(`${label}: stdout empty`);
    continue;
  }
  if (ansiPattern.test(stdout)) fail(`${label}: stdout contains ANSI`);

  try {
    const parsed = JSON.parse(stdout);
    if (parsed.schemaVersion !== "omk.contract.v1") {
      fail(`${label}: missing omk.contract.v1 envelope`);
    }
    if (parsed.command !== args[0]) fail(`${label}: command mismatch`);
  } catch (error) {
    fail(`${label}: stdout is not exactly one JSON document: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`validated JSON stdout purity for ${commands.length} command(s)`);
