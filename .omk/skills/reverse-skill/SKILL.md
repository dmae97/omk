---
name: reverse-skill
description: Use when adapting external reverse-engineering or security workflow packs into OMK, routing APK/binary/JS/browser/API/CTF/report tasks to the right skill, or creating project-local OMK skills from source markdown.
---

# Reverse Skill

Use this skill to route a reverse-engineering/security workflow before choosing tools, or to turn an external playbook into an OMK Agent Skill.

## Core workflow

1. Route first: call `reverse_skill_route` with the user task. Include `targetType`, `intent`, and `toolchain` when known.
2. Read the returned primary skill path before specialized tooling.
3. Use returned MCP and hook hints as the lane grant: usually `filesystem`, `github`, `playwright/chrome-devtools`, plus `pre-shell-guard`, `protect-secrets`, and `stop-verify`.
4. Check tool availability only when execution needs a local tool: call `reverse_skill_route` with `includeToolStatus: true` or inspect the command directly.
5. When a reusable workflow is missing, call `reverse_skill_create` or `reverse_skill_from_source` to write a project-local skill under `.omk/skills/<name>/SKILL.md`.
6. Verify the generated skill has valid frontmatter, clear triggers, workflow steps, acceptance criteria, and no secrets.

## Tools registered by the TS module

- `reverse_skill_route`: target + intent + toolchain scoring across built-in routes.
- `reverse_skill_create`: deterministic skill generator from explicit workflow inputs.
- `reverse_skill_from_source`: markdown-to-skill adapter for external packs.
- `/reverse-skill <task>`: interactive command that records a route decision in the session.

## Implementation files

- TS module: `packages/agent/src/harness/reverse-skill.ts`
- Project extension: `.omk/extensions/reverse-skill.ts`
- Reference route summary: `references/route-map.md`

## Acceptance

- Output names the primary route, confidence, required tools, MCP hints, hooks, first actions, and blockers.
- Generated skills stay inside the project and follow Agent Skills frontmatter rules.
- Evidence is file/path based; do not store credentials, private keys, raw tokens, or unredacted personal data.
