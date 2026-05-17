import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  forceDisableDeepSeek,
  getDeepSeekProviderConfigPath,
  getDeepSeekProviderStatus,
  getOmkSecretsEnvPath,
  resolveDeepSeekApiKey,
  setDeepSeekApiKey,
  setDeepSeekEnabled,
} from "../dist/providers/index.js";

const CLI = join(process.cwd(), "dist", "cli.js");

test("DeepSeek config stores API key in user-local secrets and resolves it without repo files", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-deepseek-home-"));
  const fakeKey = `sk-${"a".repeat(32)}`;

  try {
    const saved = await setDeepSeekApiKey(fakeKey, { homeDir: homeRoot, env: {} });
    assert.equal(saved.apiKeyEnv, "DEEPSEEK_API_KEY");
    assert.match(saved.secretsPath, /secrets\.env$/);

    const secretRaw = await readFile(saved.secretsPath, "utf-8");
    assert.match(secretRaw, /DEEPSEEK_API_KEY=/);
    assert.match(secretRaw, /sk-/);

    const resolved = await resolveDeepSeekApiKey({ homeDir: homeRoot, env: {} });
    assert.equal(resolved.apiKey, fakeKey);
    assert.equal(resolved.source, "omk-secrets");

    const status = await getDeepSeekProviderStatus({ homeDir: homeRoot, env: {} });
    assert.equal(status.enabled, true);
    assert.equal(status.apiKeySet, true);
    assert.equal(status.apiKeySource, "omk-secrets");
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("DeepSeek enable and forced disable persist without storing the key in provider config", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-deepseek-state-"));

  try {
    await setDeepSeekEnabled(true, { homeDir: homeRoot, env: {} });
    let status = await getDeepSeekProviderStatus({ homeDir: homeRoot, env: {} });
    assert.equal(status.enabled, true);

    await forceDisableDeepSeek("DeepSeek 402 insufficient balance", { homeDir: homeRoot, env: {} });
    status = await getDeepSeekProviderStatus({ homeDir: homeRoot, env: {} });
    assert.equal(status.enabled, false);
    assert.equal(status.disabledBy, "provider-402");
    assert.match(status.disabledReason ?? "", /402/);

    const configRaw = await readFile(status.configPath, "utf-8");
    assert.doesNotMatch(configRaw, /sk-/);
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("setting a DeepSeek API key always re-enables hybrid routing after disable", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-deepseek-reenable-"));
  const fakeKey = `sk-${"b".repeat(32)}`;

  try {
    await forceDisableDeepSeek("user disabled before adding a new key", { homeDir: homeRoot, env: {} });
    let status = await getDeepSeekProviderStatus({ homeDir: homeRoot, env: {} });
    assert.equal(status.enabled, false);

    await setDeepSeekApiKey(fakeKey, { homeDir: homeRoot, env: {} });
    status = await getDeepSeekProviderStatus({ homeDir: homeRoot, env: {} });

    assert.equal(status.enabled, true);
    assert.equal(status.disabledBy, undefined);
    assert.equal(status.disabledReason, undefined);
    assert.equal(status.apiKeySet, true);
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("DeepSeek config resolves through OMK_ORIGINAL_HOME when HOME is isolated", () => {
  const env = {
    HOME: "/tmp/omk-home-demo",
    OMK_ORIGINAL_HOME: "/terminal/home",
  };

  assert.equal(getOmkSecretsEnvPath({ env }), "/terminal/home/.config/omk/secrets.env");
  assert.equal(getDeepSeekProviderConfigPath({ env }), "/terminal/home/.config/omk/providers.json");
});

test("official deepseek api command accepts stdin without echoing the key", async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-deepseek-cli-"));
  const fakeKey = `sk-${"c".repeat(32)}`;

  try {
    const result = spawnSync(process.execPath, [CLI, "deepseek", "api", "--json"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      input: fakeKey,
      env: {
        ...process.env,
        HOME: homeRoot,
        OMK_ORIGINAL_HOME: homeRoot,
        OMK_STAR_PROMPT: "0",
        OMK_RENDER_LOGO: "0",
        DEEPSEEK_API_KEY: "",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(fakeKey));
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.provider, "deepseek");
    assert.equal(payload.enabled, true);
    assert.equal(payload.apiKeySet, true);
    assert.equal(payload.source, "stdin");

    const resolved = await resolveDeepSeekApiKey({ homeDir: homeRoot, env: {} });
    assert.equal(resolved.apiKey, fakeKey);

    const status = await getDeepSeekProviderStatus({ homeDir: homeRoot, env: {} });
    assert.equal(status.enabled, true);
    assert.equal(status.apiKeySet, true);
  } finally {
    await rm(homeRoot, { recursive: true, force: true });
  }
});
