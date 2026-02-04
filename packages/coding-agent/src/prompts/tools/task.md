# Task

Launch agents to handle complex, multi-step tasks autonomously.

<critical>
## Context is everything

Subagents fail with vague context. Every task needs:
1. **Goal** - What this accomplishes (one sentence)
2. **Constraints** - Hard requirements, banned approaches, naming conventions
3. **Existing Code** - File paths and function signatures to use as patterns
4. **API Contract** - If the task produces or consumes an interface, spell it out

Subagents CAN grep parent conversation file for supplementary details, but CANNOT grep for:
- Decisions you made but didn't write down
- Conventions that exist only in your head
- Which of 50 possible approaches you want
  **Rule of thumb:** If you'd answer clarifying question for junior dev, info belongs in context.
</critical>

<context-structure>
## Required context structure

Use this template. Omit sections only if N/A.

````
## Goal
[One sentence: what this task accomplishes]

## Constraints
- [Hard requirements - MUST/MUST NOT style]
- [API conventions, naming patterns, error handling]
- [What already exists vs what to create]

## Existing Code
Reference files the agent MUST read/use as patterns:
- `path/to/file.ts` - [what pattern it demonstrates]
- `path/to/other.rs` - [what to reuse from it]

## API Contract (if applicable)
```language
// Exact signatures the agent must implement or consume
fn example(input: Type) -> Result<Output>
```

## Task
{{description}}

## Files
{{files}}
````

### Bad context (agent fails or guesses wrong)

```
N-API migration. Keep highlight sync. Use JsString. No WASM.
Task: {{description}} Files: {{files}}
```

### Good context (agent can act confidently)

````
## Goal
Port grep module from WASM to N-API, matching existing text module patterns.

## Constraints
- Use `#[napi]` attribute macro on all exports (not `#[napi(js_name = "...")]`)
- Return `napi::Result<T>` for fallible ops; never panic
- Use `spawn_blocking` for filesystem ops or >1ms work
- Accept `JsString` for string params (NOT JsStringUtf8; lifetime issues)
- Keep all existing function names - TS bindings depend on them
- No new crate dependencies

## Existing Code
- `crates/pi-natives/src/text.rs` - reference N-API pattern: see how `visible_width` uses JsString
- `crates/pi-natives/src/lib.rs` - module registration pattern
- `crates/pi-natives/Cargo.toml` - available dependencies (ignore, regex already present)

## API Contract
Current sync API to convert to async:
```rust
// BEFORE (sync, blocks event loop)
#[napi]
pub fn search(pattern: String, path: String) -> Vec<Match>

// AFTER (async, uses spawn_blocking)
#[napi]
pub async fn search(pattern: JsString, path: JsString, env: Env) -> napi::Result<Vec<Match>>
```

## Task
{{description}}

## Files
{{files}}
````
</context-structure>

<parallelization>
## When to parallelize vs sequence
**Test:** Can agent B write correct code without seeing A's output?
- If YES → parallelize
- If NO → sequence (A completes, then B runs with A's output in context)

### Dependencies that MUST be sequential

|First|Then|Why|
|---|---|---|
|Create Rust API|Update TS bindings|Bindings need export names and signatures|
|Define interface/types|Implement consumers|Consumers need contract|
|Scaffold with signatures|Implement bodies|Implementations need shape|
|Core module|Dependent modules|Dependents import from core|

### Safe to parallelize
- Independent modules not importing each other
- Tests for already-implemented code
- Documentation for stable APIs
- Refactors in isolated file scopes

### Phased execution pattern

For layered migrations/refactors:
**Phase 1 - Foundation (do yourself or single task):**
Create scaffold, define interfaces, establish API shape. Never fan out until contract known.
**Phase 2 - Parallel implementation:**
Fan out to independent tasks consuming same known interface. Include Phase 1 API contract in every task's context.
**Phase 3 - Integration (do yourself):**
Wire things together, update build/CI, fix mismatches.
**Phase 4 - Dependent layer:**
Fan out again for work consuming Phase 2 outputs.

### Example: WASM to N-API migration
**WRONG** (launched together, will fail):

```
tasks: [
  { id: "RustApi", description: "Implement N-API exports" },
  { id: "TsBindings", description: "Update TS to use N-API" },  // ← needs RustApi output!
]
```
**RIGHT** (phased):

```
// Phase 1: You create scaffold with signatures in lib.rs

// Phase 2: Fan out Rust implementation
tasks: [
  { id: "Grep", description: "Implement grep module", args: { files: "src/grep.rs" } },
  { id: "Text", description: "Implement text module", args: { files: "src/text.rs" } },
  // Each task gets the API contract you defined in Phase 1
]

// Phase 3: You verify Rust compiles, exports are correct

// Phase 4: Fan out TS bindings (now they know what Rust exports)
tasks: [
  { id: "GrepBindings", description: "Update grep TS", args: { files: "src/grep/index.ts" } },
  // Context includes actual export names from Phase 2
]
```
</parallelization>

<parameters>
- `agent`: Agent type for all tasks
- `context`: Template with `{{placeholders}}`; **Must follow structure above**.
- `isolated`: (optional) Run in git worktree, return patches
- `tasks`: Array of `{id, description, args}`
  - `id`: CamelCase identifier (max 32 chars)
  - `description`: What task does (for logging)
  - `args`: Object with keys matching `{{placeholders}}` in context
  - `skills`: (optional) Skill names to preload
- `schema`: JTD schema for response structure (**required**; use typed properties, not `{ "type": "string" }`). **Schema goes in `schema`; never describe output format in `context`.**
</parameters>

<agents>
{{#list agents join="\n"}}
<agent name="{{name}}"{{#if output}} output="structured"{{/if}}>
<description>{{description}}</description>
<tools>{{default (join tools ", ") "All tools"}}</tools>
</agent>
{{/list}}
</agents>

<critical>
## Task granularity

Each task MUST target a small, well-defined scope. A single task should touch at most 3-5 files.
**Red flags that a task is too broad:**
- File list uses globs (`src/**/*.ts`) instead of explicit paths
- Description says "update all" / "migrate all" / "refactor all"
- Task covers an entire package or directory tree
- Estimated touch surface is >5 files
**Fix:** Split into one task per file (or small group of related files). Fan out in parallel.

### Bad (will timeout or produce garbage)
```
tasks: [
  { id: "UpdateAll", description: "Update all constructor calls in src/**/*.ts" }
]
```

### Good (focused, parallel)
```
tasks: [
  { id: "UpdateDebug", description: "Update constructors in debug/index.ts", args: { files: "src/debug/index.ts" } },
  { id: "UpdateAgent", description: "Update constructors in commit/agent.ts", args: { files: "src/commit/agentic/agent.ts" } },
  { id: "UpdateTodoExample", description: "Update constructors in examples/todo", args: { files: "examples/custom-tools/todo/index.ts" } },
]
```

When the set of files isn't known upfront, grep/glob yourself first to enumerate them, then fan out one task per file.
</critical>
