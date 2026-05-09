import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INIT_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "init.js")).href;
const CLI = join(process.cwd(), "dist", "cli.js");
const POSIX_EXECUTABLE_BITS_SUPPORTED = process.platform !== "win32";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toWslUncPath(absPath, distro = "Ubuntu-24.04") {
  return `\\\\wsl.localhost\\${distro}${absPath.replace(/\//g, "\\")}`;
}

function assertExecutableModeIfSupported(fileStat, message) {
  if (!POSIX_EXECUTABLE_BITS_SUPPORTED) return;
  assert.ok((fileStat.mode & 0o111) !== 0, message);
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
      OMK_PROJECT_ROOT: projectRoot,
      OMK_RENDER_LOGO: "0",
      OMK_STAR_PROMPT: "0",
    },
  });
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
    assert.deepEqual(Object.keys(projectMcp.mcpServers), ["omk-project"]);
    assert.ok(projectMcp.mcpServers["omk-project"]);
    assert.equal(projectMcp.mcpServers["omk-project"].env.OMK_PROJECT_ROOT, projectRoot);
    assert.match(projectMcp.mcpServers["omk-project"].args.join(" "), /mcp serve omk-project|omk-project-mcp/);
    assert.equal(projectMcp.mcpServers.remote, undefined);
    assert.doesNotMatch(projectMcpRaw, /SHOULD_NOT_COPY|Authorization|API_TOKEN|Bearer|headers/);

    const configToml = await readFile(join(projectRoot, ".omk", "config.toml"), "utf-8");
    assert.match(configToml, /mcp_scope = "project"/);
    assert.match(configToml, /skills_scope = "project"/);
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

    assert.match(agentsMd, /Repo exploration\s+explorer/);
    assert.doesNotMatch(agentsMd, /Repo exploration\s+explore(?!r)/);
    assert.match(kimiAgentsMd, /explorer\nplanner\ncoder\nreviewer/);
    assert.doesNotMatch(kimiAgentsMd, /^explore$/m);
    assert.match(rootPrompt, /- explorer for repository discovery/);
    assert.match(rootPrompt, /- planner for architecture\/refactor\/risky work/);
    assert.doesNotMatch(rootPrompt, /- explore for repository discovery/);
    assert.match(rootAgentYaml, /\n    explorer:\n      path: \.\/roles\/explorer\.yaml/);
    assert.match(rootAgentYaml, /\n    explore:\n      path: \.\/roles\/explorer\.yaml/);
    assert.match(rootAgentYaml, /\n    planner:\n      path: \.\/roles\/planner\.yaml/);
    assert.match(rootAgentYaml, /\n    plan:\n      path: \.\/roles\/planner\.yaml/);
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
    assert.match(configToml, /event = "UserPromptSubmit"/);
    assert.match(configToml, /awesome-agent-skills-router\.sh/);

    const hookPath = join(projectRoot, ".omk", "hooks", "awesome-agent-skills-router.sh");
    const hookBody = await readFile(hookPath, "utf-8");
    assert.match(hookBody, /VoltAgent\/awesome-agent-skills/);
    assert.match(hookBody, /omk-flow-design-to-code/);
    assert.match(hookBody, /Do not auto-install third-party skills/);

    const hookStat = await stat(hookPath);
    assertExecutableModeIfSupported(hookStat, "generated hook should be executable");

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

      const hookResult = spawnSync("bash", [hookPath], {
        cwd: projectRoot,
        encoding: "utf-8",
        input: "{}",
      });
      assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);

      const output = JSON.parse(hookResult.stdout);
      assert.equal(output.hookSpecificOutput.hookEventName, eventName);
      assert.match(output.hookSpecificOutput.additionalContext, contextPattern);
    }

    const guardPath = join(projectRoot, ".omk", "hooks", "pre-shell-guard.sh");
    const blockedPush = spawnSync("bash", [guardPath], {
      cwd: projectRoot,
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { command: "git push origin main", args: "" } }),
    });
    assert.equal(blockedPush.status, 0, blockedPush.stderr || blockedPush.stdout);
    const blockedPushOutput = JSON.parse(blockedPush.stdout);
    assert.equal(blockedPushOutput.hookSpecificOutput.permissionDecision, "deny");
    assert.match(blockedPushOutput.hookSpecificOutput.permissionDecisionReason, /Release\/deploy command blocked/);

    const allowedPush = spawnSync("bash", [guardPath], {
      cwd: projectRoot,
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { command: "git push origin main", args: "" } }),
      env: { ...process.env, OMK_ALLOW_RELEASE: "1" },
    });
    assert.equal(allowedPush.status, 0, allowedPush.stderr || allowedPush.stdout);
    const allowedPushOutput = JSON.parse(allowedPush.stdout);
    assert.equal(allowedPushOutput.hookSpecificOutput.permissionDecision, "allow");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init omk-project MCP avoids ephemeral package paths", async () => {
  const { createOmkProjectMcpServer } = await import(INIT_MODULE_URL);
  const server = createOmkProjectMcpServer("/workspace/app", {
    packageRoot: join(tmpdir(), "omk-smoke-local-abc", "node_modules", "@oh-my-kimi", "cli"),
    platform: "linux",
  });

  assert.equal(server.command, "bash");
  assert.match(server.args[1], /command -v omk/);
  assert.match(server.args[1], /command -v oh-my-kimi/);
  assert.match(server.args[1], /command -v omk-project-mcp/);
  assert.match(server.args[1], /mcp serve omk-project/);
  assert.match(server.args[1], new RegExp(escapeRegex(realpathSync(process.execPath))));
  assert.equal(server.env.OMK_PROJECT_ROOT, "/workspace/app");
  assert.equal(server.args.join(" ").includes("omk-smoke-local-abc"), false);
});

test("init omk-project MCP pins the current real Node executable on Unix", async () => {
  const { createOmkProjectMcpServer } = await import(INIT_MODULE_URL);
  const server = createOmkProjectMcpServer("/workspace/app", {
    packageRoot: "/opt/oh-my-kimi",
    platform: "linux",
  });

  assert.equal(server.command, "bash");
  assert.match(server.args[1], new RegExp(escapeRegex(realpathSync(process.execPath))));
  assert.doesNotMatch(server.args[1], /\bexec node\b/);
  assert.match(server.args[1], /mcp serve omk-project/);
  assert.match(server.args[1], /command -v omk/);
  assert.doesNotMatch(server.args[1], /\/opt\/oh-my-kimi/);
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
    assert.ok(projectMcp.mcpServers["omk-project"]);
    if (process.platform === "win32") {
      assert.equal(projectMcp.mcpServers["omk-project"].command, "omk");
      assert.deepEqual(projectMcp.mcpServers["omk-project"].args, ["mcp", "serve", "omk-project"]);
    } else {
      assert.match(projectMcp.mcpServers["omk-project"].args.join(" "), /command -v omk/);
    }
    assert.equal(projectMcp.mcpServers.secret, undefined);
    assert.doesNotMatch(projectMcpRaw, /SHOULD_NOT_COPY/);
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
    assert.equal(projectMcp.mcpServers["omk-project"].env.OMK_PROJECT_ROOT, projectRoot);
    if (process.platform === "win32") {
      assert.equal(projectMcp.mcpServers["omk-project"].command, "omk");
      assert.deepEqual(projectMcp.mcpServers["omk-project"].args, ["mcp", "serve", "omk-project"]);
    } else {
      assert.match(projectMcp.mcpServers["omk-project"].args.join(" "), /command -v omk/);
    }
    assert.doesNotMatch(projectMcpRaw, /omk-home-stale|\/tmp\/old-project/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init skips broken global skill symlinks instead of failing", async () => {
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
    assert.ok(projectMcp.mcpServers["omk-project"]);
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
    assert.match(result.stdout, /Local user runtime enabled/);

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.ok(projectMcp.mcpServers["omk-project"]);
    assert.equal(projectMcp.mcpServers["private-global"], undefined);

    const doctor = spawnSync(process.execPath, [CLI, "mcp", "doctor"], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: doctorHome,
        OMK_ORIGINAL_HOME: uncMcpPath,
        OMK_PROJECT_ROOT: projectRoot,
        OMK_RENDER_LOGO: "0",
        OMK_STAR_PROMPT: "0",
      },
    });
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    assert.match(doctor.stdout, /Active MCP scope: all/);
    assert.match(doctor.stdout, new RegExp(escapeRegex(join(homeRoot, ".kimi", "mcp.json"))));
    assert.match(doctor.stdout, /Server: private-global/);
    assert.match(doctor.stdout, /Server: omk-project/);

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

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.ok(projectMcp.mcpServers["omk-project"]);
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
