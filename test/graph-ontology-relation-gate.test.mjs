import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkGraphOntologyRelations } from "../dist/evidence/graph-ontology-relation-gate.js";

describe("graph ontology relation gate", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-ontology-gate-"));

  it("passes when all used relations are declared", () => {
    const file = join(tmpDir, "valid.ts");
    writeFileSync(file, 'graph.upsertEdge(state, a, b, "HAS_RUN", now);', "utf-8");
    const result = checkGraphOntologyRelations([file]);
    assert.equal(result.pass, true);
    assert.equal(result.missing.length, 0);
  });

  it("fails when a relation is used but not declared", () => {
    const file = join(tmpDir, "invalid.ts");
    writeFileSync(file, 'graph.upsertEdge(state, a, b, "CUSTOM_UNKNOWN_REL", now);', "utf-8");
    const result = checkGraphOntologyRelations([file]);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.relationType === "CUSTOM_UNKNOWN_REL"));
  });

  it("checks relation literal objects", () => {
    const file = join(tmpDir, "literal.ts");
    writeFileSync(file, 'state.edges.push({ from: "a", to: "b", type: "ALSO_UNKNOWN" });', "utf-8");
    const result = checkGraphOntologyRelations([file]);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.relationType === "ALSO_UNKNOWN"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
