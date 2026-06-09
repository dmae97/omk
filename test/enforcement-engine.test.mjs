import test from "node:test";
import assert from "node:assert/strict";

const {
  ALL_CAPABILITIES,
  combinePoliciesByMinAuthority,
  computeEnforcementProof,
  defaultLattice,
  hasValidEnforcementProof,
  policyLayerFromLegacyAuthorities,
  rankOf,
} = await import("../dist/safety/enforcement-engine.js");

const {
  decideToolAuthority,
  mapToolNameToOp,
  effectiveCapabilityLevel,
  toolOpToCapability,
  buildToolAuthorityContextFromProof,
  decideToolAuthorityV2,
  isOperationAllowedByProof,
  isOperationApprovalRequiredByProof,
} = await import("../dist/safety/tool-authority-gate.js");

const {
  evaluateToolAuthorityV2,
  ToolAuthorityBlockedError,
} = await import("../dist/runtime/tool-dispatch-contracts.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function layer(source, lattice, sandboxMode, approvalPolicy) {
  return { source, lattice, sandboxMode, approvalPolicy };
}

// ---------------------------------------------------------------------------
// defaultLattice
// ---------------------------------------------------------------------------

test("defaultLattice sets all capabilities to full", () => {
  const lat = defaultLattice();
  for (const cap of ALL_CAPABILITIES) {
    assert.equal(lat[cap], "full", `expected ${cap} to be full`);
  }
});

// ---------------------------------------------------------------------------
// rankOf
// ---------------------------------------------------------------------------

test("rankOf orders levels correctly", () => {
  assert.ok(rankOf("none") < rankOf("advisory"));
  assert.ok(rankOf("advisory") < rankOf("direct"));
  assert.ok(rankOf("direct") < rankOf("full"));
});

// ---------------------------------------------------------------------------
// combinePoliciesByMinAuthority — basic combination
// ---------------------------------------------------------------------------

test("empty layers → defaults (full, unrestricted, yolo)", () => {
  const combined = combinePoliciesByMinAuthority([]);
  assert.equal(combined.sandboxMode, "unrestricted");
  assert.equal(combined.approvalPolicy, "yolo");
  for (const cap of ALL_CAPABILITIES) {
    assert.equal(combined.lattice[cap], "full");
  }
  assert.deepEqual(combined.sources, []);
});

test("single layer sets its values", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "none", shell: "advisory" }, "read-only", "block"),
  ]);
  assert.equal(combined.lattice.write, "none");
  assert.equal(combined.lattice.shell, "advisory");
  assert.equal(combined.lattice.read, "full"); // default
  assert.equal(combined.sandboxMode, "read-only");
  assert.equal(combined.approvalPolicy, "block");
  assert.deepEqual(combined.sources, ["user"]);
});

test("minByAuthority picks the most restrictive across layers", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "full", shell: "full" }, "workspace-write", "auto"),
    layer("repo", { write: "advisory", shell: "none" }, "workspace-write", "interactive"),
    layer("provider", { write: "full", shell: "direct" }, "unrestricted", "yolo"),
  ]);
  // write: full vs advisory vs full -> advisory (most restrictive)
  assert.equal(combined.lattice.write, "advisory");
  // shell: full vs none vs direct -> none
  assert.equal(combined.lattice.shell, "none");
  // read: untouched -> full default
  assert.equal(combined.lattice.read, "full");
  // sandbox: workspace-write vs unrestricted -> workspace-write (more restrictive)
  assert.equal(combined.sandboxMode, "workspace-write");
  // approval: auto vs interactive vs yolo -> interactive (most restrictive)
  assert.equal(combined.approvalPolicy, "interactive");
  assert.deepEqual(combined.sources, ["user", "repo", "provider"]);
});

test("risk policy can block everything", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "full", shell: "full" }, "unrestricted", "yolo"),
    layer("risk", { write: "none", shell: "none", network: "none", secret_read: "none", secret_write: "none", merge: "none", publish: "none" }, "read-only", "block"),
  ]);
  assert.equal(combined.lattice.write, "none");
  assert.equal(combined.lattice.shell, "none");
  assert.equal(combined.lattice.network, "none");
  assert.equal(combined.sandboxMode, "read-only");
  assert.equal(combined.approvalPolicy, "block");
});

test("adapter policy overrides user when more restrictive", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "full", shell: "full" }, "unrestricted", "yolo"),
    layer("adapter", { write: "advisory" }, "workspace-write", "auto"),
  ]);
  assert.equal(combined.lattice.write, "advisory");
  assert.equal(combined.lattice.shell, "full"); // untouched
  assert.equal(combined.sandboxMode, "workspace-write");
  assert.equal(combined.approvalPolicy, "auto");
});

// ---------------------------------------------------------------------------
// computeEnforcementProof
// ---------------------------------------------------------------------------

test("proof for unrestricted+yolo allows everything", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", {}, "unrestricted", "yolo"),
  ]);
  const proof = computeEnforcementProof(combined);
  assert.equal(proof.sandboxMode, "unrestricted");
  assert.equal(proof.blockedCapabilities.length, 0);
  assert.equal(proof.approvalRequired.length, 0);
  assert.equal(typeof proof.policyHash, "string");
  assert.ok(proof.policyHash.length > 0);
});

test("proof for read-only sandbox blocks non-read ops", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("repo", {}, "read-only", "auto"),
  ]);
  const proof = computeEnforcementProof(combined);
  assert.equal(proof.sandboxMode, "read-only");
  const expectedBlocked = ["write", "shell", "network", "merge", "publish", "secret_write"];
  for (const cap of expectedBlocked) {
    assert.ok(proof.blockedCapabilities.includes(cap), `expected ${cap} to be blocked`);
  }
  assert.ok(!proof.blockedCapabilities.includes("read"));
  assert.equal(proof.approvalRequired.length, 0); // auto policy
});

test("proof for block policy blocks everything except read", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", {}, "unrestricted", "block"),
  ]);
  const proof = computeEnforcementProof(combined);
  const expectedBlocked = ALL_CAPABILITIES.filter((c) => c !== "read");
  for (const cap of expectedBlocked) {
    assert.ok(proof.blockedCapabilities.includes(cap), `expected ${cap} to be blocked`);
  }
  assert.equal(proof.approvalRequired.length, 0);
});

test("proof for interactive policy marks non-read as approval-required", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", {}, "workspace-write", "interactive"),
  ]);
  const proof = computeEnforcementProof(combined);
  assert.equal(proof.blockedCapabilities.length, 0);
  const expectedApproval = ALL_CAPABILITIES.filter((c) => c !== "read");
  for (const cap of expectedApproval) {
    assert.ok(proof.approvalRequired.includes(cap), `expected ${cap} to require approval`);
  }
});

test("advisory level requires approval under auto policy", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "advisory", shell: "advisory" }, "workspace-write", "auto"),
  ]);
  const proof = computeEnforcementProof(combined);
  assert.equal(proof.blockedCapabilities.length, 0);
  assert.ok(proof.approvalRequired.includes("write"));
  assert.ok(proof.approvalRequired.includes("shell"));
  assert.ok(!proof.approvalRequired.includes("read"));
});

test("yolo removes approval requirements but keeps blocks", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "advisory", shell: "none" }, "workspace-write", "yolo"),
  ]);
  const proof = computeEnforcementProof(combined);
  assert.deepEqual(proof.blockedCapabilities, ["shell"]);
  assert.equal(proof.approvalRequired.length, 0);
});

test("network-isolated blocks network only", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("repo", {}, "network-isolated", "auto"),
  ]);
  const proof = computeEnforcementProof(combined);
  assert.deepEqual(proof.blockedCapabilities, ["network"]);
});

test("none capability level blocks that capability even under yolo", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("risk", { secret_write: "none" }, "unrestricted", "yolo"),
  ]);
  const proof = computeEnforcementProof(combined);
  assert.ok(proof.blockedCapabilities.includes("secret_write"));
});

// ---------------------------------------------------------------------------
// hasValidEnforcementProof
// ---------------------------------------------------------------------------

test("valid proof passes validation", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([layer("user", {}, "workspace-write", "auto")]),
  );
  assert.equal(hasValidEnforcementProof(proof), true);
});

test("null proof is invalid", () => {
  assert.equal(hasValidEnforcementProof(null), false);
});

test("proof without policyHash is invalid", () => {
  assert.equal(hasValidEnforcementProof({ enforcedBy: ["user"], blockedCapabilities: [], approvalRequired: [], sandboxMode: "workspace-write" }), false);
});

test("proof without enforcedBy is invalid", () => {
  assert.equal(hasValidEnforcementProof({ policyHash: "abc", blockedCapabilities: [], approvalRequired: [], sandboxMode: "workspace-write" }), false);
});

// ---------------------------------------------------------------------------
// policyLayerFromLegacyAuthorities
// ---------------------------------------------------------------------------

test("legacy authority layer maps write to write/merge/publish", () => {
  const l = policyLayerFromLegacyAuthorities("provider", { writeAuthority: "advisory" });
  assert.equal(l.lattice.write, "advisory");
  assert.equal(l.lattice.merge, "advisory");
  assert.equal(l.lattice.publish, "advisory");
});

test("legacy authority layer maps shell and takes min for merge/publish", () => {
  const l = policyLayerFromLegacyAuthorities("provider", {
    writeAuthority: "full",
    shellAuthority: "advisory",
  });
  assert.equal(l.lattice.write, "full");
  assert.equal(l.lattice.shell, "advisory");
  assert.equal(l.lattice.merge, "advisory"); // min(full, advisory)
  assert.equal(l.lattice.publish, "advisory");
});

// ---------------------------------------------------------------------------
// effectiveCapabilityLevel
// ---------------------------------------------------------------------------

test("effectiveCapabilityLevel returns lattice value when present", () => {
  const lat = { ...defaultLattice(), write: "advisory" };
  assert.equal(effectiveCapabilityLevel("write", lat), "advisory");
});

test("effectiveCapabilityLevel defaults to full when lattice missing", () => {
  assert.equal(effectiveCapabilityLevel("write", undefined), "full");
});

// ---------------------------------------------------------------------------
// toolOpToCapability
// ---------------------------------------------------------------------------

test("toolOpToCapability maps all v2 ops to capabilities", () => {
  assert.equal(toolOpToCapability("read"), "read");
  assert.equal(toolOpToCapability("write"), "write");
  assert.equal(toolOpToCapability("shell"), "shell");
  assert.equal(toolOpToCapability("merge"), "merge");
  assert.equal(toolOpToCapability("network"), "network");
  assert.equal(toolOpToCapability("secret"), "secret_write");
});

// ---------------------------------------------------------------------------
// buildToolAuthorityContextFromProof
// ---------------------------------------------------------------------------

test("proof context for blocked write sets writeAuthority=none", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([
      layer("repo", { write: "none" }, "workspace-write", "auto"),
    ]),
  );
  const ctx = buildToolAuthorityContextFromProof("write", proof, false);
  assert.equal(ctx.writeAuthority, "none");
  assert.equal(ctx.approvalPolicy, "block");
});

test("proof context for advisory write sets writeAuthority=advisory", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([
      layer("repo", { write: "advisory" }, "workspace-write", "auto"),
    ]),
  );
  const ctx = buildToolAuthorityContextFromProof("write", proof, false);
  assert.equal(ctx.writeAuthority, "advisory");
  assert.equal(ctx.approvalPolicy, "interactive");
});

// ---------------------------------------------------------------------------
// decideToolAuthorityV2
// ---------------------------------------------------------------------------

test("decideToolAuthorityV2 with proof blocks when capability is blocked", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([
      layer("repo", { write: "none" }, "workspace-write", "auto"),
    ]),
  );
  const decision = decideToolAuthorityV2({
    op: "write",
    writeAuthority: "full",
    shellAuthority: "full",
    approvalPolicy: "yolo",
    sandboxMode: "workspace-write",
    tty: true,
    enforcementProof: proof,
  });
  assert.equal(decision, "block");
});

test("decideToolAuthorityV2 without proof falls back to legacy gate", () => {
  const decision = decideToolAuthorityV2({
    op: "write",
    writeAuthority: "full",
    shellAuthority: "full",
    approvalPolicy: "auto",
    sandboxMode: "workspace-write",
    tty: false,
  });
  assert.equal(decision, "allow");
});

test("decideToolAuthorityV2 interactive+TTY+proof = ask for advisory", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([
      layer("repo", { write: "advisory" }, "workspace-write", "interactive"),
    ]),
  );
  const decision = decideToolAuthorityV2({
    op: "write",
    writeAuthority: "full",
    shellAuthority: "full",
    approvalPolicy: "yolo", // should be overridden by proof
    sandboxMode: "workspace-write",
    tty: true,
    enforcementProof: proof,
  });
  assert.equal(decision, "block");
});

// ---------------------------------------------------------------------------
// isOperationAllowedByProof / isOperationApprovalRequiredByProof
// ---------------------------------------------------------------------------

test("isOperationAllowedByProof false when no proof", () => {
  assert.equal(isOperationAllowedByProof("write", undefined), false);
});

test("isOperationAllowedByProof true when capability not blocked", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([layer("user", {}, "workspace-write", "auto")]),
  );
  assert.equal(isOperationAllowedByProof("write", proof), true);
});

test("isOperationApprovalRequiredByProof true when no proof", () => {
  assert.equal(isOperationApprovalRequiredByProof("write", undefined), true);
});

test("isOperationApprovalRequiredByProof false under auto+full", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([layer("user", {}, "workspace-write", "auto")]),
  );
  assert.equal(isOperationApprovalRequiredByProof("write", proof), false);
});

// ---------------------------------------------------------------------------
// evaluateToolAuthorityV2 integration
// ---------------------------------------------------------------------------

test("evaluateToolAuthorityV2 blocks in enforce mode with proof", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([
      layer("risk", { write: "none" }, "workspace-write", "auto"),
    ]),
  );
  const { record, blocked } = evaluateToolAuthorityV2("edit_file", {
    writeAuthority: "full",
    shellAuthority: "full",
    approvalPolicy: "yolo",
    sandboxMode: "workspace-write",
    tty: false,
    enforce: true,
    enforcementProof: proof,
  });
  assert.equal(record.decision, "block");
  assert.equal(blocked, true);
  assert.equal(record.policyHash, proof.policyHash);
});

test("evaluateToolAuthorityV2 shadow mode with proof does not block", () => {
  const proof = computeEnforcementProof(
    combinePoliciesByMinAuthority([
      layer("risk", { write: "none" }, "workspace-write", "auto"),
    ]),
  );
  const { record, blocked } = evaluateToolAuthorityV2("edit_file", {
    writeAuthority: "full",
    shellAuthority: "full",
    approvalPolicy: "yolo",
    sandboxMode: "workspace-write",
    tty: false,
    enforce: false,
    enforcementProof: proof,
  });
  assert.equal(record.decision, "block");
  assert.equal(blocked, false); // shadow
  assert.equal(record.policyHash, proof.policyHash);
});

test("evaluateToolAuthorityV2 fallback to legacy when no proof", () => {
  const { record, blocked } = evaluateToolAuthorityV2("edit_file", {
    writeAuthority: "advisory",
    shellAuthority: "advisory",
    approvalPolicy: "auto",
    sandboxMode: "workspace-write",
    tty: false,
    enforce: true,
  });
  assert.equal(record.decision, "block");
  assert.equal(blocked, true);
  assert.equal(record.policyHash, undefined);
});

// ---------------------------------------------------------------------------
// Backward compatibility: legacy gate unchanged
// ---------------------------------------------------------------------------

test("legacy decideToolAuthority still works unchanged", () => {
  assert.equal(
    decideToolAuthority({
      op: "read",
      writeAuthority: "none",
      shellAuthority: "none",
      approvalPolicy: "block",
      sandboxMode: "read-only",
      tty: false,
    }),
    "allow",
  );
});

test("legacy mapToolNameToOp unchanged", () => {
  assert.equal(mapToolNameToOp("bash"), "shell");
  assert.equal(mapToolNameToOp("write_file"), "write");
  assert.equal(mapToolNameToOp("Read"), "read");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("combinePoliciesByMinAuthority ignores undefined lattice entries", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "advisory" }, undefined, undefined),
    layer("repo", {}, undefined, undefined),
  ]);
  assert.equal(combined.lattice.write, "advisory");
  assert.equal(combined.lattice.read, "full");
});

test("computeEnforcementProof deduplicates blocked+approval arrays", () => {
  const combined = combinePoliciesByMinAuthority([
    layer("user", { write: "advisory", shell: "none" }, "read-only", "interactive"),
  ]);
  const proof = computeEnforcementProof(combined);
  // shell is blocked by both none level and read-only sandbox
  assert.ok(proof.blockedCapabilities.includes("shell"));
  // shell should not appear in approvalRequired
  assert.ok(!proof.approvalRequired.includes("shell"));
});
