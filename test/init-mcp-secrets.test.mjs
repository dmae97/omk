import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const INIT_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "init.js")).href;
const RESOURCE_PROFILE_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "util", "resource-profile.js")).href;
const CLI = join(process.cwd(), "dist", "cli.js");
const POSIX_EXECUTABLE_BITS_SUPPORTED = process.platform !== "win32";
const IS_WINDOWS = process.platform === "win32";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExcludeTools(agentYaml) {
  const match = agentYaml.match(/^  exclude_tools:\n((?:    - ".+"\n?)+)/m);
  if (!match) return [];
  return Array.from(match[1].matchAll(/    - "([^"]+)"/g), (toolMatch) => toolMatch[1]);
}

function toWslUncPath(absPath, distro = "Ubuntu-24.04") {
  return `\\\\wsl.localhost\\${distro}${absPath.replace(/\//g, "\\")}`;
}

function assertExecutableModeIfSupported(fileStat, message) {
  if (!POSIX_EXECUTABLE_BITS_SUPPORTED) return;
  assert.ok((fileStat.mode & 0o111) !== 0, message);
}


async function writeOmkShim(binDir) {
  await mkdir(binDir, { recursive: true });
  if (process.platform === "win32") {
    const cmdPath = join(binDir, "omk.cmd");
    await writeFile(cmdPath, `@echo off\r\n"${process.execPath}" "${CLI}" %*\r\n`, "utf-8");
    return;
  }
  const shimPath = join(binDir, "omk");
  await writeFile(shimPath, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, "utf-8");
  await chmod(shimPath, 0o755);
}

function runInit(projectRoot, homeRoot, options = {}) {
  const initOptions = { profile: "default", ...options };
  const script = `import { initCommand } from ${JSON.stringify(INIT_MODULE_URL)}; await initCommand(${JSON.stringify(initOptions)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeRoot,
      OMK_ORIGINAL_HOME: "",
      OMK_PROJECT_ROOT: projectRoot,
      OMK_MCP_SCOPE: "",
      OMK_SKILLS_SCOPE: "",
      OMK_HOOKS_SCOPE: "",
      OMK_RENDER_LOGO: "0",
      OMK_STAR_PROMPT: "0",
    },
  });
}

function runCli(projectRoot, homeRoot, args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeRoot,
      OMK_ORIGINAL_HOME: homeRoot,
      OMK_PROJECT_ROOT: projectRoot,
      OMK_MCP_SCOPE: "",
      OMK_SKILLS_SCOPE: "",
      OMK_HOOKS_SCOPE: "",
      OMK_RENDER_LOGO: "0",
      OMK_STAR_PROMPT: "0",
      ...extraEnv,
    },
  });
}

async function writeFakeKimi(binDir) {
  await mkdir(binDir, { recursive: true });
  if (IS_WINDOWS) {
    const kimiPath = join(binDir, "kimi.cmd");
    await writeFile(kimiPath, `@echo off\nif "%~1"=="--version" (\n  echo kimi, version 1.41.0\n) else (\n  echo Usage: kimi [OPTIONS] COMMAND [ARGS...]\n  echo   --agent-file FILE\n  echo   --model MODEL\n  echo   SearchWeb FetchURL\n)\n`, "utf-8");
    return;
  }
  const kimiPath = join(binDir, "kimi");
  await writeFile(kimiPath, `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then\n  echo "kimi, version 1.41.0"\nelse\n  echo "Usage: kimi [OPTIONS] COMMAND [ARGS...]"\n  echo "  --agent-file FILE"\n  echo "  --model MODEL"\n  echo "  SearchWeb FetchURL"\nfi\n`, "utf-8");
  await chmod(kimiPath, 0o755);
}

function readRuntimeScopes(projectRoot, homeRoot) {
  const script = [
    `import { getOmkResourceSettings } from ${JSON.stringify(RESOURCE_PROFILE_MODULE_URL)};`,
    "const resources = await getOmkResourceSettings();",
    "console.log(JSON.stringify({ mcpScope: resources.mcpScope, skillsScope: resources.skillsScope, hooksScope: resources.hooksScope }));",
  ].join(" ");
  const env = { ...process.env };
  delete env.OMK_MCP_SCOPE;
  delete env.OMK_SKILLS_SCOPE;
  delete env.OMK_HOOKS_SCOPE;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: {
      ...env,
      HOME: homeRoot,
      OMK_ORIGINAL_HOME: homeRoot,
      OMK_PROJECT_ROOT: projectRoot,
      OMK_RENDER_LOGO: "0",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function runInitDirect(projectRoot, homeRoot, options = {}) {
  const originalCwd = process.cwd();
  const originalEnv = {
    HOME: process.env.HOME,
    OMK_PROJECT_ROOT: process.env.OMK_PROJECT_ROOT,
    OMK_RENDER_LOGO: process.env.OMK_RENDER_LOGO,
    OMK_STAR_PROMPT: process.env.OMK_STAR_PROMPT,
    OMK_INIT_PROMPTS: process.env.OMK_INIT_PROMPTS,
    OMK_INIT_DEEPSEEK_PROMPT: process.env.OMK_INIT_DEEPSEEK_PROMPT,
    OMK_INIT_IMPORT_USER_SKILLS: process.env.OMK_INIT_IMPORT_USER_SKILLS,
    OMK_INIT_LOCAL_USER: process.env.OMK_INIT_LOCAL_USER,
    OMK_PROVIDER_CONFIG_PATH: process.env.OMK_PROVIDER_CONFIG_PATH,
    OMK_SECRETS_ENV_PATH: process.env.OMK_SECRETS_ENV_PATH,
    OPENCODE_SECRETS_ENV_PATH: process.env.OPENCODE_SECRETS_ENV_PATH,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    CI: process.env.CI,
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
  };
  const env = {
    ...process.env,
    HOME: homeRoot,
    OMK_PROJECT_ROOT: projectRoot,
    OMK_RENDER_LOGO: "0",
    OMK_STAR_PROMPT: "force",
    OMK_INIT_IMPORT_USER_SKILLS: "",
    OMK_INIT_LOCAL_USER: "",
    OMK_INIT_MCP_SERVERS: "0",
    CI: "",
    GITHUB_ACTIONS: "",
  };
  const isolatedEnvKeys = [
    "OMK_PROVIDER_CONFIG_PATH",
    "OMK_SECRETS_ENV_PATH",
    "OPENCODE_SECRETS_ENV_PATH",
    "DEEPSEEK_API_KEY",
  ];
  for (const key of isolatedEnvKeys) {
    delete env[key];
  }

  for (const key of isolatedEnvKeys) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  process.chdir(projectRoot);
  try {
    const { initCommand } = await import(`${INIT_MODULE_URL}?direct=${Date.now()}-${Math.random()}`);
    await initCommand({
      profile: "default",
      homeDir: homeRoot,
      env,
      argv: ["node", "omk", "init"],
      ...options,
    });
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("init does not copy secret-bearing global MCP entries into project config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-home-"));

  try {
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        remote: {
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer SHOULD_NOT_COPY" },
          env: { API_TOKEN: "SHOULD_NOT_COPY" },
        },
      },
    }), "utf-8");

    const result = runInit(projectRoot, homeRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.deepEqual(Object.keys(projectMcp.mcpServers), []);
    assert.equal(projectMcp.mcpServers.remote, undefined);
    assert.doesNotMatch(projectMcpRaw, /SHOULD_NOT_COPY|Authorization|API_TOKEN|Bearer|headers/);

    const configToml = await readFile(join(projectRoot, ".omk", "config.toml"), "utf-8");
    assert.match(configToml, /mcp_scope = "project"/);
    assert.match(configToml, /skills_scope = "project"/);
    assert.match(configToml, /hooks_scope = "project"/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init does not generate a project PNG logo and reports all core scaffold groups", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-no-png-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-no-png-home-"));

  try {
    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await assert.rejects(readFile(join(projectRoot, "omk-logo.png"), "utf-8"), /ENOENT/);
    assert.doesNotMatch(result.stdout, /omk-logo\.png|bundle missing|ASCII theme/i);

    const configToml = await readFile(join(projectRoot, ".omk", "config.toml"), "utf-8");
    assert.doesNotMatch(configToml, /^logo_image\s*=/m);
    assert.match(configToml, /^# logo_image = "assets\/omk-logo\.png"$/m);

    const expectedFiles = [
      ".omk/agents/root.yaml",
      ".omk/agents/roles/coder.yaml",
      ".omk/agents/roles/router.yaml",
      ".omk/prompts/root.md",
      ".omk/config.toml",
      ".omk/kimi.config.toml",
      ".omk/hooks/pre-shell-guard.sh",
      ".omk/hooks/worktree-create-guard.sh",
      ".omk/hooks/branch-diff-snapshot.sh",
      ".omk/hooks/release-check-before-stop.sh",
      ".omk/hooks/npm-audit-summary.sh",
      ".omk/hooks/typecheck-after-edit.sh",
      ".omk/hooks/eslint-after-edit.sh",
      ".omk/lsp.json",
      ".kimi/mcp.json",
      ".omk/mcp.json",
      ".omk/runtime-preset.json",
      ".omk/runtime-presets.json",
      ".omk/memory/project.md",
      ".omk/templates/spec-kit-omk-preset/preset.yml",
    ];
    for (const relativePath of expectedFiles) {
      await readFile(join(projectRoot, relativePath), "utf-8");
    }

    const runtimePreset = JSON.parse(await readFile(join(projectRoot, ".omk", "runtime-preset.json"), "utf-8"));
    assert.equal(runtimePreset.id, "omk-core-verified");
    assert.ok(runtimePreset.mcpServers.includes("omk-project"));
    const runtimePresets = JSON.parse(await readFile(join(projectRoot, ".omk", "runtime-presets.json"), "utf-8"));
    assert.equal(runtimePresets.defaultPresetId, "omk-core-verified");
    assert.deepEqual(runtimePresets.presets.map((preset) => preset.id), [
      "omk-core-verified",
      "omk-parallel-orchestrator",
      "omk-ts-product",
      "omk-worktree-team",
      "omk-release-guard",
    ]);

    const worktreeTeam = runtimePresets.presets.find((preset) => preset.id === "omk-worktree-team");
    assert.ok(worktreeTeam);
    assert.deepEqual(worktreeTeam.skills, [
      "omk-worktree-team",
      "omk-task-router",
      "omk-context-broker",
      "omk-quality-gate",
      "omk-git-commit-pr",
    ]);
    assert.deepEqual(worktreeTeam.hooks, [
      "worktree-create-guard.sh",
      "subagent-stop-audit.sh",
      "branch-diff-snapshot.sh",
      "stop-verify.sh",
    ]);
    assert.deepEqual(worktreeTeam.mcpServers, [
      "omk-project",
      "github",
      "memory",
      "filesystem-readonly",
    ]);
    assert.match(worktreeTeam.purpose, /isolated parallel worker lanes|branch snapshots|quality evidence/i);

    const releaseGuard = runtimePresets.presets.find((preset) => preset.id === "omk-release-guard");
    assert.ok(releaseGuard);
    assert.deepEqual(releaseGuard.skills, [
      "omk-secret-guard",
      "omk-security-review",
      "omk-quality-gate",
      "omk-docs-release",
      "omk-git-commit-pr",
      "omk-research-verify",
    ]);
    assert.deepEqual(releaseGuard.hooks, [
      "protect-secrets.sh",
      "pre-shell-guard.sh",
      "release-check-before-stop.sh",
      "npm-audit-summary.sh",
      "stop-verify.sh",
    ]);
    assert.deepEqual(releaseGuard.mcpServers, [
      "github",
      "omk-project",
      "fetch",
      "context7",
    ]);
    assert.match(releaseGuard.purpose, /secret scanning|destructive-shell|audit summaries|checklist evidence/i);
    assert.match(releaseGuard.purpose, /reference MCP servers|not production-ready|narrow MCP authority/i);

    for (const createdLine of [
      "- .omk/agents/root.yaml",
      "- .omk/agents/roles/",
      "- .omk/prompts/root.md",
      "- .omk/config.toml",
      "- .omk/kimi.config.toml",
      "- .omk/hooks/",
      "- .omk/lsp.json",
      "- .kimi/mcp.json",
      "- .omk/mcp.json",
      "- .omk/runtime-preset.json",
      "- .omk/runtime-presets.json",
      "- .omk/memory/",
      "- .omk/templates/spec-kit-omk-preset/",
    ]) {
      assert.match(result.stdout, new RegExp(escapeRegex(createdLine)));
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init output converges after doctor --fix without global config writes", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-doctor-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-doctor-home-"));
  const binRoot = await mkdtemp(join(tmpdir(), "omk-init-doctor-bin-"));

  try {
    await writeFakeKimi(binRoot);
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "config.toml"), "default_model = \"kimi\"\n# >>> omk managed hooks\n", "utf-8");

    const env = { PATH: `${binRoot}${delimiter}${process.env.PATH ?? ""}` };
    const init = runInit(projectRoot, homeRoot);
    const before = runCli(projectRoot, homeRoot, ["doctor", "--json", "--soft"], env);
    const fix = runCli(projectRoot, homeRoot, ["doctor", "--fix", "--json", "--soft"], env);
    const after = runCli(projectRoot, homeRoot, ["doctor", "--json", "--soft"], env);

    assert.equal(init.status, 0, init.stderr || init.stdout);
    assert.equal(before.status, 0, before.stderr || before.stdout);
    assert.equal(fix.status, 0, fix.stderr || fix.stdout);
    assert.equal(after.status, 0, after.stderr || after.stdout);
    assert.equal(before.stderr, "");
    assert.equal(fix.stderr, "");
    assert.equal(after.stderr, "");

    const beforeJson = JSON.parse(before.stdout);
    const fixJson = JSON.parse(fix.stdout);
    const afterJson = JSON.parse(after.stdout);
    assert.equal(beforeJson.scaffold.initialized, true);
    assert.equal(afterJson.scaffold.initialized, true);
    assert.equal(afterJson.scaffold.rootYaml, true);
    assert.ok(Array.isArray(fixJson.fixes.actions));
    assert.ok(Array.isArray(fixJson.fixes.skipped));
    assert.equal(afterJson.errors.length, 0);
    assert.equal(afterJson.warnings.some((warning) => warning.name === "Global MCP"), false);
    assert.equal(afterJson.warnings.some((warning) => warning.name === "Global Memory"), false);
    assert.equal(
      afterJson.errors.every((err) => !/root\.yaml|okabe|OMK_MCP_ENABLED|OMK_SKILLS_ENABLED|OMK_HOOKS_ENABLED/.test(err.message)),
      true
    );

    const homeMcpRaw = await readFile(join(homeRoot, ".kimi", "mcp.json"), "utf-8").catch(() => "{\"mcpServers\":{}}");
    assert.doesNotMatch(homeMcpRaw, /SHOULD_NOT_COPY|Bearer|API_TOKEN|Authorization/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
    await rm(binRoot, { recursive: true, force: true });
  }
});

test("doctor --fix imports legacy project settings into .omk and removes legacy local runtime dir", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-legacy-runtime-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-legacy-runtime-home-"));

  try {
    await mkdir(join(projectRoot, ".pi", "themes"), { recursive: true });
    await writeFile(join(projectRoot, ".pi", "settings.json"), JSON.stringify({ theme: "omk-control-grid-dark" }, null, 2), "utf-8");
    await writeFile(join(projectRoot, ".pi", "themes", "custom.json"), JSON.stringify({ name: "custom", colors: {} }, null, 2), "utf-8");

    const result = runCli(projectRoot, homeRoot, ["doctor", "--fix", "--json", "--soft"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.scaffold.initialized, true);
    assert.match(JSON.stringify(report.fixes.actions), /legacy local runtime settings/);

    const settingsRaw = await readFile(join(projectRoot, ".omk", "settings.json"), "utf-8");
    const themeRaw = await readFile(join(projectRoot, ".omk", "themes", "custom.json"), "utf-8");
    assert.deepEqual(JSON.parse(settingsRaw), { theme: "omk-control-grid-dark" });
    assert.deepEqual(JSON.parse(themeRaw), { name: "custom", colors: {} });
    await assert.rejects(readFile(join(projectRoot, ".pi", "settings.json"), "utf-8"), /ENOENT/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init scaffolds Kimi subagent names that match generated role aliases", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-subagents-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-subagents-home-"));

  try {
    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const agentsMd = await readFile(join(projectRoot, "AGENTS.md"), "utf-8");
    const kimiAgentsMd = await readFile(join(projectRoot, ".kimi", "AGENTS.md"), "utf-8");
    const rootPrompt = await readFile(join(projectRoot, ".omk", "prompts", "root.md"), "utf-8");
    const rootAgentYaml = await readFile(join(projectRoot, ".omk", "agents", "root.yaml"), "utf-8");
    const okabeAgentYaml = await readFile(join(projectRoot, ".omk", "agents", "okabe.yaml"), "utf-8");

    assert.match(agentsMd, /Repo exploration\s+explorer/);
    assert.doesNotMatch(agentsMd, /Repo exploration\s+explore(?!r)/);
    assert.match(kimiAgentsMd, /explorer\nplanner\ncoder\nreviewer/);
    assert.doesNotMatch(kimiAgentsMd, /^explore$/m);
    assert.match(rootPrompt, /# open-multi-agent-kit Root Agent/);
    assert.match(rootPrompt, /OMK root orchestrator/);
    assert.match(rootPrompt, /Models execute\. OMK routes, verifies, measures, and controls\./);
    assert.match(rootPrompt, /- explorer for repository discovery/);
    assert.match(rootPrompt, /- planner for architecture\/refactor\/risky work/);
    assert.doesNotMatch(rootPrompt, /- explore for repository discovery/);
    assert.match(rootPrompt, /provider-neutral orchestration control plane/);
    assert.match(rootAgentYaml, /\n    explorer:\n      path: \.\/roles\/explorer\.yaml/);
    assert.match(rootAgentYaml, /\n    explore:\n      path: \.\/roles\/explorer\.yaml/);
    assert.match(rootAgentYaml, /\n    planner:\n      path: \.\/roles\/planner\.yaml/);
    assert.match(rootAgentYaml, /\n    plan:\n      path: \.\/roles\/planner\.yaml/);
    assert.match(rootAgentYaml, /\n    router:\n      path: \.\/roles\/router\.yaml/);
    assert.match(rootAgentYaml, /OMK_ROLE: "root-coordinator"/);
    assert.match(rootAgentYaml, /OMK_MCP_ENABLED: "true"/);
    assert.match(rootAgentYaml, /OMK_SKILLS_ENABLED: "true"/);
    assert.match(rootAgentYaml, /OMK_HOOKS_ENABLED: "true"/);
    assert.match(okabeAgentYaml, /extend: default/);
    assert.match(okabeAgentYaml, /kimi_cli\.tools\.agent:Agent/);
    assert.match(okabeAgentYaml, /kimi_cli\.tools\.dmail:SendDMail/);
    assert.match(okabeAgentYaml, /OMK_MCP_ENABLED: "true"/);
    assert.match(okabeAgentYaml, /OMK_SKILLS_ENABLED: "true"/);
    assert.match(okabeAgentYaml, /OMK_HOOKS_ENABLED: "true"/);
    const rootRoleNames = [
      "architect",
      "coder",
      "reviewer",
      "security",
      "qa",
      "tester",
      "researcher",
      "integrator",
      "aggregator",
      "interviewer",
      "ontology",
      "vision-debugger",
      "router",
    ];
    const generatedRoleNames = [
      "explorer",
      "planner",
      ...rootRoleNames,
    ];

    assert.equal(rootRoleNames.length, 13);
    assert.equal(generatedRoleNames.length, 15);

    for (const role of rootRoleNames) {
      assert.match(
        rootAgentYaml,
        new RegExp(`\\n    ${escapeRegex(role)}:\\n      path: \\.\\/roles\\/${escapeRegex(role)}\\.yaml`)
      );
    }
    for (const role of generatedRoleNames) {
      const roleYaml = await readFile(join(projectRoot, ".omk", "agents", "roles", `${role}.yaml`), "utf-8");
      assert.match(roleYaml, /extend: \.\.\/okabe\.yaml/);
      assert.match(roleYaml, new RegExp(`name: omk-${escapeRegex(role)}`));
      assert.match(roleYaml, new RegExp(`OMK_ROLE: "${escapeRegex(role)}"`));
      assert.match(roleYaml, /OMK_MCP_ENABLED: "true"/);
      assert.match(roleYaml, /OMK_SKILLS_ENABLED: "true"/);
      assert.match(roleYaml, /OMK_HOOKS_ENABLED: "true"/);
      const excludedTools = getExcludeTools(roleYaml);
      if (role === "ontology") {
        assert.ok(excludedTools.includes("kimi_cli.tools.shell:Shell"));
      }
      if (role === "security") {
        assert.ok(excludedTools.includes("kimi_cli.tools.file:WriteFile"));
        assert.ok(excludedTools.includes("kimi_cli.tools.file:StrReplaceFile"));
        assert.ok(!excludedTools.includes("kimi_cli.tools.shell:Shell"));
      }
    }
    const initSource = await readFile(join(process.cwd(), "src", "commands", "init", "content.ts"), "utf-8");
    const ontologyFallback = initSource.match(/  ontology: `version: 1\n[\s\S]*?\n`,\n  "vision-debugger":/)?.[0] ?? "";
    const securityFallback = initSource.match(/  security: `version: 1\n[\s\S]*?\n`,\n  qa:/)?.[0] ?? "";
    assert.match(initSource, /\n  router: `version: 1\n[\s\S]*?OMK_ROLE: "router"[\s\S]*?`,\n  explorer:/);
    assert.match(ontologyFallback, /exclude_tools:[\s\S]*kimi_cli\.tools\.shell:Shell/);
    assert.doesNotMatch(securityFallback, /kimi_cli\.tools\.shell:Shell/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init installs an OMK-safe awesome-agent-skills UserPromptSubmit router hook", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-awesome-skills-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-awesome-skills-home-"));

  try {
    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const configToml = await readFile(join(projectRoot, ".omk", "kimi.config.toml"), "utf-8");
    assert.doesNotMatch(configToml, /event = "UserPromptSubmit"/);
    assert.doesNotMatch(configToml, /awesome-agent-skills-router\.sh/);

    const hookPath = join(projectRoot, ".omk", "hooks", "awesome-agent-skills-router.sh");
    const hookBody = await readFile(hookPath, "utf-8");
    const normalizedHookBody = hookBody.replace(/\\/g, "/");
    assert.match(normalizedHookBody, /VoltAgent\/awesome-agent-skills/);
    assert.match(normalizedHookBody, /omk-flow-design-to-code/);
    assert.match(normalizedHookBody, /Do not auto-install third-party skills/);

    const hookStat = await stat(hookPath);
    assertExecutableModeIfSupported(hookStat, "generated hook should be executable");

    if (!IS_WINDOWS) {
      const hookResult = spawnSync("bash", [hookPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          prompt: "디자인 UI prototype 만들고 playwright 테스트도 해줘",
        }),
      });
      assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);

      const hookOutput = JSON.parse(hookResult.stdout);
      assert.equal(hookOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
      assert.match(hookOutput.hookSpecificOutput.additionalContext, /awesome-agent-skills routing hint/);
      assert.match(hookOutput.hookSpecificOutput.additionalContext, /\/open-design/);
      assert.match(hookOutput.hookSpecificOutput.additionalContext, /\/awesome-design-md/);
      assert.match(hookOutput.hookSpecificOutput.additionalContext, /\/omk-design-md/);
      assert.match(hookOutput.hookSpecificOutput.additionalContext, /\/omk-quality-gate/);

      const graphHookResult = spawnSync("bash", [hookPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          prompt: "온톨로지 그래프 관계를 보고 리스크맵 확인",
        }),
      });
      assert.equal(graphHookResult.status, 0, graphHookResult.stderr || graphHookResult.stdout);

      const graphHookOutput = JSON.parse(graphHookResult.stdout);
      assert.match(graphHookOutput.hookSpecificOutput.additionalContext, /ontology-graph/);
      assert.match(graphHookOutput.hookSpecificOutput.additionalContext, /\/graph-view/);
      assert.match(graphHookOutput.hookSpecificOutput.additionalContext, /\/omk-kimi-runtime/);
    } else {
      const hookBody = await readFile(hookPath, "utf-8");
      assert.match(hookBody, /UserPromptSubmit/);
      assert.match(hookBody, /awesome-agent-skills routing hint/);
      assert.match(hookBody, /\/open-design/);
      assert.match(hookBody, /\/awesome-design-md/);
      assert.match(hookBody, /\/omk-design-md/);
      assert.match(hookBody, /\/omk-quality-gate/);
      assert.match(hookBody, /ontology-graph/);
      assert.match(hookBody, /\/graph-view/);
      assert.match(hookBody, /\/omk-kimi-runtime/);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init installs OMK lifecycle hooks and release guard", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-lifecycle-hooks-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-lifecycle-hooks-home-"));

  try {
    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const configToml = await readFile(join(projectRoot, ".omk", "kimi.config.toml"), "utf-8");
    assert.match(configToml, /event = "SessionStart"[\s\S]*session-context\.sh/);
    assert.match(configToml, /event = "PreCompact"[\s\S]*precompact-checkpoint\.sh/);
    assert.match(configToml, /event = "SubagentStop"[\s\S]*subagent-stop-audit\.sh/);
    assert.match(configToml, /event = "Stop"[\s\S]*stop-verify\.sh/);
    assert.doesNotMatch(configToml, /release-check-before-stop\.sh/);
    assert.doesNotMatch(configToml, /npm-audit-summary\.sh/);

    const hooks = [
      ["session-context.sh", "SessionStart", /open-design[\s\S]*graph-view/],
      ["precompact-checkpoint.sh", "PreCompact", /verification state/],
      ["subagent-stop-audit.sh", "SubagentStop", /quality gates/],
      ["stop-verify.sh", "Stop", /Deployment status/],
    ];

    for (const [scriptName, eventName, contextPattern] of hooks) {
      const hookPath = join(projectRoot, ".omk", "hooks", scriptName);
      const hookStat = await stat(hookPath);
      assertExecutableModeIfSupported(hookStat, `${scriptName} should be executable`);

      if (!IS_WINDOWS) {
        const hookResult = spawnSync("bash", [hookPath], {
          cwd: projectRoot,
          encoding: "utf-8",
          input: "{}",
        });
        assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);

        const output = JSON.parse(hookResult.stdout);
        const context = output.hookSpecificOutput?.additionalContext ?? output.systemMessage;
        if (output.hookSpecificOutput) {
          assert.equal(output.hookSpecificOutput.hookEventName, eventName);
        }
        assert.equal(typeof context, "string");
        assert.match(context, contextPattern);
      } else {
        const hookBody = await readFile(hookPath, "utf-8");
        assert.match(hookBody, new RegExp(eventName));
        assert.match(hookBody, contextPattern);
      }
    }

    for (const scriptName of ["typecheck-after-edit.sh", "eslint-after-edit.sh"]) {
      const hookPath = join(projectRoot, ".omk", "hooks", scriptName);
      const hookStat = await stat(hookPath);
      assertExecutableModeIfSupported(hookStat, `${scriptName} should be executable`);

      if (!IS_WINDOWS) {
        const hookResult = spawnSync("bash", [hookPath], {
          cwd: projectRoot,
          encoding: "utf-8",
          input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
        });
        assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);

        const output = JSON.parse(hookResult.stdout);
        assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
        assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
      } else {
        const hookBody = await readFile(hookPath, "utf-8");
        assert.match(hookBody, /PostToolUse/);
        assert.match(hookBody, /allow/);
      }
    }

    const guardPath = join(projectRoot, ".omk", "hooks", "pre-shell-guard.sh");
    if (!IS_WINDOWS) {
      for (const command of [
        "git push origin main",
        "npm publish",
        "pnpm publish",
        "yarn npm publish",
        "gh release create v1.2.3",
        "gh workflow run release.yml",
        "npm version patch",
        "git -c user.name=x push origin main",
        "npm --registry=https://registry.npmjs.org publish",
        "pnpm --filter pkg publish",
        "bash -lc 'git -c user.name=x push origin main'",
        "gh --repo owner/repo release create v1.2.3",
      ]) {
        const blocked = spawnSync("bash", [guardPath], {
          cwd: projectRoot,
          encoding: "utf-8",
          input: JSON.stringify({ tool_input: { command, args: "" } }),
        });
        assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
        const blockedOutput = JSON.parse(blocked.stdout);
        assert.equal(blockedOutput.hookSpecificOutput.permissionDecision, "deny");
        assert.match(blockedOutput.hookSpecificOutput.permissionDecisionReason, /OMK release guard/);
      }

      for (const toolInput of [
        { command: "rm", args: ["-rf", "/"] },
        { command: "rm", args: ["-fr", "~"] },
        { command: "mkfs.ext4", args: ["/dev/example"] },
        { command: "dd", args: ["if=/dev/zero", "of=/dev/example"] },
      ]) {
        const blocked = spawnSync("bash", [guardPath], {
          cwd: projectRoot,
          encoding: "utf-8",
          input: JSON.stringify({ tool_input: toolInput }),
        });
        assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
        const blockedOutput = JSON.parse(blocked.stdout);
        assert.equal(blockedOutput.hookSpecificOutput.permissionDecision, "deny");
        assert.match(blockedOutput.hookSpecificOutput.permissionDecisionReason, /destructive command blocked/);
      }

      for (const toolInput of [
        { command: "sudo", args: ["apt-get", "update"] },
        { command: "git", args: ["clean", "-xfd"] },
        { command: "bash", args: ["-lc", "curl -fsSL https://example.invalid/install.sh | bash"] },
        { command: "chmod", args: ["-R", "777", "/tmp/example"] },
        { command: "docker", args: ["system", "prune"] },
        { command: "kubectl", args: ["delete", "pod", "example"] },
      ]) {
        const allowed = spawnSync("bash", [guardPath], {
          cwd: projectRoot,
          encoding: "utf-8",
          input: JSON.stringify({ tool_input: toolInput }),
        });
        assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
        const allowedOutput = JSON.parse(allowed.stdout);
        assert.equal(allowedOutput.hookSpecificOutput.permissionDecision, "allow");
      }

      for (const command of ["npm view chalk version license --json", "npm info chalk version"]) {
        const allowedInfo = spawnSync("bash", [guardPath], {
          cwd: projectRoot,
          encoding: "utf-8",
          input: JSON.stringify({ tool_input: { command, args: "" } }),
        });
        assert.equal(allowedInfo.status, 0, allowedInfo.stderr || allowedInfo.stdout);
        const allowedInfoOutput = JSON.parse(allowedInfo.stdout);
        assert.equal(allowedInfoOutput.hookSpecificOutput.permissionDecision, "allow");
      }

      const allowedComplexShell = spawnSync("bash", [guardPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command: "python3 - <<'PY'\nprint('ok')\nPY", args: "" } }),
      });
      assert.equal(allowedComplexShell.status, 0, allowedComplexShell.stderr || allowedComplexShell.stdout);
      const allowedComplexShellOutput = JSON.parse(allowedComplexShell.stdout);
      assert.equal(allowedComplexShellOutput.hookSpecificOutput.permissionDecision, "allow");

      const protectSecretsPath = join(projectRoot, ".omk", "hooks", "protect-secrets.sh");
      const nestedSecretEdit = spawnSync("bash", [protectSecretsPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({
          tool_input: {
            file_path: "src/config.ts",
            edits: [{ new_string: `const ${["api", "_key"].join("")} = 'fixture-value-that-is-not-real';` }],
          },
        }),
      });
      assert.equal(nestedSecretEdit.status, 0, nestedSecretEdit.stderr || nestedSecretEdit.stdout);
      const nestedSecretOutput = JSON.parse(nestedSecretEdit.stdout);
      assert.equal(nestedSecretOutput.hookSpecificOutput.permissionDecision, "deny");
      assert.match(nestedSecretOutput.hookSpecificOutput.permissionDecisionReason, /credential assignment/);

      const nestedSensitivePathEdit = spawnSync("bash", [protectSecretsPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({
          tool_input: {
            edits: [{ path: "config/.env.local", new_string: "placeholder" }],
          },
        }),
      });
      assert.equal(nestedSensitivePathEdit.status, 0, nestedSensitivePathEdit.stderr || nestedSensitivePathEdit.stdout);
      const nestedSensitivePathOutput = JSON.parse(nestedSensitivePathEdit.stdout);
      assert.equal(nestedSensitivePathOutput.hookSpecificOutput.permissionDecision, "deny");
      assert.match(nestedSensitivePathOutput.hookSpecificOutput.permissionDecisionReason, /sensitive file/);

      const legacyAuthPathEdit = spawnSync("bash", [protectSecretsPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({
          tool_input: {
            file_path: ".pi/agent/auth.json",
            content: "{}",
          },
        }),
      });
      assert.equal(legacyAuthPathEdit.status, 0, legacyAuthPathEdit.stderr || legacyAuthPathEdit.stdout);
      const legacyAuthPathOutput = JSON.parse(legacyAuthPathEdit.stdout);
      assert.equal(legacyAuthPathOutput.hookSpecificOutput.permissionDecision, "deny");
      assert.match(legacyAuthPathOutput.hookSpecificOutput.permissionDecisionReason, /sensitive file/);

      const tokenField = ["access", "_token"].join("");
      const jsonTokenEdit = spawnSync("bash", [protectSecretsPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({
          tool_input: {
            file_path: "notes/redacted.json",
            content: JSON.stringify({ [tokenField]: "fixture-token-value-that-is-not-real" }),
          },
        }),
      });
      assert.equal(jsonTokenEdit.status, 0, jsonTokenEdit.stderr || jsonTokenEdit.stdout);
      const jsonTokenOutput = JSON.parse(jsonTokenEdit.stdout);
      assert.equal(jsonTokenOutput.hookSpecificOutput.permissionDecision, "deny");
      assert.match(jsonTokenOutput.hookSpecificOutput.permissionDecisionReason, /credential assignment/);

      const allowedShell = spawnSync("bash", [guardPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command: "npm test", args: "" } }),
      });
      assert.equal(allowedShell.status, 0, allowedShell.stderr || allowedShell.stdout);
      const allowedShellOutput = JSON.parse(allowedShell.stdout);
      assert.equal(allowedShellOutput.hookSpecificOutput.permissionDecision, "allow");

      const allowedPush = spawnSync("bash", [guardPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command: "git push origin main", args: "" } }),
        env: { ...process.env, OMK_ALLOW_RELEASE: "1" },
      });
      assert.equal(allowedPush.status, 0, allowedPush.stderr || allowedPush.stdout);
      const allowedPushOutput = JSON.parse(allowedPush.stdout);
      assert.equal(allowedPushOutput.hookSpecificOutput.permissionDecision, "allow");
    } else {
      const guardBody = await readFile(guardPath, "utf-8");
      assert.match(guardBody, /deny/);
      assert.match(guardBody, /OMK release guard/);
      assert.match(guardBody, /allow/);
      const protectBody = await readFile(join(projectRoot, ".omk", "hooks", "protect-secrets.sh"), "utf-8");
      assert.match(protectBody, /walk\(tool_input\)/);
      assert.match(protectBody, /High-confidence credential/);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init omk-project MCP avoids ephemeral package paths", async () => {
  const { createOmkProjectMcpServer } = await import(INIT_MODULE_URL);
  const server = createOmkProjectMcpServer("/workspace/app", {
    packageRoot: join(tmpdir(), "omk-smoke-local-abc", "node_modules", "open-multi-agent-kit"),
    platform: "linux",
  });

  assert.equal(server.command, "bash");
  assert.match(server.args[1], /command -v omk/);
  assert.doesNotMatch(server.args[1], /command -v open-multi-agent-kit/);
  assert.match(server.args[1], /command -v omk-project-mcp/);
  assert.match(server.args[1], /mcp serve omk-project/);
  assert.match(server.args[1], new RegExp(escapeRegex(realpathSync(process.execPath))));
  assert.equal(server.env.OMK_PROJECT_ROOT, "/workspace/app");
  assert.equal(server.args.join(" ").includes("omk-smoke-local-abc"), false);
});

test("init omk-project MCP pins the current real Node executable on Unix", async () => {
  const { createOmkProjectMcpServer } = await import(INIT_MODULE_URL);
  const server = createOmkProjectMcpServer("/workspace/app", {
    packageRoot: "/opt/open_multi-agent_kit",
    platform: "linux",
  });

  assert.equal(server.command, "bash");
  assert.match(server.args[1], new RegExp(escapeRegex(realpathSync(process.execPath))));
  assert.doesNotMatch(server.args[1], /\bexec node\b/);
  assert.match(server.args[1], /mcp serve omk-project/);
  assert.match(server.args[1], /command -v omk/);
  assert.doesNotMatch(server.args[1], /\/opt\/open_multi-agent_kit/);
});

test("init preserves an existing custom project MCP config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-existing-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-existing-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      _comment: "custom project config",
      mcpServers: {
        local: { command: "node", args: ["local-server.js"] },
      },
    }, null, 2), "utf-8");

    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        secret: { env: { API_TOKEN: "SHOULD_NOT_COPY" } },
      },
    }), "utf-8");

    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.ok(projectMcp.mcpServers.local);
    assert.equal(projectMcp.mcpServers.secret, undefined);
    assert.doesNotMatch(projectMcpRaw, /SHOULD_NOT_COPY/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init preserves existing .omk MCP config while removing stale managed omk-project mirror", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-existing-omk-mcp-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-existing-omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      _comment: "legacy project config",
      mcpServers: {
        local: { command: "node", args: ["legacy-server.js"] },
        "omk-project": {
          command: "bash",
          args: ["-lc", "exec node /tmp/stale/omk-project-server.js"],
          env: { OMK_PROJECT_ROOT: "/tmp/stale-project" },
        },
      },
    }, null, 2), "utf-8");

    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = await readFile(join(projectRoot, ".omk", "mcp.json"), "utf-8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed.mcpServers.local);
    assert.equal(parsed.mcpServers["omk-project"], undefined);
    assert.doesNotMatch(raw, /stale-project|\/tmp\/stale/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init refreshes an existing stale omk-project MCP entry", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-refresh-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-refresh-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      _comment: "custom project config",
      mcpServers: {
        local: { command: "node", args: ["local-server.js"] },
        "omk-project": {
          command: "bash",
          args: ["-lc", "exec node /tmp/omk-home-stale/dist/mcp/omk-project-server.js"],
          env: { OMK_PROJECT_ROOT: "/tmp/old-project" },
        },
      },
    }, null, 2), "utf-8");

    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.ok(projectMcp.mcpServers.local);
    assert.equal(projectMcp.mcpServers["omk-project"], undefined);
    assert.doesNotMatch(projectMcpRaw, /omk-home-stale|old-project/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("worktree guard blocks git global option and comment spoof bypasses", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-worktree-guard-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-worktree-home-"));

  try {
    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const hookPath = join(projectRoot, ".omk", "hooks", "worktree-create-guard.sh");
    if (!IS_WINDOWS) {
      const runHook = (command) => spawnSync("bash", [hookPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command } }),
        env: { ...process.env, OMK_PROJECT_ROOT: projectRoot },
      });

      const allowed = runHook("git worktree add .omk/worktrees/feature");
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.match(allowed.stdout, /"permissionDecision":"allow"/);

      const globalOptionBypass = runHook("git -C . worktree add /tmp/outside");
      assert.equal(globalOptionBypass.status, 0, globalOptionBypass.stderr);
      assert.match(globalOptionBypass.stdout, /"permissionDecision":"deny"/);

      const commentSpoofBypass = runHook("git worktree add /tmp/outside # .omk/worktrees/spoof");
      assert.equal(commentSpoofBypass.status, 0, commentSpoofBypass.stderr);
      assert.match(commentSpoofBypass.stdout, /"permissionDecision":"deny"/);

      const shellWrapperBypass = runHook("bash -lc 'git worktree add /tmp/outside'");
      assert.equal(shellWrapperBypass.status, 0, shellWrapperBypass.stderr);
      assert.match(shellWrapperBypass.stdout, /"permissionDecision":"deny"/);
    } else {
      const hookBody = await readFile(hookPath, "utf-8");
      assert.match(hookBody, /permissionDecision/);
      assert.match(hookBody, /allow/);
      assert.match(hookBody, /deny/);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init skips broken global skill symlinks instead of failing", async () => {
  if (IS_WINDOWS) {
    // Symlink creation requires Developer Mode or admin on Windows
    return;
  }
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-symlink-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-symlink-home-"));

  try {
    const skillsRoot = join(homeRoot, ".kimi", "skills");
    await mkdir(skillsRoot, { recursive: true });
    await symlink(join(homeRoot, "missing-skill-target"), join(skillsRoot, "broken-skill"));

    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const generatedSkill = await readFile(
      join(projectRoot, ".kimi", "skills", "omk-kimi-runtime", "SKILL.md"),
      "utf-8"
    );
    assert.match(generatedSkill, /Kimi K2\.6 runtime/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init does not import personal/global skills by default", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-skills-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-skills-home-"));

  try {
    const codexSkillsRoot = join(homeRoot, ".codex", "skills");
    const agentsSkillsRoot = join(homeRoot, ".agents", "skills");
    await mkdir(join(codexSkillsRoot, "safe-codex-skill"), { recursive: true });
    await mkdir(join(codexSkillsRoot, "unsafe-codex-skill"), { recursive: true });
    await mkdir(join(agentsSkillsRoot, "safe-agent-skill"), { recursive: true });

    await writeFile(
      join(codexSkillsRoot, "safe-codex-skill", "SKILL.md"),
      "---\nname: safe-codex-skill\n---\nUses process.env.EXAMPLE_API_KEY placeholders only.\n",
      "utf-8"
    );
    const fakeSecret = `sk-${"1234567890".repeat(3)}`;
    await writeFile(
      join(codexSkillsRoot, "unsafe-codex-skill", "SKILL.md"),
      `api_key = "${fakeSecret}"\n`,
      "utf-8"
    );
    await writeFile(
      join(agentsSkillsRoot, "safe-agent-skill", "SKILL.md"),
      "---\nname: safe-agent-skill\n---\nPortable skill.\n",
      "utf-8"
    );

    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const packagedKimiSkill = await readFile(
      join(projectRoot, ".kimi", "skills", "omk-kimi-runtime", "SKILL.md"),
      "utf-8"
    );
    assert.match(packagedKimiSkill, /Kimi K2\.6 runtime/);

    await assert.rejects(
      readFile(join(projectRoot, ".kimi", "skills", "safe-codex-skill", "SKILL.md"), "utf-8"),
      /ENOENT/
    );
    await assert.rejects(
      readFile(join(projectRoot, ".kimi", "skills", "unsafe-codex-skill", "SKILL.md"), "utf-8"),
      /ENOENT/
    );
    await assert.rejects(
      readFile(join(projectRoot, ".agents", "skills", "safe-agent-skill", "SKILL.md"), "utf-8"),
      /ENOENT/
    );
    assert.equal(result.stdout.includes(fakeSecret), false);
    assert.equal(result.stdout.includes("Importing ~/.codex/skills"), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init imports personal skills only with explicit trusted opt-in", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-skills-optin-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-skills-optin-home-"));

  try {
    const codexSkillsRoot = join(homeRoot, ".codex", "skills");
    const agentsSkillsRoot = join(homeRoot, ".agents", "skills");
    await mkdir(join(codexSkillsRoot, "safe-codex-skill"), { recursive: true });
    await mkdir(join(codexSkillsRoot, "unsafe-codex-skill"), { recursive: true });
    await mkdir(join(agentsSkillsRoot, "safe-agent-skill"), { recursive: true });

    await writeFile(
      join(codexSkillsRoot, "safe-codex-skill", "SKILL.md"),
      "---\nname: safe-codex-skill\n---\nMaintainer-authored local skill.\n",
      "utf-8"
    );
    const fakeSecret = `sk-${"9876543210".repeat(3)}`;
    await writeFile(
      join(codexSkillsRoot, "unsafe-codex-skill", "SKILL.md"),
      `api_key = "${fakeSecret}"\n`,
      "utf-8"
    );
    await writeFile(
      join(agentsSkillsRoot, "safe-agent-skill", "SKILL.md"),
      "---\nname: safe-agent-skill\n---\nTrusted local portable skill.\n",
      "utf-8"
    );

    const result = runInit(projectRoot, homeRoot, { importUserSkills: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const importedCodexSkill = await readFile(
      join(projectRoot, ".kimi", "skills", "safe-codex-skill", "SKILL.md"),
      "utf-8"
    );
    assert.match(importedCodexSkill, /Maintainer-authored local skill/);

    const importedAgentSkill = await readFile(
      join(projectRoot, ".agents", "skills", "safe-agent-skill", "SKILL.md"),
      "utf-8"
    );
    assert.match(importedAgentSkill, /Trusted local portable skill/);

    await assert.rejects(
      readFile(join(projectRoot, ".kimi", "skills", "unsafe-codex-skill", "SKILL.md"), "utf-8"),
      /ENOENT/
    );
    assert.equal(result.stdout.includes(fakeSecret), false);
    assert.match(result.stdout, /trusted local opt-in/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init recognizes WSL UNC ~/.kimi/mcp.json as the user home when importing trusted skills", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-wsl-unc-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-wsl-unc-home-"));

  try {
    const skillRoot = join(homeRoot, ".kimi", "skills", "safe-wsl-skill");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: safe-wsl-skill\n---\nPortable WSL skill.\n", "utf-8");
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        global: { command: "node", args: ["global-server.js"] },
      },
    }), "utf-8");

    const result = runInit(projectRoot, homeRoot, {
      homeDir: toWslUncPath(join(homeRoot, ".kimi", "mcp.json")),
      importUserSkills: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const importedSkill = await readFile(
      join(projectRoot, ".kimi", "skills", "safe-wsl-skill", "SKILL.md"),
      "utf-8"
    );
    assert.match(importedSkill, /Portable WSL skill/);

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.equal(projectMcp.mcpServers.global, undefined);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init local-user mode uses WSL UNC ~/.kimi/mcp.json with omk-project at runtime", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-local-user-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-local-user-home-"));
  const doctorHome = await mkdtemp(join(tmpdir(), "omk-init-local-user-doctor-home-"));

  try {
    const skillRoot = join(homeRoot, ".kimi", "skills", "private-wsl-skill");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: private-wsl-skill\n---\nPrivate WSL skill.\n", "utf-8");
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        "private-global": { command: process.execPath, args: ["--version"] },
      },
    }), "utf-8");
    const uncMcpPath = toWslUncPath(join(homeRoot, ".kimi", "mcp.json"));

    const result = runInit(projectRoot, homeRoot, {
      homeDir: uncMcpPath,
      localUser: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const configToml = await readFile(join(projectRoot, ".omk", "config.toml"), "utf-8");
    assert.match(configToml, /mcp_scope = "all"/);
    assert.match(configToml, /skills_scope = "all"/);
    assert.match(configToml, /hooks_scope = "all"/);
    assert.match(result.stdout, /Local user runtime enabled/);
    assert.deepEqual(readRuntimeScopes(projectRoot, homeRoot), {
      mcpScope: "all",
      skillsScope: "all",
      hooksScope: "all",
    });

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.equal(projectMcp.mcpServers["private-global"], undefined);

    const shimBin = join(projectRoot, "bin");
    await writeOmkShim(shimBin);

    const doctorEnv = { ...process.env };
    delete doctorEnv.OMK_MCP_SCOPE;
    delete doctorEnv.OMK_SKILLS_SCOPE;
    delete doctorEnv.OMK_HOOKS_SCOPE;
    const doctor = spawnSync(process.execPath, [CLI, "mcp", "doctor"], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: {
        ...doctorEnv,
        PATH: `${shimBin}${delimiter}${process.env.PATH ?? ""}`,
        Path: `${shimBin}${delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
        HOME: doctorHome,
        OMK_ORIGINAL_HOME: uncMcpPath,
        OMK_PROJECT_ROOT: projectRoot,
        OMK_RENDER_LOGO: "0",
        OMK_STAR_PROMPT: "0",
      },
    });
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    assert.match(doctor.stdout, /Active MCP scope: all/);
    assert.match(doctor.stdout, new RegExp(`${escapeRegex(basename(homeRoot))}.*\\.kimi[\\\\/]mcp\\.json`));
    assert.match(doctor.stdout, /Server: private-global/);
    assert.match(doctor.stdout, /Server: omk-project/);
    assert.match(doctor.stdout, /virtual runtime MCP injected/);

    await assert.rejects(
      readFile(join(projectRoot, ".kimi", "skills", "private-wsl-skill", "SKILL.md"), "utf-8"),
      /ENOENT/
    );
    await readFile(join(projectRoot, ".kimi", "skills", "omk-kimi-runtime", "SKILL.md"), "utf-8");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
    await rm(doctorHome, { recursive: true, force: true });
  }
});

test("init interactive setup asks for GitHub star and saves DeepSeek key to user-local secrets only", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-interactive-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-interactive-home-"));
  const fakeKey = `deepseek-test-${"x".repeat(24)}`;
  const starredRepos = [];
  let localUserRuntimeAsked = 0;
  let deepseekSetupAsked = 0;
  let deepseekKeyAsked = 0;

  try {
    await runInitDirect(projectRoot, homeRoot, {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      promptGitHubStar: async () => true,
      starRepo: async (repoUrl) => {
        starredRepos.push(repoUrl);
      },
      promptLocalUserRuntime: async () => {
        localUserRuntimeAsked += 1;
        return false;
      },
      promptDeepSeekSetup: async () => {
        deepseekSetupAsked += 1;
        return true;
      },
      promptDeepSeekApiKey: async () => {
        deepseekKeyAsked += 1;
        return fakeKey;
      },
    });

    assert.equal(starredRepos.length, 1);
    assert.equal(localUserRuntimeAsked, 1);
    assert.equal(deepseekSetupAsked, 1);
    assert.equal(deepseekKeyAsked, 1);

    const starState = JSON.parse(await readFile(join(homeRoot, ".omk", "star-prompt.json"), "utf-8"));
    assert.equal(starState.answer, "yes");
    assert.equal(starState.starred, true);

    const secretsRaw = await readFile(join(homeRoot, ".config", "omk", "secrets.env"), "utf-8");
    assert.match(secretsRaw, /^export DEEPSEEK_API_KEY=/m);
    assert.ok(secretsRaw.includes(fakeKey));

    const providersRaw = await readFile(join(homeRoot, ".config", "omk", "providers.json"), "utf-8");
    const providers = JSON.parse(providersRaw);
    assert.equal(providers.providers.deepseek.enabled, true);
    assert.equal(providers.providers.deepseek.apiKeyEnv, "DEEPSEEK_API_KEY");
    assert.equal(providersRaw.includes(fakeKey), false);

    for (const relativePath of ["AGENTS.md", ".kimi/AGENTS.md", ".kimi/mcp.json", ".omk/config.toml"]) {
      const content = await readFile(join(projectRoot, relativePath), "utf-8");
      assert.equal(content.includes(fakeKey), false, `${relativePath} leaked DeepSeek API key`);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init interactive setup can opt into local global MCP runtime without copying global MCP servers", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-interactive-local-mcp-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-interactive-local-mcp-home-"));
  let localUserRuntimeAsked = 0;

  try {
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        "private-global": {
          command: process.execPath,
          args: ["--version"],
          env: { API_TOKEN: "SHOULD_NOT_COPY" },
        },
      },
    }), "utf-8");

    await runInitDirect(projectRoot, homeRoot, {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      promptGitHubStar: async () => false,
      promptLocalUserRuntime: async ({ homeDir }) => {
        localUserRuntimeAsked += 1;
        assert.equal(homeDir, homeRoot);
        return true;
      },
      promptDeepSeekSetup: async () => false,
    });

    assert.equal(localUserRuntimeAsked, 1);

    const configToml = await readFile(join(projectRoot, ".omk", "config.toml"), "utf-8");
    assert.match(configToml, /mcp_scope = "all"/);
    assert.match(configToml, /skills_scope = "all"/);
    assert.match(configToml, /hooks_scope = "all"/);
    assert.deepEqual(readRuntimeScopes(projectRoot, homeRoot), {
      mcpScope: "all",
      skillsScope: "all",
      hooksScope: "all",
    });

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.equal(projectMcp.mcpServers["private-global"], undefined);
    assert.equal(projectMcpRaw.includes("SHOULD_NOT_COPY"), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init interactive setup is skipped in non-TTY mode", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-nontty-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-nontty-home-"));

  try {
    await runInitDirect(projectRoot, homeRoot, {
      stdin: { isTTY: false },
      stdout: { isTTY: false },
      promptGitHubStar: async () => {
        throw new Error("GitHub star prompt should not run in non-TTY mode");
      },
      promptLocalUserRuntime: async () => {
        throw new Error("MCP runtime prompt should not run in non-TTY mode");
      },
      promptDeepSeekSetup: async () => {
        throw new Error("DeepSeek setup prompt should not run in non-TTY mode");
      },
    });

    await assert.rejects(readFile(join(homeRoot, ".omk", "star-prompt.json"), "utf-8"), /ENOENT/);
    await assert.rejects(readFile(join(homeRoot, ".config", "omk", "secrets.env"), "utf-8"), /ENOENT/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});
