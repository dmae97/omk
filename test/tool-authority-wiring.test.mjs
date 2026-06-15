import test from "node:test";
import assert from "node:assert/strict";

const {
  dispatchToolCallsByContract,
  resolveToolAuthorityEnforcement,
  resolveToolAuthorityMode,
  evaluateToolAuthority,
  ToolAuthorityBlockedError,
} = await import("../dist/runtime/tool-dispatch-contracts.js");
const { capabilityScopesFromRouting } = await import("../dist/orchestration/capability-routing.js");

const registry = new Map([
  ["edit_file", { name: "edit_file", readOnly: false, parallelSafe: false }],
  ["read_file", { name: "read_file", readOnly: true, parallelSafe: true }],
  ["read", { name: "read", readOnly: true, parallelSafe: true }],
]);

const advisoryWrite = {
  writeAuthority: "advisory",
  shellAuthority: "advisory",
  approvalPolicy: "auto",
  sandboxMode: "workspace-write",
  tty: false,
};

const fullWrite = {
  writeAuthority: "full",
  shellAuthority: "full",
  approvalPolicy: "auto",
  sandboxMode: "workspace-write",
  tty: false,
};

test("shadow mode (default / flag off) never blocks and is byte-identical to ungated", async () => {
  const calls = [{ toolName: "edit_file", args: { path: "a.ts" } }];

  // Ungated baseline (no authority arg) — this is today's behavior.
  const baseline = await dispatchToolCallsByContract(calls, registry, async (c) => `ran:${c.toolName}`);

  // Shadow: authority supplied with enforce omitted (default OFF). Records only.
  const records = [];
  const shadow = await dispatchToolCallsByContract(
    calls,
    registry,
    async (c) => `ran:${c.toolName}`,
    { ...advisoryWrite, onDecision: (r) => records.push(r) },
  );

  assert.deepEqual(
    shadow.map((r) => ({ status: r.status, value: r.value })),
    baseline.map((r) => ({ status: r.status, value: r.value })),
  );
  assert.equal(shadow[0].status, "fulfilled");
  assert.equal(shadow[0].value, "ran:edit_file");
  // A verdict was still computed and recorded in shadow mode.
  assert.equal(records.length, 1);
  assert.equal(records[0].mode, "shadow");
  assert.equal(records[0].op, "write");
  assert.equal(records[0].enforced, false);
});

test("explicit enforce=false also runs in shadow (does not block advisory write)", async () => {
  const result = await dispatchToolCallsByContract(
    [{ toolName: "edit_file", args: {} }],
    registry,
    async () => "wrote",
    { ...advisoryWrite, enforce: false },
  );
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[0].value, "wrote");
});

test("enforce mode (flag on) blocks an advisory-authority write", async () => {
  const records = [];
  const result = await dispatchToolCallsByContract(
    [{ toolName: "edit_file", args: { path: "secret.ts" } }],
    registry,
    async () => {
      throw new Error("dispatchOne MUST NOT run for a blocked call");
    },
    { ...advisoryWrite, enforce: true, onDecision: (r) => records.push(r) },
  );

  assert.equal(result[0].status, "rejected");
  assert.ok(result[0].reason instanceof ToolAuthorityBlockedError);
  assert.equal(result[0].reason.op, "write");
  assert.equal(result[0].reason.decision, "block");
  // Redacted reason must not leak the tool args / file path.
  assert.ok(!result[0].reason.message.includes("secret.ts"));
  assert.match(result[0].reason.message, /tool-authority block for write op/);
  assert.equal(records[0].mode, "enforce");
  assert.equal(records[0].enforced, true);
});

test("enforce mode allows a full-authority write", async () => {
  const result = await dispatchToolCallsByContract(
    [{ toolName: "edit_file", args: {} }],
    registry,
    async () => "wrote",
    { ...fullWrite, enforce: true },
  );
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[0].value, "wrote");
});

test("enforce mode never blocks reads even at advisory authority", async () => {
  const result = await dispatchToolCallsByContract(
    [{ toolName: "read", args: {} }],
    registry,
    async () => "data",
    { ...advisoryWrite, enforce: true },
  );
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[0].value, "data");
});

test("enforce mode fails closed: unknown tool name is treated as shell", async () => {
  // mapToolNameToOp maps unrecognized names to the most restrictive op (shell),
  // so an unknown tool at advisory shell authority is blocked under enforcement.
  const result = await dispatchToolCallsByContract(
    [{ toolName: "read_file", args: {} }],
    registry,
    async () => "data",
    { ...advisoryWrite, enforce: true },
  );
  assert.equal(result[0].status, "rejected");
  assert.ok(result[0].reason instanceof ToolAuthorityBlockedError);
  assert.equal(result[0].reason.op, "shell");
});

test("evaluateToolAuthority is pure: enforce flag controls blocking only", () => {
  const shadow = evaluateToolAuthority("edit_file", advisoryWrite);
  assert.equal(shadow.record.decision, "block");
  assert.equal(shadow.blocked, false); // shadow: computed but not enforced
  const enforced = evaluateToolAuthority("edit_file", { ...advisoryWrite, enforce: true });
  assert.equal(enforced.blocked, true);
});

test("resolveToolAuthorityEnforcement defaults OFF and honors opt-in flag", () => {
  assert.equal(resolveToolAuthorityEnforcement({}), false);
  assert.equal(resolveToolAuthorityEnforcement({ OMK_TOOL_AUTHORITY_ENFORCE: "0" }), false);
  assert.equal(resolveToolAuthorityEnforcement({ OMK_TOOL_AUTHORITY_ENFORCE: "1" }), true);
  assert.equal(resolveToolAuthorityEnforcement({ OMK_TOOL_AUTHORITY_ENFORCE: "true" }), true);
});

test("resolveToolAuthorityMode supports staged shadow/warn/enforce", () => {
  assert.equal(resolveToolAuthorityMode({}), "shadow");
  assert.equal(resolveToolAuthorityMode({ OMK_TOOL_AUTHORITY_MODE: "warn" }), "warn");
  assert.equal(resolveToolAuthorityMode({ OMK_TOOL_AUTHORITY_MODE: "enforce" }), "enforce");
  assert.equal(resolveToolAuthorityMode({ OMK_TOOL_AUTHORITY_WARN: "1" }), "warn");
  assert.equal(resolveToolAuthorityMode({ OMK_TOOL_AUTHORITY_ENFORCE: "1" }), "enforce");
});

test("capabilityScopesFromRouting defaults authority to full (coder lane stays full)", () => {
  const noRouting = capabilityScopesFromRouting(undefined);
  assert.equal(noRouting.writeAuthority, "full");
  assert.equal(noRouting.shellAuthority, "full");
  assert.equal(noRouting.mcpAuthority, "full");

  const authorityLane = capabilityScopesFromRouting({ assignedProviderAuthority: "authority" });
  assert.equal(authorityLane.writeAuthority, "full");
  assert.equal(authorityLane.shellAuthority, "full");

  const advisoryLane = capabilityScopesFromRouting({ assignedProviderAuthority: "advisory" });
  assert.equal(advisoryLane.writeAuthority, "advisory");
  assert.equal(advisoryLane.shellAuthority, "advisory");
});
