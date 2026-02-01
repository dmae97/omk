# Task

Launch agents to handle complex, multi-step tasks autonomously.

<critical>
## Context is everything

Subagents fail when context is vague. They cannot read your mind or infer project conventions. Every task needs:
1. **Goal** - What this accomplishes (one sentence)
2. **Constraints** - Hard requirements, banned approaches, naming conventions
3. **Existing Code** - File paths and function signatures to use as patterns
4. **API Contract** - If the task produces or consumes an interface, spell it out

Subagents CAN grep the parent conversation file for supplementary details. They CANNOT grep for:
- Decisions you made but didn't write down
- Conventions that exist only in your head
- Which of 50 possible approaches you want
  **Rule of thumb:** If you'd need to answer a clarifying question for a junior dev to do this task, that information belongs in context.
</critical>

<context-structure>
## Required context structure

Use this template. Sections can be omitted only if truly N/A.

````
## Goal
[One sentence: what this task accomplishes]

## Constraints
- [Hard requirements - MUST/MUST NOT style]
- [API conventions, naming patterns, error handling]
- [What already exists vs what to create]

## Existing Code
Reference files the agent MUST read or use as patterns:
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

### Bad context (agent will fail or guess wrong)

```
N-API migration. Keep highlight sync. Use JsString. No WASM.
Task: {{description}} Files: {{files}}
```

Why it fails:
- No existing code to reference - agent doesn't know your patterns
- No API contract - agent will invent signatures that don't match consumers
- No goal - agent doesn't know what success looks like
- "Keep highlight sync" is meaningless without knowing what highlight is or where it lives

### Good context (agent can act confidently)

````
## Goal
Port grep module from WASM to N-API, matching existing text module patterns.

## Constraints
- Use `#[napi]` attribute macro on all exports (not `#[napi(js_name = "...")]`)
- Return `napi::Result<T>` for fallible ops, never panic
- Use `spawn_blocking` for any operation that touches filesystem or runs >1ms
- Accept `JsString` for string params (NOT JsStringUtf8 - it has lifetime issues)
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
**The test:** Can agent B write correct code without seeing agent A's output?
- If YES → parallelize
- If NO → sequence (A completes, then B runs with A's output in context)

### Dependency patterns that MUST be sequential

|First|Then|Why|
|---|---|---|
|Create Rust API|Update TS bindings|Bindings need to know export names and signatures|
|Define interface/types|Implement consumers|Consumers need the contract|
|Scaffold with signatures|Implement bodies|Implementations need the shape|
|Core module|Dependent modules|Dependents import from core|

### Safe to parallelize
- Independent modules that don't import each other
- Tests for already-implemented code
- Documentation for stable APIs
- Refactors in isolated file scopes

### Phased execution pattern

For migrations/refactors with layers:
**Phase 1 - Foundation (do yourself or single task):**
Create the scaffold, define interfaces, establish API shape. Never fan out until the contract is known.
**Phase 2 - Parallel implementation:**
Fan out to independent tasks that all consume the same known interface. Include the API contract from Phase 1 in every task's context.
**Phase 3 - Integration (do yourself):**
Wire things together, update build/CI, fix any mismatches.
**Phase 4 - Dependent layer:**
Fan out again for work that consumes Phase 2 outputs.

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
- `context`: Template with `{{placeholders}}`. **Must follow the structure above.** Include Goal, Constraints, Existing Code references. Subagents can search parent context for background, but core requirements must be explicit here.
- `isolated`: (optional) Run in git worktree, return patches
- `tasks`: Array of `{id, description, args}`
  - `id`: CamelCase identifier (max 32 chars)
  - `description`: What the task does (for logging)
  - `args`: Object with keys matching `{{placeholders}}` in context
  - `skills`: (optional) Skill names to preload
- `schema`: JTD schema for response structure. **Required.** Use typed properties, not `{ "type": "string" }`.
**Schema goes in `schema` parameter. Never describe output format in `context`.**
</parameters>

<agents>
{{#list agents join="\n"}}
<agent name="{{name}}"{{#if output}} output="structured"{{/if}}>
<description>{{description}}</description>
<tools>{{default (join tools ", ") "All tools"}}</tools>
</agent>
{{/list}}
</agents>

<avoid>
- Terse context that requires agents to guess conventions
- Launching dependent tasks in parallel (bindings + API, consumer + producer)
- Missing "Existing Code" references - agents need patterns to follow
- Assuming agents know your codebase - they start fresh each time
- Describing output format in context instead of schema
- Single tasks doing too much - prefer focused, file-scoped tasks
</avoid>
````