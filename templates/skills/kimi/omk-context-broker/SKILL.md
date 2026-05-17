---
name: omk-context-broker
description: Context and memory policy for long-running Kimi coding sessions, DAG workers, and repeated project work.
---

## Context Broker Policy

Use this skill when a task spans many files, many turns, multiple workers, or a long session.

## Local Graph Memory

Project-local ontology graph memory is the default source of truth for project/session memory. Use `omk_read_memory`, `omk_write_memory`, `omk_memory_mindmap`, `omk_graph_query`, `omk_read_run_memory`, and `omk_write_run_memory` when the omk-project MCP exposes them. `.omk/memory/` is a local mirror/cache for reviewability.

## Okabe / D-Mail Checkpoints

Use Kimi Code Okabe + `SendDMail` for smart context recovery:

- send a D-Mail before destructive/risky refactors, multi-agent handoffs, or `/compact`;
- include the current goal, branch/changed files, tests run, blockers, and intended next action;
- keep D-Mail concise and pair it with project-local graph memory for durable project/session recall.

## Memory Files

Use:

- `.omk/memory/project.md`
- `.omk/memory/decisions.md`
- `.omk/memory/commands.md`
- `.omk/memory/risks.md`
- `.omk/runs/<run-id>/events.jsonl`
- `.omk/runs/<run-id>/plan.md`
- `.omk/runs/<run-id>/final-report.md`

## Rules

- Store stable project facts in project-local graph project memory.
- Store temporary run/session facts in project-local graph run memory.
- Store decisions with reason, date, and affected files.
- Do not store secrets.
- Before compacting, summarize active state:
  - current goal
  - completed tasks
  - pending tasks
  - changed files
  - failing commands
  - blockers

## Decision Record Format

```txt
Date:
Decision:
Reason:
Alternatives:
Affected files:
Risk:
```
