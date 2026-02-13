# `models.yml` provider integration guide

`models.yml` lets you register custom model providers (local or hosted), override built-in providers, and tune model metadata.

Default location:

- `~/.omp/agent/models.yml`

Legacy support:

- `models.json` is still read and auto-migrated to `models.yml` when possible.

## Top-level shape

```yaml
providers:
  <provider-name>:
    # Provider config
```

`<provider-name>` is the provider ID used everywhere else (selection, auth lookup, etc.).

## Provider fields

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-responses
    headers:
      X-Custom-Header: value
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      <model-id-within-provider>:
        name: Friendly Name
    models:
      - id: model-id
        name: My Model
        api: openai-responses
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
          X-Model-Header: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [openai, anthropic]
```

### `api` values

Supported API adapters:

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

`auth` values:

- `apiKey` (default)
- `none`

`discovery.type` values:

- `ollama`

If `discovery` is set, provider-level `api` is required.

## Required vs optional

### Full custom provider (defines `models`)

If `models` is non-empty, you must set:

- `baseUrl`
- `apiKey` (unless `auth: none`)
- `api` at provider level or per model

If `auth: none` is set, `apiKey` is optional even when `models` are defined.

### Override-only provider (no `models`)

If `models` is empty/missing, set at least one of:

- `baseUrl`
- `modelOverrides`
- `discovery`

Use this to modify built-in providers without redefining all models.

Default values when omitted in a model definition:

- `reasoning: false`
- `input: [text]`
- `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`
- `contextWindow: 128000`
- `maxTokens: 16384`

Header merge behavior:

- Provider `headers` are applied first
- Model-level `headers` override provider headers on key conflicts
## Merge behavior

`models.yml` does not replace the built-in registry.

1. Built-in models load first.
2. Provider-level overrides (`baseUrl`, `headers`) are applied.
3. `modelOverrides` are applied by model ID within each provider.
4. Custom `models` are merged in.
5. If a custom model has the same `provider + id` as an existing model, it replaces that model.

## API key behavior

`apiKey` resolution is:

1. Treat value as env var name (preferred)
2. If env var not found, treat value as literal key

Example:

```yaml
apiKey: OPENROUTER_API_KEY
```

If `OPENROUTER_API_KEY` exists, that value is used. Otherwise, the literal string `OPENROUTER_API_KEY` is used as the token.

Use `authHeader: true` when your endpoint expects:

```http
Authorization: Bearer <apiKey>
```

Set `auth: none` for keyless providers (local gateways, unauthenticated dev endpoints).

## Practical integration patterns

### 1) OpenAI-compatible endpoint (vLLM / LM Studio / gateway)

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

### 2) Anthropic-compatible proxy

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### 3) Override built-in provider without redefining models

```yaml
providers:
  openrouter:
    baseUrl: https://my-corp-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp Route)
```

### 4) Runtime discovery for Ollama

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
```

The agent will query `GET /api/tags` and register discovered models dynamically.

## Validation failures to watch for

Common schema/validation errors:

- Provider with `models` but missing `baseUrl`
- Provider with `models` and `auth != none` but missing `apiKey`
- Model missing `api` when neither provider-level nor model-level `api` is set
- Non-positive `contextWindow` or `maxTokens`
- `discovery` configured without provider-level `api`

When `models.yml` has errors, the agent falls back to built-in models and reports a load error.

## Quick start

1. Create `~/.omp/agent/models.yml`
2. Add one provider with one model
3. Start the agent and open `/model`
4. Confirm your provider/model appears
5. If auth fails, check env vars and `authHeader`

For SDK usage, `ModelRegistry` also accepts a custom path so you can load non-default `models.yml` files programmatically.