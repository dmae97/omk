import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildExpectedTeamRuntimeStatus, writeTeamRunState } from "../dist/commands/team.js";

test("team run state records runtime window reporting metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-team-runtime-"));
  try {
    const statePath = await writeTeamRunState(root, "team-runtime-test", 2, "omk-team-test");
    const state = JSON.parse(await readFile(statePath, "utf-8"));

    assert.equal(state.teamRuntime.session, "omk-team-test");
    assert.equal(state.teamRuntime.status, "starting");
    assert.equal(state.teamRuntime.workerCount, 2);
    assert.equal(state.teamRuntime.reviewerCount, 1);
    assert.equal(state.teamRuntime.windows.length, 4);
    assert.deepEqual(state.teamRuntime.windows.map((window) => window.name), ["coordinator", "worker-1", "worker-2", "reviewer"]);
    assert.deepEqual(state.teamRuntime.windows.map((window) => window.status), ["expected", "expected", "expected", "expected"]);
    assert.equal(state.teamRuntime.statePath, statePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("team runtime status marks tmux windows as present when discovered", () => {
  const present = new Map([
    ["coordinator", 2],
    ["worker-1", 1],
    ["reviewer", 1],
  ]);
  const runtime = buildExpectedTeamRuntimeStatus("omk-team", "/tmp/state.json", 1, "ready", present);

  assert.equal(runtime.coordinatorPanes, 2);
  assert.deepEqual(runtime.windows.map((window) => window.status), ["present", "present", "present"]);
});
