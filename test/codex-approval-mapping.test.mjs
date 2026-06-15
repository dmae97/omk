import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CodexRuntime } from "../dist/runtime/codex-runtime.js";

function buildTask({ approvalPolicy, sandboxMode, capabilities = {} }) {
  return {
    prompt: "test",
    context: {
      runId: "r1",
      nodeId: "n1",
      approvalPolicy,
      sandboxMode,
      env: {},
    },
    tools: { available: [] },
    providerPolicy: { strategy: "priority-first", preferredProviders: [], fallbackChain: [] },
    capabilities: { read: true, write: false, shell: false, patch: false, merge: false, mcp: false, review: false, vision: false, ...capabilities },
  };
}

describe("CodexRuntime approval mapping", () => {
  it("maps ask to on-request for workspace-write", async () => {
    const runtime = new CodexRuntime({ cwd: process.cwd() });
    // Exercise via public execute path up to args construction by checking metadata after failure (no real codex call)
    const task = buildTask({ approvalPolicy: "ask", sandboxMode: "workspace-write" });
    const result = await runtime.execute(task);
    assert.equal(result.exitCode, 2);
    assert.equal(result.metadata.approvalPolicy, "on-request");
    assert.equal(result.metadata.sandbox, "workspace-write");
  });

  it("maps auto to on-request for workspace-write", async () => {
    const runtime = new CodexRuntime({ cwd: process.cwd() });
    const task = buildTask({ approvalPolicy: "auto", sandboxMode: "workspace-write" });
    const result = await runtime.execute(task);
    assert.equal(result.metadata.approvalPolicy, "on-request");
  });

  it("does not map ask to never", async () => {
    const runtime = new CodexRuntime({ cwd: process.cwd() });
    const task = buildTask({ approvalPolicy: "ask", sandboxMode: "read-only" });
    const result = await runtime.execute(task);
    assert.notEqual(result.metadata.approvalPolicy, "never");
  });

  it("forces read-only sandbox when OMK_PROVIDER_AUTHORITY=advisory", async () => {
    const runtime = new CodexRuntime({ cwd: process.cwd() });
    const task = buildTask({ approvalPolicy: "auto", sandboxMode: undefined, capabilities: { write: true } });
    task.context.env = { OMK_PROVIDER_AUTHORITY: "advisory" };
    const result = await runtime.execute(task);
    assert.equal(result.metadata.sandbox, "read-only");
    assert.equal(result.metadata.approvalPolicy, "on-request");
  });
});
