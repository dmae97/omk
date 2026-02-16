# Model and Provider Configuration (`models.yml`)

This document describes how the coding-agent currently loads models, applies overrides, resolves credentials, and chooses models at runtime.

## What controls model behavior

Primary implementation files:

- `src/config/model-registry.ts` — loads built-in + custom models, provider overrides, runtime discovery, auth integration
- `src/config/model-resolver.ts` — parses model patterns and selects initial/smol/slow models
- `src/config/settings-schema.ts` — model-related settings (`modelRoles`, provider transport preferences)
- `src/session/auth-storage.ts` — API key + OAuth resolution order
- `packages/ai/src/models.ts` and `packages/ai/src/types.ts` — built-in providers/models and `Model`/`compat` types

## Config file location and legacy behavior

Default config path:

- `~/.omp/agent/models.yml`

Legacy behavior still present:

- If `models.yml` is missing and `models.json` exists at the same location, it is migrated to `models.yml`.
- Explicit `.json` / `.jsonc` config paths are still supported when passed programmatically to `ModelRegistry`.

## `models.yml` shape

```yaml
providers:
  <provider-id>:
    # provider-level config
```

`provider-id` is the canonical provider key used across selection and auth lookup.

## Provider-level fields

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
```

### Allowed provider/model `api` values

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Allowed auth/discovery values

- `auth`: `apiKey` (default) or `none`
- `discovery.type`: `ollama`

## Validation rules (current)

### Full custom provider (`models` is non-empty)

Required:

- `baseUrl`
- `apiKey` unless `auth: none`
- `api` at provider level or each model

### Override-only provider (`models` missing or empty)

Must define at least one of:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` requires provider-level `api`.

### Model value checks

- `id` required
- `contextWindow` and `maxTokens` must be positive if provided

## Merge and override order

ModelRegistry pipeline (on refresh):

1. Load built-in providers/models from `@oh-my-pi/pi-ai`.
2. Load `models.yml` custom config.
3. Apply provider overrides (`baseUrl`, `headers`) to built-in models.
4. Apply `modelOverrides` (per provider + model id).
5. Merge custom `models`:
   - same `provider + id` replaces existing
   - otherwise append
6. Apply runtime-discovered models (currently Ollama), then re-apply model overrides.

Provider defaults vs per-model overrides:

- Provider `headers` are baseline.
- Model `headers` override provider header keys.
- `modelOverrides` can override model metadata (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`).
- `compat` is deep-merged for nested routing blocks (`openRouterRouting`, `vercelGatewayRouting`).

## Runtime discovery integration

### Implicit Ollama discovery

If `ollama` is not explicitly configured, registry adds an implicit discoverable provider:

- provider: `ollama`
- api: `openai-completions`
- base URL: `OLLAMA_BASE_URL` or `http://127.0.0.1:11434`
- auth mode: keyless (`auth: none` behavior)

Runtime discovery calls `GET /api/tags` on Ollama and synthesizes model entries with local defaults.

### Explicit provider discovery

You can configure discovery yourself:

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
```

### Extension provider registration

Extensions can register providers at runtime (`pi.registerProvider(...)`), including:

- model replacement/append for a provider
- custom stream handler registration for new API IDs
- custom OAuth provider registration

## Auth and API key resolution order

When requesting a key for a provider, effective order is:

1. Runtime override (CLI `--api-key`)
2. Stored API key credential in `agent.db`
3. Stored OAuth credential in `agent.db` (with refresh)
4. Environment variable mapping (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. ModelRegistry fallback resolver (provider `apiKey` from `models.yml`, env-name-or-literal semantics)

`models.yml` `apiKey` behavior:

- Value is first treated as an environment variable name.
- If no env var exists, the literal string is used as the token.

If `authHeader: true` and provider `apiKey` is set, models get:

- `Authorization: Bearer <resolved-key>` header injected.

Keyless providers:

- Providers marked `auth: none` are treated as available without credentials.
- `getApiKey*` returns `"<no-auth>"` for them.

## Model availability vs all models

- `getAll()` returns the loaded model registry (built-in + merged custom + discovered).
- `getAvailable()` filters to models that are keyless or have resolvable auth.

So a model can exist in registry but not be selectable until auth is available.

## Runtime model resolution

### CLI and pattern parsing

`model-resolver.ts` supports:

- exact `provider/modelId`
- exact model id (provider inferred)
- fuzzy/substring matching
- glob scope patterns in `--models` (e.g. `openai/*`, `*sonnet*`)
- optional `:thinkingLevel` suffix (`off|minimal|low|medium|high|xhigh`)

`--provider` is legacy; `--model` is preferred.

### Initial model selection priority

`findInitialModel(...)` uses this order:

1. explicit CLI provider+model
2. first scoped model (if not resuming)
3. saved default provider/model
4. known provider defaults (e.g. OpenAI/Anthropic/etc.) among available models
5. first available model

### Role aliases and settings

Supported model roles:

- `default`, `smol`, `slow`, `plan`, `commit`

Role aliases like `pi/smol` expand through `settings.modelRoles`.

Related settings:

- `modelRoles` (record)
- `enabledModels` (scoped pattern list)
- `providers.kimiApiFormat` (`openai` or `anthropic` request format)
- `providers.openaiWebsockets` (`auto|off|on` websocket preference for OpenAI Codex transport)

## Compatibility and routing fields

`models.yml` supports this `compat` subset:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` or `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

These are consumed by the OpenAI-completions transport logic and combined with URL-based auto-detection.

## Practical examples

### Local OpenAI-compatible endpoint (no auth)

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### Hosted proxy with env-based key

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### Override built-in provider route + model metadata

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## Legacy consumer caveat

Most model configuration now flows through `models.yml` via `ModelRegistry`.

One notable legacy path remains: web-search Anthropic auth resolution still reads `~/.omp/agent/models.json` directly in `src/web/search/auth.ts`.

If you rely on that specific path, keep JSON compatibility in mind until that module is migrated.

## Failure mode

If `models.yml` fails schema or validation checks:

- registry keeps operating with built-in models
- error is exposed via `ModelRegistry.getError()` and surfaced in UI/notifications
