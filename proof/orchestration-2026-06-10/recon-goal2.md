# Goal#2 — THEME contract T3–T5 recon (READ-ONLY)

Date: 2026-06-10 · Method: rg/sed/cat/jq, excl node_modules,dist,.git,.omk/runs,coverage
T-map (from proof/theme-2026-06-10/t3-t5-adaptorch-route.json): **T3 = capability**,
**T4 = assets**, **T5 = cli-migration + color-debt burndown**.

## Verdict
| Contract | Status | Basis |
|---|---|---|
| **T3 capability + OKLab 256-map** | **DONE** | --no-color & NO_COLOR honored; OKLab 16–255 quantizer present; compileTheme render tables; 9/9 degradation tests |
| **T4 assets from tokens** | **DONE** | assets:build derives 5 SVGs w/ provenance hash; dark-only ADR; assets:check drift gate in CI (G3 closed) |
| **T5 CLI migration + color debt** | **DONE** | theme list/set/preview + doctor; brand/palette compiled-from-theme; color-literal-gate in CI; G1 burndown CLOSED (allowlist legacy ratchet emptied) |

All three were landed by the prior T3–T5 orchestration run (status "completed",
reviewer PASS-WITH-CONDITIONS, both MUST conditions implemented). This recon
re-verifies current tree state; nothing in T3–T5 remains OPEN/PARTIAL.

## 1. src/cli/theme/terminal-capability.ts
- **Honors --no-color**: yes — `detectColorDepth()` returns 0 when `argv.includes("--no-color")`.
- **Honors NO_COLOR**: yes — `process.env.NO_COLOR !== undefined` (and `TERM=dumb`, `FORCE_COLOR=0`) → depth 0 → tier "no-color".
- Functions present: detectCi, detectColorDepth, detectUnicode, getTerminalWidth,
  colorTierForDepth, detectColorTier, getTerminalCapability, defaultThemeForCapability.
- **OKLab precompute is NOT here** (by design). It lives in `src/cli/theme/oklab-quantize.ts`:
  `hexToOklab`, `nearestXterm256`, `buildXterm256Lookup`. Header states it maps 24-bit →
  **xterm-256 indexes 16–255 ONLY** (6×6×6 cube 16–231 + grayscale ramp 232–255); system
  colors 0–15 are never emitted. Euclidean nearest-neighbor in OKLab. → T3 DONE.

## 2. themes/night-city.theme.json
- Exists at `themes/night-city.theme.json` (+ byte-identical snapshot `src/brand/night-city.theme.json`, drift-guarded by test).
- Compile-to-render-table: `compileTheme(theme, tier)` in `src/cli/theme/render-table.ts`.
  Invoked **on-demand**, not eagerly at process startup:
  - `src/brand/theme-compiled.ts` → `compileTheme(NIGHT_CITY_THEME, tier)` (lazy brand compile).
  - `src/cli/v2/cli-v2-skeleton.ts` → `omk theme preview` loads doc + compileTheme + renderStatusFrame.
  Note: no single eager startup compile; render tables are compiled per surface/command.

## 3. package.json scripts
- `schema:check` → `node scripts/validate-json-contracts.mjs` (validates 9 JSON contracts incl. omk.theme.v1).
- `theme:check` → `node scripts/theme-check.mjs --out proof/theme-check` (WCAG CR gate: text≥4.5, indicator≥3.0; truecolor + xterm-256-quantized + 16/VGA tiers; 80 pairs / 0 failed).
- `assets:build` → `node scripts/assets-build.mjs` (derive 5 README SVGs from night-city tokens, embed `derived-from: omk.theme.v1/night-city@<hash>`, dark-only WCAG gate).
- `assets:check` → `node scripts/assets-check.mjs` (read-only provenance drift gate).

## 4. Color-literal debt + CI gate
Current measured hex(`#[0-9a-fA-F]{6}`) / SGR escape counts in named files = **all zero**:
- src/util/chat-cockpit.ts → hex 0, sgr 0
- src/commands/cockpit/render.ts → hex 0, sgr 0
- src/brand/palette.ts → hex 0, sgr 0
- src/cli/ui/*renderer* (renderer, rich, rust-forge, plain, system24, green-rain, neon-grid) → hex 0
**CI grep gate EXISTS**: `scripts/color-literal-gate.mjs` (npm `color:gate`) + `.github/workflows/ci.yml`
step "color literal gate" (after theme:check, before assets:check). Allowlist
`scripts/color-allowlist.json`: `legacy-burn-down.files = {}` (emptied 2026-06-10, G1 CLOSED);
only `permanent` exemptions remain (init templates, ascii-art data, extended-palette).

## 5. proof/theme-2026-06-10/ existing evidence
- T1/T2: t1-t2-summary.md, contrast-matrix.{csv,md} (80-pair contrast matrix), oklch-selftest.txt, phase0-recon.md, phase0-debt-counts.txt.
- T3: t3-a11y-review.md, snapshots/ (4-tier incl no-color).
- T4: g3-assets-check-evidence.md, visual-parity-t5b.md, color-debt-inventory.md.
- T5: t5-cli-evidence.md, visual-parity-g1.md.
- Orchestration: t3-t5-adaptorch-route.json, t3-t5-orchestration-result.json (status=completed),
  final-gates.md (CONDITIONAL PASS), acceptance-reconciliation.md, frame-before/after.txt.

## Residual (non-T3–T5, flagged to other owners)
- Pre-existing test failures: `omk-no-args-hud` (fs-barrel refactor), `cockpit-render` (timeout) — not theme-owned.
- `no-legacy-identity` gate trips on theme-check.mjs constant + proof token strings (theme/qa cleanup) — does not block T3–T5 gates.
