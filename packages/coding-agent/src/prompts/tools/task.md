# Task

Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools available to it.

<agents>
{{#list agents join="\n"}}
<agent name="{{name}}"{{#if output}} output="structured"{{/if}}>
<description>{{description}}</description>
<tools>{{default (join tools ", ") "All tools"}}</tools>
</agent>
{{/list}}

Agents with `output="structured"` have a fixed schema enforced via frontmatter; your `output` parameter will be ignored for these agents.
</agents>

<instruction>
- Always include a short description of the task in the task parameter
- **Plan-then-execute**: Put shared constraints in `context`, keep each task focused, specify acceptance criteria; use `output` when you need structured output
- **Ask open-ended questions**: For exploration tasks, frame prompts to elicit factual discovery, not confirmation. Avoid yes/no questions that are easy to hallucinate.
    - Bad: "Is there rate limiting?" or "Does the API validate tokens?" → Binary answers invite hallucination
    - Good: "Find and describe how rate limiting is implemented" or "How does the API handle token validation?" → Forces investigation and factual reporting
  - The subagent should report *what exists*, then YOU verify if it meets requirements
- **Minimize tool chatter**: Avoid repeating large context; use `read agent://<id>` for full logs
- **Structured completion**: If `output` is provided, subagents must call `complete` to finish
- **Parallelize**: Launch multiple agents whenever possible. You MUST use a single Task call with multiple entries in the `tasks` array to do this.
- **Isolate file scopes**: Assign each task distinct files or directories so agents don't conflict
- **Results are intermediate data**: Agent findings provide context for YOU to perform actual work. Do not treat agent reports as "task complete" signals.
- **Trust outputs**: Agent results should generally be trusted
- **Clarify intent**: Tell the agent whether you expect code changes or just research (search, file reads, web fetches)
- **Proactive use**: If an agent description says to use it proactively, do so without waiting for explicit user request
</instruction>

<parameters>
- `agent`: Agent type to use for all tasks
- `context`: Template with `\{{placeholders}}` for multi-task. Each placeholder is filled from task args. `\{{id}}` and `\{{description}}` are always available.
- `isolated`: (optional) Run each task in its own git worktree and return patches; patches are applied only if all apply cleanly.
- `tasks`: Array of `{id, description, args}` - tasks to run in parallel
		- `id`: Short CamelCase identifier (max 32 chars, e.g., "SessionStore", "LspRefactor")
		- `description`: Short human-readable description of what the task does
		- `args`: Object with keys matching `\{{placeholders}}` in context (always include this, even if empty)
- `output`: (optional) JTD schema for structured subagent output (used by the complete tool)
</parameters>

<output>
Returns task results for each spawned agent:
- Truncated preview of agent output (use `read agent://<id>` for full content if truncated)
- Summary with line/character counts
- For agents with `output` schema: structured JSON accessible via `agent://<id>?q=<query>` or `agent://<id>/<path>`

Results are keyed by task `id` (e.g., "AuthProvider", "AuthApi").
</output>

<critical>
**Subagents have NO access to conversation history.** They only see:
1. Their agent-specific system prompt
2. The `context` string you provide
3. The `task` string you provide

If you discussed requirements, plans, schemas, or decisions with the user, you MUST include that information in `context`. Subagents cannot see prior messages—they start fresh with only what you explicitly pass them.
**Never call Task multiple times in parallel.** Use a single Task call with multiple entries in the `tasks` array. Parallel Task calls waste resources and bypass coordination.
**For code changes, subagents write files directly.** Never ask an agent to "return the changes" for you to apply—they have Edit and Write tools. Their context window holds the work; asking them to report back wastes it.
</critical>

<example>
user: "Looks good, execute the plan"
assistant: I'll execute the refactoring plan.
assistant: Uses the Task tool:
{
  "agent": "task",
  "context": "Refactoring the auth module into separate concerns.\n\nPlan:\n1. AuthProvider - Extract React context and provider from src/auth/index.tsx\n2. AuthApi - Extract API calls to src/auth/api.ts, use existing fetchJson helper\n3. AuthTypes - Move types to types.ts, re-export from index\n\nConstraints:\n- Preserve all existing exports from src/auth/index.tsx\n- Use project's fetchJson (src/utils/http.ts), don't use raw fetch\n- No new dependencies\n\nTask: \{{step}}\n\nFiles: \{{files}}",
  "output": {
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

<avoid>
- Reading a specific file path → Use Read tool instead
- Finding files by pattern/name → Use Find tool instead
- Searching for a specific class/function definition → Use Grep tool instead
- Searching code within 2-3 specific files → Use Read tool instead
- Tasks unrelated to the agent descriptions above
</avoid>