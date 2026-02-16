# Skills

Skills are file-backed capability packs discovered at startup and exposed to the model as:

- lightweight metadata in the system prompt (name + description)
- on-demand content via `read skill://...`
- optional interactive `/skill:<name>` commands

This document covers current runtime behavior in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts`, and `src/discovery/agents-md.ts`.

## What a skill is in this codebase

A discovered skill is represented as:

- `name`
- `description`
- `filePath` (the `SKILL.md` path)
- `baseDir` (skill directory)
- source metadata (`provider`, `level`, path)

The runtime only requires `name` and `path` for validity. In practice, matching quality depends on `description` being meaningful.

## Required layout and SKILL.md expectations

### Directory layout

For provider-based discovery (native/Claude/Codex/Agents/plugin providers), skills are discovered as **one level under `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Nested patterns like `<skills-root>/group/<skill>/SKILL.md` are not discovered by provider loaders.

For `skills.customDirectories`, scanning is recursive and treats any directory containing `SKILL.md` as a skill root.

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is recursive, so the same nested path is valid when that parent is listed in `skills.customDirectories`.
```


### `SKILL.md` frontmatter

Supported frontmatter fields on the skill type:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- additional keys are preserved as unknown metadata

Current runtime behavior:

- `name` defaults to the skill directory name
- `description` is required for:
  - native `.omp` provider skill discovery (`requireDescription: true`)
  - `skills.customDirectories` scan in `extensibility/skills.ts`
- non-native providers can load skills without description

## Discovery pipeline

`loadSkills()` in `src/extensibility/skills.ts` does two passes:

1. **Capability providers** via `loadCapability("skills")`
2. **Custom directories** via recursive scan of `skills.customDirectories`

If `skills.enabled` is `false`, discovery returns no skills.

### Built-in skill providers and precedence

Provider ordering is priority-first (higher wins), then registration order for ties.

Current registered skill providers:

1. `native` (priority 100) — `.omp` user/project skills via `src/discovery/builtin.ts`
2. `claude` (priority 80)
3. priority 70 group (in registration order):
   - `claude-plugins`
   - `agents`
   - `codex`

Dedup key is skill name. First item with a given name wins.

### Source toggles and filtering

`loadSkills()` applies these controls:

- source toggles: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- glob filters on skill name:
  - `ignoredSkills` (exclude)
  - `includeSkills` (include allowlist; empty means include all)

Filter order is:

1. source enabled
2. not ignored
3. included (if include list present)

For providers other than codex/claude/native (for example `agents`, `claude-plugins`), enablement currently falls back to: enabled if **any** built-in source toggle is enabled.

### Collision and duplicate handling

- Capability dedup already keeps first skill per name (highest-precedence provider)
- `extensibility/skills.ts` additionally:
  - de-duplicates identical files by `realpath` (symlink-safe)
  - emits collision warnings when a later skill name conflicts
- Custom-directory skills are merged after provider skills and follow the same collision behavior

## Runtime usage behavior

### System prompt exposure

System prompt construction (`src/system-prompt.ts`) uses discovered skills as follows:

- if `read` tool is available **and** no explicit preloaded skills are supplied:
  - include discovered skills list in prompt
- otherwise:
  - omit discovered list
- if preloaded skills are provided (for example from Task tool skill pinning):
  - inline full preloaded skill contents in `<preloaded_skills>`

### Task tool skill pinning

When a Task call specifies `skills`, runtime resolves names against session skills:

- unknown names cause an immediate error with available skill names
- resolved skills are passed as preloaded skills to subagents

### Interactive `/skill:<name>` commands

If `skills.enableSkillCommands` is true, interactive mode registers one slash command per discovered skill.

`/skill:<name> [args]` behavior:

- reads the skill file directly from `filePath`
- strips frontmatter
- injects skill body as a follow-up custom message
- appends metadata (`Skill: <path>`, optional `User: <args>`)

## `skill://` URL behavior

`src/internal-urls/skill-protocol.ts` supports:

- `skill://<name>` → resolves to that skill's `SKILL.md`
- `skill://<name>/<relative-path>` → resolves inside that skill directory

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

Resolution details:

- skill name must match exactly
- relative paths are URL-decoded
- absolute paths are rejected
- path traversal (`..`) is rejected
- resolved path must remain within `baseDir`
- missing files return an explicit `File not found` error

Content type:

- `.md` => `text/markdown`
- everything else => `text/plain`

No fallback search is performed for missing assets.

## Skills vs AGENTS.md, commands, tools, hooks

### Skills vs AGENTS.md

- **Skills**: named, optional capability packs selected by task context or explicitly requested
- **AGENTS.md/context files**: persistent instruction files loaded as context-file capability and merged by level/depth rules

`src/discovery/agents-md.ts` specifically walks ancestor directories from `cwd` to discover standalone `AGENTS.md` files (up to depth 20), excluding hidden-directory segments.

### Skills vs slash commands

- **Skills**: model-readable knowledge/workflow content
- **Slash commands**: user-invoked command entry points
- `/skill:<name>` is a convenience wrapper that injects skill text; it does not change skill discovery semantics

### Skills vs custom tools

- **Skills**: documentation/workflow content loaded through prompt context and `read`
- **Custom tools**: executable tool APIs callable by the model with schemas and runtime side effects

### Skills vs hooks

- **Skills**: passive content
- **Hooks**: event-driven runtime interceptors that can block/modify behavior during execution

## Practical authoring guidance tied to discovery logic

- Put each skill in its own directory: `<skills-root>/<skill-name>/SKILL.md`
- Always include explicit `name` and `description` frontmatter
- Keep referenced assets under the same skill directory and access with `skill://<name>/...`
- If you need nested taxonomy (`team/domain/skill`), use `skills.customDirectories` (recursive scanner), not provider `skills/` roots
- Avoid duplicate skill names across sources; first match wins by provider precedence
