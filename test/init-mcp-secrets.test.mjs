import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INIT_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "init.js")).href;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toWslUncPath(absPath, distro = "Ubuntu-24.04") {
  return `\\\\wsl.localhost\\${distro}${absPath.replace(/\//g, "\\")}`;
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
    assert.match(projectMcp.mcpServers["omk-project"].args.join(" "), /omk-project-server\.js|omk-project-mcp/);
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
  assert.match(server.args[1], /omk-project-server\.js/);
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
  assert.match(server.args[1], /omk-project-server\.js/);
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
    assert.match(projectMcp.mcpServers["omk-project"].args.join(" "), /command -v omk/);
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
    assert.match(projectMcp.mcpServers["omk-project"].args.join(" "), /command -v omk/);
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

test("init local-user mode uses WSL UNC ~/.kimi/skills at runtime without copying personal files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-local-user-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-local-user-home-"));

  try {
    const skillRoot = join(homeRoot, ".kimi", "skills", "private-wsl-skill");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: private-wsl-skill\n---\nPrivate WSL skill.\n", "utf-8");
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        "private-global": { command: "node", args: ["private-global.js"] },
      },
    }), "utf-8");

    const result = runInit(projectRoot, homeRoot, {
      homeDir: toWslUncPath(join(homeRoot, ".kimi", "skills")),
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

    await assert.rejects(
      readFile(join(projectRoot, ".kimi", "skills", "private-wsl-skill", "SKILL.md"), "utf-8"),
      /ENOENT/
    );
    await readFile(join(projectRoot, ".kimi", "skills", "omk-kimi-runtime", "SKILL.md"), "utf-8");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init interactive setup asks for GitHub star and saves DeepSeek key to user-local secrets only", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-interactive-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-interactive-home-"));
  const fakeKey = `deepseek-test-${"x".repeat(24)}`;
  const starredRepos = [];
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
