import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "cli.js");

function runModelCli(home, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      OMK_ORIGINAL_HOME: home,
      OMK_PROVIDER_CONFIG_PATH: join(home, ".config", "omk", "providers.json"),
      NO_COLOR: "1",
    },
  });
}

test("model alias add and resolve stay user-local and secret-free", () => {
  const home = mkdtempSync(join(tmpdir(), "omk-model-home-"));
  try {
    const add = runModelCli(home, ["model", "alias", "add", "fast", "deepseek/flash", "--json"]);
    assert.equal(add.status, 0, add.stderr);
    const added = JSON.parse(add.stdout);
    assert.equal(added.command, "model alias add");
    assert.equal(added.alias, "fast");
    assert.equal(added.target, "deepseek/deepseek-v4-flash");
    assert.equal(added.secretValuesPrinted, false);

    const resolved = runModelCli(home, ["model", "resolve", "fast", "--json"]);
    assert.equal(resolved.status, 0, resolved.stderr);
    const payload = JSON.parse(resolved.stdout);
    assert.equal(payload.command, "model resolve");
    assert.equal(payload.provider, "deepseek");
    assert.equal(payload.model, "deepseek-v4-flash");
    assert.equal(payload.source, "user-alias");
    assert.equal(payload.tokenFilesRead, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("provider use and model use persist defaults without secret values", () => {
  const home = mkdtempSync(join(tmpdir(), "omk-provider-use-home-"));
  try {
    const providerUse = runModelCli(home, ["provider", "use", "codex", "--model", "codex", "--json"]);
    assert.equal(providerUse.status, 0, providerUse.stderr);
    const providerPayload = JSON.parse(providerUse.stdout);
    assert.equal(providerPayload.command, "provider use");
    assert.equal(providerPayload.defaultProvider, "codex");
    assert.equal(providerPayload.defaultModel, "codex-cli");
    assert.equal(providerPayload.secretValuesPrinted, false);

    const modelUse = runModelCli(home, ["model", "use", "sonnet", "--json"]);
    assert.equal(modelUse.status, 0, modelUse.stderr);
    const modelPayload = JSON.parse(modelUse.stdout);
    assert.equal(modelPayload.command, "model use");
    assert.equal(modelPayload.defaultProvider, "openrouter");
    assert.equal(modelPayload.defaultModel, "claude-sonnet");
    assert.equal(modelPayload.secretValuesPrinted, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("model list renders provider tabs with deepseek max thinking", () => {
  const home = mkdtempSync(join(tmpdir(), "omk-model-list-home-"));
  try {
    const result = runModelCli(home, ["model", "list"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OMK Model Control · provider tabs/);
    assert.match(result.stdout, /\[mimo\]/);
    assert.match(result.stdout, /\[deepseek\]/);
    assert.match(result.stdout, /deepseek-v4-pro:max/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("think command previews model variant without persisting settings", () => {
  const home = mkdtempSync(join(tmpdir(), "omk-think-home-"));
  try {
    const result = runModelCli(home, ["think", "high", "--provider", "codex", "--model", "codex", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "think");
    assert.equal(payload.provider, "codex");
    assert.equal(payload.model, "codex-cli");
    assert.equal(payload.thinking, "high");
    assert.equal(payload.modelVariant, "codex-cli:high");
    assert.equal(payload.persisted, false);
    assert.equal(payload.secretValuesPrinted, false);
    assert.equal(payload.tokenFilesRead, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("think command allows max for duckcoding and fable-5", () => {
  const home = mkdtempSync(join(tmpdir(), "omk-think-max-home-"));
  try {
    const duck = runModelCli(home, ["think", "max", "--provider", "duckcoding", "--model", "duckcoding", "--json"]);
    assert.equal(duck.status, 0, duck.stderr);
    const duckPayload = JSON.parse(duck.stdout);
    assert.equal(duckPayload.provider, "duckcoding");
    assert.equal(duckPayload.model, "duckcoding");
    assert.equal(duckPayload.thinking, "max");
    assert.equal(duckPayload.modelVariant, "duckcoding:max");
    assert.deepEqual(duckPayload.supportedLevels, ["minimal", "low", "medium", "high", "xhigh", "max"]);

    const fable = runModelCli(home, ["think", "max", "--model", "fable-5", "--json"]);
    assert.equal(fable.status, 0, fable.stderr);
    const fablePayload = JSON.parse(fable.stdout);
    assert.equal(fablePayload.provider, "openrouter");
    assert.equal(fablePayload.model, "anthropic/claude-fable-5");
    assert.equal(fablePayload.thinking, "max");
    assert.equal(fablePayload.modelVariant, "anthropic/claude-fable-5:max");
    assert.ok(fablePayload.supportedLevels.includes("max"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("think command exports custom variants as shell env only", () => {
  const home = mkdtempSync(join(tmpdir(), "omk-think-export-home-"));
  try {
    const result = runModelCli(home, ["think", "variant", "code-high", "--model", "codex", "--export"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /export OMK_THINKING='code-high'/);
    assert.match(result.stdout, /export OMK_MODEL_VARIANT='codex-cli:code-high'/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
