---
name: omk-kimi-runtime
description: Kimi K2.6 runtime policy for thinking mode, no-thinking research mode, tool use, context budget, and long-horizon coding tasks.
---

## Runtime Policy

Use this skill when running OMK workflows on Kimi K2.6.

## Mode Selection

- Use thinking mode for architecture, coding, debugging, review, planning, and multi-step tool work.
- Use no-thinking mode for fast summarization, commit messages, simple classification, and web-search-heavy research.
- Do not expose temperature/top_p tuning as user-facing options.
- Prefer structured task execution over one-shot answers.

## Tool Use

- Keep tool calls scoped to the current task.
- Before writing files, inspect nearby code and project conventions.
- For web-heavy work, use a no-thinking research profile when available.
- For multimodal UI/debug work, inspect screenshots, traces, or video before proposing code.

## Okabe + D-Mail

- Generated OMK agents should inherit the Okabe-compatible base, not plain `default`, so `SendDMail` is available while custom `--agent-file` configs remain supported.
- Use `SendDMail` for checkpoint rollback scenarios: risky refactors, dependency migrations, context compaction, or long-running work where a future recovery note prevents lost state.
- Treat D-Mail as context insurance, not a substitute for tests, git diff review, or project-local graph durable memory.

## Context Policy

- Never load the whole repository just because Kimi supports long context.
- First build a file map.
- Then read only relevant files.
- Store stable facts through project-local graph memory; `.omk/memory/` is only a local mirror/cache.
- Use Okabe/D-Mail checkpoints before risky context transitions.
- Compact or summarize before context pressure becomes high.

## Completion Rule

A task is not complete until the required quality gates pass:
1. lint
2. typecheck
3. tests
4. build, if available
5. diff review
