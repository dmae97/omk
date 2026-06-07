import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSkillCatalog, skillCatalogCommand, skillInstallCommand, skillPackCommand, skillSyncCommand } from "../dist/commands/skill.js";

const TOP_PRIORITY_SKILLS = [
  "omk-context-broker",
  "omk-repo-explorer",
  "omk-industrial-control-loop",
  "omk-plan-first",
  "omk-quality-gate",
  "omk-test-debug-loop",
  "omk-code-review",
  "omk-security-review",
  "omk-secret-guard",
  "omk-typescript-strict",
  "omk-python-typing",
  "omk-worktree-team",
];

const AGENTIC_OPS_SKILLS = [
  "omk-adaptorch-orchestration-review",
  "omk-evidence-contract",
  "omk-control-loop-debugger",
];

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
    const priority = catalog.packs.find((pack) => pack.id === "omk-priority");
    const agenticOps = catalog.packs.find((pack) => pack.id === "omk-agentic-ops");
    const awesomeDesign = catalog.skills.find((skill) => skill.name === "awesome-design-md");
    const provider = catalog.skills.find((skill) => skill.name === "provider");
    const think = catalog.skills.find((skill) => skill.name === "think");

    assert.equal(core?.lifecycle, "active");
    assert.equal(core?.installed, false);
    assert.deepEqual(priority?.skills, TOP_PRIORITY_SKILLS);
    assert.deepEqual(agenticOps?.skills, AGENTIC_OPS_SKILLS);
    for (const skillName of TOP_PRIORITY_SKILLS) {
      const skill = catalog.skills.find((entry) => entry.name === skillName);
      assert.equal(skill?.templateAvailable, true, `${skillName} should have a Kimi skill template`);
      assert.ok(skill?.packs.includes("omk-priority"), `${skillName} should belong to omk-priority`);
    }
    for (const skillName of AGENTIC_OPS_SKILLS) {
      const skill = catalog.skills.find((entry) => entry.name === skillName);
      assert.equal(skill?.templateAvailable, true, `${skillName} should have a Kimi skill template`);
      assert.ok(skill?.packs.includes("omk-agentic-ops"), `${skillName} should belong to omk-agentic-ops`);
    }
    assert.equal(awesomeDesign?.lifecycle, "active");
    assert.equal(awesomeDesign?.slashCommand, true);
    assert.equal(awesomeDesign?.templateAvailable, true);
    assert.ok(awesomeDesign?.packs.includes("omk-core"));
    assert.equal(provider?.slashCommand, true);
    assert.equal(provider?.templateAvailable, true);
    assert.ok(provider?.packs.includes("omk-core"));
    assert.equal(think?.slashCommand, true);
    assert.equal(think?.templateAvailable, true);
    assert.ok(think?.packs.includes("omk-core"));
  });
});

test("skill install omk-priority copies the top 12 repeatable workflow skills", async () => {
  await withTempProject(async (projectRoot) => {
    await skillInstallCommand("omk-priority");

    for (const skillName of TOP_PRIORITY_SKILLS) {
      const skill = await readFile(join(projectRoot, ".kimi", "skills", skillName, "SKILL.md"), "utf-8");
      assert.match(skill, new RegExp(`^name:\\s*${skillName}$`, "m"));
    }
    const installed = JSON.parse(await readFile(join(projectRoot, ".omk", "installed-skill-packs.json"), "utf-8"));
    assert.deepEqual(installed.packs, ["omk-priority"]);
  });
});

test("skill install omk-agentic-ops copies orchestration evidence and control-loop skills", async () => {
  await withTempProject(async (projectRoot) => {
    await skillInstallCommand("omk-agentic-ops");

    for (const skillName of AGENTIC_OPS_SKILLS) {
      const skill = await readFile(join(projectRoot, ".kimi", "skills", skillName, "SKILL.md"), "utf-8");
      assert.match(skill, new RegExp(`^name:\\s*${skillName}$`, "m"));
    }
    const installed = JSON.parse(await readFile(join(projectRoot, ".omk", "installed-skill-packs.json"), "utf-8"));
    assert.deepEqual(installed.packs, ["omk-agentic-ops"]);
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
    const provider = await readFile(join(projectRoot, ".kimi", "skills", "provider", "SKILL.md"), "utf-8");
    const think = await readFile(join(projectRoot, ".kimi", "skills", "think", "SKILL.md"), "utf-8");
    const deepseekApi = await readFile(join(projectRoot, ".kimi", "skills", "deepseek-api", "SKILL.md"), "utf-8");
    const deepseekEnable = await readFile(join(projectRoot, ".kimi", "skills", "deepseek-enable", "SKILL.md"), "utf-8");
    const installed = JSON.parse(await readFile(join(projectRoot, ".omk", "installed-skill-packs.json"), "utf-8"));

    assert.match(openDesign, /^# \/open-design/m);
    assert.match(openDesign, /omk design open-design --open/);
    assert.match(awesomeDesignMd, /^# \/awesome-design-md/m);
    assert.match(awesomeDesignMd, /omk design search <keyword>/);
    assert.match(graphView, /^# \/graph-view/m);
    assert.match(provider, /^# \/provider/m);
    assert.match(provider, /omk provider oauth <provider>/);
    assert.match(think, /^# \/think/m);
    assert.match(think, /\/think xhigh/);
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
