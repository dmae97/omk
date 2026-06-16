#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decideToolAuthority } from "../dist/safety/tool-authority-gate.js";

const cases = [
  {
    name: "enforce read prompt passes",
    mode: "enforce",
    ctx: { op: "read", writeAuthority: "none", shellAuthority: "none", approvalPolicy: "interactive", sandboxMode: "read-only", tty: false },
    expected: "allow",
  },
  {
    name: "enforce write prompt without authority blocks",
    mode: "enforce",
    ctx: { op: "write", writeAuthority: "none", shellAuthority: "none", approvalPolicy: "auto", sandboxMode: "workspace-write", tty: false },
    expected: "block",
  },
  {
    name: "enforce shell prompt in read-only sandbox blocks",
    mode: "enforce",
    ctx: { op: "shell", writeAuthority: "full", shellAuthority: "full", approvalPolicy: "auto", sandboxMode: "read-only", tty: false },
    expected: "block",
  },
  {
    name: "warn mode would diagnose but pure decision still blocks insufficient authority",
    mode: "warn",
    ctx: { op: "write", writeAuthority: "none", shellAuthority: "none", approvalPolicy: "auto", sandboxMode: "workspace-write", tty: false },
    expected: "block",
  },
  {
    name: "shadow mode records trace only; authority-sufficient auto write allows",
    mode: "shadow",
    ctx: { op: "write", writeAuthority: "full", shellAuthority: "none", approvalPolicy: "auto", sandboxMode: "workspace-write", tty: false },
    expected: "allow",
  },
];

const results = [];
for (const testCase of cases) {
  const actual = decideToolAuthority(testCase.ctx);
  assert.equal(actual, testCase.expected, testCase.name);
  results.push({ ...testCase, actual, passed: true, layer: "decision" });
}

const nativeDispatch = spawnSync(process.execPath, ["--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import { buildNativeRootLoopTurnNode, executeNativeRootTurn } from "./dist/commands/chat/native-root-loop.js";
  const bootstrap = {
    ok: true,
    provider: "mimo",
    providerPolicy: "mimo",
    selectedProvider: "mimo",
    selectedRuntimeId: "mimo-api",
    selectedModel: "mimo-v2.5-pro",
    sessionMode: "api",
    runtimeMode: "api",
    diagnostics: []
  };
  const node = buildNativeRootLoopTurnNode({ bootstrap, prompt: "modify src/example.ts", nodeId: "authority-e2e" });
  let called = false;
  const result = await executeNativeRootTurn({
    taskRunner: { async run() { called = true; return { success: true, exitCode: 0, stdout: "unexpected", stderr: "", metadata: {} }; } },
    node,
    env: { OMK_TOOL_AUTHORITY_MODE: "enforce", OMK_RUN_ID: "authority-smoke-e2e" },
    signal: new AbortController().signal,
    heartbeatEnabled: false
  });
  assert.equal(called, false, "enforce block must happen before task runner dispatch");
  assert.equal(result.exitCode, 78);
  assert.equal(result.metadata?.code, "TOOL_AUTHORITY_BLOCKED");
`], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, OMK_TOOL_AUTHORITY_MODE: "enforce" } });

assert.equal(nativeDispatch.status, 0, nativeDispatch.stderr || nativeDispatch.stdout);
results.push({
  name: "enforce native turn blocks before task runner dispatch",
  mode: "enforce",
  actual: "block",
  expected: "block",
  passed: true,
  layer: "native-turn-subprocess",
});

const outDir = join(process.cwd(), "proof", "authority-smoke");
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "authority-smoke.json"), JSON.stringify({ schemaVersion: "omk.authority-smoke.v1", results }, null, 2), "utf8");
console.log(`authority smoke passed (${results.length}/${results.length}); artifact=proof/authority-smoke/authority-smoke.json`);
