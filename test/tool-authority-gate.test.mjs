import test from "node:test";
import assert from "node:assert/strict";

// Imported directly from source: tool-authority-gate.ts only uses a type-only
// import, so Node's native type-stripping loads it with no runtime dependency.
import {
  decideToolAuthority,
  mapToolNameToOp,
} from "../dist/safety/tool-authority-gate.js";

/**
 * Build a ToolAuthorityContext with conservative defaults, overridable per case.
 * Defaults: write op, no authority, interactive policy, workspace-write, no TTY.
 */
function ctx(overrides = {}) {
  return {
    op: "write",
    writeAuthority: "none",
    shellAuthority: "none",
    approvalPolicy: "interactive",
    sandboxMode: "workspace-write",
    tty: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// decideToolAuthority matrix
// ---------------------------------------------------------------------------

test("advisory write under auto+workspace-write -> block (authority not full)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "advisory", approvalPolicy: "auto" }),
    ),
    "block",
  );
});

test("none write under auto+workspace-write -> block (authority not full)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "none", approvalPolicy: "auto" }),
    ),
    "block",
  );
});

test("direct write under auto+workspace-write -> block (direct is not full)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "direct", approvalPolicy: "auto" }),
    ),
    "block",
  );
});

test("none shell under yolo -> block (authority outranks policy)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "shell", shellAuthority: "none", approvalPolicy: "yolo", tty: true }),
    ),
    "block",
  );
});

test("full write under read-only sandbox -> block (sandbox hard floor)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({
        op: "write",
        writeAuthority: "full",
        approvalPolicy: "yolo",
        sandboxMode: "read-only",
        tty: true,
      }),
    ),
    "block",
  );
});

test("full write under auto+workspace-write -> allow", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "full", approvalPolicy: "auto" }),
    ),
    "allow",
  );
});

test("full write interactive+TTY -> ask", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "full", approvalPolicy: "interactive", tty: true }),
    ),
    "ask",
  );
});

test("full write interactive+non-TTY -> block (deny-by-default)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "full", approvalPolicy: "interactive", tty: false }),
    ),
    "block",
  );
});

test("full write block-policy -> block", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "full", approvalPolicy: "block", tty: true }),
    ),
    "block",
  );
});

test("full write yolo -> allow", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "write", writeAuthority: "full", approvalPolicy: "yolo" }),
    ),
    "allow",
  );
});

test("full shell under auto -> allow", () => {
  assert.equal(
    decideToolAuthority(
      ctx({ op: "shell", shellAuthority: "full", approvalPolicy: "auto" }),
    ),
    "allow",
  );
});

test("merge with only write=full -> block (needs both write+shell full)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({
        op: "merge",
        writeAuthority: "full",
        shellAuthority: "none",
        approvalPolicy: "auto",
      }),
    ),
    "block",
  );
});

test("merge with only shell=full -> block (needs both write+shell full)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({
        op: "merge",
        writeAuthority: "none",
        shellAuthority: "full",
        approvalPolicy: "auto",
      }),
    ),
    "block",
  );
});

test("merge with write+shell=full under auto -> allow", () => {
  assert.equal(
    decideToolAuthority(
      ctx({
        op: "merge",
        writeAuthority: "full",
        shellAuthority: "full",
        approvalPolicy: "auto",
      }),
    ),
    "allow",
  );
});

test("merge write+shell full interactive+TTY -> ask", () => {
  assert.equal(
    decideToolAuthority(
      ctx({
        op: "merge",
        writeAuthority: "full",
        shellAuthority: "full",
        approvalPolicy: "interactive",
        tty: true,
      }),
    ),
    "ask",
  );
});

test("merge write+shell full interactive+non-TTY -> block", () => {
  assert.equal(
    decideToolAuthority(
      ctx({
        op: "merge",
        writeAuthority: "full",
        shellAuthority: "full",
        approvalPolicy: "interactive",
        tty: false,
      }),
    ),
    "block",
  );
});

test("any read -> allow (even read-only sandbox, block policy, no authority)", () => {
  assert.equal(
    decideToolAuthority(
      ctx({
        op: "read",
        writeAuthority: "none",
        shellAuthority: "none",
        approvalPolicy: "block",
        sandboxMode: "read-only",
        tty: false,
      }),
    ),
    "allow",
  );
});

test("read always allows under yolo+workspace-write too", () => {
  assert.equal(
    decideToolAuthority(ctx({ op: "read", approvalPolicy: "yolo" })),
    "allow",
  );
});

// ---------------------------------------------------------------------------
// mapToolNameToOp matrix
// ---------------------------------------------------------------------------

test("mapToolNameToOp: shell-family -> shell", () => {
  assert.equal(mapToolNameToOp("bash"), "shell");
  assert.equal(mapToolNameToOp("Shell"), "shell");
  assert.equal(mapToolNameToOp("RunShell"), "shell");
});

test("mapToolNameToOp: write-family -> write", () => {
  assert.equal(mapToolNameToOp("write_file"), "write");
  assert.equal(mapToolNameToOp("Write"), "write");
  assert.equal(mapToolNameToOp("StrReplace"), "write");
  assert.equal(mapToolNameToOp("applyDiff"), "write");
  assert.equal(mapToolNameToOp("edit"), "write");
});

test("mapToolNameToOp: git history/publish ops -> merge", () => {
  assert.equal(mapToolNameToOp("git push"), "merge");
  assert.equal(mapToolNameToOp("git merge"), "merge");
  assert.equal(mapToolNameToOp("git cherry-pick"), "merge");
  assert.equal(mapToolNameToOp("git rebase"), "merge");
  assert.equal(mapToolNameToOp("git tag"), "merge");
  assert.equal(mapToolNameToOp("merge"), "merge");
});

test("mapToolNameToOp: read-family -> read", () => {
  assert.equal(mapToolNameToOp("Read"), "read");
  assert.equal(mapToolNameToOp("Grep"), "read");
  assert.equal(mapToolNameToOp("Glob"), "read");
  assert.equal(mapToolNameToOp("ls"), "read");
  assert.equal(mapToolNameToOp("cat"), "read");
});

test("mapToolNameToOp: unknown -> non-read restrictive (shell)", () => {
  const op = mapToolNameToOp("totally-unknown-frobnicator");
  assert.notEqual(op, "read");
  assert.equal(op, "shell");
});

test("mapToolNameToOp: empty/whitespace -> non-read restrictive (shell)", () => {
  assert.notEqual(mapToolNameToOp("   "), "read");
  assert.equal(mapToolNameToOp("   "), "shell");
});

// ---------------------------------------------------------------------------
// Integration: name -> op -> decision (still fail-closed end to end)
// ---------------------------------------------------------------------------

test("integration: unknown tool blocks without full shell authority", () => {
  const op = mapToolNameToOp("mystery-tool");
  assert.equal(
    decideToolAuthority(ctx({ op, shellAuthority: "advisory", approvalPolicy: "auto" })),
    "block",
  );
});

test("integration: Read tool always allows regardless of policy", () => {
  const op = mapToolNameToOp("Read");
  assert.equal(
    decideToolAuthority(ctx({ op, approvalPolicy: "block", sandboxMode: "read-only" })),
    "allow",
  );
});
