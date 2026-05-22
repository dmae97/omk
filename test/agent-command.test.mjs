import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentCreateCommand, agentDoctorCommand, agentShowCommand } from "../dist/commands/agent.js";

const GENERATED_ROLES = [
  "aggregator",
  "architect",
  "coder",
  "explorer",
  "integrator",
  "interviewer",
  "ontology",
  "planner",
  "qa",
  "researcher",
  "reviewer",
  "router",
  "security",
  "tester",
  "vision-debugger",
];

test("agent create gives custom agents MCP skills and hooks capability flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-agent-create-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousWarn = console.warn;
  const previousLog = console.log;
  try {
    process.env.OMK_PROJECT_ROOT = root;
    console.warn = () => {};
    console.log = () => {};
    await mkdir(join(root, ".omk", "agents", "roles"), { recursive: true });
    await writeFile(join(root, ".omk", "agents", "roles", "coder.yaml"), [
      "version: 1",
      "agent:",
      "  name: omk-coder",
      "  system_prompt_args:",
      "    OMK_ROLE: \"coder\"",
      "",
    ].join("\n"), "utf-8");

    await agentCreateCommand("custom-coder", { from: "coder" });

    const yaml = await readFile(join(root, ".omk", "agents", "roles", "custom-coder.yaml"), "utf-8");
    assert.match(yaml, /OMK_ROLE: custom-coder|OMK_ROLE: "custom-coder"/);
    assert.match(yaml, /OMK_MCP_ENABLED: "true"/);
    assert.match(yaml, /OMK_SKILLS_ENABLED: "true"/);
    assert.match(yaml, /OMK_HOOKS_ENABLED: "true"/);
  } finally {
    console.warn = previousWarn;
    console.log = previousLog;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent doctor treats security as a generated capability-enabled stable agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-agent-doctor-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousLog = console.log;
  const previousWarn = console.warn;
  const logs = [];
  try {
    process.env.OMK_PROJECT_ROOT = root;
    console.log = (...args) => logs.push(args.join(" "));
    console.warn = (...args) => logs.push(args.join(" "));
    const rolesDir = join(root, ".omk", "agents", "roles");
    await mkdir(rolesDir, { recursive: true });
    await writeFile(join(root, ".omk", "agents", "okabe.yaml"), [
      "version: 1",
      "agent:",
      "  extend: default",
      "  name: omk-okabe-base",
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
      "  system_prompt_args:",
      "    OMK_ROLE: \"root-coordinator\"",
      "    OMK_MCP_ENABLED: \"true\"",
      "    OMK_SKILLS_ENABLED: \"true\"",
      "    OMK_HOOKS_ENABLED: \"true\"",
      "  subagents:",
      ...GENERATED_ROLES.flatMap((role) => [
        `    ${role}:`,
        `      path: ./roles/${role}.yaml`,
      ]),
      "",
    ].join("\n"), "utf-8");
    for (const role of GENERATED_ROLES) {
      await writeFile(join(rolesDir, `${role}.yaml`), [
        "version: 1",
        "agent:",
        "  extend: ../okabe.yaml",
        `  name: omk-${role}`,
        "  system_prompt_args:",
        `    OMK_ROLE: \"${role}\"`,
        "    OMK_MCP_ENABLED: \"true\"",
        "    OMK_SKILLS_ENABLED: \"true\"",
        "    OMK_HOOKS_ENABLED: \"true\"",
        "",
      ].join("\n"), "utf-8");
    }

    await agentDoctorCommand();

    const output = logs.join("\n");
    assert.match(output, /All agents healthy/);
    assert.doesNotMatch(output, /Missing stable agent: security/);
    assert.doesNotMatch(output, /function bullet/);
  } finally {
    console.log = previousLog;
    console.warn = previousWarn;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent doctor reports missing capability flags for root okabe and role agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-agent-doctor-missing-flags-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousLog = console.log;
  const previousWarn = console.warn;
  const logs = [];
  try {
    process.env.OMK_PROJECT_ROOT = root;
    console.log = (...args) => logs.push(args.join(" "));
    console.warn = (...args) => logs.push(args.join(" "));
    const rolesDir = join(root, ".omk", "agents", "roles");
    await mkdir(rolesDir, { recursive: true });
    await writeFile(join(root, ".omk", "agents", "okabe.yaml"), [
      "version: 1",
      "agent:",
      "  name: omk-okabe-base",
      "  tools:",
      "    - \"kimi_cli.tools.dmail:SendDMail\"",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(root, ".omk", "agents", "root.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ./okabe.yaml",
      "  name: omk-root",
      "  system_prompt_args:",
      "    OMK_ROLE: \"root-coordinator\"",
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
      "",
    ].join("\n"), "utf-8");

    await agentDoctorCommand();

    const output = logs.join("\n");
    for (const id of ["okabe", "root", "coder"]) {
      assert.match(output, new RegExp(`${id}: missing OMK_MCP_ENABLED=true`));
      assert.match(output, new RegExp(`${id}: missing OMK_SKILLS_ENABLED=true`));
      assert.match(output, new RegExp(`${id}: missing OMK_HOOKS_ENABLED=true`));
    }
    assert.doesNotMatch(output, /All agents healthy/);
    assert.doesNotMatch(output, /function bullet/);
  } finally {
    console.log = previousLog;
    console.warn = previousWarn;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent show renders excluded tools without leaking the bullet function body", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-agent-show-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousLog = console.log;
  const previousWarn = console.warn;
  const logs = [];
  try {
    process.env.OMK_PROJECT_ROOT = root;
    console.log = (...args) => logs.push(args.join(" "));
    console.warn = (...args) => logs.push(args.join(" "));
    const rolesDir = join(root, ".omk", "agents", "roles");
    await mkdir(rolesDir, { recursive: true });
    await writeFile(join(rolesDir, "reviewer.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ../okabe.yaml",
      "  name: omk-reviewer",
      "  system_prompt_args:",
      "    OMK_ROLE: \"reviewer\"",
      "    OMK_MCP_ENABLED: \"true\"",
      "    OMK_SKILLS_ENABLED: \"true\"",
      "    OMK_HOOKS_ENABLED: \"true\"",
      "  exclude_tools:",
      "    - \"kimi_cli.tools.file:WriteFile\"",
      "",
    ].join("\n"), "utf-8");

    await agentShowCommand("reviewer");

    const output = logs.join("\n");
    assert.match(output, /kimi_cli\.tools\.file:WriteFile/);
    assert.doesNotMatch(output, /function bullet/);
  } finally {
    console.log = previousLog;
    console.warn = previousWarn;
    if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
