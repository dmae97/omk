import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeHarnessRun } from "../dist/harness/execute-harness-run.js";
import { createDag } from "../dist/orchestration/dag.js";

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "omk-harness-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createSingleNodeDag(id = "node-1") {
  return createDag({
    nodes: [
      {
        id,
        name: "Harness test node",
        role: "tester",
        dependsOn: [],
        maxRetries: 1,
        routing: {
          readOnly: true,
          rationale: "test harness execution",
        },
      },
    ],
  });
}

test("executeHarnessRun runs a DAG through the shared executor and persists RunState", async () => {
  await withTempRoot(async (root) => {
    const calls = [];
    const starts = [];
    const completes = [];
    const runner = {
      async run(node, env, _signal, context) {
        calls.push({
          nodeId: node.id,
          envRunId: env.OMK_RUN_ID,
          baseEnv: env.CUSTOM_BASE_ENV,
          envMcpConfigFile: env.OMK_MCP_CONFIG_FILE,
          contextRunId: context?.goal?.runId,
          contextRoot: context?.goal?.root,
          workerRunId: context?.worker?.runId,
          contextMcpConfigFile: context?.worker?.toolPlane?.mcpConfigFile,
        });
        return {
          success: true,
          stdout: "## Summary\nok\n\n## Evidence\nok",
          stderr: "",
        };
      },
    };

    const result = await executeHarnessRun({
      root,
      runId: "harness-test",
      dag: createSingleNodeDag(),
      runner,
      env: {
        CUSTOM_BASE_ENV: "base-value",
        OMK_MCP_CONFIG_FILE: join(root, ".kimi", "mcp.json"),
      },
      workers: 1,
      approvalPolicy: "block",
      onNodeStart: (node) => starts.push(node.id),
      onNodeComplete: (node, taskResult) => completes.push([node.id, taskResult.success]),
    });

    assert.equal(result.success, true);
    assert.equal(result.state.runId, "harness-test");
    assert.equal(result.state.nodes[0].status, "done");
    assert.deepEqual(calls, [
      {
        nodeId: "node-1",
        envRunId: "harness-test",
        baseEnv: "base-value",
        envMcpConfigFile: join(root, ".kimi", "mcp.json"),
        contextRunId: "harness-test",
        contextRoot: root,
        workerRunId: "harness-test",
        contextMcpConfigFile: join(root, ".kimi", "mcp.json"),
      },
    ]);
    assert.deepEqual(starts, ["node-1"]);
    assert.deepEqual(completes, [["node-1", true]]);

    const persisted = JSON.parse(
      await readFile(join(root, ".omk", "runs", "harness-test", "state.json"), "utf8")
    );
    assert.equal(persisted.runId, "harness-test");
    assert.equal(persisted.nodes[0].status, "done");
  });
});

test("executeHarnessRun preserves harness env when the runner is forked", async () => {
  await withTempRoot(async (root) => {
    const calls = [];
    let forked = false;
    const runner = {
      fork() {
        forked = true;
        return {
          async run(_node, env, _signal, context) {
            calls.push({
              baseEnv: env.CUSTOM_BASE_ENV,
              envMcpConfigFile: env.OMK_MCP_CONFIG_FILE,
              contextMcpConfigFile: context?.worker?.toolPlane?.mcpConfigFile,
            });
            return {
              success: true,
              stdout: "## Summary\nok\n\n## Evidence\nok",
              stderr: "",
            };
          },
        };
      },
      async run() {
        throw new Error("base runner should be forked by the executor");
      },
    };

    const result = await executeHarnessRun({
      root,
      runId: "harness-fork-env",
      dag: createSingleNodeDag("forked-node"),
      runner,
      env: {
        CUSTOM_BASE_ENV: "base-value",
        OMK_MCP_CONFIG_FILE: join(root, ".kimi", "mcp.json"),
      },
      workers: 1,
      approvalPolicy: "block",
    });

    assert.equal(result.success, true);
    assert.equal(forked, true);
    assert.deepEqual(calls, [
      {
        baseEnv: "base-value",
        envMcpConfigFile: join(root, ".kimi", "mcp.json"),
        contextMcpConfigFile: join(root, ".kimi", "mcp.json"),
      },
    ]);
  });
});

test("executeHarnessRun marks the run failed when a required node fails", async () => {
  await withTempRoot(async (root) => {
    const result = await executeHarnessRun({
      root,
      runId: "harness-fail",
      dag: createSingleNodeDag("failing-node"),
      runner: {
        async run() {
          return {
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: "boom",
          };
        },
      },
      workers: 1,
      approvalPolicy: "block",
    });

    assert.equal(result.success, false);
    assert.equal(result.state.nodes[0].status, "failed");

    const persisted = JSON.parse(
      await readFile(join(root, ".omk", "runs", "harness-fail", "state.json"), "utf8")
    );
    assert.equal(persisted.nodes[0].status, "failed");
  });
});
