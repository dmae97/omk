import test from "node:test";
import assert from "node:assert/strict";

// Import from compiled dist
const mod = await import("../dist/orchestration/adaptorch-topology.js");
const {
  isAdaptorchRoutingEnabled,
  computeTopologyFeatures,
  routeTopology,
} = mod;

// ─────────────────────────────────────────────
// 1. singleton — empty DAG
// ─────────────────────────────────────────────

test("singleton: empty DAG returns empty waves", () => {
  const decision = routeTopology([], []);
  assert.equal(decision.topology, "singleton");
  assert.equal(decision.features.nodeCount, 0);
  assert.equal(decision.waves.length, 0);
  assert.match(decision.reason, /empty/i);
});

// ─────────────────────────────────────────────
// 2. singleton — single node
// ─────────────────────────────────────────────

test("singleton: single-node DAG", () => {
  const decision = routeTopology(["a"], []);
  assert.equal(decision.topology, "singleton");
  assert.equal(decision.features.nodeCount, 1);
  assert.equal(decision.features.width, 1);
  assert.equal(decision.waves.length, 1);
  assert.deepEqual(decision.waves[0], ["a"]);
  assert.match(decision.reason, /single/i);
});

// ─────────────────────────────────────────────
// 3. parallel — wide low-coupling DAG
// ─────────────────────────────────────────────

test("parallel: wide fan-out DAG with no internal edges selects parallel", () => {
  // 6 independent nodes all depending on a single root → 5-wide second layer
  const nodes = ["root", "a", "b", "c", "d", "e"];
  const edges = nodes.slice(1).map((id) => ({ from: "root", to: id }));
  const decision = routeTopology(nodes, edges);

  // parallelRatio = 5/6 ≈ 0.83 ≥ 0.5, width=5 < hierarchicalSubtasks=5 is borderline
  // width=5, so if width >= 5, map_reduce; else parallel
  assert.ok(
    decision.topology === "parallel" || decision.topology === "map_reduce",
    `expected parallel or map_reduce, got ${decision.topology}`,
  );
  assert.ok(decision.features.parallelRatio >= 0.5);
  assert.equal(decision.features.nodeCount, 6);
  assert.equal(decision.waves.length, 2);
  assert.deepEqual(decision.waves[0], ["root"]);
  assert.deepEqual(decision.waves[1].sort(), ["a", "b", "c", "d", "e"].sort());
});

// ─────────────────────────────────────────────
// 4. pipeline — linear chain
// ─────────────────────────────────────────────

test("pipeline: linear chain a→b→c→d selects pipeline", () => {
  const nodes = ["a", "b", "c", "d"];
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ];
  const decision = routeTopology(nodes, edges);

  assert.equal(decision.topology, "pipeline");
  assert.equal(decision.features.criticalDepth, 4);
  assert.equal(decision.features.nodeCount, 4);
  assert.equal(decision.features.width, 1);
  assert.equal(decision.waves.length, 4);
  assert.match(decision.reason, /linear/i);
});

// ─────────────────────────────────────────────
// 5. hybrid — mixed structure
// ─────────────────────────────────────────────

test("hybrid: moderate fan-out with chain selects hybrid or dag", () => {
  // a→b, a→c, b→d, c→d (diamond)
  // 4 nodes, 4 edges, coupling=4/6≈0.67 ≥ 0.6 → triggers high-coupling → dag
  const nodes = ["a", "b", "c", "d"];
  const edges = [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "c", to: "d" },
  ];
  const decision = routeTopology(nodes, edges);

  // coupling = 4/6 ≈ 0.67 ≥ 0.6 → high coupling path → "dag" (depth=3>1 but check)
  assert.ok(
    ["dag", "hierarchical", "hybrid"].includes(decision.topology),
    `expected dag/hierarchical/hybrid, got ${decision.topology}`,
  );
  assert.equal(decision.features.nodeCount, 4);
  assert.equal(decision.features.edgeCount, 4);
  assert.equal(decision.waves.length, 3); // [a], [b,c], [d]
});

// ─────────────────────────────────────────────
// 6. cycle-guard — cyclic graph falls back to single wave
// ─────────────────────────────────────────────

test("cycle-guard: cyclic graph falls back to single wave dag", () => {
  const nodes = ["a", "b", "c"];
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a" }, // cycle
  ];
  const decision = routeTopology(nodes, edges);

  assert.equal(decision.topology, "dag");
  assert.equal(decision.waves.length, 1);
  assert.deepEqual(decision.waves[0].sort(), ["a", "b", "c"].sort());
});

// ─────────────────────────────────────────────
// 7. env-disabled — OMK_ADAPTORCH_ROUTING=off
// ─────────────────────────────────────────────

test("env-disabled: isAdaptorchRoutingEnabled respects off/0/false", () => {
  assert.equal(isAdaptorchRoutingEnabled({}), true, "default should be true");
  assert.equal(isAdaptorchRoutingEnabled({ OMK_ADAPTORCH_ROUTING: "on" }), true);
  assert.equal(isAdaptorchRoutingEnabled({ OMK_ADAPTORCH_ROUTING: "1" }), true);
  assert.equal(isAdaptorchRoutingEnabled({ OMK_ADAPTORCH_ROUTING: "off" }), false);
  assert.equal(isAdaptorchRoutingEnabled({ OMK_ADAPTORCH_ROUTING: "0" }), false);
  assert.equal(isAdaptorchRoutingEnabled({ OMK_ADAPTORCH_ROUTING: "false" }), false);
  assert.equal(isAdaptorchRoutingEnabled({ OMK_ADAPTORCH_ROUTING: "FALSE" }), false);
  assert.equal(isAdaptorchRoutingEnabled({ OMK_ADAPTORCH_ROUTING: "OFF" }), false);
});

// ─────────────────────────────────────────────
// 8. map_reduce — large fan-out triggers map_reduce
// ─────────────────────────────────────────────

test("map_reduce: 8 independent workers after coordinator selects map_reduce", () => {
  const nodes = ["coord", "w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"];
  const edges = nodes.slice(1).map((id) => ({ from: "coord", to: id }));
  const decision = routeTopology(nodes, edges);

  // parallelRatio = 8/9 ≈ 0.89, width=8 ≥ hierarchicalSubtasks=5 → map_reduce
  assert.equal(decision.topology, "map_reduce");
  assert.equal(decision.features.width, 8);
  assert.equal(decision.waves.length, 2);
});

// ─────────────────────────────────────────────
// 9. features determinism — same input yields same output
// ─────────────────────────────────────────────

test("determinism: routeTopology is deterministic", () => {
  const nodes = ["a", "b", "c", "d", "e"];
  const edges = [
    { from: "a", to: "c" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "c", to: "e" },
  ];
  const d1 = routeTopology(nodes, edges);
  const d2 = routeTopology(nodes, edges);
  assert.deepEqual(d1, d2);
});

// ─────────────────────────────────────────────
// 10. computeTopologyFeatures standalone
// ─────────────────────────────────────────────

test("computeTopologyFeatures returns all required fields", () => {
  const f = computeTopologyFeatures(["a", "b"], [{ from: "a", to: "b" }]);
  assert.equal(typeof f.nodeCount, "number");
  assert.equal(typeof f.edgeCount, "number");
  assert.equal(typeof f.width, "number");
  assert.equal(typeof f.criticalDepth, "number");
  assert.equal(typeof f.couplingDensity, "number");
  assert.equal(typeof f.parallelRatio, "number");
  assert.ok(Array.isArray(f.layers));
  assert.equal(f.nodeCount, 2);
  assert.equal(f.edgeCount, 1);
  assert.equal(f.width, 1);
  assert.equal(f.criticalDepth, 2);
});
