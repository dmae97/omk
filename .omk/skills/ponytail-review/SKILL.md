---
name: ponytail-review
description: >
  Code review focused exclusively on over-engineering. Finds what to delete:
  reinvented standard library, unneeded dependencies, speculative abstractions,
  dead flexibility. One line per finding: location, what to cut, what replaces
  it. Use when the user says "review for over-engineering", "what can we
  delete", "is this over-engineered", "simplify review", or invokes
  /ponytail-review. Complements correctness-focused review, this one only
  hunts complexity.
license: MIT
metadata:
  vendored-from: "https://github.com/DietrichGebert/ponytail"
  vendored-commit: "40e50d9e03242aa5dd53ac771950f9127362b25f"
  vendored-commit-short: "40e50d9"
  vendored-source-path: "skills/ponytail-review/SKILL.md"
  vendored-license: "MIT"
---

Review diffs for unnecessary complexity. One line per finding: location, what
to cut, what replaces it. The diff's best outcome is getting shorter.

## Format

`L<line>: <tag> <what>. <replacement>.`, or `<file>:L<line>: ...` for
multi-file diffs.

Tags:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Examples

❌ "This EmailValidator class might be more complex than necessary, have you
considered whether all these validation rules are needed at this stage?"

✅ `L12-38: stdlib: 27-line validator class. "@" in email, 1 line, real validation is the confirmation mail.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

End with the only metric that matters: `net: -<N> lines possible.`

If there is nothing to cut, say `Lean already. Ship.` and stop.

## Boundaries

Scope: over-engineering and complexity only. Correctness bugs, security holes,
and performance are explicitly out of scope. Route them to a normal review
pass, not this one. A single smoke test or `assert`-based
self-check is the ponytail minimum, not bloat, never flag it for deletion.
Does not apply the fixes, only lists them.
"stop ponytail-review" or "normal mode": revert to verbose review style.

---

## OMK Vendoring Notice

This skill is vendored from the upstream [Ponytail](https://github.com/DietrichGebert/ponytail)
project (npm: `@dietrichgebert/ponytail`) as a pure markdown OMK skill, copied unmodified in
substance from `skills/ponytail-review/SKILL.md` at pinned commit
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
- **Invocation in OMK:** use `/skill:ponytail-review` or `!skill:ponytail-review` (shorthand
  `!ponytail-review` also works when unambiguous), per `packages/coding-agent/docs/skills.md`.
  The bare `/ponytail-review` slash form referenced above describes the upstream multi-host
  package's own command surface (Claude Code, Codex, OpenCode, etc.) and is not an OMK command.
- **Updates:** this is a static vendored copy, not a live package install. To pick up upstream
  changes, re-vendor against a newer pinned commit; there is no auto-update mechanism here.
