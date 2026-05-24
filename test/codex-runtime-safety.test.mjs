import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { CodexRuntime } = await import("../dist/runtime/codex-runtime.js");
const { DeepSeekRuntime } = await import("../dist/runtime/deepseek-runtime.js");

async function fakeCodexBin(dir) {
  const capturePath = join(dir, "capture.json");
  const scriptPath = join(dir, "fake-codex.mjs");
  await writeFile(scriptPath, `
import { writeFileSync } from "node:fs";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
writeFileSync(process.env.OMK_CAPTURE_PATH, JSON.stringify({
  argv: process.argv.slice(2),
  env: {
    OMK_APPROVAL_POLICY: process.env.OMK_APPROVAL_POLICY,
    OMK_SANDBOX_MODE: process.env.OMK_SANDBOX_MODE,
    OMK_TASK_RISK: process.env.OMK_TASK_RISK
  },
  stdin
}));
process.stdout.write("ok");
`);
  if (process.platform === "win32") {
    const cmdPath = join(dir, "codex.cmd");
    await writeFile(cmdPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
    return { bin: cmdPath, capturePath };
  }
  const binPath = join(dir, "codex");
  await writeFile(binPath, `#!/usr/bin/env sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  await chmod(binPath, 0o755);
  return { bin: binPath, capturePath };
}

test("CodexRuntime propagates ask approval and read-only sandbox", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omk-codex-runtime-"));
  const { bin, capturePath } = await fakeCodexBin(dir);
  const runtime = new CodexRuntime({ bin, cwd: dir });

  const result = await runtime.execute({
    prompt: "summarize only",
    context: {
      runId: "run-codex-safety",
      nodeId: "node-read",
      role: "reviewer",
      goal: "safety",
      cwd: dir,
      env: { OMK_CAPTURE_PATH: capturePath },
      approvalPolicy: "ask",
      sandboxMode: "read-only",
      risk: "read",
    },
    tools: { available: [] },
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: ["codex"],
      fallbackChain: [],
    },
    capabilities: {
      read: true,
      write: false,
      shell: false,
      mcp: false,
      patch: false,
      review: true,
      merge: false,
      vision: false,
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.metadata.sandbox, "read-only");
  assert.equal(result.metadata.approvalPolicy, "on-request");

  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  assert.deepEqual(capture.argv.slice(0, 5), ["exec", "--sandbox", "read-only", "--ask-for-approval", "on-request"]);
  assert.equal(capture.env.OMK_APPROVAL_POLICY, "ask");
  assert.equal(capture.env.OMK_SANDBOX_MODE, "read-only");
  assert.equal(capture.env.OMK_TASK_RISK, "read");
  assert.match(capture.stdin, /summarize only/);
});

test("DeepSeekRuntime rejects write and tool authority", async () => {
  const runtime = new DeepSeekRuntime({ apiKey: "test-key" });
  assert.equal(runtime.capabilities.write, false);
  assert.equal(runtime.capabilities.patch, false);
  assert.equal(runtime.capabilities.shell, false);
  assert.equal(runtime.capabilities.mcp, false);
  assert.equal(runtime.capabilities.supportsToolCalling, false);

  const result = await runtime.execute({
    prompt: "edit the file",
    context: {
      runId: "run-deepseek-safety",
      nodeId: "node-write",
      role: "coder",
      goal: "safety",
      cwd: process.cwd(),
    },
    tools: { available: [{ name: "write_file", description: "write", inputSchema: {} }] },
    providerPolicy: {
      strategy: "priority-first",
      preferredProviders: ["deepseek"],
      fallbackChain: [],
    },
    capabilities: {
      read: true,
      write: true,
      shell: false,
      mcp: false,
      patch: true,
      review: false,
      merge: false,
      vision: false,
      toolCalling: true,
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.metadata.authorityMode, "advisory");
  assert.match(result.metadata.error, /advisory\/read-only/);
});
