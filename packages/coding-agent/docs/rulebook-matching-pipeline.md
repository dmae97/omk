# Rulebook Matching Pipeline

This document describes how coding-agent discovers rules from supported config formats, normalizes them into a single `Rule` shape, resolves precedence conflicts, and splits the result into:

- **Rulebook rules** (available to the model via system prompt + `rule://` URLs)
- **TTSR rules** (time-travel stream interruption rules)

It reflects the current implementation, including partial semantics and metadata that is parsed but not enforced.

## Implementation files

- [`../src/capability/rule.ts`](../src/capability/rule.ts)
- [`../src/capability/index.ts`](../src/capability/index.ts)
- [`../src/discovery/index.ts`](../src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../src/discovery/cline.ts)
- [`../src/sdk.ts`](../src/sdk.ts)
- [`../src/system-prompt.ts`](../src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../src/utils/frontmatter.ts)

## 1. Canonical rule shape

All providers normalize source files into `Rule`:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

Capability identity is `rule.name` (`ruleCapability.key = rule => rule.name`).

Consequence: precedence and deduplication are **name-based only**. Two different files with the same `name` are considered the same logical rule.

## 2. Discovery sources and normalization

`src/discovery/index.ts` auto-registers providers. For `rules`, current providers are:

- `native` (priority `100`)
- `cursor` (priority `50`)
- `windsurf` (priority `50`)
- `cline` (priority `40`)

### Native provider (`builtin.ts`)

Loads `.omp` rules from:

- project: `<cwd>/.omp/rules/*.{md,mdc}`
- user: `~/.omp/agent/rules/*.{md,mdc}`

Normalization:

- `name` = filename without `.md`/`.mdc`
- frontmatter parsed via `parseFrontmatter`
- `content` = body (frontmatter stripped)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mapped directly

Important caveat: `globs` is cast as `string[] | undefined` with no element filtering in this provider.

### Cursor provider (`cursor.ts`)

Loads from:

- user: `~/.cursor/rules/*.{mdc,md}`
- project: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalization (`transformMDCRule`):

- `description`: kept only if string
- `alwaysApply`: only `true` is preserved (`false` becomes `undefined`)
- `globs`: accepts array (string elements only) or single string
- `ttsr_trigger`: string only
- `name` from filename without extension

### Windsurf provider (`windsurf.ts`)

Loads from:

- user: `~/.codeium/windsurf/memories/global_rules.md` (fixed rule name `global_rules`)
- project: `<cwd>/.windsurf/rules/*.md`

Normalization:

- `globs`: array-of-string or single string
- `alwaysApply`, `description` cast from frontmatter
- `ttsr_trigger`: string only
- `name` from filename for project rules

### Cline provider (`cline.ts`)

Searches upward from `cwd` for nearest `.clinerules`:

- if directory: loads `*.md` inside it
- if file: loads single file as rule named `clinerules`

Normalization:

- `globs`: array-of-string or single string
- `alwaysApply`: only if boolean
- `description`: string only
- `ttsr_trigger`: string only

## 3. Frontmatter parsing behavior and ambiguity

All providers use `parseFrontmatter` (`utils/frontmatter.ts`) with these semantics:

1. Frontmatter is parsed only when content starts with `---` and has a closing `\n---`.
2. Body is trimmed after frontmatter extraction.
3. If YAML parse fails:
   - warning is logged,
   - parser falls back to simple `key: value` line parsing (`^(\w+):\s*(.*)$`).

Ambiguity consequences:

- Fallback parser does not support arrays, nested objects, quoting rules, or hyphenated keys.
- Fallback values become strings (for example `alwaysApply: true` becomes string `"true"`), so providers requiring boolean/string types may drop metadata.
- `ttsr_trigger` works in fallback (underscore key); keys like `thinking-level` would not.
- Files without valid frontmatter still load as rules with empty metadata and full content body.

## 4. Provider precedence and deduplication

`loadCapability("rules")` (`capability/index.ts`) merges provider outputs and then deduplicates by `rule.name`.

### Precedence model

- Providers are ordered by priority descending.
- Equal priority keeps registration order (`cursor` before `windsurf` from `discovery/index.ts`).
- Dedup is first-wins: first encountered rule name is kept; later same-name items are marked `_shadowed` in `all` and excluded from `items`.

Effective rule provider order is currently:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Intra-provider ordering caveat

Within a provider, item order comes from `loadFilesFromDir` glob result ordering plus explicit push order. This is deterministic enough for normal use but not explicitly sorted in code.

Notable source-order differences:

- `native` appends project then user config dirs.
- `cursor` appends user then project results.
- `windsurf` appends user `global_rules` first, then project rules.
- `cline` loads only nearest `.clinerules` source.

## 5. Split into Rulebook vs TTSR buckets

After rule discovery in `createAgentSession` (`sdk.ts`):

1. All discovered rules are scanned.
2. Rules with `ttsrTrigger` are registered into `TtsrManager`.
3. A separate `rulebookRules` list is built with this predicate:

```ts
!rule.ttsrTrigger && !rule.alwaysApply && !!rule.description
```

### Bucket behavior

- **TTSR bucket**: any rule with `ttsrTrigger` (description not required).
- **Rulebook bucket**: must have description, must not be TTSR, must not be `alwaysApply`.
- A rule with both `ttsrTrigger` and `description` goes to TTSR only.
- A rule marked `alwaysApply` is currently excluded from rulebook.

## 6. How metadata affects runtime surfaces

### `description`

- Required for inclusion in rulebook.
- Rendered in system prompt `<rules>` block.
- Missing description means rule is not available via `rule://` and not listed in system prompt rules.

### `globs`

- Carried through on `Rule`.
- Rendered as `<glob>...</glob>` entries in the system prompt rules block.
- Exposed in rules UI state (`extensions` mode list).
- **Not enforced for automatic matching in this pipeline.** There is no runtime glob matcher selecting rules by current file/tool target.

### `alwaysApply`

- Parsed and preserved by providers.
- Used in UI display (`"always"` trigger label in extensions state manager).
- Used as an exclusion condition from `rulebookRules`.
- **Not used to auto-inject content into system prompt in current implementation.**

### `ttsr_trigger`

- Mapped to `rule.ttsrTrigger`.
- If present, rule is routed to TTSR manager, not rulebook.

## 7. System prompt inclusion path

`buildSystemPromptInternal(..., { rules: rulebookRules })` injects rulebook rules into system prompt templates.

Templates include:

- `Read rule://<name> when working in matching domain`
- A `<rules>` block with each rule's `name`, `description`, and optional `<glob>` list

This is advisory/contextual: prompt text asks the model to read applicable rules, but code does not enforce glob applicability.

## 8. `rule://` internal URL behavior

`RuleProtocolHandler` is registered with:

```ts
new RuleProtocolHandler({ getRules: () => rulebookRules })
```

Implications:

- `rule://<name>` resolves only against **rulebookRules** (not all discovered rules).
- TTSR-only rules and rules filtered out for missing description/`alwaysApply` are not addressable via `rule://`.
- Resolution is exact name match.
- Unknown names return error listing available rule names.
- Returned content is raw `rule.content` (frontmatter stripped), content type `text/markdown`.

## 9. Known partial / non-enforced semantics

1. Provider descriptions mention legacy files (`.cursorrules`, `.windsurfrules`), but current loader code paths do not actually read those files.
2. `globs` metadata is surfaced to prompt/UI but not enforced by rule selection logic.
3. `alwaysApply` does not force inclusion into system prompt; current behavior excludes such rules from `rulebookRules`.
4. Rule selection for `rule://` is constrained to prefiltered rulebook rules, not the full discovered set.
5. Discovery warnings (`loadCapability("rules").warnings`) are produced but `createAgentSession` does not currently surface/log them in this path.
