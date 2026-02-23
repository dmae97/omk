# Task

Launches subagents to parallelize workflows.

{{#if asyncEnabled}}
- Use `read jobs://` to inspect state; `read jobs://<job_id>` for detail.
- Wait with `poll_jobs` — blocks until complete. MUST NOT poll `read jobs://` in a loop.
{{/if}}

Subagents lack your conversation history. Every decision, file content, and user requirement they need MUST be explicit in `context` or `assignment`.

<parameters>
- `agent`: Agent type for all tasks.
  - `.id`: CamelCase, max 32 chars
  - `.description`: UI display only — subagent never sees it
  - `.assignment`: Complete self-contained instructions. One-liners PROHIBITED; missing acceptance criteria = too vague.
  - `.skills`: Skill names to preload
- `context`: Shared background prepended to every assignment. Session-specific info only.
- `schema`: JTD schema for expected output. Format lives here — MUST NOT be duplicated in assignments.
- `tasks`: Tasks to execute in parallel.
- `isolated`: Run in isolated git worktree; returns patches. Use when tasks edit overlapping files.
</parameters>

<critical>
- MUST NOT include AGENTS.md rules, coding conventions, or style guidelines — subagents already have them.
- MUST NOT duplicate shared constraints across assignments — put them in `context` once.
- MUST NOT tell tasks to run project-wide build/test/lint. Parallel agents share the working tree; each task edits, stops. Caller verifies after all complete.
- For large payloads (traces, JSON blobs), write to `local://<path>` and pass the path in context.
- If scope is unclear, run a **Discovery task** first to enumerate files and callsites, then fan out.
</critical>

<scope>
Each task: **at most 3–5 files**. Globs in file paths, "update all", or package-wide scope = too broad. Enumerate files explicitly and fan out to a cluster of agents.
</scope>

<parallelization>
**Test:** Can task B produce correct output without seeing A's result? Yes → parallel. No → sequential.

|Sequential first|Then|Reason|
|---|---|---|
|Types/interfaces|Consumers|Need contract|
|API exports|Callers|Need signatures|
|Core module|Dependents|Import dependency|
|Schema/migration|App logic|Schema dependency|
**Safe to parallelize:** independent modules, isolated file-scoped refactors, tests for existing code.
</parallelization>

<templates>
**context:**
```
## Goal         ← one sentence: what the batch accomplishes
## Non-goals    ← what tasks must not touch
## Constraints  ← MUST/MUST NOT rules beyond AGENTS.md; session decisions
## API Contract ← exact types/signatures if tasks share an interface (omit if N/A)
## Acceptance   ← definition of done; build/lint runs AFTER all tasks complete
```
**assignment:**
```
## Target       ← exact file paths; named symbols; explicit non-goals
## Change       ← step-by-step what to add/remove/rename; patterns/APIs to use
## Edge Cases   ← tricky inputs; existing behavior that must survive
## Acceptance   ← observable result proving the task is done; no project-wide commands
```
</templates>

<checklist>
Before invoking:
- `context` contains only session-specific info not in AGENTS.md
- Every `assignment` follows the template; no one-liners; edge cases covered
- Tasks are truly parallel — you can articulate why none depends on another's output
- File paths are explicit; no globs
- `schema` is set if you expect structured output
</checklist>

<example label="Rename exported symbol + update all call sites">
Two tasks with non-overlapping file sets. Neither depends on the other's edits.

<context>
## Goal
Rename `parseConfig` → `loadConfig` in `src/config/parser.ts` and all callers.
## Non-goals
Do not change function behavior, signature, or tests — rename only.
## Acceptance (global)
Caller runs `bun check:ts` after both tasks complete. Tasks must NOT run it.
</context>
<tasks>
  <task name="RenameExport">
    <description>Rename the export in parser.ts</description>
    <assignment>
## Target
- File: `src/config/parser.ts`
- Symbol: exported function `parseConfig`
- Non-goals: do not touch callers or tests

## Change
- Rename `parseConfig` → `loadConfig` (declaration + any JSDoc referencing it)
- If `src/config/index.ts` re-exports `parseConfig`, update that re-export too

## Edge Cases
- If the function is overloaded, rename all overload signatures
- Internal helpers named `_parseConfigValue` or similar: leave untouched — different symbols
- Do not add a backwards-compat alias

## Acceptance
- `src/config/parser.ts` exports `loadConfig`; `parseConfig` no longer appears as a top-level export in that file
    </assignment>
  </task>
  <task name="UpdateCallers">
    <description>Update import and call sites in consuming modules</description>
    <assignment>
## Target
- Files: `src/cli/init.ts`, `src/server/bootstrap.ts`, `src/worker/index.ts`
- Non-goals: do not touch `src/config/parser.ts` or `src/config/index.ts` — handled by sibling task

## Change
- In each file: replace `import { parseConfig }` → `import { loadConfig }` from its config path
- Replace every call site `parseConfig(` → `loadConfig(`

## Edge Cases
- If a file spreads the import (`import * as cfg from "…"`) and calls `cfg.parseConfig(…)`, update the property access too
- String literals containing "parseConfig" (log messages, comments) are documentation — leave them
- If any file re-exports `parseConfig` to an external package boundary, keep the old name via `export { loadConfig as parseConfig }` and add a `// TODO: remove after next major` comment

## Acceptance
- No bare reference to `parseConfig` (as identifier, not string) remains in the three target files
    </assignment>
  </task>
</tasks>
</example>

{{#list agents join="\n"}}
### Agent: {{name}}
**Tools:** {{default (join tools ", ") "All"}}
{{description}}
{{/list}}