import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDynamicNodes } from "../dist/commands/parallel.js";
import { buildCapabilityAgentNodes } from "../dist/orchestration/capability-agents.js";
import { resetRoutingInventoryCache } from "../dist/orchestration/routing.js";

test("initial orchestration spawns dedicated DeepSeek Flash and Pro model-agent nodes", () => {
  const nodes = buildDynamicNodes({
    flow: "parallel",
    goal: "고도화 된 첫 input -> orchestration DeepSeek 실제 모델 에이전트",
    startedAt: "2026-05-09T00:00:00.000Z",
    workerCount: 2,
    intent: {
      taskType: "implement",
      complexity: "complex",
      estimatedWorkers: 2,
      requiredRoles: ["planner", "coder", "reviewer"],
      isReadOnly: false,
      needsResearch: false,
      needsSecurityReview: false,
      needsTesting: true,
      needsDesignReview: false,
      parallelizable: true,
      rationale: "DeepSeek model agents should run as read-only orchestration lanes.",
    },
  });

  const flash = nodes.find((node) => node.id === "deepseek-flash-agent");
  const pro = nodes.find((node) => node.id === "deepseek-pro-agent");
  const review = nodes.find((node) => node.id === "review-merge");

  assert.ok(flash);
  assert.ok(pro);
  assert.equal(flash.routing?.provider, "deepseek");
  assert.equal(flash.routing?.providerModelTier, "flash");
  assert.equal(pro.routing?.provider, "deepseek");
  assert.equal(pro.routing?.providerModelTier, "pro");
  assert.equal(flash.routing?.requiresMcp, false);
  assert.equal(pro.routing?.requiresToolCalling, false);
  assert.equal(flash.outputs?.[0]?.required, false);
  assert.equal(pro.outputs?.[0]?.required, false);
  assert.ok(review?.dependsOn.includes("deepseek-flash-agent"));
  assert.ok(review?.dependsOn.includes("deepseek-pro-agent"));
  assert.equal(review?.inputs?.find((input) => input.from === "deepseek-flash-agent")?.required, false);
  assert.equal(review?.inputs?.find((input) => input.from === "deepseek-pro-agent")?.required, false);
});

test("initial orchestration auto-spawns active skill, MCP, and hook capability agents", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-capability-agents-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousSkillsScope = process.env.OMK_SKILLS_SCOPE;
  const previousMcpScope = process.env.OMK_MCP_SCOPE;
  const previousHooksScope = process.env.OMK_HOOKS_SCOPE;

  try {
    process.env.OMK_PROJECT_ROOT = projectRoot;
    process.env.OMK_SKILLS_SCOPE = "project";
    process.env.OMK_MCP_SCOPE = "project";
    process.env.OMK_HOOKS_SCOPE = "project";
    await mkdir(join(projectRoot, ".agents", "skills", "omk-industrial-control-loop"), { recursive: true });
    await mkdir(join(projectRoot, ".agents", "skills", "omk-context-broker"), { recursive: true });
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, ".agents", "skills", "omk-industrial-control-loop", "SKILL.md"), "# control loop\n");
    await writeFile(join(projectRoot, ".agents", "skills", "omk-context-broker", "SKILL.md"), "# context broker\n");
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({ mcpServers: { "omk-project": { command: "node" } } }));
    await writeFile(join(projectRoot, ".omk", "kimi.config.toml"), [
      "[[hooks]]",
      "event = \"UserPromptSubmit\"",
      "command = \".omk/hooks/awesome-agent-skills-router.sh\"",
      "",
      "[[hooks]]",
      "event = \"SubagentStop\"",
      "command = \".omk/hooks/subagent-stop-audit.sh\"",
      "",
    ].join("\n"));
    resetRoutingInventoryCache();

    const nodes = buildDynamicNodes({
      flow: "parallel",
      goal: "사용자가 요청하지 않아도 mcp skills hooks 를 병렬 subagent로 자동 활성화",
      startedAt: "2026-05-09T00:00:00.000Z",
      workerCount: 3,
      intent: {
        taskType: "implement",
        complexity: "complex",
        estimatedWorkers: 3,
        requiredRoles: ["planner", "coder", "reviewer"],
        isReadOnly: false,
        needsResearch: false,
        needsSecurityReview: false,
        needsTesting: true,
        needsDesignReview: false,
        parallelizable: true,
        rationale: "Capability agents should run as optional orchestration lanes.",
      },
    });

    const skillAgent = nodes.find((node) => node.id === "capability-skill-agent");
    const mcpAgent = nodes.find((node) => node.id === "capability-mcp-agent");
    const hookAgent = nodes.find((node) => node.id === "capability-hook-agent");
    const review = nodes.find((node) => node.id === "review-merge");

    assert.ok(skillAgent);
    assert.ok(mcpAgent);
    assert.ok(hookAgent);
    assert.equal(skillAgent.routing?.autoSpawned, true);
    assert.equal(mcpAgent.routing?.requiresMcp, true);
    assert.equal(mcpAgent.routing?.mcpServers?.includes("omk-project"), true);
    assert.equal(hookAgent.routing?.hooks?.includes("subagent-stop-audit.sh"), true);
    assert.equal(skillAgent.outputs?.[0]?.required, false);
    assert.equal(mcpAgent.failurePolicy?.blockDependents, false);
    assert.ok(review?.dependsOn.includes("capability-skill-agent"));
    assert.ok(review?.dependsOn.includes("capability-mcp-agent"));
    assert.ok(review?.dependsOn.includes("capability-hook-agent"));
    assert.equal(review?.inputs?.find((input) => input.from === "capability-mcp-agent")?.required, false);
    assert.equal(review?.inputs?.find((input) => input.from === "capability-hook-agent")?.required, false);
  } finally {
    resetRoutingInventoryCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("OMK_SKILLS_SCOPE", previousSkillsScope);
    restoreEnv("OMK_MCP_SCOPE", previousMcpScope);
    restoreEnv("OMK_HOOKS_SCOPE", previousHooksScope);
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("parallel algorithm clamps invalid and excessive worker budgets", () => {
  const base = {
    flow: "parallel",
    goal: "worker budget clamp",
    startedAt: "2026-05-09T00:00:00.000Z",
  };

  const zeroWorkers = buildDynamicNodes({
    ...base,
    workerCount: 0,
    intent: {
      taskType: "implement",
      complexity: "moderate",
      estimatedWorkers: 0,
      requiredRoles: ["coder"],
      isReadOnly: false,
      needsResearch: false,
      needsSecurityReview: false,
      needsTesting: true,
      needsDesignReview: false,
      parallelizable: true,
      rationale: "invalid estimate should not create a zero-worker DAG",
    },
  });
  assert.equal(zeroWorkers.filter((node) => node.id.startsWith("worker-")).length, 1);
  assert.ok(zeroWorkers.find((node) => node.id === "worker-1"));
  assert.ok(zeroWorkers.find((node) => node.id === "review-merge")?.dependsOn.includes("worker-1"));

  const tooManyWorkers = buildDynamicNodes({
    ...base,
    workerCount: 99,
  });
  assert.equal(tooManyWorkers.filter((node) => node.id.startsWith("worker-")).length, 6);
});

test("capability agent builder respects maxAgents and empty dependency guards", () => {
  assert.deepEqual(buildCapabilityAgentNodes({
    goal: "no deps",
    dependsOn: [],
    maxAgents: 3,
  }), []);

  const nodes = buildCapabilityAgentNodes({
    goal: "mcp skills hooks",
    dependsOn: ["root-coordinator"],
    maxAgents: 1,
  });

  assert.ok(nodes.length <= 1);
  for (const node of nodes) {
    assert.equal(node.outputs?.[0]?.required, false);
    assert.equal(node.failurePolicy?.blockDependents, false);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
