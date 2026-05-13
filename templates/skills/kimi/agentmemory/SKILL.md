---
name: agentmemory
description: Persistent memory, recall, session replay, and memory-governance workflow adapted from rohitg00/agentmemory for OMK. Use when setting up agent memory, deciding what to remember, importing/replaying sessions, reducing repeated context, or auditing memory safety.
---

# agentmemory

Source basis: rohitg00/agentmemory at commit 25dddc43798c09f8e1dc5179eb48e434a5c89ab2. This OMK skill is a compact adaptation, not a vendored copy of upstream prompts or code.

## Use when

- A task depends on prior decisions, run history, project facts, or repeated architecture context.
- You need to design or review MCP/hook-based persistent memory for coding agents.
- You need replayable evidence for prompts, tool calls, diffs, checks, or completion gates.
- You are deciding what is safe to store in project memory.

## OMK workflow

1. Inventory memory surfaces: `.omk/memory`, `.omk/runs`, `.kimi/skills`, `.agents/skills`, MCP config, and available graph-memory tools.
2. Classify candidate memories as project fact, decision, command, risk, user preference, or run-scoped note.
3. Store only stable, useful, non-secret facts. Include confidence, scope, source, and expiry/refresh trigger when the fact may drift.
4. Prefer OMK project graph memory when available. Treat external memory servers as optional integrations that must pass local health checks before use.
5. For replay/evidence tasks, preserve raw prompt, generated diff, verification JSON/logs, screenshots, and known limitations in one artifact bundle.
6. Before finalizing, verify memory updates did not include credentials, private data, or unvalidated claims.

## Output contract

Return:

- memory sources consulted
- memories added or skipped
- verification artifacts
- replay/proof paths
- limitations and refresh triggers

## Guardrails

- Never write secrets, tokens, private keys, cookies, or raw `.env` values into memory.
- Do not let memory override current source files, official docs, or live command results.
- Do not install or start external memory services unless the user asked for that operational change.
