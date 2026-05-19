import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverRoutingInventory, resetRoutingInventoryCache } from "../dist/orchestration/routing.js";

const IS_WINDOWS = process.platform === "win32";
import { cleanupIsolatedKimiHome, prepareIsolatedKimiHome } from "../dist/kimi/isolated-home.js";
import { getOmkResourceSettings, resetOmkResourceSettingsCache } from "../dist/util/resource-profile.js";

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("isolated Kimi HOME does not bridge shell profiles by default", async () => {
  const originalHome = await mkdtemp(join(tmpdir(), "omk-isolated-original-profile-"));
  let tmpHome;

  try {
    await mkdir(join(originalHome, ".kimi", "credentials"), { recursive: true });
    await writeFile(join(originalHome, ".bashrc"), "export SHOULD_NOT_REACH_KIMI=secret\n");

    tmpHome = await prepareIsolatedKimiHome({
      originalHome,
      inheritLocalAuth: false,
      env: {},
    });

    await assert.rejects(lstat(join(tmpHome, ".bashrc")));
  } finally {
    if (tmpHome) await cleanupIsolatedKimiHome(tmpHome);
    await rm(originalHome, { recursive: true, force: true });
  }
});

test("isolated Kimi HOME bridges shell profiles only with trusted opt-in", async () => {
  const originalHome = await mkdtemp(join(tmpdir(), "omk-isolated-original-profile-optin-"));
  let tmpHome;

  try {
    await mkdir(join(originalHome, ".kimi", "credentials"), { recursive: true });
    await writeFile(join(originalHome, ".zshrc"), "export TRUSTED_PROFILE_VALUE=ok\n");

    tmpHome = await prepareIsolatedKimiHome({
      originalHome,
      inheritLocalAuth: false,
      env: { OMK_ISOLATED_HOME_BRIDGE_SHELL_PROFILES: "1" },
    });

    const bridged = await readFile(join(tmpHome, ".zshrc"), "utf8");
    assert.match(bridged, /OMK isolated HOME shell profile bridge/);
    assert.match(bridged, /\.zshrc/);
  } finally {
    if (tmpHome) await cleanupIsolatedKimiHome(tmpHome);
    await rm(originalHome, { recursive: true, force: true });
  }
});

test("isolated Kimi HOME respects project skills/hooks scope", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-isolated-project-scope-"));
  const originalHome = await mkdtemp(join(tmpdir(), "omk-isolated-original-scope-"));
  let tmpHome;

  try {
    await mkdir(join(originalHome, ".kimi", "credentials"), { recursive: true });
    await mkdir(join(originalHome, ".kimi", "skills", "global-skill"), { recursive: true });
    await mkdir(join(originalHome, ".kimi", "hooks"), { recursive: true });
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(originalHome, ".kimi", "config.toml"), [
      "default_model = \"kimi-k2.6\"",
      "",
      "[[hooks]]",
      "event = \"Stop\"",
      "command = \"/global/hooks/stop.sh\"",
      "",
    ].join("\n"));
    await writeFile(join(projectRoot, ".omk", "kimi.config.toml"), [
      "[[hooks]]",
      "event = \"SubagentStop\"",
      "command = \".omk/hooks/subagent-stop-audit.sh\"",
      "",
    ].join("\n"));

    tmpHome = await prepareIsolatedKimiHome({
      originalHome,
      projectRoot,
      inheritLocalAuth: false,
      skillsScope: "project",
      hooksScope: "project",
    });

    await assert.rejects(lstat(join(tmpHome, ".kimi", "skills")), /ENOENT/);
    await assert.rejects(lstat(join(tmpHome, ".kimi", "hooks")), /ENOENT/);
    if (!IS_WINDOWS) {
      assert.equal((await lstat(join(tmpHome, ".kimi", "credentials"))).isSymbolicLink(), true);
    }

    const config = await readFile(join(tmpHome, ".kimi", "config.toml"), "utf-8");
    assert.match(config, /default_model = "kimi-k2\.6"/);
    assert.match(config, /subagent-stop-audit\.sh/);
    assert.match(config, new RegExp(escapeRegExp(join(projectRoot, ".omk", "hooks", "subagent-stop-audit.sh"))));
    assert.doesNotMatch(config, /command = "\.omk\/hooks\/subagent-stop-audit\.sh"/);
    assert.doesNotMatch(config, /\/global\/hooks\/stop\.sh/);
  } finally {
    if (tmpHome) await cleanupIsolatedKimiHome(tmpHome);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(originalHome, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("isolated Kimi HOME disables skills and hooks when scopes are none", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-isolated-none-scope-project-"));
  const originalHome = await mkdtemp(join(tmpdir(), "omk-isolated-none-scope-home-"));
  let tmpHome;

  try {
    await mkdir(join(originalHome, ".kimi", "skills", "global-skill"), { recursive: true });
    await mkdir(join(originalHome, ".kimi", "hooks"), { recursive: true });
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(originalHome, ".kimi", "config.toml"), [
      "default_model = \"kimi-k2.6\"",
      "",
      "[[hooks]]",
      "event = \"Stop\"",
      "command = \"/global/hooks/stop.sh\"",
      "",
    ].join("\n"));
    await writeFile(join(projectRoot, ".omk", "kimi.config.toml"), [
      "[[hooks]]",
      "event = \"Stop\"",
      "command = \".omk/hooks/stop-verify.sh\"",
      "",
    ].join("\n"));

    tmpHome = await prepareIsolatedKimiHome({
      originalHome,
      projectRoot,
      inheritLocalAuth: false,
      skillsScope: "none",
      hooksScope: "none",
    });

    await assert.rejects(lstat(join(tmpHome, ".kimi", "skills")), /ENOENT/);
    await assert.rejects(lstat(join(tmpHome, ".kimi", "hooks")), /ENOENT/);

    const config = await readFile(join(tmpHome, ".kimi", "config.toml"), "utf-8");
    assert.match(config, /default_model = "kimi-k2\.6"/);
    assert.doesNotMatch(config, /hooks/);
    assert.doesNotMatch(config, /stop-verify|\/global\/hooks\/stop/);
  } finally {
    if (tmpHome) await cleanupIsolatedKimiHome(tmpHome);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(originalHome, { recursive: true, force: true });
  }
});

test("runtime scope aliases local-user/global/personal resolve to all-scope resources", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-runtime-scope-alias-project-"));
  const originalHome = await mkdtemp(join(tmpdir(), "omk-runtime-scope-alias-home-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousHome = process.env.HOME;
  const previousOriginalHome = process.env.OMK_ORIGINAL_HOME;
  const previousMcpScope = process.env.OMK_MCP_SCOPE;
  const previousSkillsScope = process.env.OMK_SKILLS_SCOPE;
  const previousHooksScope = process.env.OMK_HOOKS_SCOPE;

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(originalHome, ".kimi", "skills", "global-skill"), { recursive: true });
    await writeFile(join(originalHome, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: { "global-mcp": { command: "node" } },
    }));
    await writeFile(join(originalHome, ".kimi", "skills", "global-skill", "SKILL.md"), "# global skill\n");
    await writeFile(join(originalHome, ".kimi", "kimi.config.toml"), [
      "[[hooks]]",
      "event = \"Stop\"",
      "command = \"/global/hooks/global-stop.sh\"",
      "",
    ].join("\n"));

    process.env.OMK_PROJECT_ROOT = projectRoot;
    process.env.HOME = originalHome;
    process.env.OMK_ORIGINAL_HOME = originalHome;
    process.env.OMK_MCP_SCOPE = "local-user";
    process.env.OMK_SKILLS_SCOPE = "global";
    process.env.OMK_HOOKS_SCOPE = "personal";
    resetOmkResourceSettingsCache();
    resetRoutingInventoryCache();

    const resources = await getOmkResourceSettings();
    assert.equal(resources.mcpScope, "all");
    assert.equal(resources.skillsScope, "all");
    assert.equal(resources.hooksScope, "all");

    const inventory = discoverRoutingInventory(projectRoot);
    assert.equal(inventory.mcpScope, "all");
    assert.equal(inventory.skillsScope, "all");
    assert.equal(inventory.hooksScope, "all");
    assert.equal(inventory.mcpServers.get("global-mcp"), "global");
    assert.equal(inventory.skills.get("global-skill"), "global");
    assert.equal(inventory.hooks.get("global-stop.sh"), "global");
  } finally {
    resetOmkResourceSettingsCache();
    resetRoutingInventoryCache();
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("HOME", previousHome);
    restoreEnv("OMK_ORIGINAL_HOME", previousOriginalHome);
    restoreEnv("OMK_MCP_SCOPE", previousMcpScope);
    restoreEnv("OMK_SKILLS_SCOPE", previousSkillsScope);
    restoreEnv("OMK_HOOKS_SCOPE", previousHooksScope);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(originalHome, { recursive: true, force: true });
  }
});
