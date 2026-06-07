import test from "node:test";
import assert from "node:assert/strict";

// Imported directly from source: provider-health.ts only uses type imports,
// so Node's native type-stripping loads it with no runtime dependencies.
import { toProviderHealth } from "../dist/providers/provider-health.js";

const FAILURE_KINDS = new Set([
  "none",
  "runtime",
  "auth",
  "model",
  "quota",
  "policy",
  "transient",
  "unknown",
]);
const AUTHORITY_LEVELS = new Set(["none", "advisory", "direct", "full"]);

// Synthetic token built at runtime; matches SECRET_PATTERNS when assembled but is
// never stored as a literal high-entropy string in source (keeps secret:scan clean).
const PLANTED_TOKEN = ["sk", "L3AKEDSECRET", "1234567890"].join("-");

// Patterns that would indicate a leaked secret value (never an env var NAME).
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{12,}/,
  /Bearer\s+[A-Za-z0-9._-]{12,}/i,
  /[A-Za-z0-9_-]{40,}/, // long opaque token
];

function assertHealthShape(health) {
  // All required ProviderHealth fields present with correct primitive types.
  assert.equal(typeof health.provider, "string");
  assert.ok(health.provider.length > 0, "provider must be non-empty");
  assert.equal(typeof health.checkedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(health.checkedAt)), "checkedAt must be ISO parseable");
  assert.equal(typeof health.runtimeOk, "boolean");
  assert.equal(typeof health.authOk, "boolean");
  assert.equal(typeof health.modelOk, "boolean");
  assert.equal(typeof health.quotaOk, "boolean");
  assert.ok(AUTHORITY_LEVELS.has(health.writeAuthority), "writeAuthority enum");
  assert.ok(AUTHORITY_LEVELS.has(health.shellAuthority), "shellAuthority enum");
  assert.ok(AUTHORITY_LEVELS.has(health.mcpAuthority), "mcpAuthority enum");
  assert.ok(FAILURE_KINDS.has(health.failureKind), "failureKind enum");
  assert.ok(Array.isArray(health.remediation), "remediation is array");
  for (const hint of health.remediation) {
    assert.equal(typeof hint, "string");
  }
  // Exactly the contract keys, nothing extra.
  assert.deepEqual(
    Object.keys(health).sort(),
    [
      "authOk",
      "checkedAt",
      "failureKind",
      "mcpAuthority",
      "modelOk",
      "provider",
      "quotaOk",
      "remediation",
      "runtimeOk",
      "shellAuthority",
      "writeAuthority",
    ],
  );
}

function assertNoSecrets(health) {
  const serialized = JSON.stringify(health);
  for (const pattern of SECRET_PATTERNS) {
    assert.ok(!pattern.test(serialized), `health must not surface secret-like string: ${pattern}`);
  }
}

test("native-ok (kimi) maps to a fully healthy ProviderHealth", () => {
  const kimi = {
    provider: "kimi",
    enabled: true,
    available: true,
    kind: "openai-compatible",
    model: "kimi-k2.6",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "KIMI_API_KEY",
    apiKeySet: true,
    capabilities: ["read", "review", "qa", "research", "advisory"],
    authority: "authority",
    fallbackProvider: "kimi",
    reason: "Provider configured",
  };
  const health = toProviderHealth(kimi);
  assertHealthShape(health);
  assertNoSecrets(health);
  assert.equal(health.runtimeOk, true);
  assert.equal(health.authOk, true);
  assert.equal(health.modelOk, true);
  assert.equal(health.quotaOk, true);
  assert.equal(health.failureKind, "none");
  assert.equal(health.writeAuthority, "full");
  assert.equal(health.shellAuthority, "none"); // openai-compatible is not a shell kind
  assert.equal(health.remediation.length, 0);
});

test("missing-api-key maps to auth failure without leaking secrets", () => {
  const noKey = {
    provider: "kimi",
    enabled: true,
    available: false,
    kind: "openai-compatible",
    model: "kimi-k2.6",
    apiKeyEnv: "KIMI_API_KEY",
    apiKeySet: false,
    capabilities: ["read", "review", "qa", "research", "advisory"],
    authority: "authority",
    fallbackProvider: "kimi",
    // Planted secret-looking token in the reason must NOT be echoed back.
    // Constructed at runtime so the source file never commits a literal secret pattern.
    reason: `Missing KIMI_API_KEY environment variable ${PLANTED_TOKEN}; fallback active`,
  };
  const health = toProviderHealth(noKey);
  assertHealthShape(health);
  assertNoSecrets(health);
  assert.equal(health.authOk, false);
  assert.equal(health.failureKind, "auth");
  assert.ok(health.remediation.length > 0);
  // Remediation references the env var NAME, never the value.
  assert.ok(health.remediation.some((hint) => hint.includes("KIMI_API_KEY")));
  assert.ok(!health.remediation.join(" ").includes(PLANTED_TOKEN));
});

test("codex CLI missing maps to runtime failure with shell authority", () => {
  const codex = {
    provider: "codex",
    enabled: true,
    available: false,
    kind: "codex-cli",
    model: "codex-cli",
    capabilities: ["read", "plan", "review", "advisory"],
    codexCliAvailable: false,
    authority: "advisory",
    fallbackProvider: "kimi",
    reason: "Codex CLI missing/disabled or authentication not verified; configured authority fallback is active",
  };
  const health = toProviderHealth(codex);
  assertHealthShape(health);
  assertNoSecrets(health);
  assert.equal(health.runtimeOk, false);
  assert.equal(health.authOk, true); // external-cli auth handled outside OMK
  assert.equal(health.failureKind, "runtime");
  assert.equal(health.shellAuthority, "advisory"); // codex-cli is a shell kind
  assert.ok(health.remediation.length > 0);
});

test("deepseek insufficient balance maps to quota failure", () => {
  const lowBalance = {
    provider: "deepseek",
    available: false,
    enabled: true,
    apiKeySet: true,
    checkedAt: Date.now(),
    reason: "DeepSeek 402 insufficient balance",
    disableForRun: true,
  };
  const health = toProviderHealth(lowBalance);
  assertHealthShape(health);
  assertNoSecrets(health);
  assert.equal(health.quotaOk, false);
  assert.equal(health.failureKind, "quota");
  assert.equal(health.writeAuthority, "advisory");
  assert.equal(health.shellAuthority, "none");
  assert.ok(health.remediation.length > 0);
});

test("deepseek balance unavailable flag maps to quota failure", () => {
  const noBalance = {
    provider: "deepseek",
    available: false,
    enabled: true,
    apiKeySet: true,
    checkedAt: Date.now(),
    reason: "DeepSeek balance is unavailable for API calls",
    balance: { is_available: false, balance_infos: [] },
    disableForRun: true,
  };
  const health = toProviderHealth(noBalance);
  assertHealthShape(health);
  assertNoSecrets(health);
  assert.equal(health.quotaOk, false);
  assert.equal(health.failureKind, "quota");
});

test("deepseek healthy balance maps to a healthy ProviderHealth", () => {
  const ok = {
    provider: "deepseek",
    available: true,
    enabled: true,
    apiKeySet: true,
    checkedAt: Date.now(),
    balance: { is_available: true, balance_infos: [{ currency: "USD", total_balance: "12.00" }] },
    disableForRun: false,
  };
  const health = toProviderHealth(ok);
  assertHealthShape(health);
  assertNoSecrets(health);
  assert.equal(health.runtimeOk, true);
  assert.equal(health.authOk, true);
  assert.equal(health.quotaOk, true);
  assert.equal(health.modelOk, true);
  assert.equal(health.failureKind, "none");
  assert.equal(health.remediation.length, 0);
});
