import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { test } from "node:test";

const { resolveRuntimeBootstrap } = await import("../dist/runtime/runtime-bootstrap.js");

async function fakeExecutable(name) {
  const dir = await mkdtemp(join(tmpdir(), "omk-runtime-bootstrap-"));
  const bin = join(dir, name);
  await writeFile(bin, "#!/usr/bin/env sh\nexit 0\n");
  await chmod(bin, 0o755);
  return bin;
}

test("resolveRuntimeBootstrap honors explicit opencode binary env", async () => {
  const opencodeBin = await fakeExecutable("opencode");
  const bootstrap = await resolveRuntimeBootstrap({
    provider: "opencode",
    env: { OPENCODE_BIN: opencodeBin },
  });

  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.selectedProvider, "opencode");
  assert.equal(bootstrap.sessionMode, "one-shot-cli");
});

test("resolveRuntimeBootstrap does not accept missing commandcode env binary", async () => {
  const bootstrap = await resolveRuntimeBootstrap({
    provider: "commandcode",
    env: { COMMANDCODE_BIN: "/definitely/missing/commandcode" },
  });

  assert.equal(bootstrap.ok, false);
  assert.equal(bootstrap.selectedProvider, "commandcode");
  assert.match(bootstrap.reason ?? "", /CLI not found/);
});

test("resolveRuntimeBootstrap resolves authority provider policy to concrete provider", async () => {
  const codexBin = await fakeExecutable("codex");
  const bootstrap = await resolveRuntimeBootstrap({
    provider: "authority",
    env: {
      OMK_AUTHORITY_PROVIDER: "codex",
      CODEX_BIN: codexBin,
    },
  });

  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.providerPolicy, "authority");
  assert.equal(bootstrap.selectedProvider, "codex");
  assert.equal(bootstrap.selectedRuntimeId, codexBin);
});

test("resolveRuntimeBootstrap auto mode prefers configured API providers before legacy Kimi CLI", async () => {
  const kimiBin = await fakeExecutable("kimi");
  const bootstrap = await resolveRuntimeBootstrap({
    provider: "auto",
    env: {
      KIMI_BIN: kimiBin,
      DEEPSEEK_API_KEY: "test-key",
    },
  });

  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.providerPolicy, "auto");
  assert.equal(bootstrap.selectedProvider, "deepseek");
  assert.equal(bootstrap.selectedRuntimeId, "deepseek-api");
});

test("resolveRuntimeBootstrap treats explicit Kimi as direct API, not CLI", async () => {
  const kimiBin = await fakeExecutable("kimi");
  const bootstrap = await resolveRuntimeBootstrap({
    provider: "kimi",
    env: {
      KIMI_BIN: kimiBin,
      KIMI_API_KEY: "test-key",
    },
  });

  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.selectedProvider, "kimi");
  assert.equal(bootstrap.selectedRuntimeId, "KIMI_API_KEY");
  assert.equal(bootstrap.sessionMode, "api-turn");
});

test("resolveRuntimeBootstrap auto mode ignores Kimi CLI without API credentials", async () => {
  const kimiBin = await fakeExecutable("kimi");
  const home = await mkdtemp(join(tmpdir(), "omk-runtime-bootstrap-home-"));
  try {
    const bootstrap = await resolveRuntimeBootstrap({
      provider: "auto",
      env: {
        HOME: home,
        PATH: "",
        KIMI_BIN: kimiBin,
        CODEX_BIN: join(home, "missing-codex"),
        COMMANDCODE_BIN: join(home, "missing-commandcode"),
        OPENCODE_BIN: join(home, "missing-opencode"),
      },
    });

    assert.equal(bootstrap.ok, false);
    assert.equal(bootstrap.selectedRuntimeId, "auto");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
