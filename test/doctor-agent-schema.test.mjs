import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import YAML from "yaml";

import { doctorCommand } from "../dist/commands/doctor.js";
import { validateAgentYamlFile } from "../dist/util/agent-schema.js";
import { resetOmkResourceSettingsCache } from "../dist/util/resource-profile.js";

async function captureDoctorJson(root, home, options) {
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousHome = process.env.HOME;
  const previousOriginalHome = process.env.OMK_ORIGINAL_HOME;
  const previousLog = console.log;
  const logs = [];
  try {
    process.env.OMK_PROJECT_ROOT = root;
    process.env.HOME = home;
    process.env.OMK_ORIGINAL_HOME = home;
    resetOmkResourceSettingsCache();
    console.log = (...args) => logs.push(args.join(" "));
    await doctorCommand({ ...options, json: true, soft: true });
    return JSON.parse(logs.join("\n"));
  } finally {
    console.log = previousLog;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousOriginalHome === undefined) delete process.env.OMK_ORIGINAL_HOME;
    else process.env.OMK_ORIGINAL_HOME = previousOriginalHome;
    resetOmkResourceSettingsCache();
  }
}

test("doctor reports uninitialized project agent YAML as info instead of release-blocking failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-doctor-agent-uninitialized-"));
  const home = await mkdtemp(join(tmpdir(), "omk-doctor-agent-uninitialized-home-"));
  try {
    await mkdir(join(root, ".kimi"), { recursive: true });
    await mkdir(join(home, ".kimi"), { recursive: true });
    await writeFile(join(home, ".kimi", "config.toml"), "default_model = \"kimi-k2.6\"\n", "utf-8");
    await writeFile(join(root, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const report = await captureDoctorJson(root, home, {});
    assert.equal(report.errors.some((item) => item.name === "Agent YAML Schema"), false);
    assert.match(JSON.stringify(report), /project agent YAML is not initialized/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("doctor keeps partial project agent scaffold as Agent YAML Schema failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-doctor-agent-partial-"));
  const home = await mkdtemp(join(tmpdir(), "omk-doctor-agent-partial-home-"));
  try {
    await mkdir(join(root, ".omk", "agents"), { recursive: true });
    await mkdir(join(root, ".kimi"), { recursive: true });
    await mkdir(join(home, ".kimi"), { recursive: true });
    await writeFile(join(home, ".kimi", "config.toml"), "default_model = \"kimi-k2.6\"\n", "utf-8");
    await writeFile(join(root, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const report = await captureDoctorJson(root, home, {});
    assert.ok(report.errors.some((item) => item.name === "Agent YAML Schema"));
    assert.match(JSON.stringify(report.errors), /agent YAML file is missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("explicit agent YAML file validation still fails for missing chat preflight file", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-agent-explicit-missing-"));
  try {
    const report = await validateAgentYamlFile(join(root, ".omk", "agents", "root.yaml"), root);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((item) => item.code === "missing-agent-yaml"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor detects and fixes non-string agent prompt args plus missing root aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-doctor-agent-schema-"));
  const home = await mkdtemp(join(tmpdir(), "omk-doctor-agent-schema-home-"));
  try {
    const rolesDir = join(root, ".omk", "agents", "roles");
    await mkdir(rolesDir, { recursive: true });
    await mkdir(join(root, ".kimi"), { recursive: true });
    await mkdir(join(home, ".kimi"), { recursive: true });
    await writeFile(join(home, ".kimi", "config.toml"), "default_model = \"kimi-k2.6\"\n", "utf-8");
    await writeFile(join(root, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    await writeFile(join(root, ".omk", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    await writeFile(join(root, ".omk", "agents", "okabe.yaml"), [
      "version: 1",
      "agent:",
      "  extend: default",
      "  name: okabe",
      "  system_prompt_args:",
      "    OMK_MCP_ENABLED: \"true\"",
      "    OMK_SKILLS_ENABLED: \"true\"",
      "    OMK_HOOKS_ENABLED: \"true\"",
      "  tools:",
      "    - \"kimi_cli.tools.agent:Agent\"",
      "    - \"kimi_cli.tools.dmail:SendDMail\"",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(root, ".omk", "agents", "root.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ./okabe.yaml",
      "  name: omk-root",
      "  system_prompt_path: ../prompts/root.md",
      "  system_prompt_args:",
      "    OMK_ROLE: \"root-coordinator\"",
      "    OMK_MCP_ENABLED: \"true\"",
      "    OMK_SKILLS_ENABLED: \"true\"",
      "    OMK_HOOKS_ENABLED: \"true\"",
      "    OMK_MAX_WORKERS: 4",
      "  subagents:",
      "    coder:",
      "      path: ./roles/coder.yaml",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(rolesDir, "coder.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ../okabe.yaml",
      "  name: omk-coder",
      "  system_prompt_args:",
      "    OMK_ROLE: \"coder\"",
      "    OMK_MCP_ENABLED: \"true\"",
      "    OMK_SKILLS_ENABLED: \"true\"",
      "    OMK_HOOKS_ENABLED: \"true\"",
      "",
    ].join("\n"), "utf-8");

    const before = await captureDoctorJson(root, home, {});
    assert.ok(before.errors.some((item) => item.name === "Agent YAML Schema"));
    assert.match(JSON.stringify(before.errors), /OMK_MAX_WORKERS must be a string/);
    assert.match(JSON.stringify(before.errors), /missing canonical alias/);
    assert.match(JSON.stringify(before.errors), /router.*security.*tester.*aggregator/);

    const fixed = await captureDoctorJson(root, home, { fix: true });
    assert.ok(fixed.fixes.actions.some((item) => /converted .*system_prompt_args/.test(item)));
    assert.ok(fixed.fixes.actions.some((item) => /missing root subagent alias/.test(item)));
    assert.equal(fixed.errors.some((item) => item.name === "Agent YAML Schema"), false);

    const rootYaml = YAML.parse(await readFile(join(root, ".omk", "agents", "root.yaml"), "utf-8"));
    assert.equal(rootYaml.agent.system_prompt_args.OMK_MAX_WORKERS, "4");
    for (const alias of ["router", "security", "tester", "aggregator"]) {
      assert.ok(rootYaml.agent.subagents[alias], `${alias} alias should be merged`);
    }
    const routerRoleYaml = await readFile(join(rolesDir, "router.yaml"), "utf-8");
    assert.match(routerRoleYaml, /name: omk-router/);
    assert.match(routerRoleYaml, /OMK_ROLE: "router"/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
