# T5a — Theme CLI/doctor surface + reviewer MUST/SHOULD conditions

- Lane: T5a coder (OMK subagent), 2026-06-10
- Input verdict: `proof/theme-2026-06-10/t3-a11y-review.md` — PASS-WITH-CONDITIONS
- Scope honored: did NOT touch `src/brand/**`, `src/util/chat-cockpit.ts`,
  `src/commands/cockpit/**`, `src/cli/ui/**`, `package.json`, `.github/`,
  `readmeasset/`, `scripts/color-*` (parallel color-debt lane untouched).

## 1. Files changed

| file | change |
|---|---|
| `scripts/theme-check.mjs` | (MUST #1) Added self-contained xterm-256 OKLab NN quantizer (cube [0,95,135,175,215,255] idx 16–231 + grayscale ramp 8+10n idx 232–255; idx 0–15 excluded) and a third matrix tier `256(xterm)`: every semantic pair quantized (fg AND bg) and re-gated at text ≥ 4.5 / indicator ≥ 3.0. Rows emitted into `proof/theme-check/contrast-matrix.{csv,md}` and gate failures exit 1. |
| `themes/night-city.theme.json` | (SHOULD #3) `control.dim` glyph `·` → `┊` — resolves NO_COLOR collision with `telemetry.info` in `logStream`. (SHOULD #4) `meta.reservedPrimitives.magenta` documents the unused `#FF47B2` as reserved (quantizes to idx 205, would pass if adopted); `meta.tierAssumptions` records the VGA-palette assumption for the 16-color tier. |
| `src/cli/theme/status-frame.ts` | NEW — shared `renderStatusFrame(ct)`: the ONE representative frame, now used by BOTH `test/theme-degradation.test.mjs` and `omk theme preview`. |
| `src/cli/theme/theme-doc.ts` | NEW — `listThemeDocuments` / `loadThemeDocument` / `validateThemeDocument` (executable twin of `schemas/omk.theme.v1.schema.json`, mirrors `theme-check.mjs validateTheme()`). |
| `src/cli/theme/tier-explain.ts` | NEW — `explainColorTier(argv, env, isTty)`: same precedence as `terminal-capability.ts detectColorDepth()`, plus reasons + NO_COLOR requested/honored for doctor. |
| `src/cli/theme/index.ts` | Barrel exports for the three new modules (additive). |
| `src/cli/v2/cli-v2-skeleton.ts` | `ThemeCommand`: `list` (active theme + omk.theme.v1 docs w/ validity + builtin swatches), `set <name>` (validates against docs+registry, persists to `.omkrc.json` read by `theme-resolver.ts`, exit 2 on unknown), `preview <name>` (representative frame via `compileTheme(doc, detectedTier)`; swatch fallback for registry-only themes), `--no-color` flag. `DoctorCommand`: new "Color tier & theme" section (tier, why, NO_COLOR honored, active theme, schema validity; `--json` variant). |
| `test/theme-degradation.test.mjs` | Snapshots updated for `┊` dim glyph (all 4 tiers); local frame renderer replaced by the shared `dist/cli/theme/status-frame.js` import (single source of truth). 9/9 pass. |
| `test/theme-cli-surface.test.mjs` | NEW — 10 tests: theme-doc load/validate + violation detection, glyph-collision regression, magenta-reserved regression, tier-explain precedence/NO_COLOR, status-frame snapshot parity, Clipanion `theme list/set/preview` + `doctor` section. |

## 2. Commands + exit codes

| command | exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx tsc` (build) | 0 |
| `npm run schema:check` (validated 9 contract schemas) | 0 |
| `npm run theme:check` (80 pairs checked, 0 failed) | 0 |
| `node --test test/theme-degradation.test.mjs` (9 pass / 0 fail) | 0 |
| `node --test test/theme-cli-surface.test.mjs` (10 pass / 0 fail) | 0 |
| `node --test test/v2-regression.test.mjs` (15 pass / 0 fail) | 0 |
| `node --test test/no-kimi-cli-hud-surface.test.mjs` (1 pass / 0 fail) | 0 |
| `OMK_CLI_V2=1 node dist/cli.js theme list` | 0 |
| `OMK_CLI_V2=1 node dist/cli.js theme preview night-city` | 0 |
| `OMK_CLI_V2=1 node dist/cli.js theme set night-city --cwd <tmp>` | 0 |
| `OMK_CLI_V2=1 node dist/cli.js theme set bogus-theme --cwd <tmp>` | 2 (expected) |
| `OMK_CLI_V2=1 node dist/cli.js doctor` (truecolor / NO_COLOR=1 / --json) | 0 |

## 3. 256-tier matrix summary (MUST #1)

- Matrix now gates THREE tiers: 32 truecolor + **32 `256(xterm)` quantized** + 16 VGA-16 = 80 rows.
- 256(xterm): **32/32 pass, 0 failed** (30 gated ≥ 4.5, 2 gated ≥ 3.0).
- Reviewer's tight pairs appear verbatim and pass:

```csv
"night-city","256(xterm)","control.dim","text","gray@103 #8787AF","surface@234 #1C1C1C","4.96","4.5","true",""
"night-city","256(xterm)","control.accent","indicator","purple@98 #875FD7","surface@234 #1C1C1C","3.77","3","true",""
```

Margins match `t3-a11y-review.md` §2 exactly (4.96 vs 4.5; 3.77 vs 3.0). Any future
hand-tuned index override or primitive edit that erodes a quantized margin now fails CI.

## 4. CLI/doctor smoke snippets

`omk theme list`:

```
Active theme: omk (mode dark, tier truecolor)

Theme documents (omk.theme.v1):
  ○ night-city — /home/yu/open_multi-agent_kit/themes/night-city.theme.json (valid)

Built-in palettes:
  omk [dark] ...
```

`omk theme preview night-city` (COLORTERM=truecolor; same frame as the snapshot test, with the new `┊` dim glyph):

```
OMK//CONTROL — Night City Ops Console — tier truecolor

\e[38;2;157;78;221m◆ OMK//CONTROL\e[0m \e[38;2;117;143;168m┊ night-city ops console\e[0m
\e[38;2;0;214;255m▶ lane compile\e[0m  \e[38;2;0;255;194m● lane schema\e[0m  ...
```

`omk theme set night-city --cwd <tmp>` → `Theme set to: night-city (persisted to <tmp>/.omkrc.json)`;
`.omkrc.json` = `{ "theme": "night-city" }` (read by `theme-resolver.ts` priority chain).

`omk doctor` (with persisted night-city, COLORTERM=truecolor):

```
Color tier & theme
  detected tier : truecolor
  why           : COLORTERM=truecolor
  NO_COLOR      : requested=no honored=yes
  active theme  : night-city (mode dark)
  theme schema  : omk.theme.v1 document: valid
```

`NO_COLOR=1 omk doctor`: `detected tier : no-color / why : NO_COLOR env var set / requested=yes honored=yes`.
`--json`: `{"section":"color-theme","tier":"truecolor","reasons":["COLORTERM=truecolor"],...}`.

## 5. Reviewer-condition disposition

| condition | disposition |
|---|---|
| MUST #1 — 256-tier matrix in `theme:check` CI gate | DONE (32 quantized rows, tight pairs verified) |
| MUST #2 — re-gate after hand-tuning | Process rule now self-enforcing: matrix row required, gate fails CI |
| SHOULD #3 — `·` glyph collision | FIXED (`control.dim` → `┊`; regression test added) |
| SHOULD #4 — magenta unused + VGA assumption docs | DOCUMENTED (`meta.reservedPrimitives`, `meta.tierAssumptions`; regression test added) |

## 6. Remaining risk

- `theme-check.mjs` quantizer is an intentional self-contained twin of
  `src/cli/theme/oklab-quantize.ts`; drift between them would desynchronize gate vs runtime.
  Mitigated by identical constants and the degradation test asserting runtime indexes
  (45/49/98/103/145/195/214) that also appear in matrix rows.
- `omk theme set` persists to project `.omkrc.json`; user-level (`~/.omk/config.json`)
  persistence not implemented (resolver already reads it; out of T5a scope).
- Doc-only themes not in the builtin registry would be accepted by `set` but fall back at
  resolve time (resolver validates against `listBuiltinThemes()`); night-city is registered,
  so no current impact.
- MCP lanes (omk-project / filesystem-readonly / memory) were not used — work was
  fully local; no MCP-dependent claims made.
