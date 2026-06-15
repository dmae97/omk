import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveProviderPolicy } from "../dist/runtime/runtime-bootstrap.js";

describe("resolveProviderPolicy", () => {
  it("passes through non-policy providers", async () => {
    const result = await resolveProviderPolicy("deepseek", {});
    assert.equal(result.ok, true);
    assert.equal(result.provider, "deepseek");
  });

  it("resolves authority to OMK_AUTHORITY_PROVIDER", async () => {
    const result = await resolveProviderPolicy("authority", { OMK_AUTHORITY_PROVIDER: "codex" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "codex");
  });

  it("resolves authority to mimo when env key exists", async () => {
    const result = await resolveProviderPolicy("authority", { MIMO_API_KEY: "test" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "mimo");
    assert.equal(result.runtimeId, "mimo-api");
  });

  it("resolves authority to kimi when mimo is absent but kimi key exists", async () => {
    const result = await resolveProviderPolicy("authority", { KIMI_API_KEY: "test" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "kimi");
    assert.equal(result.runtimeId, "kimi-api");
  });

  it("fails authority resolution with remediation when no provider is configured and no CLI binary exists", async () => {
    const result = await resolveProviderPolicy("authority", {
      PATH: "/usr/bin:/bin",
      HOME: process.env.HOME,
      CODEX_BIN: "__nonexistent_codex_for_test__",
      COMMANDCODE_BIN: "__nonexistent_commandcode_for_test__",
      OPENCODE_BIN: "__nonexistent_opencode_for_test__",
    });
    assert.equal(result.ok, false);
    assert.ok(result.reason);
    assert.ok(Array.isArray(result.remediation));
    assert.ok(result.remediation.length > 0);
  });
});
