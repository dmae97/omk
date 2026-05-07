import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { skillInstallCommand, skillPackCommand, skillSyncCommand } from "../dist/commands/skill.js";

async function withTempProject(fn) {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-skill-project-"));
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  try {
    await fn(projectRoot);
  } finally {
    if (previousProjectRoot === undefined) {
      delete process.env.OMK_PROJECT_ROOT;
    } else {
      process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    }
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function captureConsoleLog(fn) {
  const previousLog = console.log;
  let output = "";
  console.log = (...args) => {
    output += `${args.join(" ")}\n`;
  };
  try {
    await fn();
    return output;
  } finally {
    console.log = previousLog;
  }
}

test("skill pack lists open-design first in OMK core", async () => {
  const output = await captureConsoleLog(async () => {
    await skillPackCommand();
  });

  assert.match(output, /Skills:\s*open-design, omk-global-rules/);
});

test("skill install generates slash commands from packaged templates outside the repo root", async () => {
  await withTempProject(async (projectRoot) => {
    await skillInstallCommand("omk-core");

    const openDesign = await readFile(join(projectRoot, ".kimi", "skills", "open-design", "SKILL.md"), "utf-8");
    const graphView = await readFile(join(projectRoot, ".kimi", "skills", "graph-view", "SKILL.md"), "utf-8");
    const deepseekApi = await readFile(join(projectRoot, ".kimi", "skills", "deepseek-api", "SKILL.md"), "utf-8");
    const deepseekEnable = await readFile(join(projectRoot, ".kimi", "skills", "deepseek-enable", "SKILL.md"), "utf-8");
    const installed = JSON.parse(await readFile(join(projectRoot, ".omk", "installed-skill-packs.json"), "utf-8"));

    assert.match(openDesign, /^# \/open-design/m);
    assert.match(openDesign, /omk design open-design --open/);
    assert.match(graphView, /^# \/graph-view/m);
    assert.match(deepseekApi, /^# \/deepseek-api/m);
    assert.match(deepseekApi, /omk deepseek api/);
    assert.match(deepseekEnable, /^# \/deepseek-enable/m);
    assert.deepEqual(installed.packs, ["omk-core"]);
  });
});

test("skill sync replaces stale partial slash-command directories", async () => {
  await withTempProject(async (projectRoot) => {
    await skillInstallCommand("omk-core");

    const graphViewDir = join(projectRoot, ".kimi", "skills", "graph-view");
    await writeFile(join(graphViewDir, "SKILL.md"), "---\nname: broken\n---\n# /broken\n", "utf-8");
    await mkdir(join(graphViewDir, "stale"), { recursive: true });
    await writeFile(join(graphViewDir, "stale", "partial.tmp"), "leftover", "utf-8");

    await skillSyncCommand();

    const graphView = await readFile(join(graphViewDir, "SKILL.md"), "utf-8");
    assert.match(graphView, /^name: graph-view$/m);
    assert.match(graphView, /^# \/graph-view$/m);
    assert.equal(existsSync(join(graphViewDir, "stale", "partial.tmp")), false);
  });
});
