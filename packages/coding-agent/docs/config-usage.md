# Configuration Discovery and Resolution

This document describes how the coding-agent resolves configuration today: which roots are scanned, how precedence works, and how resolved config is consumed by settings, skills, hooks, tools, and extensions.

## Scope

Primary implementation:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

Key integration points:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## Resolution flow (visual)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.omp/agent + <cwd>/.omp          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```


## 1) Config roots and source order

## Canonical roots

`src/config.ts` defines a fixed source priority list:

1. `.omp` (native)
2. `.claude`
3. `.codex`
4. `.gemini`

User-level bases:

- `~/.omp/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

Project-level bases:

- `<cwd>/.omp`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` is `.omp` (`packages/utils/src/dirs.ts`).

## Important constraint

The generic helpers in `src/config.ts` do **not** include `.pi` in source discovery order.

---

## 2) Core discovery helpers (`src/config.ts`)

## `getConfigDirs(subpath, options)`

Returns ordered entries:

- User-level entries first (by source priority)
- Then project-level entries (by same source priority)

Options:

- `user` (default `true`)
- `project` (default `true`)
- `cwd` (default `getProjectDir()`)
- `existingOnly` (default `false`)

This API is used for directory-based config lookups (commands, hooks, tools, agents, etc.).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

Searches for the first existing file across ordered bases, returns first match (path-only or path+metadata).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

Walks parent directories upward and returns the **nearest existing directory per source base** (`.omp`, `.claude`, `.codex`, `.gemini`), then sorts results by source priority.

Use this when project config should be inherited from ancestor directories (monorepo/nested workspace behavior).

---

## 3) File config wrapper (`ConfigFile<T>` in `src/config.ts`)

`ConfigFile<T>` is the schema-validated loader for single config files.

Supported formats:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

Behavior:

- Validates parsed data with AJV against a provided TypeBox schema.
- Caches load result until `invalidate()`.
- Returns tri-state result via `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` with schema/parse context)

Legacy migration still supported:

- If target path is `.yml`/`.yaml`, a sibling `.json` is auto-migrated once (`migrateJsonToYml`).

---

## 4) Settings resolution model (`src/config/settings.ts`)

The runtime settings model is layered:

1. Global settings: `~/.omp/agent/config.yml`
2. Project settings: discovered via settings capability (`settings.json` from providers)
3. Runtime overrides: in-memory, non-persistent
4. Schema defaults: from `SETTINGS_SCHEMA`

Effective read path:

`defaults <- global <- project <- overrides`

Write behavior:

- `settings.set(...)` writes to the **global** layer (`config.yml`) and queues background save.
- Project settings are read-only from capability discovery.

## Migration behavior still active

On startup, if `config.yml` is missing:

1. Migrate from `~/.omp/agent/settings.json` (renamed to `.bak` on success)
2. Merge with legacy DB settings from `agent.db`
3. Write merged result to `config.yml`

Field-level migrations in `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` milliseconds -> seconds when old value looks like ms (`> 1000`)
- Legacy flat `theme: "..."` -> `theme.dark/theme.light` structure

---

## 5) Capability/discovery integration

Most non-core config loading flows through the capability registry (`src/capability/index.ts` + `src/discovery/index.ts`).

## Provider ordering

Providers are sorted by numeric priority (higher first). Example priorities:

- Native OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.omp)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## Dedup semantics

Capabilities define a `key(item)`:

- same key => first item wins (higher-priority/earlier-loaded item)
- no key (`undefined`) => no dedup, all items retained

Relevant keys:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: no dedup (all items preserved)

---

## 6) Native `.omp` provider behavior (`src/discovery/builtin.ts`)

Native provider (`id: native`) reads from:

- project: `<cwd>/.omp/...`
- user: `~/.omp/agent/...`

### Directory admission rule

`builtin.ts` only includes a config root if the directory exists **and is non-empty** (`ifNonEmptyDir`).

### Scope-specific loading

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` and `tools/<name>/index.ts`
- Extension modules: discovered under `extensions/` (+ legacy `settings.json.extensions` string array)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### Nearest-project lookup nuance

For `SYSTEM.md` and `AGENTS.md`, native provider uses nearest-ancestor project `.omp` directory search (walk-up) but still requires the `.omp` dir to be non-empty.

---

## 7) How major subsystems consume config

## Settings subsystem

- `Settings.init()` loads global `config.yml` + discovered project `settings.json` capability items.
- Only capability items with `level === "project"` are merged into project layer.

## Skills subsystem

- `extensibility/skills.ts` loads via `loadCapability(skillCapability.id, { cwd })`.
- Applies source toggles and filters (`ignoredSkills`, `includeSkills`, custom dirs).
- Legacy-named toggles still exist (`skills.enablePiUser`, `skills.enablePiProject`) but they gate the native provider (`provider === "native"`).

## Hooks subsystem

- `discoverAndLoadHooks()` resolves hook paths from hook capability + explicit configured paths.
- Then loads modules via Bun import.

## Tools subsystem

- `discoverAndLoadCustomTools()` resolves tool paths from tool capability + plugin tool paths + explicit configured paths.
- Declarative `.md/.json` tool files are metadata only; executable loading expects code modules.

## Extensions subsystem

- `discoverAndLoadExtensions()` resolves extension modules from extension-module capability plus explicit paths.
- Current implementation intentionally keeps only capability items with `_source.provider === "native"` before loading.

---

## 8) Precedence rules to rely on

Use this mental model:

1. Source directory ordering from `config.ts` determines candidate path order.
2. Capability provider priority determines cross-provider precedence.
3. Capability key dedup determines collision behavior (first wins for keyed capabilities).
4. Subsystem-specific merge logic can further change effective precedence (especially settings).

### Settings-specific caveat

Settings capability items are not deduplicated; `Settings.#loadProjectSettings()` deep-merges project items in returned order. Because merge applies later item values over earlier values, effective override behavior depends on provider emission order, not just capability key semantics.

---

## 9) Legacy/compatibility behaviors still present

- `ConfigFile` JSON -> YAML migration for YAML-targeted files.
- Settings migration from `settings.json` and `agent.db` to `config.yml`.
- Settings key migrations (`queueMode`, `ask.timeout`, flat `theme`).
- Extension manifest compatibility: loader accepts both `package.json.omp` and `package.json.pi` manifest sections.
- Legacy setting names `skills.enablePiUser` / `skills.enablePiProject` are still active gates for native skill source.

If these compatibility paths are removed in code, update this document immediately; several runtime behaviors still depend on them today.
