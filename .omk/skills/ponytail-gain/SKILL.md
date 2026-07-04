---
name: ponytail-gain
description: >
  Show ponytail's measured impact as a compact scoreboard: less code, less
  cost, more speed, from the benchmark medians. One-shot display, not a
  persistent mode, and not a per-repo number. Trigger: /ponytail-gain,
  "ponytail gain", "what does ponytail save", "show ponytail impact",
  "ponytail scoreboard".
license: MIT
metadata:
  vendored-from: "https://github.com/DietrichGebert/ponytail"
  vendored-commit: "40e50d9e03242aa5dd53ac771950f9127362b25f"
  vendored-commit-short: "40e50d9"
  vendored-source-path: "skills/ponytail-gain/SKILL.md"
  vendored-license: "MIT"
---

# Ponytail Gain

Display this scoreboard when invoked. One-shot: do NOT change mode, write flag
files, or persist anything.

The figures are the published benchmark medians (5 everyday tasks: email
validator, debounce, CSV sum, countdown timer, rate limiter; three models:
Haiku, Sonnet, Opus). They are measured, not computed from the current repo.
Source: `benchmarks/` and the README.

## Scoreboard

Render plain ASCII bars. The bar length shows the measured range; the label
carries the exact figure:

```
  ponytail gain                     benchmark median · 5 tasks · 3 models

  Lines of code   no-skill  ████████████████████  100%
                  ponytail  ██▌·················    6–20%   ▼ 80–94%
  Cost            no-skill  ████████████████████  100%
                  ponytail  █████▌··············   23–53%  ▼ 47–77%
  Speed           ponytail  ▸ 3–6× faster

  This repo:  /ponytail-debt  (shortcuts you deferred)
              /ponytail-audit (what's still cuttable)
```

## Honesty boundary

These are benchmark medians, not this repo. NEVER print a per-repo savings
number ("you saved X lines/tokens here"): the unbuilt version was never
written, so there is no real baseline to subtract from in a live repo. The
only real per-repo figures come from `/ponytail-debt` (a counted ledger), and
this card points there instead of inventing one.

## Boundaries

One-shot display. Edits nothing, changes no mode.
"stop ponytail" or "normal mode": revert.

---

## OMK Vendoring Notice

This skill is vendored from the upstream [Ponytail](https://github.com/DietrichGebert/ponytail)
project (npm: `@dietrichgebert/ponytail`) as a pure markdown OMK skill, copied unmodified in
substance from `skills/ponytail-gain/SKILL.md` at pinned commit
[`40e50d9`](https://github.com/DietrichGebert/ponytail/commit/40e50d9e03242aa5dd53ac771950f9127362b25f)
(full SHA `40e50d9e03242aa5dd53ac771950f9127362b25f`).

- **License:** MIT. Copyright (c) 2026 DietrichGebert. Full text: [`../ponytail/LICENSE`](../ponytail/LICENSE)
  (this repo's vendored copy, kept alongside the primary `ponytail` skill) and the upstream
  `LICENSE` file at the pinned commit.
- **Scope:** only the six `skills/*/SKILL.md` files were vendored. Upstream's Node/Python
  extension code (`pi-extension/`, `hooks/*.js`, `ponytail-mcp/`), the Hermes Agent plugin
  (`__init__.py`, `plugin.yaml`), command/hook manifests, and marketplace/CI tooling are
  **not** included in OMK. Nothing in this skill executes code; it is inert markdown loaded
  into the system prompt. Note in particular: the benchmark medians in this scoreboard were
  measured by the upstream project's own `benchmarks/` harness, which is **not** vendored here
  and was not re-run by this integration.
- **Invocation in OMK:** use `/skill:ponytail-gain` or `!skill:ponytail-gain` (shorthand
  `!ponytail-gain` also works when unambiguous), per `packages/coding-agent/docs/skills.md`.
  The bare `/ponytail-gain` slash form referenced above describes the upstream multi-host
  package's own command surface (Claude Code, Codex, OpenCode, etc.) and is not an OMK command.
- **Updates:** this is a static vendored copy, not a live package install. To pick up upstream
  changes, re-vendor against a newer pinned commit; there is no auto-update mechanism here.
