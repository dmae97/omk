# Phase 0 — Recon (theme contract) · 2026-06-10

Orchestration: 3 parallel lanes (omk-explorer ×3; skills: omk-repo-explorer; local rg/sed/cat
evidence only). MCP adaptorch/ouroboros/supermemory configured in runtime; not directly
callable from this tool surface — wired into the queued goal contract instead (reported, not faked).

## (a) Hardcoded color debt — counts: 144 hex literals, 92 raw ANSI lines (src/, excl. theme paths), 0 chalk

| file | hex | category | difficulty |
|---|---|---|---|
| src/brand/palette.ts | 35 | brand source-of-truth (`P`) | trivial (becomes the primitive layer) |
| src/memory/graph-viewer.ts | 30 | generated graph HTML/SVG | hard |
| src/commands/design.ts | 16 | generates design assets | hard |
| src/ui/omk-working-sweep.ts / omk-sigil.ts | 12 / 11 | UI renderer | trivial |
| src/commands/init.ts + init/config.ts + init/content.ts | 12+7+5 | **template payloads → user files** (not render debt) | flag separately |
| src/util/chat-cockpit.ts | 8 | generated tmux conf | hard |
| src/cli/ui/{neon-grid,green-rain,system24,rust-forge}-renderer.ts | 3/2/1/1 | UI renderer | trivial |
| src/kimi/ascii-art.ts (+adapters dup) | — | **2 037 truecolor SGR escapes each**, baked data | hard |
| src/orchestration/log-streamer.ts | — | 6 color escapes | trivial |

ANSI split: color SGR debt = ascii-art ×2 + log-streamer; the other 80+ escape lines are
cursor/clear/alt-screen (NOT color debt).

## (b) Canonical Night City palette (extracted from readmeasset SVG frequency × provenance)

| hex | freq | role |
|---|---|---|
| #00D6FF | 39 | signal cyan — route/info |
| #101826 | 23 | surface/panel bg (**absent from palette.ts — drift**) |
| #9D4EDD | 13 | orchestration purple — control accent |
| #00FFC2 | 13 | telemetry mint — success/evidence |
| #FF47B2 | 8 | control magenta — focus accent |
| #E8F8FF | 5 | console cream — bright text |
| #070B14 | 5 | cockpit dark — canonical bg |
| #9DB3C7 | 4 | muted text (**palette.ts gray=#758FA8 mismatch — drift**) |
| #FFB000 / #FF5874 | webp-only | warning amber / fault red (per provenance theme mapping) |

SVG (regenerable): omk-badges, omk-core-loop, omk-evidence-ledger, omk-logo-mark, omk-provider-lanes.
Provenance already says "local SVG render from OMK palette" but no machine link exists.

## (c) Render surfaces

| surface | entry | today |
|---|---|---|
| TUI brand renderers | src/cli/ui/renderer.ts + 4 variants | themed via src/brand/theme.ts (rgb escapes) |
| Semantic runtime renderers | src/runtime/renderers.ts | themed via ThemePalette/SemanticToken — 0 hex |
| Chat HUD/cockpit | src/util/chat-cockpit.ts, src/commands/cockpit/render.ts | hardcoded hex |
| Brand art/splash | src/brand/*, src/kimi/ascii-art.ts | hardcoded (P import / baked SGR) |
| README SVGs | readmeasset/*.svg | hardcoded inline hex |

## Existing infra (extend, don't duplicate)

- src/cli/theme/theme-registry.ts: SemanticToken (16 generic tokens) + ThemePalette w/ render(); 23 names → 9 palettes; night-city/omk-control alias one palette. No domain roles (route./evidence./dag.), glyphs only ad-hoc `bullet`.
- terminal-capability.ts: tiers 24/8/4/1/0; honors NO_COLOR + FORCE_COLOR + TERM=dumb; `--no-color` flag NOT honored (T3 gap).
- theme-resolver.ts: precedence flag > OMK_THEME > project cfg > user cfg > capability default — matches prompt already.
- Brand hexes duplicated ≥7 places incl. crates/omk-safety/src/lib.rs NIGHT_CITY_RUST_COLORS (also Kill-Gate pending from rust-lane eval).
