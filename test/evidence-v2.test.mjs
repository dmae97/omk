import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkEvidenceGate,
  evidenceRequirementsFromOutputs,
  evidenceObservationsFromResult,
  hasDeclaredEvidenceRequirement,
} from "../dist/runtime/contracts/evidence.js";

describe("Evidence model v2", () => {
  it("treats output gates as declarations, not observations", () => {
    const result = checkEvidenceGate(true, [{ gate: "command-pass", ref: "npm test" }], null);
    assert.equal(result.required, true);
    assert.equal(result.satisfied, false);
    assert.deepEqual(result.gates, []);
    assert.deepEqual(result.missing, ["command-pass"]);
  });

  it("builds requirements from outputs", () => {
    const requirements = evidenceRequirementsFromOutputs([
      { gate: "summary", ref: "## Evidence" },
      { gate: "none" },
      { gate: "diff", required: false },
    ]);
    assert.deepEqual(requirements, [{ gate: "summary", ref: "## Evidence", required: true }]);
    assert.equal(hasDeclaredEvidenceRequirement([{ gate: "summary" }]), true);
  });

  it("satisfies gates with replayable observations from metadata/stdout", () => {
    const result = checkEvidenceGate(
      true,
      [{ gate: "summary" }, { gate: "diff" }],
      { changedFiles: ["src/foo.ts"] },
      "## Evidence\nImplemented and verified.",
    );
    assert.equal(result.satisfied, true);
    assert.ok(result.gates.includes("summary"));
    assert.ok(result.gates.includes("diff"));
    assert.ok(result.observations?.every((observation) => observation.replayable));
  });

  it("treats stdout-only command observations as weak evidence", () => {
    const observations = evidenceObservationsFromResult({ stdout: "npm test passed" });
    const commandObservation = observations.find((observation) => observation.kind === "command-pass");
    assert.ok(commandObservation);
    assert.equal(commandObservation.source, "stdout");
    assert.ok(commandObservation.confidence < 0.8);

    const result = checkEvidenceGate(true, [{ gate: "command-pass", ref: "npm test" }], null, "npm test passed");
    assert.equal(result.satisfied, false);
    assert.ok(result.missing.includes("command-pass"));
  });

  it("accepts metadata-backed command observations as high-confidence evidence", () => {
    const result = checkEvidenceGate(true, [{ gate: "command-pass", ref: "npm test" }], { commandPass: true });
    assert.equal(result.satisfied, true);
    assert.ok(result.observations?.some((observation) => observation.kind === "command-pass" && observation.confidence >= 0.8));
  });
});
