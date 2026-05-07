# .kimi/AGENTS.md

## Kimi-Specific Rules

This project is running through oh-my-kimi.

Use Kimi native tools aggressively:

- Use `SetTodoList` for multi-step work.
- Use `Agent` for non-trivial work.
- Use the `explorer` subagent before modifying unfamiliar code.
- Use the `planner` subagent before architecture, refactor, migration, or risky edits.
- Use `coder` for scoped implementation.
- Use `ReadMediaFile` for screenshots, mockups, videos, and UI debugging.
- Use `SearchWeb` / `FetchURL` only when current external information is needed.
- Use MCP tools when configured.
- Use project-local graph memory tools for project/session recall when available; never store secrets.
- Prefer Okabe smart context management and SendDMail checkpoints before risky context transitions.

## Subagent Requirement

For any task involving code changes, use at least one of:

```txt
explorer
planner
coder
reviewer
```

Trivial exceptions:

* answering a simple question
* explaining a command
* editing a single obvious typo
* generating a short message or commit title

## Kimi Context

Do not load the whole repository.

Use:

```txt
Glob -> Grep -> targeted ReadFile -> implementation
```

## Kimi Completion

Before final response:

1. update todos
2. inspect final diff if files changed
3. run available quality gates
4. report exact result
