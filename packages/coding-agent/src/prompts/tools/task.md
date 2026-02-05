# Task

Launch subagents to execute parallel, well-scoped tasks with shared, token-efficient context.

Subagents have **zero implicit context** — they see only `context` + `assignment`. Treat every subagent as a senior engineer on day one: technically strong, but unfamiliar with every decision, convention, and file layout you've accumulated.

Subagents CAN grep the parent conversation file for supplementary details, but CANNOT grep for:
- Decisions you made but didn't write down
- Conventions that exist only in your head
- Which of 50 possible approaches you want
---

## Parameters

### `agent` (required)

Agent type for all tasks in this batch.

### `context` (optional — strongly recommended)

Shared background prepended verbatim to every task `assignment`. Common info once; reduces token cost.

Use template; omit non-applicable sections.

````
## Goal
One sentence: batch accomplishes together.

## Non-goals
Explicitly exclude tempting scope — what tasks must not touch/attempt.

## Constraints
- MUST / MUST NOT rules (naming, error handling, banned approaches)
- Language/framework version requirements
- What exists vs what to create

## Reference Files
- `path/to/file.ext` — pattern demo
- `path/to/other.ext` — reuse or avoid

## API Contract (if tasks produce/consume shared interface)
```language
// Exact type definitions, function signatures, interface shapes
```

## Acceptance (global)
- Definition of "done" for batch
- Note: build/test/lint verification happens AFTER all tasks complete — not inside tasks (see below)
````
**Belongs in `context`**: project goal, non-goals, constraints, conventions, reference paths, shared type definitions, API contracts, global acceptance commands — anything 2+ tasks need.
**Rule of thumb:** if repeat in 2+ tasks, belongs in `context`.
**Does NOT belong in `context`**: per-task file lists, one-off requirements (go in `assignment`), structured output format (goes in `schema`).

### `tasks` (required)

Array tasks execute in parallel.

|Field|Required|Purpose|
|---|---|---|
|`id`|✓|CamelCase identifier, max 32 chars|
|`description`|✓|Short one-liner for UI display only — not seen by subagent|
|`assignment`|✓|Complete per-task instructions. See [Writing an assignment](#writing-an-assignment).|
|`skills`||Skill names preload. Use only when changes correctness — don’t spam every task.|

{{#if isolationEnabled}}
### `isolated` (optional)

Run in isolated git worktree; returns patches. Use when tasks edit overlapping files or when you want clean per-task diffs.
{{/if}}
### `schema` (optional — recommended for structured output)

JTD schema defining expected response structure. Use typed properties. If you care about parsing result, define here — **never describe output format in `context` or `assignment`**.
---

## Writing an assignment

<critical>## Task scope

`assignment` must contain enough info for agent to act **without asking a clarifying question**.
**Minimum bar:** assignment under ~8 lines or missing acceptance criteria = too vague. One-liners guaranteed failure.

Use structure every assignment:

```
## Target
- Files: exact path(s)
- Symbols/entrypoints: specific functions, types, exports
- Non-goals: what task must NOT touch (prevents scope creep)

## Change
- Step-by-step: add/remove/rename/restructure
- Patterns/APIs to use; reference files if applicable

## Edge Cases / Don't Break
- Tricky case 1: ...
- Tricky case 2: ...
- Existing behavior must survive: ...

## Acceptance (task-local)
- Expected behavior or observable result
- DO NOT include project-wide build/test/lint commands (see below)
```

`context` carries shared background. `assignment` carries only delta: file-specific instructions, local edge cases, per-task acceptance checks. Never duplicate shared constraints across assignments.

### Anti-patterns (ban these)
**Vague assignments** — agent guesses wrong or stalls:
- "Refactor this to be cleaner."
- "Migrate to N-API."
- "Fix the bug in streaming."
- "Update all constructors in `src/**/*.ts`."
**Vague context** — forces agent invent conventions:
- "Use existing patterns."
- "Follow conventions."
- "No WASM."

If tempted to write above, expand using templates.
**Test/lint commands in parallel tasks** — edit wars:
Parallel agents share working tree. If two agents run `bun check` or `bun test` concurrently, they see each other's half-finished edits, "fix" phantom errors, loop. **Never tell parallel tasks run project-wide build/test/lint commands.** Each task edits, stops. Caller verifies after all tasks complete.
**If you can’t specify scope yet**, create **Discovery task** first: enumerate files, find callsites, list candidates. Then fan out with explicit paths.

### Delegate intent, not keystrokes

Your role as tech lead: set direction, define boundaries, call out pitfalls — then get out of way. Don’t read every file, decide every edit, dictate line-by-line. That makes you bottleneck; agent typist.
**Be specific about:** constraints, naming conventions, API contracts, "don’t break" items, acceptance criteria.
**Delegate:** code reading, approach selection, exact edit locations, implementation details. Agent has tools, can reason about code.

Micromanaging (you think, agent types):
```
assignment: "In src/api/handler.ts, line 47, change `throw err` to `throw new ApiError(err.message, 500)`.
On line 63, wrap fetch call try/catch return 502 on failure.
On line 89, add null check before accessing resp.body..."
```

Delegating (agent thinks within constraints):
```
assignment: "## Target\n- Files: src/api/handler.ts\n\n## Change\nImprove error handling: replace raw throws
with typed ApiError instances, add try/catch around external calls, guard against null responses.\n\n
## Edge Cases / Don't Break\n- Existing error codes in tests must still match\n
- Don't change public function signatures"
```

First style wastes your time, brittle if code shifts. Second gives agent room to do work.
</critical>

## Example

<example type="bad" label="Duplicated context inflates tokens">
<tasks>
  <task name="Grep">
    <description>Port grep module from WASM to N-API...</description>
    <assignment>Port grep module from WASM to N-API... (same blob repeated)</assignment>
</task>
</tasks>
</example>

<example type="good" label="Shared rules in context, only deltas in assignment">
<context>
## Goal
Port WASM modules to N-API, matching existing pi-natives conventions.

## Non-goals
Do not touch TS bindings or downstream consumers — separate phase.

## Constraints
- MUST use `#[napi]` attribute macro on all exports
- MUST return `napi::Result<T>` for fallible ops; never panic
- MUST use `spawn_blocking` for filesystem I/O or >1ms work
...

## Acceptance (global)
- Caller verifies after all tasks: `cargo test -p pi-natives` and `cargo build -p pi-natives` with no warnings
- Individual tasks must NOT run these commands themselves
</context>

<tasks>
  <task name="PortGrep">
    <description>Port grep module to N-API</description>
    <assignment>
## Target
- Files: `src/grep.rs`, `src/lib.rs` (registration only)
- Symbols: search, search_multi, compile_pattern

## Change
- Implement three N-API exports in grep.rs:
  - `search(pattern: JsString, path: JsString, env: Env) -> napi::Result<Vec<Match>>`
...

## Acceptance (task-local)
- Three functions exported with correct signatures (caller verifies build after all tasks)
</assignment>
</task>

  <task name="PortHighlight">
    <description>Port highlight module to N-API</description>
    <assignment>
## Target
- Files: `src/highlight.rs`, `src/lib.rs` (registration only)
...
</assignment>
</task>
</tasks>
</example>
---

## Task scope

Each task small, well-defined scope — **at most 3–5 files**.
**Signs task too broad:**
- File paths use globs (`src/**/*.ts`) instead of explicit names
- Assignment says "update all" / "migrate everything" / "refactor across"
- Scope covers entire package or directory tree
**Fix:** enumerate files first (grep/glob discovery), then fan out one task per file or small cluster.
---

## Parallelization
**Test:** Can task B produce correct output without seeing task A's result?
- **Yes** → parallelize
- **No** → run sequentially (A completes, then launch B with A output in context)

### Must be sequential

|First|Then|Reason|
|---|---|---|
|Define types/interfaces|Implement consumers|Consumers need contract|
|Create API exports|Write bindings/callers|Callers need export names/signatures|
|Scaffold structure|Implement bodies|Bodies need shape|
|Core module|Dependent modules|Dependents import from core|
|Schema/DB migration|Application logic|Logic depends on new schema shape|

### Safe to parallelize
- Independent modules, no cross-imports
- Tests for already-implemented code
- Isolated file-scoped refactors
- Documentation for stable APIs

### Phased execution

Layered work with dependencies:
**Phase 1 — Foundation** (do yourself or single task): define interfaces, create scaffolds, establish API shape. Never fan out until contract known.
**Phase 2 — Parallel implementation**: fan out tasks consuming same known interface. Include Phase 1 API contract in `context`.
**Phase 3 — Integration** (do yourself): wire modules, fix mismatches, verify builds.
**Phase 4 — Dependent layer**: fan out tasks consuming Phase 2 outputs.
---

## Pre-flight checklist

Before calling tool, verify:
- [ ] `context` includes shared constraints, references, definition of done
- [ ] Each `assignment` follows assignment template — not one-liner
- [ ] Each `assignment` includes edge cases / "don’t break" items
- [ ] Tasks truly parallel (no hidden dependencies)
- [ ] Scope small, file paths explicit (no globs)
- [ ] No task runs project-wide build/test/lint — you do after all tasks complete
- [ ] `schema` used if you expect information
---

## Agents

{{#list agents join="\n"}}
<agent name="{{name}}"{{#if output}} output="structured"{{/if}}>
<description>{{description}}</description>
<tools>{{default (join tools ", ") "All tools"}}</tools>
</agent>
{{/list}}