---
name: ponytail-audit
description: >
  Whole-repo audit for over-engineering. Like ponytail-review, but scans the
  entire codebase instead of a diff: a ranked list of what to delete, simplify,
  or replace with stdlib/native equivalents. Use when the user says "audit this
  codebase", "audit for over-engineering", "what can I delete from this repo",
  "find bloat", "ponytail-audit", or "/ponytail-audit". One-shot report, does
  not apply fixes.
license: MIT
metadata:
  vendored-from: "https://github.com/DietrichGebert/ponytail"
  vendored-commit: "40e50d9e03242aa5dd53ac771950f9127362b25f"
  vendored-commit-short: "40e50d9"
  vendored-source-path: "skills/ponytail-audit/SKILL.md"
  vendored-license: "MIT"
---

ponytail-review, repo-wide. Scan the whole tree instead of a diff. Rank
findings biggest cut first.

## Tags

Same as ponytail-review:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Hunt

Deps the stdlib or platform already ships, single-implementation interfaces,
factories with one product, wrappers that only delegate, files exporting one
thing, dead flags and config, hand-rolled stdlib.

## Output

One line per finding, ranked: `<tag> <what to cut>. <replacement>. [path]`.
End with `net: -<N> lines, -<M> deps possible.` Nothing to cut: `Lean already. Ship.`

## Boundaries

Scope: over-engineering and complexity only. Correctness bugs, security holes,
and performance are explicitly out of scope. Route them to a normal review
pass. Lists findings, applies nothing. One-shot.
"stop ponytail-audit" or "normal mode" to revert.

---

## OMK Vendoring Notice

This skill is vendored from the upstream [Ponytail](https://github.com/DietrichGebert/ponytail)
project (npm: `@dietrichgebert/ponytail`) as a pure markdown OMK skill, copied unmodified in
substance from `skills/ponytail-audit/SKILL.md` at pinned commit
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
- **Invocation in OMK:** use `/skill:ponytail-audit` or `!skill:ponytail-audit` (shorthand
  `!ponytail-audit` also works when unambiguous), per `packages/coding-agent/docs/skills.md`.
  The bare `/ponytail-audit` slash form referenced above describes the upstream multi-host
  package's own command surface (Claude Code, Codex, OpenCode, etc.) and is not an OMK command.
- **Updates:** this is a static vendored copy, not a live package install. To pick up upstream
  changes, re-vendor against a newer pinned commit; there is no auto-update mechanism here.
