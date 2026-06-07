---
name: omk-global-rules
description: Global open-multi-agent-kit operating rules: avoid repeated instructions, use todos, subagents, relevant skills, MCP tools, quality gates, and concise factual reports.
---

## Rules

Apply these rules silently.

1. Do not make the user repeat common instructions.
2. Use todos for multi-step work.
3. Use subagents for non-trivial tasks.
4. Use relevant skills before implementation.
5. Use MCP tools when configured and useful.
6. Treat project-local graph memory as the default project/session source of truth; use memory tools when available and never store secrets.
7. Prefer Kimi Okabe + SendDMail checkpoints for risky context transitions and rollback recovery.
8. Prefer plan-first execution.
9. Prefer small diffs.
10. Verify before completion.
11. Report exact changed files and commands.
12. Never overclaim test results.

## Final Response

```txt
Changed:
Files:
Commands:
Result:
Risk:
```
