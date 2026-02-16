# Secret Obfuscation

Prevents sensitive values (API keys, tokens, passwords) from being sent to LLM providers. When enabled, secrets are replaced with deterministic placeholders before leaving the process, and restored in tool call arguments returned by the model.

## Enabling

Disabled by default. Toggle via `/settings` UI or directly in `config.yml`:

```yaml
secrets:
  enabled: true
```

## How it works

1. On session startup, secrets are collected from two sources:
   - **Environment variables** matching common secret patterns (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, etc.) with values >= 8 characters
   - **`secrets.yml` files** (see below)

2. Outbound messages to the LLM have all secret values replaced with placeholders like `<<$env:S0>>`, `<<$env:S1>>`, etc.

3. Tool call arguments returned by the model are deep-walked and placeholders are restored to original values before execution.

Two modes control what happens to each secret:

| Mode | Behavior | Reversible |
|---|---|---|
| `obfuscate` (default) | Replaced with indexed placeholder `<<$env:SN>>` | Yes (deobfuscated in tool args) |
| `replace` | Replaced with deterministic same-length string | No (one-way) |

## secrets.yml

Define custom secret entries in YAML. Two locations are checked:

| Level | Path | Purpose |
|---|---|---|
| Global | `~/.omp/agent/secrets.yml` | Secrets across all projects |
| Project | `<cwd>/.omp/secrets.yml` | Project-specific secrets |

Project entries override global entries with matching `content`.

### Schema

Each entry in the array has these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"plain"` or `"regex"` | Yes | Match strategy |
| `content` | string | Yes | The secret value (plain) or regex pattern (regex) |
| `mode` | `"obfuscate"` or `"replace"` | No | Default: `"obfuscate"` |
| `replacement` | string | No | Custom replacement (replace mode only) |
| `flags` | string | No | Regex flags (regex type only) |

### Examples

#### Plain secrets

```yaml
# Obfuscate a specific API key (default mode)
- type: plain
  content: sk-proj-abc123def456

# Replace a database password with a fixed string
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Regex secrets

```yaml
# Obfuscate any AWS-style key
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive match with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex literal syntax (pattern and flags in one string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Regex entries always scan globally (the `g` flag is enforced automatically). The regex literal syntax `/pattern/flags` is supported as an alternative to separate `content` + `flags` fields. Escaped slashes within the pattern (`\\/`) are handled correctly.

#### Replace mode with regex

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interaction with env var detection

Environment variables are always collected first. File-defined entries are appended after, so file entries can cover secrets that don't live in env vars (config files, hardcoded values, etc.). If the same value appears in both, the file entry's mode takes precedence.

## Key files

- `src/secrets/index.ts` -- loading, merging, env var collection
- `src/secrets/obfuscator.ts` -- `SecretObfuscator` class, placeholder generation, message obfuscation
- `src/secrets/regex.ts` -- regex literal parsing and compilation
- `src/config/settings-schema.ts` -- `secrets.enabled` setting definition
