import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultScopedRoleAgentFile,
  readRootAgentSubagents,
  renderScopedAgentYaml,
  writeScopedAgentFile,
} from "../dist/util/scoped-agent-file.js";

test("scoped agent wrapper renders capability flags from effective scopes", () => {
  const yaml = renderScopedAgentYaml({
    baseAgentFile: "/repo/.omk/agents/roles/researcher.yaml",
    outputFile: "/repo/.omk/runs/run-1/agents/roles/researcher.yaml",
    role: "researcher",
    resources: {
      mcpScope: "none",
      skillsScope: "project",
      hooksScope: "all",
    },
  });

  assert.match(yaml, /extend: "\.\.\/\.\.\/\.\.\/\.\.\/agents\/roles\/researcher\.yaml"/);
  assert.match(yaml, /OMK_ROLE: "researcher"/);
  assert.match(yaml, /OMK_MCP_ENABLED: "false"/);
  assert.match(yaml, /OMK_SKILLS_ENABLED: "true"/);
  assert.match(yaml, /OMK_HOOKS_ENABLED: "true"/);
  assert.match(yaml, /OMK_REASONING_VARIANT: "balanced-medium"/);
  assert.doesNotMatch(yaml, /mcpServers|Authorization|API_TOKEN|skills_dir/i);
});

test("scoped agent wrapper enables explicit routed names even when global scope is none", () => {
  const yaml = renderScopedAgentYaml({
    baseAgentFile: "/repo/.omk/agents/roles/coder.yaml",
    outputFile: "/repo/.omk/runs/run-1/agents/roles/coder.yaml",
    role: "coder",
    resources: {
      mcpScope: "none",
      skillsScope: "none",
      hooksScope: "none",
      mcpNames: ["omk-project"],
      skillNames: ["omk-typescript-strict"],
      hookNames: ["protect-secrets.sh"],
      reasoningVariant: "code-medium",
    },
  });

  assert.match(yaml, /OMK_MCP_ENABLED: "true"/);
  assert.match(yaml, /OMK_SKILLS_ENABLED: "true"/);
  assert.match(yaml, /OMK_HOOKS_ENABLED: "true"/);
  assert.match(yaml, /OMK_MCP_HINTS: "count=1;digest=[0-9a-f]+;top=omk-project"/);
  assert.match(yaml, /OMK_SKILL_HINTS: "count=1;digest=[0-9a-f]+;top=omk-typescript-strict"/);
  assert.match(yaml, /OMK_HOOK_HINTS: "count=1;digest=[0-9a-f]+;top=protect-secrets\.sh"/);
  assert.match(yaml, /OMK_REASONING_VARIANT: "code-medium"/);
});

test("scoped agent wrapper writes custom agent safety flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-scoped-agent-"));
  try {
    const baseAgentFile = join(root, ".omk", "agents", "roles", "custom.yaml");
    await mkdir(join(root, ".omk", "agents", "roles"), { recursive: true });
    await writeFile(baseAgentFile, "version: 1\nagent:\n  name: custom\n", "utf-8");

    const outputFile = defaultScopedRoleAgentFile(root, "run/custom", "custom role");
    await writeScopedAgentFile({
      baseAgentFile,
      outputFile,
      role: "custom role",
      resources: {
        mcpScope: "all",
        skillsScope: "all",
        hooksScope: "all",
      },
    });

    const yaml = await readFile(outputFile, "utf-8");
    assert.match(yaml, /name: "omk-custom role"/);
    assert.match(yaml, /OMK_MCP_ENABLED: "true"/);
    assert.match(yaml, /OMK_SKILLS_ENABLED: "true"/);
    assert.match(yaml, /OMK_HOOKS_ENABLED: "true"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root agent subagent parser resolves role aliases and base role files", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-subagent-refs-"));
  try {
    const rootAgentFile = join(root, ".omk", "agents", "root.yaml");
    await mkdir(join(root, ".omk", "agents", "roles"), { recursive: true });
    await writeFile(rootAgentFile, [
      "version: 1",
      "agent:",
      "  subagents:",
      "    explorer:",
      "      path: ./roles/explorer.yaml",
      "      description: Explore repo",
      "    explore:",
      "      path: ./roles/explorer.yaml",
      "",
    ].join("\n"), "utf-8");

    const refs = await readRootAgentSubagents(rootAgentFile);
    assert.deepEqual(refs.map((ref) => [ref.alias, ref.role]), [
      ["explorer", "explorer"],
      ["explore", "explorer"],
    ]);
    assert.ok(refs.every((ref) => ref.baseAgentFile.replace(/\\/g, "/").endsWith("/.omk/agents/roles/explorer.yaml")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
