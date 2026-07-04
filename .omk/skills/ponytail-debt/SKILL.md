---
name: ponytail-debt
description: >
  Harvest every `ponytail:` comment in the codebase into a debt ledger, so the
  deliberate shortcuts and deferrals ponytail leaves behind get tracked instead
  of rotting into "later means never". Use when the user says "ponytail debt",
  "/ponytail-debt", "what did ponytail defer", "list the shortcuts", "ponytail
  ledger", or "what did we mark to do later". One-shot report, changes nothing.
license: MIT
metadata:
  vendored-from: "https://github.com/DietrichGebert/ponytail"
  vendored-commit: "40e50d9e03242aa5dd53ac771950f9127362b25f"
  vendored-commit-short: "40e50d9"
  vendored-source-path: "skills/ponytail-debt/SKILL.md"
  vendored-license: "MIT"
---

Every deliberate ponytail shortcut is marked with a `ponytail:` comment naming
its ceiling and upgrade path. This collects them into one ledger so a deferral
can't quietly become permanent.

## Scan

Grep the repo for comment markers, skipping `node_modules`, `.git`, and build
output:

`grep -rnE '(#|//) ?ponytail:' .`  (add other comment prefixes if your stack uses them)

Each hit is one ledger row. The comment prefix keeps prose that merely mentions
the convention out of the ledger.

## Output

One row per marker, grouped by file:

`<file>:<line>, <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.`

The convention is `ponytail: <ceiling>, <upgrade path>`, so pull the ceiling
and the trigger straight from the comment. Want an owner per row too? add
`git blame -L<line>,<line>`.

Flag the rot risk: any `ponytail:` comment that names no upgrade path or
trigger gets a `no-trigger` tag, those are the ones that silently rot.

End with `<N> markers, <M> with no trigger.` Nothing found: `No ponytail: debt. Clean ledger.`

## Boundaries

Reads and reports only, changes nothing. To persist it, ask and it writes the
ledger to a file (e.g. `PONYTAIL-DEBT.md`). One-shot. "stop ponytail-debt" or
"normal mode" to revert.

---

## OMK Vendoring Notice

This skill is vendored from the upstream [Ponytail](https://github.com/DietrichGebert/ponytail)
project (npm: `@dietrichgebert/ponytail`) as a pure markdown OMK skill, copied unmodified in
substance from `skills/ponytail-debt/SKILL.md` at pinned commit
[`40e50d9`](https://github.com/DietrichGebert/ponytail/commit/40e50d9e03242aa5dd53ac771950f9127362b25f)
(full SHA `40e50d9e03242aa5dd53ac771950f9127362b25f`).

- **License:** MIT. Copyright (c) 2026 DietrichGebert. Full text: [`../ponytail/LICENSE`](../ponytail/LICENSE)
  (this repo's vendored copy, kept alongside the primary `ponytail` skill) and the upstream
  `LICENSE` file at the pinned commit.
- **Scope:** only the six `skills/*/SKILL.md` files were vendored. Upstream's Node/Python
  extension code (`pi-extension/`, `hooks/*.js`, `ponytail-mcp/`), the Hermes Agent plugin
  (`__init__.py`, `plugin.yaml`), command/hook manifests, and marketplace/CI tooling are
  **not** included in OMK. Nothing in this skill executes code; it is inert markdown loaded
  into the system prompt.
- **Invocation in OMK:** use `/skill:ponytail-debt` or `!skill:ponytail-debt` (shorthand
  `!ponytail-debt` also works when unambiguous), per `packages/coding-agent/docs/skills.md`.
  The bare `/ponytail-debt` slash form referenced above describes the upstream multi-host
  package's own command surface (Claude Code, Codex, OpenCode, etc.) and is not an OMK command.
- **Updates:** this is a static vendored copy, not a live package install. To pick up upstream
  changes, re-vendor against a newer pinned commit; there is no auto-update mechanism here.
