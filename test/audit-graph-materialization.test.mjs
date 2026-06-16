import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGraphMemoryStore } from "../dist/memory/local-graph-memory-store.js";

describe("turn audit graph materialization", () => {
  it("creates run, turn, route, and evidence nodes", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-audit-graph-"));
    try {
      const store = await LocalGraphMemoryStore.create({ projectRoot: root, sessionId: "run-audit-test", source: "test" });
      assert.ok(store, "local graph store should be available");
      await store.materializeTurnAudit({
        runId: "run-audit-test",
        nodeId: "turn-1",
        provider: "codex",
        selectedRuntime: "codex-cli",
        fallbackChain: ["codex-cli"],
        evidenceKind: "turn-result-pass",
        evidenceArtifactPath: ".omk/runs/run-audit-test/turns/turn-1-result.jsonl",
        evidenceHash: "abc123",
      });
      const raw = await readFile(join(root, ".omk", "memory", "graph-state.json"), "utf8");
      const state = JSON.parse(raw);
      assert.ok(state.nodes.some((node) => node.type === "Run" && node.properties.runId === "run-audit-test"));
      assert.ok(state.nodes.some((node) => node.type === "Provider" && node.properties.provider === "codex"));
      assert.ok(state.nodes.some((node) => node.type === "ProviderRoute" && node.properties.selectedRuntime === "codex-cli"));
      assert.ok(state.nodes.some((node) => node.type === "Evidence" && node.properties.sha256 === "abc123"));
      assert.ok(state.nodes.some((node) => node.type === "Artifact" && node.properties.sha256 === "abc123"));
      assert.ok(state.edges.some((edge) => edge.type === "HAS_PROVIDER_ROUTE"));
      assert.ok(state.edges.some((edge) => edge.type === "ROUTES_TO"));
      assert.ok(state.edges.some((edge) => edge.type === "OBSERVED_EVIDENCE"));
      assert.ok(state.edges.some((edge) => edge.type === "STORED_AT"));
      assert.ok(state.edges.some((edge) => edge.type === "EVIDENCED_BY"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
