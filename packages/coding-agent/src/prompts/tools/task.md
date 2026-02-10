# Task

Launch subagents to execute parallel, well-scoped tasks.

## What subagents inherit automatically
Subagents receive the **full system prompt**, including AGENTS.md, context files, and skills. Do NOT repeat project rules, coding conventions, or style guidelines in `context` — they already have them.

## What subagents do NOT have
Subagents have no access to your conversation history. They don't know:
- Decisions you made but didn't write down
- Which approach you chose among alternatives
- What you learned from reading files during this session
- Requirements the user stated only in conversation

Subagents CAN grep the parent conversation file for supplementary details.
---

## Parameters

### `agent` (required)

Agent type for all tasks in this batch.

### `context` (optional — strongly recommended)

Shared background prepended verbatim to every task `assignment`. Use only for session-specific information subagents lack.

<critical>
Do NOT include project rules, coding conventions, or style guidelines — subagents already have AGENTS.md and context files in their system prompt. Repeating them wastes tokens and inflates context. Restating any rule from AGENTS.md in `context` is a bug — treat it like a lint error.
</critical>
**Before writing each line of context, ask:** "Would this sentence be true for ANY task in this repo, or only for THIS specific batch?" If it applies to any task → it's a project rule → the subagent already has it → delete the line.

WRONG — restating project rules the subagent already has:
```
## Constraints
- Use X import style, not Y (per AGENTS.md)
- Use Z for private fields per AGENTS.md
- Run the formatter after changes
- Follow the logging convention
```
Every line above restates a project convention. The subagent reads AGENTS.md. Delete them all.

RIGHT — only session-specific decisions the subagent cannot infer from project files:
```
## Constraints
- We decided to use approach A over B (session decision)
- The migration target type is `Foo` from `bar` package (looked up this session)
```

Use template; omit non-applicable sections:

````
## Goal
One sentence: batch accomplishes together.

## Non-goals
Explicitly exclude tempting scope — what tasks must not touch/attempt.

## Constraints
- Task-specific MUST / MUST NOT rules not already in AGENTS.md
- Decisions made during this session that affect implementation

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
**Belongs in `context`**: task-specific goal, non-goals, session decisions, reference paths, shared type definitions, API contracts, global acceptance commands — anything 2+ tasks need that isn't already in AGENTS.md.
**Rule of thumb:** if repeat in 2+ tasks, belongs in `context`.
**Does NOT belong in `context`**: project rules already in AGENTS.md/context files, per-task file lists, one-off requirements (go in `assignment`), structured output format (goes in `schema`).

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

<caution>
**Schema vs agent mismatch causes null output.** Agents with `output="structured"` (e.g., `explore`) have a built-in schema. If you also pass `schema`, yours takes precedence — but if you describe output format in `context`/`assignment` instead, the agent's built-in schema wins. The agent gets confused trying to fit your requested format into its schema shape and submits `null`. Either: (1) use `schema` to override the built-in one, (2) use `task` agent which has no built-in schema, or (3) match your instructions to the agent's expected output shape.
</caution>
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
**Redundant context** — wastes tokens repeating what subagents already have:
- Restating AGENTS.md rules (coding style, import conventions, formatting commands, logger usage, etc.)
- Repeating project constraints from context files
- Listing tool/framework preferences already documented in the repo

If a constraint appears in AGENTS.md, it MUST NOT appear in `context`. The subagent has the full system prompt.

If tempted to write above, expand using templates.
**Output format in prose instead of `schema`** — agent returns null:
Structured agents (`explore`, `reviewer`) have built-in output schemas. Describing a different output format in `context`/`assignment` without overriding via `schema` creates a mismatch — the agent can't reconcile your prose instructions with its schema and submits null data. Always use `schema` for output structure, or pick an agent whose built-in schema matches your needs.
**Test/lint commands in parallel tasks** — edit wars:
Parallel agents share working tree. If two agents run `bun check` or `bun test` concurrently, they see each other's half-finished edits, "fix" phantom errors, loop. **Never tell parallel tasks run project-wide build/test/lint commands.** Each task edits, stops. Caller verifies after all tasks complete.
**If you can't specify scope yet**, create **Discovery task** first: enumerate files, find callsites, list candidates. Then fan out with explicit paths.

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
- [ ] `context` includes only session-specific info not already in AGENTS.md/context files
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