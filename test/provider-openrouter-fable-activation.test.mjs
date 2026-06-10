import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseProviderModelArg,
  normalizeModelAlias,
  normalizeProviderId,
  readProviderRegistry,
  providerDoctorStatus,
  setProviderConfig,
} from "../dist/providers/model-registry.js";

// 1. `fable` must resolve to openrouter / anthropic/claude-fable-5 from every alias form.
test("fable aliases resolve to openrouter / anthropic/claude-fable-5", () => {
  for (const alias of ["fable", "fable-5", "claude-fable-5", "anthropic/claude-fable-5"]) {
    assert.equal(normalizeModelAlias(alias), "anthropic/claude-fable-5", `normalizeModelAlias(${alias})`);
  }
  const parsed = parseProviderModelArg("fable");
  assert.equal(parsed.provider, "openrouter");
  assert.equal(parsed.model, "anthropic/claude-fable-5");

  // Provider-qualified form also routes to openrouter.
  assert.equal(normalizeProviderId("anthropic"), "openrouter");
  const qualified = parseProviderModelArg("anthropic/claude-fable-5");
  assert.equal(qualified.provider, "openrouter");
  assert.equal(qualified.model, "anthropic/claude-fable-5");
});

// 2. The openrouter registry entry exposes the fable aliases + OpenRouter wiring.
test("openrouter registry entry carries fable aliases and OpenRouter endpoint", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-fable-registry-"));
  try {
    const registry = await readProviderRegistry({ homeDir });
    const openrouter = registry.find((entry) => entry.id === "openrouter");
    assert.ok(openrouter, "openrouter entry present");
    assert.equal(openrouter.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(openrouter.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(openrouter.aliases.fable, "anthropic/claude-fable-5");
    assert.equal(openrouter.aliases["claude-fable-5"], "anthropic/claude-fable-5");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

// 3. Contract: key presence alone is NOT enough; explicit enable is required.
test("openrouter stays unavailable with a key but no explicit enable (two-factor contract)", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-fable-contract-"));
  try {
    const status = await providerDoctorStatus("openrouter", {
      homeDir,
      env: { OPENROUTER_API_KEY: "sk-test" },
    });
    assert.equal(status.enabled, false);
    assert.equal(status.available, false);
    assert.equal(status.apiKeyEnv, "OPENROUTER_API_KEY");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

// 4. Once explicitly enabled AND a key is present, fable's provider is available
//    as an advisory provider (authority stays on the configured authority provider).
test("openrouter becomes available (advisory) once enabled with OPENROUTER_API_KEY", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-fable-enabled-"));
  try {
    const stored = await setProviderConfig("openrouter", {}, { homeDir });
    assert.equal(stored.enabled, true);

    const withoutKey = await providerDoctorStatus("openrouter", { homeDir, env: { OPENROUTER_API_KEY: "" } });
    assert.equal(withoutKey.available, false);

    const withKey = await providerDoctorStatus("openrouter", {
      homeDir,
      env: { OPENROUTER_API_KEY: "sk-test" },
    });
    assert.equal(withKey.enabled, true);
    assert.equal(withKey.apiKeySet, true);
    assert.equal(withKey.available, true);
    assert.equal(withKey.authority, "advisory");
    assert.equal(withKey.reason, "Provider configured");
    // Secret value must never be serialized into status.
    assert.equal(JSON.stringify(withKey).includes("sk-test"), false);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
