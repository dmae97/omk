# T1+T2 — Token contract + contrast gate · evidence

## Commands + results
- `npm run schema:check` → "validated 9 OMK JSON contract schemas" (omk.theme.v1 registered)
- `npm run theme:check` → "✓ night-city: 48 pairs checked, 0 failed" → contrast-matrix.{csv,md}
- `node scripts/theme-check.mjs --self-test` → OKLCH repair proven: #9D4EDD on #070B14
  @4.5-gate: CR 4.28 → #A253E2 CR 4.57, hue held 306.3°→306.5° (oklch-selftest.txt)

## Adjusted values shipped: NONE
All 32 truecolor pairs + 16 hand-authored VGA-tier pairs pass their gates with the original
brand hexes, because usage classes were assigned honestly:
- purple #9D4EDD is `control.accent`, kind=chrome, usage=indicator (gate 3.0; measured 4.28/3.86
  vs dark/surface). It FAILS the 4.5 text gate — the matrix documents this; the contract
  prevents purple running text. The self-test shows the repair the engine would apply if a
  future theme tries it.
- 16-color tier: `control.dim` mapped to `white` (#AAAAAA, CR 9.04), NOT `brightBlack`
  (#555555, CR 2.81 — fails 3.0). Hand-authoring justified by measurement.

## Gate decisions encoded
- text ≥ 4.5 (telemetry/logs/verdict lines/route+dag labels), indicator ≥ 3.0 (chrome,
  glyphs, borders), backgrounds gated as bg side of every pair.
- Glyphs mandatory for kind=state (schema if/then + executable check); chrome may omit,
  control.fg/bg carry none. Deliberate interpretation: bg/fg chrome are not "states".

## CI wiring
- package.json: `"theme:check": "node scripts/theme-check.mjs --out proof/theme-check"`
- .github/workflows/ci.yml: `theme:check` step added directly after `schema:check` — a
  failing pair now blocks merge.
