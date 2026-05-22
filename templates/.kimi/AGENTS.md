# .kimi/AGENTS.md

## Kimi-Specific Rules

This project is running through oh-my-kimi.

Use Kimi native tools aggressively:

- Use `SetTodoList` for multi-step work.
- Use `Agent` for non-trivial work.
- Use the `explorer` subagent before modifying unfamiliar code.
- Use the `planner` subagent before architecture, refactor, migration, or risky edits.
- Use `coder` for scoped implementation.
- Use `reviewer` or `qa` before completion when code, docs, or release evidence changed.
- Use `ReadMediaFile` for screenshots, mockups, videos, and UI debugging.
- Use `SearchWeb` / `FetchURL` only when current external information is needed.
- Use MCP tools when configured.
- Use project-local graph memory tools for project/session recall when available; never store secrets.
- Prefer Okabe smart context management and SendDMail checkpoints before risky context transitions.

## Current Runtime Surface

- Fresh init exposes root aliases `explorer`, `explore`, `planner`, `plan`, `router`, `architect`, `coder`, `reviewer`, `qa`, `tester`, `researcher`, `integrator`, `aggregator`, `interviewer`, `ontology`, and `vision-debugger` from `.omk/agents/root.yaml`.
- These generated role files are scaffolded with MCP, skills, and hooks enabled through the Okabe-compatible base.
- This repo may add local roles such as `coordinator`, `docs`, `merger`, `release`, and `security`; verify `.omk/agents/root.yaml` before invoking them.
- Project skills are loaded from `.kimi/skills` and `.agents/skills`; read only the matching `SKILL.md` files.
- Default runtime preset is `omk-core-verified`; use it as the baseline safe loop for ordinary coding, refactor, and debugging work. Use `omk-ts-product` for TypeScript/React/Next/Nest product work, `omk-worktree-team` for parallel worker lanes in isolated Git worktrees, and `omk-release-guard` for secret/security/release evidence gates with narrowed MCP authority, strong hooks, and no auto-publish authority.
- Packaged external-inspired workflow skills include `agentmemory`, `andrej-karpathy-skills`, `matt-pocock-skills`, `multica`, and `react-doctor`; use them for memory, surgical coding, alignment/TDD, managed-agent teamwork, and React diagnostics respectively.
- Default MCP scope is project-only `omk-project`. All-scope reads user `~/.kimi/mcp.json` and `~/.kimi/skills` at runtime without copying them.

## Harness Contract

When the prompt, contract, or run directory mentions `chat-agent-harness.json`:

1. Read `.omk/runs/<run-id>/chat-agent-harness.json` before assuming available MCP servers, skills, hooks, gates, or worker limits.
2. Treat prompt MCP/skill/hook counts as compact summaries, not full inventory.
3. Follow the harness authority boundaries and gate list.
4. Do not paste full global inventories or secrets into prompts, memory, or final reports.

## Subagent Requirement

For any task involving code changes, use at least one of:

```txt
explorer
planner
coder
reviewer
```

Useful additions when exposed:

```txt
qa
architect
researcher
ontology
vision-debugger
security
tester
docs
release
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

Prefer `chat-agent-harness.json`, `.omk/config.toml`, `.kimi/mcp.json`, `.omk/mcp.json`, `.omk/agents/root.yaml`, and the loaded skills list over guessing runtime state.

## Kimi Completion

Before final response:

1. update todos
2. inspect final diff if files changed
3. run available quality gates
4. report exact result
