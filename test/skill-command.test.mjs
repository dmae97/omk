import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSkillCatalog, skillCatalogCommand, skillInstallCommand, skillPackCommand, skillSyncCommand } from "../dist/commands/skill.js";

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

test("skill pack lists Open Design and awesome-design-md in OMK core", async () => {
  const output = await captureConsoleLog(async () => {
    await skillPackCommand();
  });

  assert.match(output, /Skills:\s*open-design, awesome-design-md, omk-global-rules/);
});

test("skill catalog exposes OMX-style status metadata", async () => {
  await withTempProject(async (projectRoot) => {
    const catalog = await getSkillCatalog(projectRoot);
    const core = catalog.packs.find((pack) => pack.id === "omk-core");
    const awesomeDesign = catalog.skills.find((skill) => skill.name === "awesome-design-md");

    assert.equal(core?.lifecycle, "active");
    assert.equal(core?.installed, false);
    assert.equal(awesomeDesign?.lifecycle, "active");
    assert.equal(awesomeDesign?.slashCommand, true);
    assert.equal(awesomeDesign?.templateAvailable, true);
    assert.ok(awesomeDesign?.packs.includes("omk-core"));
  });
});

test("skill catalog --json emits common machine-readable fields", async () => {
  await withTempProject(async () => {
    const output = await captureConsoleLog(async () => {
      await skillCatalogCommand({ json: true });
    });
    const parsed = JSON.parse(output);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "skill catalog");
    assert.match(parsed.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Array.isArray(parsed.data.packs));
    assert.ok(Array.isArray(parsed.data.skills));
    assert.deepEqual(parsed.errors, []);
  });
});

test("skill install generates slash commands from packaged templates outside the repo root", async () => {
  await withTempProject(async (projectRoot) => {
    await skillInstallCommand("omk-core");

    const openDesign = await readFile(join(projectRoot, ".kimi", "skills", "open-design", "SKILL.md"), "utf-8");
    const awesomeDesignMd = await readFile(join(projectRoot, ".kimi", "skills", "awesome-design-md", "SKILL.md"), "utf-8");
    const graphView = await readFile(join(projectRoot, ".kimi", "skills", "graph-view", "SKILL.md"), "utf-8");
    const deepseekApi = await readFile(join(projectRoot, ".kimi", "skills", "deepseek-api", "SKILL.md"), "utf-8");
    const deepseekEnable = await readFile(join(projectRoot, ".kimi", "skills", "deepseek-enable", "SKILL.md"), "utf-8");
    const installed = JSON.parse(await readFile(join(projectRoot, ".omk", "installed-skill-packs.json"), "utf-8"));

    assert.match(openDesign, /^# \/open-design/m);
    assert.match(openDesign, /omk design open-design --open/);
    assert.match(awesomeDesignMd, /^# \/awesome-design-md/m);
    assert.match(awesomeDesignMd, /omk design search <keyword>/);
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
