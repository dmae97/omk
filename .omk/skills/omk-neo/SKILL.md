---
name: omk-neo
description: Entry point for Neo computer-use work in this checkout. Route browser, website, research, code-review and MCP-setup tasks to the matching Neo skill after checking actual capabilities, and explain Neo skill/MCP availability without claiming connections.
---

# Neo router

Start here for Neo tasks. This skill routes; it does not itself drive browsers, write sites, or configure servers. This checkout integrates and builds the Neo bundle locally on 2026-09-17, but it is an uncommitted working-tree state, not a published release. Verify installed behavior before recommending commands to others.

## Route by target

Neo workflow skills are bundled with the installed package under `resources/neo/skills` and are discovered by skill name. Load by name, for example with `!skill:omk-browser` or `/skill:omk-browser`.

| Task | Load skill |
| --- | --- |
| Desktop app, native GUI, or model/capability questions | `omk-computeruse` |
| Website interaction, screenshots, structured extraction | `omk-browser` |
| Building or validating a site in this repository | `omk-site` |
| Current technical documentation lookup | `omk-research` |
| Reviewing a change before handoff | `omk-code-review` |
| Installing or connecting Neo MCP presets | `omk-mcp-setup` |

Read only the matched skill, plus a second one when the task genuinely crosses domains (for example site work needs browser verification). Load `omk-computeruse` when the target is native desktop or you must first decide which model capabilities the task needs. If a matched name is absent from your session inventory, check `omk neo list` for packaging state instead of inventing a path; a missing name is a packaging problem, not a reason to fake a workflow.

## Check Neo state before acting

1. `omk neo list` shows packaged skills and offered presets from the built installation. `connected: null` is unprobed, not zero failures.
2. Bundled skills fill only names that user, project, or explicit skills do not already own. A same-name project skill always wins.
3. This working tree's bundle lives at `packages/coding-agent/resources/neo/skills`. The local build also copies it to `dist/resources`; the published package verification remains a separate release task.
4. Restart OMK after a rebuild; an active session does not hot-reload source.

## MCP discipline

MCP setup is opt-in and scoped. `omk neo setup playwright context7` previews the exact target and disabled entries without writing; `--apply` needs explicit approval for the target file and network effects. Never overwrite an existing `.omk/mcp.json`; use `omk neo mcp-config` and a reviewed manual merge instead. Sandbox launch failure must be diagnosed, never bypassed with `--no-sandbox`. Profile isolation is not OS or network isolation.

Current machine status, checked 2026-09-17: a Playwright MCP connection answered a read-only probe; Context7 returned an invalid API-key error. Treat those as per-host facts to recheck, not standing connectivity claims. Do not modify credentials without an explicit request.

## Report

End with runtime, target, actions, verification evidence, and `VERIFIED`, `PARTIAL`, or `BLOCKED`. Distinguish packaged, loaded, configured, connected, and verified states. Never claim deployment, publishing, or model-performance gains that no evidence in this checkout supports.
