import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProfileArgs } from "../dist/util/runtime-profile.js";
import { getOmkResourceSettings, resetOmkResourceSettingsCache } from "../dist/util/resource-profile.js";

test("buildProfileArgs injects supported flags only", () => {
  const profile = {
    model: "kimi-k2-6",
    thinking: true,
    temperature: 0.15,
    topP: 0.85,
    variant: "coding",
  };
  const caps = { model: true, thinking: true, temperature: true, topP: true, variant: true };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, [
    "--model", "kimi-k2-6",
    "--thinking",
    "--temperature", "0.15",
    "--top-p", "0.85",
    "--variant", "coding",
  ]);
});

test("buildProfileArgs omits unsupported flags (soft fallback)", () => {
  const profile = {
    model: "kimi-k2-6",
    thinking: true,
    temperature: 0.15,
    topP: 0.85,
    variant: "coding",
  };
  const caps = { model: true, thinking: true, temperature: false, topP: false, variant: false };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, ["--model", "kimi-k2-6", "--thinking"]);
});

test("buildProfileArgs handles no-thinking", () => {
  const profile = { thinking: false };
  const caps = { model: true, thinking: true, temperature: false, topP: false, variant: false };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, ["--no-thinking"]);
});

test("buildProfileArgs returns empty when nothing is supported", () => {
  const profile = { temperature: 0.5, topP: 0.9 };
  const caps = { model: false, thinking: false, temperature: false, topP: false, variant: false };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, []);
});

test("buildProfileArgs skips undefined fields", () => {
  const profile = { model: undefined, thinking: undefined };
  const caps = { model: true, thinking: true, temperature: true, topP: true, variant: true };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, []);
});

test("resource settings default MCP and skills scopes to project", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-resource-scope-"));
  const previous = {
    OMK_PROJECT_ROOT: process.env.OMK_PROJECT_ROOT,
    OMK_MCP_SCOPE: process.env.OMK_MCP_SCOPE,
    OMK_SKILLS_SCOPE: process.env.OMK_SKILLS_SCOPE,
    OMK_HOOKS_SCOPE: process.env.OMK_HOOKS_SCOPE,
  };

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "config.toml"), "[runtime]\nresource_profile = \"standard\"\n", "utf-8");
    process.env.OMK_PROJECT_ROOT = projectRoot;
    delete process.env.OMK_MCP_SCOPE;
    delete process.env.OMK_SKILLS_SCOPE;
    delete process.env.OMK_HOOKS_SCOPE;
    resetOmkResourceSettingsCache();

    const settings = await getOmkResourceSettings();
    assert.equal(settings.mcpScope, "project");
    assert.equal(settings.skillsScope, "project");
    assert.equal(settings.hooksScope, "project");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetOmkResourceSettingsCache();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resource settings do not inherit hooks scope from skills scope", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-resource-hooks-scope-"));
  const previous = {
    OMK_PROJECT_ROOT: process.env.OMK_PROJECT_ROOT,
    OMK_MCP_SCOPE: process.env.OMK_MCP_SCOPE,
    OMK_SKILLS_SCOPE: process.env.OMK_SKILLS_SCOPE,
    OMK_HOOKS_SCOPE: process.env.OMK_HOOKS_SCOPE,
  };

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "config.toml"), [
      "[runtime]",
      "resource_profile = \"standard\"",
      "skills_scope = \"all\"",
      "",
    ].join("\n"), "utf-8");
    process.env.OMK_PROJECT_ROOT = projectRoot;
    delete process.env.OMK_MCP_SCOPE;
    delete process.env.OMK_SKILLS_SCOPE;
    delete process.env.OMK_HOOKS_SCOPE;
    resetOmkResourceSettingsCache();

    const settings = await getOmkResourceSettings();
    assert.equal(settings.skillsScope, "all");
    assert.equal(settings.hooksScope, "project");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetOmkResourceSettingsCache();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resource settings resolve execution prompt from config and env", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-resource-execution-"));
  const previous = {
    OMK_PROJECT_ROOT: process.env.OMK_PROJECT_ROOT,
    OMK_EXECUTION_PROMPT: process.env.OMK_EXECUTION_PROMPT,
  };

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "config.toml"), [
      "[runtime]",
      "resource_profile = \"standard\"",
      "",
      "[orchestration]",
      "execution_prompt = \"sequential\"",
      "",
    ].join("\n"), "utf-8");
    process.env.OMK_PROJECT_ROOT = projectRoot;
    delete process.env.OMK_EXECUTION_PROMPT;
    resetOmkResourceSettingsCache();
    let settings = await getOmkResourceSettings();
    assert.equal(settings.executionPrompt, "sequential");

    process.env.OMK_EXECUTION_PROMPT = "parallel";
    resetOmkResourceSettingsCache();
    settings = await getOmkResourceSettings();
    assert.equal(settings.executionPrompt, "parallel");

    process.env.OMK_EXECUTION_PROMPT = "sequental";
    resetOmkResourceSettingsCache();
    await assert.rejects(getOmkResourceSettings(), /Invalid OMK_EXECUTION_PROMPT/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetOmkResourceSettingsCache();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
