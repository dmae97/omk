import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { ModelRegistry } from "../../packages/coding-agent/src/core/model-registry.ts";
import { AuthStorage } from "../../packages/coding-agent/src/core/auth-storage.ts";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import type { AssistantMessageEvent, Model } from "../../packages/ai/src/types.ts";
import { cases as streams } from "./anthropic-provider-cases.ts";
const scenarios = [
 { id: "runtime", runtime: "faux-runtime" },
 { id: "stored", store: '{"anthropic":{"type":"api_key","key":"$SYN_KEY"}}', env: { SYN_KEY: "faux-stored" } },
 { id: "environment", environment: "faux-environment" },
 { id: "fallback", fallback: "faux-fallback" },
 { id: "provider-model-headers", runtime: "faux-runtime", headers: { "x-test": "provider", "x-provider": "$SYN_KEY" }, modelHeaders: { "X-Test": "model" }, env: { SYN_KEY: "header-value" } },
 { id: "authorization-header", runtime: "faux-runtime", authHeader: true },
 { id: "eager-disabled", runtime: "faux-runtime", compat: { supportsEagerToolInputStreaming: false }, tool: true },
 { id: "adaptive-beta", runtime: "faux-runtime", compat: { forceAdaptiveThinking: true } },
 { id: "tools", runtime: "faux-runtime", tool: true },
 { id: "custom-provider", runtime: "faux-runtime", provider: "synthetic" },
];
const home = mkdtempSync(join(tmpdir(), "omk-dispatch-oracle-"));
const fetch = globalThis.fetch;
try {
 const cases = [];
 for (const scenario of scenarios) {
  const s = scenario as typeof scenario & { provider?: string; fallback?: string; runtime?: string; store?: string; environment?: string; env?: Record<string,string>; headers?: Record<string,string>; modelHeaders?: Record<string,string>; authHeader?: boolean; compat?: Record<string,boolean>; tool?: boolean };
  for (const name of ["ANTHROPIC_API_KEY","ANTHROPIC_OAUTH_TOKEN","SYN_KEY"]) delete process.env[name];
  Object.assign(process.env, s.env); if (s.environment) process.env.ANTHROPIC_API_KEY = s.environment;
  const provider = s.provider ?? "anthropic";
  const definition = { id: "synthetic-dispatch", reasoning: false, input: ["text"], headers: s.modelHeaders, compat: s.compat };
  const overlay = JSON.stringify({ providers: { [provider]: { api: "anthropic-messages", baseUrl: "https://synthetic.invalid/v1/", apiKey: s.fallback ?? "faux-config", headers: s.headers, authHeader: s.authHeader, models: [definition] } } });
  const path = join(home,"models.json"); writeFileSync(path,overlay);
  const auth = AuthStorage.fromStorage({ withLock: fn => fn(s.store).result, async withLockAsync() { throw new Error("unexpected refresh"); } });
  if (s.runtime) auth.setRuntimeApiKey(provider,s.runtime);
  const registry = ModelRegistry.createReadOnly(auth,path);
  const model = registry.find(provider,definition.id) as Model<"anthropic-messages">;
  const resolved = await registry.getApiKeyAndHeaders(model); if (!resolved.ok || !resolved.apiKey) throw new Error("oracle auth failed");
  let request: unknown;
  globalThis.fetch = async (url, init) => {
   if (String(url) !== "https://synthetic.invalid/v1/messages" || request) throw new Error("unexpected dispatch/retry");
   const headers = Object.fromEntries([...new Headers(init?.headers)].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent"));
   request = { url: String(url), headers, body: init?.body };
   return new Response(streams[0].wire, { headers: { "content-type":"text/event-stream" } });
  };
  const tools = s.tool ? [{ name: "read", description: "Read synthetic file", parameters: Type.Object({ path: Type.String() }) }] : undefined;
  const stream = streamAnthropic(model, { systemPrompt: "Synthetic system", messages: [{ role:"user", content:"Hello 🌍", timestamp:0 }], tools }, { apiKey: resolved.apiKey, headers: resolved.headers, cacheRetention:"none", maxTokens:64, maxRetries:0 });
  const events = [];
  for await (const event of stream) { const { partial: _p, message: _m, error: _e, ...projection } = event as Partial<AssistantMessageEvent> & { partial?: unknown; message?: unknown; error?: unknown }; events.push(projection); }
  const { timestamp: _t, usage, ...result } = await stream.result(); const { cost: _c, ...tokens } = usage;
  const input = { model:definition.id, maxTokens:64, system:"Synthetic system", user:"Hello 🌍", tools:s.tool ? [{name:"read",description:"Read synthetic file",properties:{path:{type:"string"}},required:["path"]}] : [] };
  cases.push({ id:s.id, overlay, provider, input, runtime:s.runtime, store:s.store, environment:s.environment, env:s.env, request, events, result:{...result,usage:tokens}, wire:streams[0].wire });
 }
 const source = Object.fromEntries(["scripts/fixtures/dispatch-recorder.ts","scripts/fixtures/anthropic-provider-cases.ts","packages/ai/src/providers/anthropic.ts","packages/ai/src/providers/anthropic-compat.ts","packages/coding-agent/src/core/model-registry.ts","packages/coding-agent/src/core/provider-request-key.ts"].map(p => [p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({ schema:"omk.authenticated-dispatch.v1", source, cases }));
} finally { globalThis.fetch = fetch; rmSync(home,{recursive:true,force:true}); }
