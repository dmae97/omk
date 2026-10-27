# Spec 109 — Single-binary distribution (Bun compile vs Node SEA)

Status: Draft · Part of the 2.0.0 plan
Gate: Work starts only after spec 108 step 2 (internal interface layer over `pi-*`) is complete and merged.

## Goal
Ship omk as a single executable. Compare two zero/low-dependency options:

| Option | License / deps | Notes |
|---|---|---|
| `bun build --compile` | Bun is MIT; adds Bun as a build-time tool only | Bundles runtime + code; cross-compile targets |
| Node SEA (single executable applications) | Built into Node, zero new deps | Requires pre-bundling to one script; blob injected via postject-style step |

No new runtime dependency is added to omk `package.json` by this spec.

## Pre-registered criteria (Tech Lead approved; fixed before any measurement)
1. **Tests:** the same test suite that passes on main passes when run against the binary.
2. **Startup time:** measure (a) `omk --version` and (b) time-to-first-prompt-ready.
   Each with 30 cold and 30 warm runs.
   **PASS** = median ≤ main's Node run median, reported with a 95% CI.
3. **Report-only (not used for pass/fail):** binary size, OS/arch support table.
4. **Fixed beforehand:** the measuring machine, and the exact Node and Bun versions, recorded in this spec before the first run.

## Risks
- **Native addons:** `.node` modules may not embed or load from inside the binary; need inventory and fallback.
- **Dynamic import / plugin and skill loading:** runtime `import()` of user plugins and skills from disk may break under bundling; resolution paths must be tested explicitly.
- **Asset paths:** `__dirname`/`import.meta.url`-relative assets (prompts, templates, schemas) may not resolve inside the binary; assets must be embedded or located relative to the executable.

## Out of scope
Publishing, release tags, and signing. Those need the owner's explicit OK.
