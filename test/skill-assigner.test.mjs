import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assignSkills } from "../dist/orchestration/skill-assigner.js";
import {
  OMK_CORE_VERIFIED_PRESET,
  OMK_RELEASE_GUARD_PRESET,
  OMK_TS_PRODUCT_PRESET,
  OMK_TOP_PRIORITY_SKILLS,
  OMK_WORKTREE_TEAM_PRESET,
} from "../dist/runtime/core-verified-preset.js";

test("skill assigner applies omk-core-verified baseline to general coding work", () => {
  const assignment = assignSkills({
    id: "implement-cli-option",
    name: "Implement CLI option",
    role: "coder",
  });

  for (const skill of OMK_CORE_VERIFIED_PRESET.skills) {
    assert.ok(assignment.skills.includes(skill), `missing skill ${skill}`);
  }
  for (const hook of OMK_CORE_VERIFIED_PRESET.hooks) {
    assert.ok(assignment.hooks.includes(hook), `missing hook ${hook}`);
  }
  assert.deepEqual(assignment.mcpServers, OMK_CORE_VERIFIED_PRESET.mcpServers);
  assert.match(assignment.rationale, /omk-core-verified/);
});

test("runtime presets cover the top-priority OMK skill recommendation set", () => {
  const presetSkills = new Set([
    ...OMK_CORE_VERIFIED_PRESET.skills,
    ...OMK_TS_PRODUCT_PRESET.skills,
    ...OMK_WORKTREE_TEAM_PRESET.skills,
    ...OMK_RELEASE_GUARD_PRESET.skills,
  ]);

  assert.deepEqual([...OMK_TOP_PRIORITY_SKILLS], [
    "omk-context-broker",
    "omk-repo-explorer",
    "omk-industrial-control-loop",
    "omk-plan-first",
    "omk-quality-gate",
    "omk-test-debug-loop",
    "omk-code-review",
    "omk-security-review",
    "omk-secret-guard",
    "omk-typescript-strict",
    "omk-python-typing",
    "omk-worktree-team",
  ]);
  for (const skill of OMK_TOP_PRIORITY_SKILLS) {
    assert.ok(presetSkills.has(skill), `missing top-priority skill in runtime presets: ${skill}`);
  }
});

test("skill assigner keeps specialized debugging skills alongside core baseline", () => {
  const assignment = assignSkills({
    id: "debug-failing-test",
    name: "Debug failing test",
    role: "debugger",
  });

  assert.ok(assignment.skills.includes("omk-test-debug-loop"));
  assert.ok(assignment.skills.includes("omk-flow-bugfix"));
  assert.ok(assignment.mcpServers.includes("omk-project"));
});

test("skill assigner prefers filesystem-readonly for generic MCP-required lanes", () => {
  const assignment = assignSkills({
    id: "review-with-mcp-context",
    name: "Review with MCP context",
    role: "reviewer",
    routing: { requiresMcp: true },
  });

  assert.ok(assignment.mcpServers.includes("filesystem-readonly"));
  assert.equal(assignment.mcpServers.includes("filesystem"), false);
});

test("skill assigner gives every exposed OMK role MCP, skills, and hooks", () => {
  for (const role of [
    "explorer",
    "researcher",
    "planner",
    "architect",
    "coder",
    "reviewer",
    "security",
    "qa",
    "tester",
    "integrator",
    "aggregator",
    "interviewer",
    "vision-debugger",
    "ontology",
  ]) {
    const assignment = assignSkills({
      id: `${role}-capability-contract`,
      name: `Capability contract for ${role}`,
      role,
    });

    assert.ok(assignment.skills.length > 0, `${role} missing skills`);
    assert.ok(assignment.mcpServers.length > 0, `${role} missing MCP servers`);
    assert.ok(assignment.hooks.length > 0, `${role} missing hooks`);
  }
});

test("skill assigner covers every root subagent role path", () => {
  const rootYaml = readFileSync("templates/.omk/agents/root.yaml", "utf-8");
  const roles = [...new Set([...rootYaml.matchAll(/path:\s*\.\/roles\/([^/\s]+)\.yaml/g)].map((match) => match[1]))].sort();
  assert.ok(roles.length > 0);

  for (const role of roles) {
    const assignment = assignSkills({
      id: `${role}-root-subagent-contract`,
      name: `Root subagent contract for ${role}`,
      role,
    });
    assert.ok(assignment.skills.length > 0, `${role} missing skills`);
    assert.ok(assignment.mcpServers.length > 0, `${role} missing MCP servers`);
    assert.ok(assignment.hooks.length > 0, `${role} missing hooks`);
  }
});

test("skill assigner layers omk-ts-product onto TypeScript product work", () => {
  const assignment = assignSkills({
    id: "next-ui-api-dto",
    name: "Implement Next.js React UI with API DTO domain persistence types",
    role: "coder",
  });

  for (const skill of OMK_TS_PRODUCT_PRESET.skills) {
    assert.ok(assignment.skills.includes(skill), `missing skill ${skill}`);
  }
  for (const hook of OMK_TS_PRODUCT_PRESET.hooks) {
    assert.ok(assignment.hooks.includes(hook), `missing hook ${hook}`);
  }
  for (const server of OMK_TS_PRODUCT_PRESET.mcpServers) {
    assert.ok(assignment.mcpServers.includes(server), `missing MCP server ${server}`);
  }
  assert.ok(assignment.skills.includes("omk-repo-explorer"));
  assert.match(assignment.rationale, /omk-ts-product/);
});

test("skill assigner layers omk-worktree-team onto parallel worktree lanes", () => {
  const assignment = assignSkills({
    id: "parallel-worktree-lanes",
    name: "Run parallel worker lanes in isolated git worktrees before merge",
    role: "planner",
  });

  for (const skill of OMK_WORKTREE_TEAM_PRESET.skills) {
    assert.ok(assignment.skills.includes(skill), `missing skill ${skill}`);
  }
  for (const hook of OMK_WORKTREE_TEAM_PRESET.hooks) {
    assert.ok(assignment.hooks.includes(hook), `missing hook ${hook}`);
  }
  for (const server of OMK_WORKTREE_TEAM_PRESET.mcpServers) {
    assert.ok(assignment.mcpServers.includes(server), `missing MCP server ${server}`);
  }
  assert.ok(assignment.mcpServers.includes("filesystem-readonly"));
  assert.equal(assignment.mcpServers.includes("filesystem"), false);
  assert.ok(assignment.mcpServers.includes("memory"));
  assert.ok(assignment.hooks.includes("worktree-create-guard.sh"));
  assert.ok(assignment.hooks.includes("branch-diff-snapshot.sh"));
  assert.ok(assignment.hooks.includes("subagent-stop-audit.sh"));
  assert.ok(assignment.hooks.includes("stop-verify.sh"));
  assert.match(assignment.rationale, /omk-worktree-team/);
});

test("skill assigner layers omk-release-guard onto release and security publish work", () => {
  const assignment = assignSkills({
    id: "publish-release",
    name: "Publish npm release with changelog, provenance, audit summary, and GitHub release",
    role: "coder",
  });

  for (const skill of OMK_RELEASE_GUARD_PRESET.skills) {
    assert.ok(assignment.skills.includes(skill), `missing skill ${skill}`);
  }
  for (const hook of OMK_RELEASE_GUARD_PRESET.hooks) {
    assert.ok(assignment.hooks.includes(hook), `missing hook ${hook}`);
  }
  for (const server of OMK_RELEASE_GUARD_PRESET.mcpServers) {
    assert.ok(assignment.mcpServers.includes(server), `missing MCP server ${server}`);
  }
  assert.ok(assignment.skills.includes("omk-flow-release"));
  assert.equal(assignment.mcpServers.includes("filesystem"), false);
  assert.match(assignment.rationale, /omk-release-guard/);
  assert.match(assignment.rationale, /\[release\]/);
});
