import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkEvidenceGate } from "../dist/runtime/contracts/evidence.js";

describe("checkEvidenceGate", () => {
  it("allows read-only tasks without required evidence", () => {
    const result = checkEvidenceGate(false, [], null);
    assert.equal(result.satisfied, true);
    assert.equal(result.required, false);
  });

  it("blocks high-risk task with no evidence gates", () => {
    const result = checkEvidenceGate(true, [], null);
    assert.equal(result.satisfied, false);
    assert.equal(result.required, true);
    assert.ok(result.missing.length > 0);
  });

  it("allows high-risk task with a command-pass output", () => {
    const result = checkEvidenceGate(true, [{ gate: "command-pass", ref: "npm test" }], null);
    assert.equal(result.satisfied, true);
    assert.ok(result.gates.includes("command-pass"));
  });

  it("allows high-risk task with metadata evidence gates", () => {
    const result = checkEvidenceGate(true, [], { evidenceGates: ["diff"], changedFiles: ["src/foo.ts"] });
    assert.equal(result.satisfied, true);
    assert.ok(result.gates.includes("diff"));
  });
});
