import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { createDag, skipNode } from "../dist/orchestration/dag.js";
import { createScheduler } from "../dist/orchestration/scheduler.js";
import { createEnsembleTaskRunner } from "../dist/orchestration/ensemble.js";
import { createExecutor } from "../dist/orchestration/executor.js";
import { estimateRunProgress } from "../dist/orchestration/eta.js";
import { createRoutedRunState, refreshRunStateEstimate, routeRunState, createExecutableDagFromState } from "../dist/orchestration/run-state.js";
import { discoverRoutingInventory, resetRoutingInventoryCache } from "../dist/orchestration/routing.js";
import { collectMcpConfigs, getUserHome, normalizeUserHomePath } from "../dist/util/fs.js";
import { resetTimeoutPresetCache, resolveTimeoutMs } from "../dist/util/timeout-config.js";

async function tempWorktree() {
  return mkdtemp(join(tmpdir(), "omk-ensemble-"));
}

function toWslUncPath(absPath, distro = "Ubuntu-24.04") {
  return `\\\\wsl.localhost\\${distro}${absPath.replace(/\//g, "\\")}`;
}

async function withRoutingSkills(skills, fn) {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-routing-skills-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousSkillsScope = process.env.OMK_SKILLS_SCOPE;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  process.env.OMK_SKILLS_SCOPE = "project";
  resetRoutingInventoryCache();

  try {
    for (const skill of skills) {
      const dir = join(projectRoot, ".agents", "skills", skill);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `# ${skill}\n`);
    }
    resetRoutingInventoryCache();
    return await fn(projectRoot);
  } finally {
    resetRoutingInventoryCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("OMK_SKILLS_SCOPE", previousSkillsScope);
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("task graph returns runnable nodes in deterministic topological order", () => {
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
      { id: "review", name: "Review", role: "reviewer", dependsOn: ["code"], maxRetries: 1 },
    ],
  });
  const scheduler = createScheduler();

  assert.deepEqual(scheduler.getRunnableNodes(dag).map((node) => node.id), ["plan"]);
  scheduler.updateNodeStatus(dag, "plan", "done");
  assert.deepEqual(scheduler.getRunnableNodes(dag).map((node) => node.id), ["code"]);
});

test("task graph ranks critical-path runnable nodes before low-impact siblings", () => {
  const dag = createDag({
    nodes: [
      { id: "side", name: "Side task", role: "coder", dependsOn: [], maxRetries: 1 },
      { id: "root", name: "Root critical task", role: "planner", dependsOn: [], maxRetries: 1 },
      { id: "mid", name: "Middle", role: "coder", dependsOn: ["root"], maxRetries: 1 },
      { id: "leaf", name: "Leaf", role: "reviewer", dependsOn: ["mid"], maxRetries: 1 },
    ],
  });

  assert.deepEqual(createScheduler().getRunnableNodes(dag).map((node) => node.id), ["root", "side"]);
});

test("createDag adds bounded Kimi routing hints without changing node contract", async () => {
  await withRoutingSkills(["omk-research-verify"], async () => {
    const dag = createDag({
      nodes: [
        {
          id: "route-research",
          name: "Verify Kimi paper and official API docs before planner handoff",
          role: "researcher",
          dependsOn: [],
          maxRetries: 1,
          outputs: [{ name: "citation notes", gate: "summary" }],
        },
      ],
    });
    const routing = dag.nodes[0].routing;

    assert.ok(routing?.skills?.includes("omk-research-verify"));
    assert.ok(routing?.tools?.includes("SearchWeb"));
    assert.ok((routing?.skills?.length ?? 0) <= 3);
    assert.ok((routing?.tools?.length ?? 0) <= 4);
    assert.equal(routing?.contextBudget, "small");
    assert.equal(routing?.evidenceRequired, true);
  });
});

test("routing inventory discovers project skills and MCP without global scope", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-routing-inventory-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousSkillsScope = process.env.OMK_SKILLS_SCOPE;
  const previousMcpScope = process.env.OMK_MCP_SCOPE;
  const previousHooksScope = process.env.OMK_HOOKS_SCOPE;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  process.env.OMK_SKILLS_SCOPE = "project";
  process.env.OMK_MCP_SCOPE = "project";
  process.env.OMK_HOOKS_SCOPE = "project";
  resetRoutingInventoryCache();

  try {
    await mkdir(join(projectRoot, ".agents", "skills", "omk-repo-explorer"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi", "skills", "omk-task-router"), { recursive: true });
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, ".agents", "skills", "omk-repo-explorer", "SKILL.md"), "# repo explorer\n");
    await writeFile(join(projectRoot, ".kimi", "skills", "omk-task-router", "SKILL.md"), "# task router\n");
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": { command: "node" } } }));
    await writeFile(join(projectRoot, ".omk", "kimi.config.toml"), [
      "[[hooks]]",
      "event = \"SubagentStop\"",
      "command = \".omk/hooks/subagent-stop-audit.sh\"",
      "",
    ].join("\n"));

    const inventory = discoverRoutingInventory(projectRoot);

    assert.equal(inventory.skills.get("omk-repo-explorer"), "project");
    assert.equal(inventory.skills.get("omk-task-router"), "project");
    assert.equal(inventory.mcpServers.get("omk-project"), "project");
    assert.equal(inventory.hooks.get("subagent-stop-audit.sh"), "project");
    assert.equal(inventory.tools.has("omk_run_quality_gate"), true);
    assert.equal(inventory.skillsScope, "project");
    assert.equal(inventory.mcpScope, "project");
    assert.equal(inventory.hooksScope, "project");
  } finally {
    resetRoutingInventoryCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("OMK_SKILLS_SCOPE", previousSkillsScope);
    restoreEnv("OMK_MCP_SCOPE", previousMcpScope);
    restoreEnv("OMK_HOOKS_SCOPE", previousHooksScope);
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("routing inventory reports invalid MCP JSON without dropping valid project MCP", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-routing-invalid-mcp-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousMcpScope = process.env.OMK_MCP_SCOPE;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  process.env.OMK_MCP_SCOPE = "project";
  resetRoutingInventoryCache();

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "mcp.json"), "{ invalid json", "utf-8");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": { command: "node" } } }), "utf-8");

    const inventory = discoverRoutingInventory(projectRoot);

    assert.equal(inventory.mcpServers.get("omk-project"), "project");
    assert.equal(inventory.diagnostics.length, 1);
    assert.deepEqual(inventory.diagnostics[0], {
      kind: "mcp-config",
      source: "project",
      path: join(".omk", "mcp.json"),
      message: "invalid JSON",
    });
  } finally {
    resetRoutingInventoryCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("OMK_MCP_SCOPE", previousMcpScope);
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("project MCP scope excludes global Kimi MCP config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-scope-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": {} } }));
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }));

    const configs = await collectMcpConfigs("project");

    assert.deepEqual(configs, [join(projectRoot, ".kimi", "mcp.json")]);
    assert.equal(configs.includes(join(projectRoot, ".omk", "mcp.json")), false);
    assert.equal(configs.some((path) => path.startsWith(join(homedir(), ".kimi"))), false);
  } finally {
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("global MCP and skills resolve through OMK_ORIGINAL_HOME when HOME is isolated", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-original-home-project-"));
  const originalHome = await mkdtemp(join(tmpdir(), "omk-original-home-"));
  const isolatedHome = await mkdtemp(join(tmpdir(), "omk-isolated-home-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousHome = process.env.HOME;
  const previousOriginalHome = process.env.OMK_ORIGINAL_HOME;
  const previousMcpScope = process.env.OMK_MCP_SCOPE;
  const previousSkillsScope = process.env.OMK_SKILLS_SCOPE;

  try {
    await mkdir(join(originalHome, ".kimi"), { recursive: true });
    await mkdir(join(originalHome, ".kimi", "skills", "global-skill"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(join(originalHome, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: { "global-original": { command: "node" } } }));
    await writeFile(join(originalHome, ".kimi", "skills", "global-skill", "SKILL.md"), "# global skill\n");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": { command: "omk-project-mcp" } } }));

    process.env.OMK_PROJECT_ROOT = projectRoot;
    process.env.HOME = isolatedHome;
    process.env.OMK_ORIGINAL_HOME = originalHome;
    process.env.OMK_MCP_SCOPE = "all";
    process.env.OMK_SKILLS_SCOPE = "all";
    resetRoutingInventoryCache();

    const configs = await collectMcpConfigs("all");
    assert.deepEqual(configs, [
      join(originalHome, ".kimi", "mcp.json"),
      join(projectRoot, ".kimi", "mcp.json"),
    ]);
    assert.equal(configs.some((path) => path.startsWith(isolatedHome)), false);

    const inventory = discoverRoutingInventory(projectRoot);
    assert.equal(inventory.mcpServers.get("global-original"), "global");
    assert.equal(inventory.mcpServers.get("omk-project"), "project");
    assert.equal(inventory.skills.get("global-skill"), "global");
  } finally {
    resetRoutingInventoryCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("HOME", previousHome);
    restoreEnv("OMK_ORIGINAL_HOME", previousOriginalHome);
    restoreEnv("OMK_MCP_SCOPE", previousMcpScope);
    restoreEnv("OMK_SKILLS_SCOPE", previousSkillsScope);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(originalHome, { recursive: true, force: true });
    await rm(isolatedHome, { recursive: true, force: true });
  }
});

test("global MCP resolves WSL UNC ~/.kimi/mcp.json paths through the native home", {
  skip: process.platform === "win32" ? "WSL UNC normalization is validated from WSL/POSIX runtimes" : false,
}, async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-wsl-unc-project-"));
  const originalHome = await mkdtemp(join(tmpdir(), "omk-wsl-unc-home-"));
  const isolatedHome = await mkdtemp(join(tmpdir(), "omk-wsl-unc-isolated-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousHome = process.env.HOME;
  const previousOriginalHome = process.env.OMK_ORIGINAL_HOME;
  const previousMcpScope = process.env.OMK_MCP_SCOPE;
  const previousSkillsScope = process.env.OMK_SKILLS_SCOPE;

  try {
    await mkdir(join(originalHome, ".kimi", "skills", "global-wsl-skill"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(join(originalHome, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: { "global-wsl": { command: "node" } } }));
    await writeFile(join(originalHome, ".kimi", "skills", "global-wsl-skill", "SKILL.md"), "# global WSL skill\n");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": { command: "omk-project-mcp" } } }));

    const uncMcpPath = toWslUncPath(join(originalHome, ".kimi", "mcp.json"));
    const uncSkillsPath = toWslUncPath(join(originalHome, ".kimi", "skills"));
    process.env.OMK_PROJECT_ROOT = projectRoot;
    process.env.HOME = isolatedHome;
    process.env.OMK_ORIGINAL_HOME = uncMcpPath;
    process.env.OMK_MCP_SCOPE = "all";
    process.env.OMK_SKILLS_SCOPE = "all";
    resetRoutingInventoryCache();

    assert.equal(normalizeUserHomePath(uncMcpPath), originalHome);
    assert.equal(normalizeUserHomePath(uncSkillsPath), originalHome);
    assert.equal(getUserHome(), originalHome);

    const configs = await collectMcpConfigs("all");
    assert.deepEqual(configs, [
      join(originalHome, ".kimi", "mcp.json"),
      join(projectRoot, ".kimi", "mcp.json"),
    ]);

    const inventory = discoverRoutingInventory(projectRoot);
    assert.equal(inventory.mcpServers.get("global-wsl"), "global");
    assert.equal(inventory.mcpServers.get("omk-project"), "project");
    assert.equal(inventory.skills.get("global-wsl-skill"), "global");
  } finally {
    resetRoutingInventoryCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("HOME", previousHome);
    restoreEnv("OMK_ORIGINAL_HOME", previousOriginalHome);
    restoreEnv("OMK_MCP_SCOPE", previousMcpScope);
    restoreEnv("OMK_SKILLS_SCOPE", previousSkillsScope);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(originalHome, { recursive: true, force: true });
    await rm(isolatedHome, { recursive: true, force: true });
  }
});

test("run state routing helper enriches synthetic CLI nodes", async () => {
  await withRoutingSkills(["omk-industrial-control-loop", "omk-quality-gate"], async () => {
    const state = createRoutedRunState({
      runId: "run-state-test",
      startedAt: "2026-05-01T00:00:00.000Z",
      workerCount: 2,
      nodes: [
        { id: "coordinator", name: "Coordinate DAG team", role: "orchestrator", dependsOn: [], maxRetries: 1 },
        { id: "review", name: "Review quality gate", role: "reviewer", dependsOn: ["coordinator"], maxRetries: 1 },
      ],
    });

    assert.equal(state.nodes[0].status, "pending");
    assert.ok(state.nodes[0].routing?.skills?.includes("omk-industrial-control-loop"));
    assert.ok(state.nodes[1].routing?.skills?.includes("omk-quality-gate"));
    assert.equal(state.estimate?.totalNodes, 2);
  });
});

test("run state estimate can be refreshed after synthetic status changes", () => {
  const state = createRoutedRunState({
    runId: "estimate-refresh-test",
    startedAt: "2026-05-01T00:00:00.000Z",
    workerCount: 2,
    nodes: [
      { id: "bootstrap", name: "Bootstrap", role: "omk", dependsOn: [], maxRetries: 1 },
      { id: "coordinator", name: "Coordinate DAG team", role: "orchestrator", dependsOn: ["bootstrap"], maxRetries: 1 },
    ],
  });

  state.nodes[0].status = "done";
  state.nodes[1].status = "running";
  refreshRunStateEstimate(state, 2);

  assert.equal(state.estimate?.completedNodes, 1);
  assert.equal(state.estimate?.runningNodes, 1);
});

test("routeRunState preserves runtime status while refreshing routing metadata", async () => {
  await withRoutingSkills(["omk-industrial-control-loop"], async () => {
    const routed = routeRunState({
      runId: "resume-test",
      startedAt: "2026-05-01T00:00:00.000Z",
      nodes: [
        {
          id: "root",
          name: "Coordinate resumed DAG",
          role: "orchestrator",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 1,
          startedAt: "2026-05-01T00:00:01.000Z",
        },
      ],
    });

    assert.equal(routed.nodes[0].status, "running");
    assert.equal(routed.nodes[0].startedAt, "2026-05-01T00:00:01.000Z");
    assert.ok(routed.nodes[0].routing?.skills?.includes("omk-industrial-control-loop"));
  });
});

test("scheduler blocks descendants after a terminal failed dependency", () => {
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
      { id: "review", name: "Review", role: "reviewer", dependsOn: ["code"], maxRetries: 1 },
    ],
  });
  const scheduler = createScheduler();

  scheduler.updateNodeStatus(dag, "plan", "failed");

  assert.equal(dag.nodes.find((node) => node.id === "code")?.status, "blocked");
  assert.equal(dag.nodes.find((node) => node.id === "review")?.status, "blocked");
  assert.equal(scheduler.isFailed(dag), true);
});

test("scheduler keeps transitive optional dependents runnable after a blocker", () => {
  const dag = createDag({
    nodes: [
      { id: "discover", name: "Discover", role: "researcher", dependsOn: [], maxRetries: 1 },
      { id: "summarize", name: "Summarize", role: "writer", dependsOn: ["discover"], maxRetries: 1 },
      {
        id: "report",
        name: "Report with optional summary",
        role: "reviewer",
        dependsOn: ["summarize"],
        maxRetries: 1,
        inputs: [{ name: "optional summary", ref: "summary.md", from: "summarize", required: false }],
      },
    ],
  });
  const scheduler = createScheduler();

  scheduler.updateNodeStatus(dag, "discover", "failed");

  assert.equal(dag.nodes.find((node) => node.id === "summarize")?.status, "blocked");
  assert.equal(dag.nodes.find((node) => node.id === "report")?.status, "pending");
  assert.deepEqual(scheduler.getRunnableNodes(dag).map((node) => node.id), ["report"]);
});

test("createDag rejects hidden input dependencies", () => {
  assert.throws(
    () => createDag({
      nodes: [
        { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
        {
          id: "code",
          name: "Code",
          role: "coder",
          dependsOn: [],
          maxRetries: 1,
          inputs: [{ name: "plan output", ref: "plan.md", from: "plan" }],
        },
      ],
    }),
    /hidden dependency/
  );
});

test("createDag rejects malformed dependency contracts", () => {
  assert.throws(
    () => createDag({ nodes: "not-an-array" }),
    /nodes array/
  );
  assert.throws(
    () => createDag({
      nodes: [
        { id: "plan", name: "Plan", role: "planner", dependsOn: ["plan"], maxRetries: 1 },
      ],
    }),
    /cannot depend on itself/
  );
  assert.throws(
    () => createDag({
      nodes: [
        { id: "code", name: "Code", role: "coder", dependsOn: [], maxRetries: 1, inputs: [{ name: "missing", ref: "x", from: "plan" }] },
      ],
    }),
    /missing input dependency/
  );
});

test("task graph rejects cycles with a useful error", () => {
  assert.throws(
    () => createDag({
      nodes: [
        { id: "a", name: "A", role: "planner", dependsOn: ["b"], maxRetries: 1 },
        { id: "b", name: "B", role: "coder", dependsOn: ["a"], maxRetries: 1 },
      ],
    }),
    /circular dependency/
  );
});

test("ensemble runner calls role-specific candidates and aggregates quorum", async () => {
  const calls = [];
  const baseRunner = {
    async run(node, env) {
      calls.push({ node, env });
      return {
        success: env.OMK_ENSEMBLE_CANDIDATE_ID !== "edge-cases",
        stdout: `candidate=${env.OMK_ENSEMBLE_CANDIDATE_ID}\nconfidence: 0.9`,
        stderr: "",
      };
    },
  };
  const runner = createEnsembleTaskRunner(baseRunner, {
    enabled: true,
    maxCandidatesPerNode: 2,
    maxParallel: 1,
    quorumRatio: 0.5,
  });

  const result = await runner.run(
    { id: "node-1", name: "Implement", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 1, worktree: await tempWorktree() },
    { OMK_RUN_ID: "test" }
  );

  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.env.OMK_ENSEMBLE_CANDIDATE_ID), ["implement", "edge-cases"]);
  assert.match(result.stdout, /OMK Ensemble Result/);
  assert.equal(result.metadata.ensemble.winner, "implement");
});

test("ensemble runner tolerates one candidate throwing when quorum still passes", async () => {
  const baseRunner = {
    async run(node, env) {
      if (env.OMK_ENSEMBLE_CANDIDATE_ID === "edge-cases") {
        throw new Error("candidate crashed");
      }
      return {
        success: true,
        stdout: `candidate=${env.OMK_ENSEMBLE_CANDIDATE_ID}\nconfidence: 0.8`,
        stderr: "",
      };
    },
  };
  const runner = createEnsembleTaskRunner(baseRunner, {
    enabled: true,
    maxCandidatesPerNode: 2,
    maxParallel: 1,
    quorumRatio: 0.5,
  });

  const result = await runner.run(
    { id: "node-2", name: "Implement", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 1, worktree: await tempWorktree() },
    { OMK_RUN_ID: "test" }
  );

  assert.equal(result.success, true);
  assert.match(result.stderr, /\[edge-cases] candidate crashed/);
  assert.equal(result.metadata.ensemble.winner, "implement");
});

test("router ensemble candidates preserve routing metadata and use route-specific roles", async () => {
  const calls = [];
  const baseRunner = {
    async run(node, env) {
      calls.push({ node, env });
      return {
        success: true,
        stdout: `candidate=${env.OMK_ENSEMBLE_CANDIDATE_ID}\nconfidence: 0.9`,
        stderr: "",
      };
    },
  };
  const runner = createEnsembleTaskRunner(baseRunner, {
    enabled: true,
    maxCandidatesPerNode: 2,
    maxParallel: 1,
    quorumRatio: 0.5,
  });

  const result = await runner.run(
    {
      id: "route-1",
      name: "Select skills and MCP for DAG node",
      role: "router",
      dependsOn: [],
      status: "pending",
      retries: 0,
      maxRetries: 1,
      worktree: await tempWorktree(),
      routing: { skills: ["omk-repo-explorer"], mcpServers: ["omk-project"], contextBudget: "tiny" },
    },
    { OMK_RUN_ID: "test" }
  );

  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.env.OMK_ENSEMBLE_CANDIDATE_ID), ["skill-fit", "safety-budget"]);
  assert.deepEqual(calls.map((call) => call.node.role), ["planner", "reviewer"]);
  assert.equal(calls[0].node.routing.skills[0], "omk-repo-explorer");
});

test("ETA estimator uses completed durations and worker count", () => {
  const estimate = estimateRunProgress({
    startedAt: "2026-05-01T00:00:00.000Z",
    now: new Date("2026-05-01T00:00:05.000Z"),
    workerCount: 2,
    nodes: [
      {
        id: "plan",
        name: "Plan",
        role: "planner",
        dependsOn: [],
        status: "done",
        retries: 0,
        maxRetries: 1,
        durationMs: 1000,
      },
      {
        id: "code",
        name: "Code",
        role: "coder",
        dependsOn: [],
        status: "pending",
        retries: 0,
        maxRetries: 1,
      },
      {
        id: "review",
        name: "Review",
        role: "reviewer",
        dependsOn: [],
        status: "pending",
        retries: 0,
        maxRetries: 1,
      },
    ],
  });

  assert.equal(estimate.averageCompletedDurationMs, 1000);
  assert.equal(estimate.estimatedRemainingMs, 1000);
  assert.equal(estimate.percentComplete, 33);
  assert.equal(estimate.confidence, "medium");
});

test("executor records agent timings and passes ETA environment", async () => {
  await withRoutingSkills(["omk-industrial-control-loop", "omk-typescript-strict"], async () => {
    const savedStates = [];
    const seenEnv = [];
    const executor = createExecutor({
      ensemble: false,
      persister: {
        async load() {
          return null;
        },
        async save(state) {
          savedStates.push(JSON.parse(JSON.stringify(state)));
        },
      },
    });
    const dag = createDag({
      nodes: [
        { id: "plan", name: "Plan DAG implementation", role: "planner", dependsOn: [], maxRetries: 1 },
        { id: "code", name: "Implement TypeScript routing", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
      ],
    });
    const runner = {
      async run(_node, env) {
        seenEnv.push({ ...env });
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { success: true, stdout: "", stderr: "" };
      },
    };

    const result = await executor.execute(dag, runner, {
      runId: "eta-test",
      workers: 1,
      approvalPolicy: "yolo",
    });

    assert.equal(result.success, true);
    assert.equal(result.state.estimate.completedNodes, 2);
    assert.equal(result.state.estimate.estimatedRemainingMs, 0);
    assert.ok(result.state.nodes.every((node) => typeof node.startedAt === "string"));
    assert.ok(result.state.nodes.every((node) => typeof node.completedAt === "string"));
    assert.ok(result.state.nodes.every((node) => typeof node.durationMs === "number"));
    assert.ok(result.state.nodes.every((node) => node.attempts?.length === 1));
    assert.ok(seenEnv.every((env) => typeof env.OMK_ETA_REMAINING_MS === "string"));
    assert.ok(seenEnv.every((env) => typeof env.OMK_SKILL_HINTS === "string"));
    assert.ok(seenEnv.every((env) => typeof env.OMK_HOOK_HINTS === "string"));
    assert.ok(seenEnv.some((env) => env.OMK_SKILL_HINTS.includes("omk-industrial-control-loop")));
    assert.ok(seenEnv.some((env) => env.OMK_SKILL_HINTS.includes("omk-typescript-strict")));
    assert.ok(savedStates.some((state) => state.estimate?.runningNodes === 1));
  });
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("scheduler retries node when failure is under maxRetries", () => {
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 3 },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
    ],
  });
  const scheduler = createScheduler();

  // First failure — should retry (retries=0 < maxRetries=3)
  scheduler.updateNodeStatus(dag, "plan", "failed");
  assert.equal(dag.nodes.find((node) => node.id === "plan")?.status, "pending");
  assert.equal(dag.nodes.find((node) => node.id === "plan")?.retries, 1);
  assert.equal(dag.nodes.find((node) => node.id === "code")?.status, "pending");

  // Second failure — should retry again (retries=1 < maxRetries=3)
  scheduler.updateNodeStatus(dag, "plan", "failed");
  assert.equal(dag.nodes.find((node) => node.id === "plan")?.status, "pending");
  assert.equal(dag.nodes.find((node) => node.id === "plan")?.retries, 2);

  // Third failure — terminal (retries=2 < maxRetries=3 is false), should block dependents
  scheduler.updateNodeStatus(dag, "plan", "failed");
  assert.equal(dag.nodes.find((node) => node.id === "plan")?.status, "failed");
  assert.equal(dag.nodes.find((node) => node.id === "code")?.status, "blocked");
  assert.equal(scheduler.isFailed(dag), true);
});

test("executor times out hanging node and marks it failed", async () => {
  const executor = createExecutor({ ensemble: false });
  const dag = createDag({
    nodes: [
      { id: "fast", name: "Fast", role: "coder", dependsOn: [], maxRetries: 1 },
      { id: "slow", name: "Slow", role: "coder", dependsOn: [], maxRetries: 1 },
    ],
  });
  const runner = {
    async run(node, _env) {
      if (node.id === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { success: true, stdout: "", stderr: "" };
      }
      return { success: true, stdout: "", stderr: "" };
    },
  };

  let slowResult;
  executor.onNodeComplete((node, result) => {
    if (node.id === "slow") slowResult = result;
  });

  const result = await executor.execute(dag, runner, {
    runId: "timeout-test",
    workers: 2,
    approvalPolicy: "yolo",
    nodeTimeoutMs: 50,
  });

  assert.equal(result.success, false);
  const slowNode = result.state.nodes.find((node) => node.id === "slow");
  const fastNode = result.state.nodes.find((node) => node.id === "fast");
  assert.equal(fastNode?.status, "done");
  assert.equal(slowNode?.status, "failed");
  assert.ok(slowNode?.attempts?.[0]?.status === "failed");
  assert.ok(slowResult?.stderr?.includes("timed out"));
});

test("executor waits for running siblings before terminal failure resolution", async () => {
  const executor = createExecutor({ ensemble: false });
  const dag = createDag({
    nodes: [
      { id: "fail-fast", name: "Fail fast", role: "coder", dependsOn: [], maxRetries: 1 },
      { id: "slow-sibling", name: "Slow sibling", role: "coder", dependsOn: [], maxRetries: 1 },
    ],
  });
  let slowCompleted = false;
  const runner = {
    async run(node, _env) {
      if (node.id === "fail-fast") {
        return { success: false, stdout: "", stderr: "boom" };
      }
      await new Promise((resolve) => setTimeout(resolve, 75));
      slowCompleted = true;
      return { success: true, stdout: "", stderr: "" };
    },
  };

  const result = await executor.execute(dag, runner, {
    runId: "terminal-sibling-race-test",
    workers: 2,
    approvalPolicy: "yolo",
  });

  assert.equal(result.success, false);
  assert.equal(slowCompleted, true);
  assert.equal(result.state.nodes.find((node) => node.id === "fail-fast")?.status, "failed");
  assert.equal(result.state.nodes.find((node) => node.id === "slow-sibling")?.status, "done");
});

test("executor rejects fractional worker counts", async () => {
  const executor = createExecutor({ ensemble: false });
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
    ],
  });
  const runner = {
    async run() {
      return { success: true, stdout: "", stderr: "" };
    },
  };

  await assert.rejects(
    () => executor.execute(dag, runner, {
      runId: "fractional-workers-test",
      workers: 1.5,
      approvalPolicy: "yolo",
    }),
    /positive integer/
  );
});

test("executor node timeout preset overrides run preset and default node timeout", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-timeout-preset-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  resetTimeoutPresetCache();

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(
      join(projectRoot, ".omk", "config.toml"),
      "[timeouts.tiny]\ntimeout_ms = 50\n\n[timeouts.slow]\ntimeout_ms = 500\n"
    );

    const executor = createExecutor({ ensemble: false });
    const dag = createDag({
      nodes: [
        { id: "slow", name: "Slow", role: "coder", dependsOn: [], maxRetries: 1, timeoutPreset: "tiny" },
      ],
    });
    const runner = {
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { success: true, stdout: "", stderr: "" };
      },
    };
    let slowResult;
    executor.onNodeComplete((node, taskResult) => {
      if (node.id === "slow") slowResult = taskResult;
    });

    const result = await executor.execute(dag, runner, {
      runId: "timeout-preset-test",
      workers: 1,
      approvalPolicy: "yolo",
      nodeTimeoutMs: 5_000,
      timeoutPreset: "slow",
    });

    assert.equal(result.success, false);
    const slowNode = result.state.nodes.find((node) => node.id === "slow");
    assert.equal(slowNode?.status, "failed");
    assert.match(slowResult?.stderr ?? "", /timed out after 50ms/);
  } finally {
    resetTimeoutPresetCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resolveTimeoutMs rejects unknown timeout presets", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-timeout-invalid-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  resetTimeoutPresetCache();

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await assert.rejects(
      resolveTimeoutMs({ timeoutPreset: "does-not-exist" }),
      /Unknown timeout preset "does-not-exist".*default/
    );
  } finally {
    resetTimeoutPresetCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("executor uses OMK_NODE_TIMEOUT_MS when no explicit timeout or preset is set", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-timeout-env-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousTimeout = process.env.OMK_NODE_TIMEOUT_MS;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  process.env.OMK_NODE_TIMEOUT_MS = "50";
  resetTimeoutPresetCache();

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    const executor = createExecutor({ ensemble: false });
    const dag = createDag({
      nodes: [
        { id: "slow", name: "Slow", role: "coder", dependsOn: [], maxRetries: 1 },
      ],
    });
    const runner = {
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { success: true, stdout: "", stderr: "" };
      },
    };
    let slowResult;
    executor.onNodeComplete((node, taskResult) => {
      if (node.id === "slow") slowResult = taskResult;
    });

    const result = await executor.execute(dag, runner, {
      runId: "timeout-env-test",
      workers: 1,
      approvalPolicy: "yolo",
    });

    assert.equal(result.success, false);
    const slowNode = result.state.nodes.find((node) => node.id === "slow");
    assert.equal(slowNode?.status, "failed");
    assert.match(slowResult?.stderr ?? "", /timed out after 50ms/);
  } finally {
    resetTimeoutPresetCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("OMK_NODE_TIMEOUT_MS", previousTimeout);
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("executor returns failure when all nodes are blocked", async () => {
  const executor = createExecutor({ ensemble: false });
  // Build a valid DAG then manually block every node to simulate total dependency failure
  const dag = createDag({
    nodes: [
      { id: "a", name: "A", role: "coder", dependsOn: [], maxRetries: 1 },
      { id: "b", name: "B", role: "coder", dependsOn: ["a"], maxRetries: 1 },
    ],
  });
  dag.nodes[0].status = "blocked";
  dag.nodes[0].blockedReason = "manual block";
  dag.nodes[1].status = "blocked";
  dag.nodes[1].blockedReason = "manual block";

  const runner = {
    async run() {
      return { success: true, stdout: "", stderr: "" };
    },
  };

  const result = await executor.execute(dag, runner, {
    runId: "blocked-test",
    workers: 1,
    approvalPolicy: "yolo",
  });

  assert.equal(result.success, false);
});

test("state persister writes atomically via temp file", async () => {
  const { createStatePersister } = await import("../dist/orchestration/state-persister.js");
  const tmpDir = await mkdtemp(join(tmpdir(), "omk-state-"));
  const persister = createStatePersister(tmpDir);

  const state = {
    runId: "atomic-test",
    nodes: [],
    startedAt: new Date().toISOString(),
  };

  await persister.save(state);
  const loaded = await persister.load("atomic-test");
  assert.equal(loaded.runId, "atomic-test");

  // Verify no temp files left behind
  const entries = await (await import("node:fs/promises")).readdir(join(tmpDir, "atomic-test"));
  assert.ok(entries.includes("state.json"));
  assert.ok(!entries.some((e) => e.endsWith(".tmp")), "temp file should be cleaned up after successful rename");

  await rm(tmpDir, { recursive: true, force: true });
});


test("skipNode propagates skip to dependents", () => {
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
      { id: "review", name: "Review", role: "reviewer", dependsOn: ["code"], maxRetries: 1 },
    ],
  });

  skipNode(dag, "plan");

  assert.equal(dag.nodes.find((n) => n.id === "plan")?.status, "skipped");
  assert.equal(dag.nodes.find((n) => n.id === "code")?.status, "skipped");
  assert.equal(dag.nodes.find((n) => n.id === "review")?.status, "skipped");
});

test("scheduler skipOnFailure skips dependents instead of blocking", () => {
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1, failurePolicy: { skipOnFailure: true } },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
    ],
  });
  const scheduler = createScheduler();

  scheduler.updateNodeStatus(dag, "plan", "failed");

  assert.equal(dag.nodes.find((n) => n.id === "plan")?.status, "skipped");
  assert.equal(dag.nodes.find((n) => n.id === "code")?.status, "skipped");
  assert.equal(scheduler.isFailed(dag), false);
  assert.equal(scheduler.isComplete(dag), true);
});

test("executor runs fallback node when terminal failure has fallbackRole", async () => {
  const executor = createExecutor({ ensemble: false });
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1, failurePolicy: { fallbackRole: "coder" } },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
    ],
  });
  const runner = {
    async run(node, _env) {
      if (node.role === "planner") {
        return { success: false, stdout: "", stderr: "plan failed" };
      }
      return { success: true, stdout: "fallback ok", stderr: "" };
    },
  };

  const result = await executor.execute(dag, runner, {
    runId: "fallback-test",
    workers: 1,
    approvalPolicy: "yolo",
  });

  const fallbackNode = result.state.nodes.find((n) => n.id === "plan--fallback");
  assert.ok(fallbackNode, "fallback node should exist");
  assert.equal(fallbackNode.status, "done");
  assert.equal(result.state.nodes.find((n) => n.id === "code")?.status, "done");
  assert.equal(result.success, true);
});


test("executor fallback node inherits evidence gates and blocks dependents on missing artifacts", async () => {
  const executor = createExecutor({ ensemble: false });
  const tmpDir = await mkdtemp(join(tmpdir(), "omk-fallback-evidence-"));
  const dag = createDag({
    nodes: [
      {
        id: "plan",
        name: "Plan",
        role: "planner",
        dependsOn: [],
        maxRetries: 1,
        outputs: [{ name: "artifact", ref: "artifact.txt", gate: "file-exists" }],
        failurePolicy: { fallbackRole: "coder" },
      },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
    ],
  });
  const runner = {
    async run(node, _env) {
      if (node.role === "planner") {
        return { success: false, stdout: "", stderr: "plan failed" };
      }
      return { success: true, stdout: "fallback ok", stderr: "" };
    },
  };

  try {
    const result = await executor.execute(dag, runner, {
      runId: "fallback-evidence-test",
      workers: 1,
      approvalPolicy: "yolo",
      worktreeRoot: tmpDir,
    });

    const fallbackNode = result.state.nodes.find((n) => n.id === "plan--fallback");
    assert.ok(fallbackNode, "fallback node should exist");
    assert.equal(fallbackNode.status, "failed");
    assert.equal(fallbackNode.outputs?.[0]?.gate, "file-exists");
    assert.equal(fallbackNode.evidence?.[0]?.passed, false);
    assert.match(fallbackNode.evidence?.[0]?.message ?? "", /File does not exist/);
    assert.equal(result.state.nodes.find((n) => n.id === "code")?.status, "blocked");
    assert.equal(result.success, false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("executor respects AbortSignal and cancels pending nodes", async () => {
  const ac = new AbortController();
  const executor = createExecutor({ ensemble: false, signal: ac.signal });
  const dag = createDag({
    nodes: [
      { id: "a", name: "A", role: "coder", dependsOn: [], maxRetries: 1 },
      { id: "b", name: "B", role: "coder", dependsOn: ["a"], maxRetries: 1 },
    ],
  });
  const runner = {
    async run(node, _env) {
      if (node.id === "a") {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true, stdout: "", stderr: "" };
      }
      return { success: true, stdout: "", stderr: "" };
    },
  };

  setTimeout(() => ac.abort(), 10);

  const result = await executor.execute(dag, runner, {
    runId: "cancel-test",
    workers: 1,
    approvalPolicy: "yolo",
  });

  assert.equal(result.success, false);
  assert.ok(result.state.nodes.some((n) => n.status === "blocked" && n.blockedReason === "cancelled"));
});

test("executor resumes from persisted state and skips done nodes", async () => {
  const executor = createExecutor({
    ensemble: false,
    resumeFromState: {
      runId: "resume-test",
      startedAt: new Date().toISOString(),
      nodes: [
        {
          id: "plan",
          name: "Plan",
          role: "planner",
          dependsOn: [],
          status: "done",
          retries: 0,
          maxRetries: 1,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        {
          id: "code",
          name: "Code",
          role: "coder",
          dependsOn: ["plan"],
          status: "pending",
          retries: 0,
          maxRetries: 1,
        },
      ],
    },
  });
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
    ],
  });
  let codeRan = false;
  const runner = {
    async run(node, _env) {
      if (node.id === "code") codeRan = true;
      return { success: true, stdout: "", stderr: "" };
    },
  };

  const result = await executor.execute(dag, runner, {
    runId: "resume-test",
    workers: 1,
    approvalPolicy: "yolo",
  });

  assert.equal(result.success, true);
  assert.equal(codeRan, true);
  assert.equal(result.state.nodes.find((n) => n.id === "plan")?.status, "done");
  assert.equal(result.state.nodes.find((n) => n.id === "code")?.status, "done");
});

test("evidence gate fails node when file-exists gate misses", async () => {
  const executor = createExecutor({ ensemble: false });
  const dag = createDag({
    nodes: [
      {
        id: "build",
        name: "Build",
        role: "coder",
        dependsOn: [],
        maxRetries: 1,
        outputs: [{ name: "dist", gate: "file-exists", ref: "/nonexistent/path/xyz.txt" }],
      },
    ],
  });
  const runner = {
    async run() {
      return { success: true, stdout: "built", stderr: "" };
    },
  };

  const result = await executor.execute(dag, runner, {
    runId: "evidence-test",
    workers: 1,
    approvalPolicy: "yolo",
  });

  assert.equal(result.success, false);
  const buildNode = result.state.nodes.find((n) => n.id === "build");
  assert.equal(buildNode?.status, "failed");
  assert.ok(buildNode?.evidence?.some((e) => e.gate === "file-exists" && !e.passed));
});

test("evidence gate blocks file-exists refs outside worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-evidence-boundary-"));
  const worktree = join(root, "worktree");
  await mkdir(worktree, { recursive: true });
  await writeFile(join(root, "outside.txt"), "outside");

  try {
    const executor = createExecutor({ ensemble: false });
    const dag = createDag({
      nodes: [
        {
          id: "artifact",
          name: "Artifact",
          role: "coder",
          dependsOn: [],
          maxRetries: 1,
          outputs: [{ name: "outside", gate: "file-exists", ref: "../outside.txt" }],
        },
      ],
    });
    const runner = {
      async run() {
        return { success: true, stdout: "built", stderr: "" };
      },
    };

    const result = await executor.execute(dag, runner, {
      runId: "evidence-boundary-test",
      workers: 1,
      approvalPolicy: "yolo",
      worktreeRoot: worktree,
    });

    assert.equal(result.success, false);
    const artifactNode = result.state.nodes.find((node) => node.id === "artifact");
    assert.equal(artifactNode?.status, "failed");
    assert.ok(artifactNode?.evidence?.some((e) => e.gate === "file-exists" && !e.passed && e.message?.includes("outside workspace")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence gate blocks file-exists symlink escapes outside worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-evidence-symlink-"));
  const worktree = join(root, "worktree");
  await mkdir(worktree, { recursive: true });
  await writeFile(join(root, "outside.txt"), "outside");
  await symlink(join(root, "outside.txt"), join(worktree, "artifact.txt"));

  try {
    const executor = createExecutor({ ensemble: false });
    const dag = createDag({
      nodes: [
        {
          id: "artifact",
          name: "Artifact",
          role: "coder",
          dependsOn: [],
          maxRetries: 1,
          outputs: [{ name: "artifact", gate: "file-exists", ref: "artifact.txt" }],
        },
      ],
    });
    const runner = {
      async run() {
        return { success: true, stdout: "built", stderr: "" };
      },
    };

    const result = await executor.execute(dag, runner, {
      runId: "evidence-symlink-test",
      workers: 1,
      approvalPolicy: "yolo",
      worktreeRoot: worktree,
    });

    assert.equal(result.success, false);
    const artifactNode = result.state.nodes.find((node) => node.id === "artifact");
    assert.equal(artifactNode?.status, "failed");
    assert.ok(artifactNode?.evidence?.some((e) => e.gate === "file-exists" && !e.passed && e.message?.includes("outside workspace")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("createExecutableDagFromState restores done node runtime fields", () => {
  const startedAt = new Date().toISOString();
  const completedAt = new Date().toISOString();
  const state = {
    runId: "exec-test",
    startedAt,
    nodes: [
      {
        id: "plan",
        name: "Plan",
        role: "planner",
        dependsOn: [],
        status: "done",
        retries: 0,
        maxRetries: 1,
        startedAt,
        completedAt,
        durationMs: 1234,
        attempts: [{ attempt: 1, startedAt, completedAt, durationMs: 1234, status: "done" }],
      },
      {
        id: "code",
        name: "Code",
        role: "coder",
        dependsOn: ["plan"],
        status: "pending",
        retries: 0,
        maxRetries: 1,
      },
    ],
  };

  const dag = createExecutableDagFromState(state);
  const planNode = dag.nodes.find((n) => n.id === "plan");
  const codeNode = dag.nodes.find((n) => n.id === "code");

  assert.equal(planNode?.status, "done");
  assert.equal(planNode?.startedAt, startedAt);
  assert.equal(planNode?.completedAt, completedAt);
  assert.equal(planNode?.durationMs, 1234);
  assert.equal(planNode?.attempts?.length, 1);
  assert.equal(codeNode?.status, "pending");
});

test("createExecutableDagFromState forces bootstrap to done", () => {
  const startedAt = new Date().toISOString();
  const state = {
    runId: "bootstrap-test",
    startedAt,
    nodes: [
      {
        id: "bootstrap",
        name: "Bootstrap",
        role: "omk",
        dependsOn: [],
        status: "pending",
        retries: 0,
        maxRetries: 1,
      },
    ],
  };

  const dag = createExecutableDagFromState(state);
  const bootstrap = dag.nodes.find((n) => n.id === "bootstrap");
  assert.equal(bootstrap?.status, "done");
  assert.equal(bootstrap?.startedAt, startedAt);
  assert.equal(bootstrap?.completedAt, startedAt);
});
