# Theme-Aware Brand Chrome Implementation

Status: completed
Date: 2026-06-10
Package version observed: 0.78.6 (`node -p "require('./package.json').version"`)

## Changed Files

- `src/brand/rust-forge.theme.json` - byte-for-byte snapshot of `themes/rust-forge.theme.json`.
- `src/brand/theme-compiled.ts` - added active brand theme API, rust-forge snapshot export, active chrome copy helpers, and theme+tier compile cache.
- `src/brand/palette.ts` - made `P` and `BRAND_HEX` stable mutable exports and added `setBrandPaletteTheme()` in-place updates.
- `src/brand/theme.ts` - refreshed rust-forge label copy to oxidized forge control language and switched rust theme colors to rust-forge compiled roles.
- `src/util/chat-cockpit.ts` - replaced Night City-only tmux constants with `buildTmuxBrandChromeOptions()` and applied brand from chat launch options.
- `src/commands/cockpit/render.ts` and `src/commands/cockpit/utils.ts` - wired cockpit rendering to `OMK_THEME`/option theme and active chrome subtitle/detail helpers.
- `src/theme/layout.ts`, `src/theme/parallel.ts`, `src/hud/render.ts` - made hardcoded live chrome text theme-aware while preserving night-city defaults.
- `src/commands/chat/runtime.ts`, `src/commands/chat/utils.ts`, `src/cli/ui/rust-forge-renderer.ts`, `src/cli/v2/interactive-prompt.ts` - aligned rust-forge live chat/intro copy with oxidized forge wording.
- `test/brand-theme.test.mjs`, `test/cockpit-render-core.test.mjs`, `test/chat-cockpit.test.mjs`, `test/rust-forge-renderer.test.mjs` - added drift, palette switch, cockpit, tmux, and copy coverage.

## Role Map

| Brand slot | Active semantic / primitive | Night-city value | Rust-forge value |
| --- | --- | --- | --- |
| `P.blue`, `BRAND_HEX.cyan` | `route.active` | `#00D6FF` | `#FF6A3D` |
| `P.mint`, `P.cargoGreen`, `P.matrixGreen`, `BRAND_HEX.mint` | `evidence.pass` | `#00FFC2` | `#4FB39B` |
| `P.orange`, `BRAND_HEX.amber` | `route.fallback` | `#FFB000` | `#E08A4B` |
| `P.red`, `BRAND_HEX.red` | `telemetry.error` | `#FF5874` | `#FF5468` |
| `P.purple`, `BRAND_HEX.purple` | `control.accent` | `#9D4EDD` | `#FF6A3D` |
| `P.pink`, `P.hotPink`, `BRAND_HEX.magenta` | night primitive `magenta`; rust alias to `control.accent` | `#FF47B2` | `#FF6A3D` |
| `P.cream`, `BRAND_HEX.cream` | `control.fg` | `#E8F8FF` | `#F2E4D6` |
| `P.dark`, `BRAND_HEX.dark` | `control.bg` | `#070B14` | `#0E0B09` |
| `P.gray`, `BRAND_HEX.gray` | `control.dim` | `#758FA8` | `#9FB0BD` |
| `BRAND_HEX.surface` | background slot 2 | `#101826` | `#1A1310` |
| `BRAND_HEX.muted` | `muted` primitive / `dag.lane.queued` fallback | `#9DB3C7` | `#8F7B6D` |
| `P.rustOrange` | legacy rust accent by default; `route.active` when active rust-forge | `{249,115,22}` | `{255,106,61}` |
| `P.rustEmber`, `BRAND_HEX.rustEmber` | legacy sparkle by default; `telemetry.warn` when active rust-forge | `#FF7A18` | `#FFB454` |
| `P.rustCrimson`, `BRAND_HEX.rustCrimson` | legacy sparkle by default; `telemetry.error` when active rust-forge | `#FF315D` | `#FF5468` |

Specialty constants retained: sparkle white/gold, Matrix rain/deep/dim/error constants, metrics dashboard constants, and legacy night-city rust defaults.

## Night-City Parity Proof

- Default active brand remains `night-city`; unknown names map to `night-city`.
- `P` and `BRAND_HEX` retain stable object identities; nested RGB values are mutated in place during theme switches.
- Default sample after build:
  - `P.blue={0,214,255}`, `P.mint={0,255,194}`, `P.purple={157,78,221}`, `P.orange={255,176,0}`.
  - `P.red={255,88,116}`, `P.cream={232,248,255}`, `P.dark={7,11,20}`, `P.gray={117,143,168}`.
  - `P.rustOrange={249,115,22}` preserved.
  - `BRAND_HEX.dark=#070B14`, `cyan=#00D6FF`, `mint=#00FFC2`, `magenta=#FF47B2`, `purple=#9D4EDD`, `amber=#FFB000`, `red=#FF5874`, `cream=#E8F8FF`, `gray=#758FA8`.
- Default cockpit labels remain `NEON GRID · GREEN RAIN · METRICS WALL` and `route · verify · loop · control · evidence gated`.
- Default tmux status-left remains `#[fg=#00FFC2,bold] OMK//CONTROL #[fg=#758FA8]Night City`.
- `test/brand-theme.test.mjs` asserts default P/BRAND_HEX semantics still match night-city compiled primitives and reset restores originals.

## Rust-Forge Live Chrome Proof

- `src/brand/rust-forge.theme.json` matches `themes/rust-forge.theme.json` byte-for-byte.
- `setBrandPaletteTheme("rust-forge")` changes shared slots to rust-forge roles:
  - `P.blue={255,106,61}`, `P.mint={79,179,155}`, `P.orange={224,138,75}`, `P.red={255,84,104}`.
  - `P.cream={242,228,214}`, `P.dark={14,11,9}`, `P.gray={159,176,189}`, `P.rustOrange={255,106,61}`.
  - `BRAND_HEX.cyan=#FF6A3D`, `mint=#4FB39B`, `magenta=#FF6A3D`, `amber=#E08A4B`, `red=#FF5468`, `cream=#F2E4D6`.
- Cockpit with `OMK_THEME=rust-forge` includes `OXIDIZED FORGE · ROUTE · VERIFY · CONTROL` and emits rust truecolor `38;2;255;106;61m`.
- Tmux chrome for brand alias `rust` includes `Oxidized Forge`, `bg=#0E0B09,fg=#F2E4D6`, and `fg=#4FB39B` for the control label.
- Rust-forge UI copy now uses oxidized forge route/verify/control wording rather than native/Rust safety lane wording.

## Gate Results

- `npm run build` - passed (`tsc && node scripts/chmod-dist.mjs`).
- `node --test test/brand-theme.test.mjs test/cockpit-render-core.test.mjs test/hud-branding.test.mjs test/chat-cockpit.test.mjs test/rust-forge-renderer.test.mjs` - passed, 63 tests.
- `npm run theme:check` - passed; night-city 80 pairs/0 failed, rust-forge 80 pairs/0 failed.
- `npm run schema:check` - passed; validated 9 OMK JSON contract schemas.
- `npx tsc --noEmit 2>&1 | grep 'error TS' || true` - emitted no `error TS` lines (0 TypeScript errors).
- `npm run color:gate` - passed; existing permanent allowlist only.
- `npm run secret:scan` - passed; no high-confidence secrets or maintainer-private paths.
- `git diff --check` - passed.

## Residual Risk

- The active brand palette is process-global by design; tests reset to night-city after rust-forge checks, but long-lived callers should switch deliberately at process edges.
- Specialty palettes without theme roles remain constants to preserve legacy visuals; only safe semantic mappings were applied.
- Provider/fable worker tests were intentionally not run per instruction.
