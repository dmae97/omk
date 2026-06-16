import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createKimiApiRuntime } from "../dist/runtime/kimi-api-runtime.js";

describe("Kimi API runtime compaction consumption", () => {
  it("reports compactionConsumed=false when context.compaction is absent", async () => {
    const runtime = createKimiApiRuntime({ apiKey: "test" });
    const result = await runtime.execute({
      prompt: "hello",
      context: { runId: "r", nodeId: "n" },
      tools: { available: [] },
      providerPolicy: { strategy: "priority-first", preferredProviders: [], fallbackChain: [] },
      capabilities: {},
      safety: { risk: "read", approvalPolicy: "ask", sandboxMode: "advisory", evidenceRequired: false, authorityMode: "advisory" },
    });
    assert.equal(result.metadata.compactionConsumed, false);
  });

  it("reports compactionConsumed=true with contract schemaVersion", async () => {
    const runtime = createKimiApiRuntime({ apiKey: "test" });
    const result = await runtime.execute({
      prompt: "hello",
      context: {
        runId: "r",
        nodeId: "n",
        compaction: {
          schemaVersion: "omk.task-compaction.v1",
          contract: { schemaVersion: "omk.structured-compaction.v2" },
          diagnostics: { qualityScore: 0.85 },
          artifactRef: ".omk/runs/r/headroom-decisions.jsonl",
        },
      },
      tools: { available: [] },
      providerPolicy: { strategy: "priority-first", preferredProviders: [], fallbackChain: [] },
      capabilities: {},
      safety: { risk: "read", approvalPolicy: "ask", sandboxMode: "advisory", evidenceRequired: false, authorityMode: "advisory" },
    });
    assert.equal(result.metadata.compactionConsumed, true);
    assert.equal(result.metadata.compactionContract, "omk.structured-compaction.v2");
    assert.equal(result.metadata.compactionArtifactRef, ".omk/runs/r/headroom-decisions.jsonl");
    assert.equal(result.metadata.compactionQualityScore, 0.85);
  });
});
