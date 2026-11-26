import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModels, getProviders } from "../../packages/ai/src/models.ts";
import { AuthStorage } from "../../packages/coding-agent/src/core/auth-storage.ts";
import { ModelRegistry } from "../../packages/coding-agent/src/core/model-registry.ts";

const builtin = getProviders().flatMap(provider => getModels(provider));
const first = getModels("anthropic")[0].id;
const scenarios = [
 { id: "default", overlay: "{}" },
 { id: "custom-defaults", overlay: { providers: { synthetic: { api: "anthropic-messages", baseUrl: "https://synthetic.invalid/v2/", apiKey: "faux-key", models: [{ id: "one" }, { id: "two", maxTokens: 42, input: ["text", "image"] }] } } } },
 { id: "builtin-inheritance", overlay: { providers: { anthropic: { models: [{ id: "synthetic-new" }] } } } },
 { id: "provider-overrides", overlay: { providers: { anthropic: { baseUrl: "https://synthetic.invalid/route/V12/", compat: { supportsEagerToolInputStreaming: false } } } } },
 { id: "partial-model-override", overlay: { providers: { anthropic: { modelOverrides: { [first]: { name: "Synthetic", cost: { output: 7 }, reasoning: false, thinkingLevelMap: { off: null }, input: ["text"], maxTokens: 32 } } } } } },
 { id: "custom-replaces-builtin", overlay: { providers: { anthropic: { models: [{ id: first, name: "Replacement" }] } } } },
 { id: "duplicate-last-wins", overlay: { providers: { synthetic: { api: "anthropic-messages", baseUrl: "https://synthetic.invalid", apiKey: "faux-key", models: [{ id: "one", name: "First" }, { id: "one", name: "Last" }] } } } },
 { id: "header-precedence", overlay: { providers: { anthropic: { headers: { "x-test": "provider", "x-extra": "literal" }, modelOverrides: { [first]: { headers: { "x-test": "model" } } } } } } },
 { id: "visibility", overlay: { providers: {}, visibility: { providers: ["anthropic"], models: { anthropic: [first] } } } },
 { id: "comments-trailing", overlay: '{// line\n"providers":{"anthropic":{"baseUrl":"https://synthetic.invalid/v1",},},}' },
 { id: "non-anthropic-url", overlay: { providers: { synthetic: { api: "openai-completions", baseUrl: "https://synthetic.invalid/v1/", apiKey: "faux-key", models: [{ id: "one" }] } } } },
 { id: "retired", overlay: { providers: { "grok-oauth-proxy": { baseUrl: "https://synthetic.invalid", models: [{ id: "old" }] } } } },
 { id: "invalid-json", overlay: "{" },
 { id: "invalid-model-limit", overlay: { providers: { anthropic: { models: [{ id: "broken", maxTokens: 0 }] } } } },
 { id: "missing-api", overlay: { providers: { synthetic: { baseUrl: "https://synthetic.invalid", apiKey: "faux-key", models: [{ id: "one" }] } } } },
 { id: "missing-auth", overlay: { providers: { synthetic: { api: "anthropic-messages", baseUrl: "https://synthetic.invalid", models: [{ id: "one" }] } } } },
];
const home = mkdtempSync(join(tmpdir(), "omk-catalog-oracle-"));
try {
 const cases = [];
 for (const scenario of scenarios) {
  const overlay = typeof scenario.overlay === "string" ? scenario.overlay : JSON.stringify(scenario.overlay);
  const path = join(home, "models.json"); writeFileSync(path, overlay);
  const auth = AuthStorage.inMemory(); auth.setRuntimeApiKey("anthropic", "faux-key"); auth.setRuntimeApiKey("synthetic", "faux-key");
  const registry = ModelRegistry.createReadOnly(auth, path);
  const models = registry.getAll().filter(m => m.provider === "anthropic" || m.provider === "synthetic");
  cases.push({ id: scenario.id, overlay, expected: { invalid: !!registry.getError(), total: registry.getAll().length, models, available: registry.getAvailable().filter(m => m.provider === "anthropic" || m.provider === "synthetic").map(m => [m.provider, m.id]) } });
 }
 const source = Object.fromEntries(["scripts/fixtures/catalog-recorder.ts", "packages/ai/src/models.generated.ts", "packages/ai/src/models.ts", "packages/ai/src/providers/grok-thinking.ts", "packages/coding-agent/src/core/model-registry.ts", "packages/coding-agent/src/core/model-registry-schema.ts", "packages/coding-agent/src/utils/json.ts"].map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({ builtin: { schema: "omk.model-catalog.v1", source, models: builtin }, fixture: { schema: "omk.model-overlay.v1", source, cases } }));
} finally { rmSync(home, { recursive: true, force: true }); }
