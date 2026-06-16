import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toTaskResult } from "../dist/runtime/agent-runtime.js";

test("toTaskResult redacts stderr and retains private debug artifact outside RuntimeRouter", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-direct-stderr-"));
  const previous = {
    OMK_PRIVATE_STDERR_ARTIFACTS: process.env.OMK_PRIVATE_STDERR_ARTIFACTS,
    OMK_PROJECT_ROOT: process.env.OMK_PROJECT_ROOT,
    OMK_RUN_ID: process.env.OMK_RUN_ID,
    OMK_NODE_ID: process.env.OMK_NODE_ID,
  };
  try {
    process.env.OMK_PRIVATE_STDERR_ARTIFACTS = "1";
    process.env.OMK_PROJECT_ROOT = root;
    process.env.OMK_RUN_ID = "direct-stderr-run";
    process.env.OMK_NODE_ID = "direct-node";

    const result = toTaskResult({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `provider failed\n${"z".repeat(650)}\nOPENAI_API_KEY=shortvalue`,
      metadata: { runtime: "external-cli" },
    });

    assert.equal(result.metadata.stderrRetainedPrivately, true);
    assert.match(result.metadata.stderrPrivateArtifact, /^private\/stderr\//);
    assert.doesNotMatch(result.stderr, /shortvalue/);
    const artifact = JSON.parse(await readFile(join(root, ".omk", "runs", "direct-stderr-run", result.metadata.stderrPrivateArtifact), "utf8"));
    assert.match(artifact.stderr, /z{650}/);
    assert.doesNotMatch(artifact.stderr, /shortvalue/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
