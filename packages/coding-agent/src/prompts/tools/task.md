# Task

Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools available to it.

<critical>
This matters. Get it right.

Subagents can access parent conversation context via a file—they can grep or tail it for details you don't include. Don't repeat information unnecessarily; focus `context` on:
- Task-specific constraints and decisions
- Critical requirements that must not be missed
- Information not easily found in the codebase

Use a single Task call with multiple `tasks` entries when parallelizing. Multiple concurrent Task calls bypass coordination.

For code changes, have subagents write files directly with Edit/Write. Do not ask them to return patches for you to apply.

Agents with `output="structured"` enforce their own schema; the `schema` parameter is ignored for those agents.
**Never describe expected output in `context` or task descriptions.** All response format requirements go in the `schema` parameter. Use structured schemas with typed properties—not `{ "type": "string" }`. Prose like "respond as a bullet list" is prohibited.
</critical>

<instruction id="phased-execution">
## Phased execution for migrations and refactors

When work has layers where one layer must exist before the next can be built:

1. **Foundation phase** — Create scaffolding, define interfaces, establish the API shape. Do this yourself or in a single task. Never fan out until the contract is known.
2. **Parallel implementation** — Fan out to independent tasks that all consume the same known interface.
3. **Integration phase** — Wire things together, update build/CI. Do this yourself.
4. **Dependent layer** — Fan out again for work that consumes the previous layer.

**Wrong:** Launch "create Rust API" + "update JS bindings to use Rust API" + "update CI for Rust" in parallel. JS bindings need to know the API. CI needs to know what's being built.

**Right:** 
1. Create Rust API scaffold yourself (or single task)
2. Fan out: one task per module to implement against the scaffold
3. Update CI yourself
4. Fan out: one task per JS binding now that Rust exports are known

The test: Can subagent B write correct code without seeing A's output? If no, they are sequential.
</instruction>

<agents>
{{#list agents join="\n"}}
<agent name="{{name}}"{{#if output}} output="structured"{{/if}}>
<description>{{description}}</description>
<tools>{{default (join tools ", ") "All tools"}}</tools>
</agent>
{{/list}}
</agents>

<instruction>
This matters. Be thorough.
1. Plan before acting. Define the goal, acceptance criteria, and scope per task.
2. Put shared constraints and decisions in `context`; keep each task request short and unambiguous. **Do not describe response format here.**
3. State whether each task is research-only or should modify files.
4. **Always provide a `schema`** with typed properties. Avoid `{ "type": "string" }`—if data has any structure (list, fields, categories), model it. Plain text is almost never the right choice.
5. Assign distinct file scopes per task to avoid conflicts.
6. Trust the returned data, then verify with tools when correctness matters.
7. For critical constraints, be explicit in `context`. For general background, subagents can search the parent context file themselves.
</instruction>

<parameters>
- `agent`: Agent type to use for all tasks
- `context`: Template with `\{{placeholders}}` for multi-task. Include critical constraints and task-specific decisions. Subagents have access to parent conversation context via a searchable file, so don't repeat everything—focus on what matters. `\{{id}}` and `\{{description}}` are always available.
- `isolated`: (optional) Run each task in its own git worktree and return patches; patches are applied only if all apply cleanly.
- `tasks`: Array of `{id, description, args}` - tasks to run in parallel
		- `id`: Short CamelCase identifier (max 32 chars, e.g., "SessionStore", "LspRefactor")
		- `description`: Short human-readable description of what the task does
		- `args`: Object with keys matching `\{{placeholders}}` in context (always include this, even if empty)
		- `skills`: (optional) Array of skill names to preload into this task's system prompt. When set, the skills index section is omitted and the full SKILL.md contents are embedded.
- `schema`: JTD schema defining expected response structure. **Required.** Use objects with typed properties—e.g., `{ "properties": { "items": { "elements": { "type": "string" } } } }` for lists.
</parameters>

<output>
Returns task results for each spawned agent:
- Truncated preview of agent output (use `read agent://<id>` for full content if truncated)
- Summary with line/character counts
- For agents with `schema`: structured JSON accessible via `agent://<id>?q=<query>` or `agent://<id>/<path>`

Results are keyed by task `id` (e.g., "AuthProvider", "AuthApi").
</output>

<example>
user: "Looks good, execute the plan"
assistant: I'll execute the refactoring plan.
assistant: Uses the Task tool:
{
  "agent": "task",
  "context": "Refactoring the auth module into separate concerns.\n\nPlan:\n1. AuthProvider - Extract React context and provider from src/auth/index.tsx\n2. AuthApi - Extract API calls to src/auth/api.ts, use existing fetchJson helper\n3. AuthTypes - Move types to types.ts, re-export from index\n\nConstraints:\n- Preserve all existing exports from src/auth/index.tsx\n- Use project's fetchJson (src/utils/http.ts), don't use raw fetch\n- No new dependencies\n\nTask: \{{step}}\n\nFiles: \{{files}}",
  "schema": {
    "properties": {
      "summary": { "type": "string" },
      "decisions": { "elements": { "type": "string" } },
      "concerns": { "elements": { "type": "string" } }
    }
  },
  "tasks": [
    { "id": "AuthProvider", "description": "Extract React context", "args": { "step": "Execute step 1: Extract AuthProvider and AuthContext", "files": "src/auth/index.tsx" } },
    { "id": "AuthApi", "description": "Extract API layer", "args": { "step": "Execute step 2: Extract API calls to api.ts", "files": "src/auth/api.ts" } },
    { "id": "AuthTypes", "description": "Extract types", "args": { "step": "Execute step 3: Move types to types.ts", "files": "src/auth/types.ts" } }
  ]
}
</example>

<example name="phased-migration">
user: "Port the natives package from WASM to N-API"
assistant: This requires phased execution—JS bindings depend on knowing the Rust API.

Phase 1: I'll create the N-API scaffold myself to establish the API shape.
assistant: [Uses Edit tool to create Cargo.toml with napi-rs, writes lib.rs with module structure and exported function signatures]

Phase 2: Now that the API contract is defined, I'll fan out to implement each module.
assistant: Uses the Task tool:
{
  "agent": "task",
  "context": "Implementing N-API native module. Scaffold exists at crates/pi-natives with napi-rs setup.\n\nAPI contract (from lib.rs):\n- grep: async fn search(pattern: &str, path: &str, opts: SearchOptions) -> Vec<Match>\n- text: fn visible_width(s: &str) -> usize, fn truncate(s: &str, width: usize) -> String\n- html: fn to_markdown(html: &str) -> String\n- image: fn resize(data: &[u8], width: u32, height: u32) -> Vec<u8>\n\nTask: Implement {{module}} module. File: crates/pi-natives/src/{{module}}.rs",
  "schema": { "properties": { "exports": { "elements": { "type": "string" } }, "notes": { "type": "string" } } },
  "tasks": [
    { "id": "Grep", "description": "Implement parallel grep with ignore crate", "args": { "module": "grep" } },
    { "id": "Text", "description": "Implement text width/truncate", "args": { "module": "text" } },
    { "id": "Html", "description": "Implement HTML to markdown", "args": { "module": "html" } },
    { "id": "Image", "description": "Implement image resize", "args": { "module": "image" } }
  ]
}

Phase 3: Rust implementation complete. I'll update CI for native builds myself.
assistant: [Uses Edit tool to update .github/workflows/ci.yml with cross-platform native build matrix]

Phase 4: Now I'll fan out to update JS bindings—the Rust exports are known.
assistant: Uses the Task tool:
{
  "agent": "task", 
  "context": "Update JS bindings to load N-API addon instead of WASM workers.\n\nRust exports (from Phase 2):\n{{exports}}\n\nTask: Update packages/natives/src/{{module}}/index.ts to use native addon. Remove worker.ts usage.",
  ...
}
</example>

<avoid>
- Describing response format in `context` (e.g., "respond as JSON", "return a bullet list")—use `schema` parameter instead
- Confirmation bias: ask for factual discovery instead of yes/no exploration prompts
- Reading a specific file path → Use Read tool instead
- Finding files by pattern/name → Use Find tool instead
- Searching for a specific class/function definition → Use Grep tool instead
- Searching code within 2-3 specific files → Use Read tool instead
- Tasks unrelated to the agent descriptions above
</avoid>