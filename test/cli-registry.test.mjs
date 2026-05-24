import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { createOmkProgram } from "../dist/cli/main.js";

const CLI = join(process.cwd(), "dist", "cli.js");
const CLI_ENV = {
  ...process.env,
  OMK_STAR_PROMPT: "0",
  OMK_RENDER_LOGO: "0",
};

function commandNames(command) {
  return command.commands.map((subcommand) => subcommand.name());
}

function optionFlags(command) {
  return command.options.map((option) => option.flags);
}

function findCommand(command, name) {
  const found = command.commands.find((subcommand) => subcommand.name() === name);
  assert.ok(found, `missing command: ${name}`);
  return found;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: CLI_ENV,
  });
}

test("sliced CLI registry preserves ordered top-level commands", () => {
  const program = createOmkProgram();

  assert.deepEqual(commandNames(program), [
    "star",
    "menu",
    "mode",
    "update",
    "init",
    "doctor",
    "runs",
    "history",
    "chat",
    "research",
    "replay",
    "inspect",
    "web-bridge",
    "index",
    "index-show",
    "skill",
    "summary",
    "summary-show",
    "diff-runs",
    "open-design",
    "open-design-agent",
    "cockpit",
    "rail",
    "plan",
    "feature",
    "bugfix",
    "refactor",
    "review",
    "run",
    "team",
    "parallel",
    "orchestrate",
    "provider",
    "deepseek",
    "deepseekset",
    "codex",
    "openai",
    "image",
    "graph",
    "hud",
    "merge",
    "sync",
    "lsp",
    "design",
    "google",
    "snip",
    "specify",
    "spec",
    "agent",
    "verify",
    "goal",
    "servarr",
    "appshot",
    "browser",
    "notice",
    "mcp",
    "dag",
    "cron",
    "screenshot",
  ]);
});

test("sliced CLI registry preserves ordered nested command groups", () => {
  const program = createOmkProgram();

  assert.deepEqual(commandNames(findCommand(program, "skill")), ["pack", "catalog", "install", "sync"]);
  const provider = findCommand(program, "provider");
  assert.deepEqual(commandNames(provider), ["list", "doctor", "oauth", "auth", "profiles", "set", "enable", "disable", "deepseek"]);
  assert.deepEqual(commandNames(findCommand(provider, "deepseek")), ["enable", "disable", "set"]);
  const deepseek = findCommand(program, "deepseek");
  assert.deepEqual(commandNames(deepseek), ["api", "enable", "disable", "doctor"]);
  assert.deepEqual(commandNames(findCommand(program, "codex")), ["auth"]);
  assert.deepEqual(commandNames(findCommand(program, "openai")), ["setup"]);
  assert.deepEqual(commandNames(findCommand(program, "image")), ["generate", "edit"]);
  assert.deepEqual(commandNames(findCommand(program, "design")), ["init", "list", "apply", "search", "open-design", "lint", "diff", "export"]);
  assert.deepEqual(commandNames(findCommand(program, "goal")), ["create", "list", "show", "plan", "run", "verify", "close", "block", "continue", "auto", "watch", "wake", "sleep", "daemon"]);
  assert.deepEqual(commandNames(findCommand(program, "servarr")), [
    "config-path",
    "instances",
    "status",
    "health",
    "logs",
    "tasks",
    "list",
    "search",
  ]);
  assert.deepEqual(commandNames(findCommand(program, "mcp")), [
    "list",
    "doctor",
    "test",
    "prewarm",
    "check",
    "serve",
    "remove",
    "add",
    "install",
    "import-codex",
    "sync-global",
    "migrate",
  ]);
  assert.deepEqual(commandNames(findCommand(program, "web-bridge")), ["doctor", "status", "install-host", "native-host"]);
  assert.deepEqual(commandNames(findCommand(program, "dag")), ["from-spec", "validate", "show", "replay"]);
  assert.deepEqual(commandNames(findCommand(program, "screenshot")), ["paste", "dir", "list", "clean"]);
});

test("sliced CLI registry exposes doctor fix options", () => {
  const program = createOmkProgram();

  const doctorFlags = optionFlags(findCommand(program, "doctor"));
  assert.ok(doctorFlags.includes("--fix"));
  assert.ok(doctorFlags.includes("--fix-level <level>"));
  assert.ok(doctorFlags.includes("--verify-fix"));
  assert.ok(doctorFlags.includes("--no-verify-fix"));
  const mcpDoctorFlags = optionFlags(findCommand(findCommand(program, "mcp"), "doctor"));
  assert.ok(mcpDoctorFlags.includes("--fix"));
  assert.ok(mcpDoctorFlags.includes("--dry-run"));
  assert.ok(mcpDoctorFlags.includes("--global"));
});

test("sliced CLI registry preserves public aliases", () => {
  const program = createOmkProgram();
  const design = findCommand(program, "design");
  const deepseek = findCommand(program, "deepseek");

  assert.deepEqual(findCommand(program, "open-design").aliases(), ["opendesign"]);
  assert.deepEqual(findCommand(design, "open-design").aliases(), ["od"]);
  assert.deepEqual(findCommand(findCommand(program, "provider"), "oauth").aliases(), ["login"]);
  assert.deepEqual(findCommand(deepseek, "api").aliases(), ["set"]);
  assert.deepEqual(findCommand(deepseek, "doctor").aliases(), ["status"]);
});

test("sliced CLI shim keeps open-design-agent smoke path cheap and exact", () => {
  for (const args of [
    ["open-design-agent", "--smoke"],
    ["--run-id", "smoke-fast-path", "open-design-agent", "--smoke"],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "ok\n");
    assert.equal(result.stderr, "");
  }
});

test("sliced CLI registry keeps representative JSON command stdout-pure", () => {
  const result = runCli(["skill", "catalog", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "skill catalog");
});
