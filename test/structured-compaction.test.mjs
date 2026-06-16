import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STRUCTURED_COMPACTION_CONTRACT,
  structuredCompactionInstruction,
  validateStructuredCompaction,
} from "../dist/runtime/structured-compaction.js";

test("structured compaction contract validates required routing/evidence/safety sections", () => {
  const capsule = {
    task: "Implement structured compaction contract for native runtime handoff",
    system: "Preserve safety constraints and evidence required gates.",
    node: {
      routing: {
        provider: "codex",
        risk: "write",
        sandboxMode: "workspace-write",
        readOnly: false,
        assignedProviderCapabilities: ["write", "patch"],
      },
    },
    evidenceRequirements: [{ gate: "command-pass", required: true }],
  };

  const missing = validateStructuredCompaction("short summary only", capsule);
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.includes("task"));
  assert.ok(missing.missing.includes("evidence requirements"));

  const valid = validateStructuredCompaction([
    "Implement structured compaction contract for native runtime handoff",
    "provider codex risk write sandboxMode workspace-write",
    "command-pass evidence required",
    "preserve safety constraints and capabilities write patch",
  ].join("\n"), capsule);

  assert.equal(valid.ok, true);
  assert.equal(valid.contract.schemaVersion, DEFAULT_STRUCTURED_COMPACTION_CONTRACT.schemaVersion);
  assert.match(structuredCompactionInstruction(), /omk\.structured-compaction\.v1/);
});
