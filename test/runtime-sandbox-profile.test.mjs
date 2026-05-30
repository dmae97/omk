import test from "node:test";
import assert from "node:assert/strict";

const { createRuntimeSandboxProfile } = await import("../dist/runtime/sandbox-profile.js");

test("runtime sandbox profile defaults to explicit env grants and no network", () => {
  const profile = createRuntimeSandboxProfile({ cwd: "/repo" });

  assert.deepEqual(profile, {
    level: "env-only",
    cwd: "/repo",
    writableRoots: [],
    readableRoots: ["/repo"],
    network: "off",
    envPolicy: "explicit-grants",
  });
});

test("runtime sandbox profile grants only workspace root for workspace-write skeleton", () => {
  const profile = createRuntimeSandboxProfile({ cwd: "/repo", level: "workspace-write" });

  assert.deepEqual(profile.writableRoots, ["/repo"]);
  assert.deepEqual(profile.readableRoots, ["/repo"]);
  assert.equal(profile.network, "off");
});

