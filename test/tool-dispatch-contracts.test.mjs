import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const { dispatchToolCallsByContract } = await import("../dist/runtime/tool-dispatch-contracts.js");

test("dispatchToolCallsByContract runs parallel-safe tools concurrently but appends in declared order", async () => {
  const registry = new Map([
    ["slow_read", { name: "slow_read", readOnly: true, parallelSafe: true, fn: async () => "slow" }],
    ["fast_read", { name: "fast_read", readOnly: true, parallelSafe: true, fn: async () => "fast" }],
    ["edit_file", { name: "edit_file", readOnly: false, parallelSafe: false, fn: async () => "edit" }],
  ]);
  const started = [];
  const calls = [
    { toolName: "slow_read", args: {} },
    { toolName: "fast_read", args: {} },
    { toolName: "edit_file", args: {} },
    { toolName: "fast_read", args: { after: "edit" } },
  ];

  const results = await dispatchToolCallsByContract(calls, registry, async (call) => {
    started.push(call.toolName);
    if (call.toolName === "slow_read") {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return call.toolName;
  });

  assert.deepEqual(
    results.map((result) => result.call.toolName),
    ["slow_read", "fast_read", "edit_file", "fast_read"],
  );
  assert.deepEqual(started.slice(0, 2).sort(), ["fast_read", "slow_read"]);
  assert.equal(started[2], "edit_file");
});

// --- Lane C2 write-path enforcement wiring (Wave-4 C2) ----------------------

const WRITE_REGISTRY = new Map([
  ["edit_file", { name: "edit_file", readOnly: false, parallelSafe: false, fn: async () => "edit" }],
]);

// Authority wiring that yields a non-blocking "allow" verdict for a write op so
// the write-path check (not the authority gate) is what we are exercising.
function allowWriting(overrides) {
  return {
    writeAuthority: "full",
    shellAuthority: "full",
    approvalPolicy: "auto",
    sandboxMode: "workspace-write",
    tty: true,
    ...overrides,
  };
}

test("(a) enforce + writableRoots + resolveWritePath: out-of-root write throws; dispatchOne NOT called", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omk-disp-")));
  try {
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, "escape")); // root/escape -> outside
    let dispatched = 0;
    const calls = [{ toolName: "edit_file", args: { p: path.join(root, "escape", "evil.txt") } }];
    const wiring = allowWriting({
      enforce: true,
      writableRoots: [root],
      resolveWritePath: (call) => call.args.p,
    });
    const results = await dispatchToolCallsByContract(
      calls,
      WRITE_REGISTRY,
      async () => {
        dispatched += 1;
        return "ok";
      },
      wiring,
    );
    assert.equal(dispatched, 0, "dispatchOne must not run on a denied write");
    assert.equal(results[0].status, "rejected");
    assert.equal(results[0].reason?.name, "SandboxWriteDeniedError");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(b) enforce + writableRoots + resolveWritePath: in-root write => dispatchOne called", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omk-disp-")));
  try {
    let dispatched = 0;
    const calls = [{ toolName: "edit_file", args: { p: path.join(base, "sub", "ok.txt") } }];
    const wiring = allowWriting({
      enforce: true,
      writableRoots: [base],
      resolveWritePath: (call) => call.args.p,
    });
    const results = await dispatchToolCallsByContract(
      calls,
      WRITE_REGISTRY,
      async () => {
        dispatched += 1;
        return "ok";
      },
      wiring,
    );
    assert.equal(dispatched, 1, "dispatchOne must run for an in-root write");
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[0].value, "ok");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(c) no resolveWritePath OR enforce=false => byte-identical pass-through (no path check)", async () => {
  // c1: resolveWritePath provided + writableRoots but enforce=false => no check.
  let dispatchedA = 0;
  const callsA = [{ toolName: "edit_file", args: { p: "/definitely/outside/all/roots.txt" } }];
  const resA = await dispatchToolCallsByContract(
    callsA,
    WRITE_REGISTRY,
    async () => {
      dispatchedA += 1;
      return "ok";
    },
    allowWriting({ enforce: false, writableRoots: ["/some/root"], resolveWritePath: (c) => c.args.p }),
  );
  assert.equal(dispatchedA, 1, "enforce=false must skip the write-path check");
  assert.equal(resA[0].status, "fulfilled");

  // c2: enforce=true + writableRoots but NO resolveWritePath => no check.
  let dispatchedB = 0;
  const callsB = [{ toolName: "edit_file", args: { p: "/definitely/outside/all/roots.txt" } }];
  const resB = await dispatchToolCallsByContract(
    callsB,
    WRITE_REGISTRY,
    async () => {
      dispatchedB += 1;
      return "ok";
    },
    allowWriting({ enforce: true, writableRoots: ["/some/root"] }),
  );
  assert.equal(dispatchedB, 1, "missing resolveWritePath must skip the write-path check");
  assert.equal(resB[0].status, "fulfilled");
});
