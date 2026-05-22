import test from "node:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  getProjectRoot,
  resolveProjectRoot,
  resolveProjectRootAsync,
} from "../dist/util/fs.js";
import { getProjectRoot as getResourceProjectRoot } from "../dist/util/resource-profile.js";

function gitInit(dir) {
  const result = spawnSync("git", ["init"], { cwd: dir, encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function restoreEnv(name, previous) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

test("OMK_PROJECT_ROOT overrides HOME git repo and OMK_DEFAULT_PROJECT_ROOT", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-root-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-root-project-"));
  const defaultRoot = await mkdtemp(join(tmpdir(), "omk-root-default-"));
  const previousCwd = process.cwd();
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  const previousDefaultRoot = process.env.OMK_DEFAULT_PROJECT_ROOT;
  const previousHome = process.env.HOME;
  const previousOriginalHome = process.env.OMK_ORIGINAL_HOME;

  try {
    gitInit(homeRoot);
    process.chdir(homeRoot);
    process.env.HOME = homeRoot;
    process.env.OMK_ORIGINAL_HOME = homeRoot;
    process.env.OMK_PROJECT_ROOT = projectRoot;
    process.env.OMK_DEFAULT_PROJECT_ROOT = defaultRoot;

    assert.equal(canonical(getProjectRoot()), canonical(projectRoot));
    assert.equal(canonical(getResourceProjectRoot()), canonical(projectRoot));
  } finally {
    process.chdir(previousCwd);
    restoreEnv("OMK_PROJECT_ROOT", previousProjectRoot);
    restoreEnv("OMK_DEFAULT_PROJECT_ROOT", previousDefaultRoot);
    restoreEnv("HOME", previousHome);
    restoreEnv("OMK_ORIGINAL_HOME", previousOriginalHome);
    await rm(homeRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
    await rm(defaultRoot, { recursive: true, force: true });
  }
});

test("OMK_DEFAULT_PROJECT_ROOT applies when cwd is HOME git repo", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-root-home-git-"));
  const projectRoot = join(homeRoot, "work", "app");

  try {
    gitInit(homeRoot);
    await mkdir(projectRoot, { recursive: true });
    const env = {
      HOME: homeRoot,
      OMK_ORIGINAL_HOME: homeRoot,
      OMK_DEFAULT_PROJECT_ROOT: projectRoot,
    };

    const resolution = resolveProjectRoot({ cwd: homeRoot, home: homeRoot, env });
    assert.equal(canonical(resolution.root), canonical(projectRoot));
    assert.equal(resolution.source, "default-env");
    assert.equal(resolution.homeIsGitRepo, true);
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("user config default_project_root applies for HOME git repo", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-root-config-home-"));
  const projectRoot = join(homeRoot, "projects", "omk-app");

  try {
    gitInit(homeRoot);
    await mkdir(projectRoot, { recursive: true });
    await mkdir(join(homeRoot, ".omk"), { recursive: true });
    await writeFile(join(homeRoot, ".omk", "config.toml"), `default_project_root = "${projectRoot}"\n`, "utf-8");

    const resolution = resolveProjectRoot({
      cwd: homeRoot,
      home: homeRoot,
      env: { HOME: homeRoot, OMK_ORIGINAL_HOME: homeRoot },
    });
    assert.equal(canonical(resolution.root), canonical(projectRoot));
    assert.equal(resolution.source, "default-config");
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("normal non-HOME git repo remains the project root", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-root-normal-home-"));
  const repoRoot = await mkdtemp(join(tmpdir(), "omk-root-normal-repo-"));
  const nested = join(repoRoot, "packages", "cli");

  try {
    gitInit(repoRoot);
    await mkdir(nested, { recursive: true });
    const resolution = await resolveProjectRootAsync({
      cwd: nested,
      home: homeRoot,
      env: { HOME: homeRoot, OMK_ORIGINAL_HOME: homeRoot },
    });
    assert.equal(canonical(resolution.root), canonical(repoRoot));
    assert.equal(resolution.source, "git");
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("strong OMK markers under HOME beat HOME git root", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-root-marker-home-"));
  const projectRoot = join(homeRoot, "src", "app");
  const nested = join(projectRoot, "nested");

  try {
    gitInit(homeRoot);
    await mkdir(join(projectRoot, ".omk", "agents"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(projectRoot, ".omk", "agents", "root.yaml"), "agent: {}\n", "utf-8");

    const resolution = resolveProjectRoot({
      cwd: nested,
      home: homeRoot,
      env: { HOME: homeRoot, OMK_ORIGINAL_HOME: homeRoot },
    });
    assert.equal(canonical(resolution.root), canonical(projectRoot));
    assert.equal(resolution.source, "strong-marker");
    assert.equal(resolution.marker, ".omk/agents/root.yaml");
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});
