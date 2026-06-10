# Visual parity — Lane G1-BURNDOWN

Date: 2026-06-10 · Scope: deterministic terminal surfaces whose colors moved from
hardcoded hex literals onto theme-derived lookups (`BRAND_HEX`) or the
`src/theme/extended-palette.ts` data module. Expectation: **byte-identical**, because
the migration changes only the *source* of each color value, not the value itself.

## Method

1. Extracted the pre-change `src/ui/omk-sigil.ts` and `src/ui/omk-working-sweep.ts`
   from `git show HEAD:` into `/tmp/g1parity/` and transpiled them (the originals are
   self-contained — no imports).
2. Rendered the current (`dist/`) modules and the original modules at the same fixed
   frames with `NO_COLOR` unset and `TERM=xterm-256color` (truecolor path), then compared
   the raw escaped bytes.
3. For `parallel.ts` (figlet/hero ramps) and `layout.ts` (HUD sparkle ramp), verified the
   migrated color arrays resolve to byte-identical strings/RGB versus the original literals
   (`gradient-string` and `colorFromHex` are deterministic functions of the color array).

## Results — byte-identical (no intentional differences)

| surface | source | frames compared | result |
|---|---|---|---|
| `renderOmkSigil` (forge/control/omk/grid/gate) | omk-sigil.ts | 5 names × 40 frames | byte-identical |
| `renderOmkSparkleText` | omk-sigil.ts | fixed frame | byte-identical |
| `renderSweepText` | omk-working-sweep.ts | 60 frames | byte-identical |
| `renderSweepRule` | omk-working-sweep.ts | 60 frames | byte-identical |
| `renderWorkingHud` | omk-working-sweep.ts | 30 frames | byte-identical |
| figlet title ramp (`gradient-string`) | parallel.ts | "OMK" Small font | byte-identical |
| default hero-art gradient pairs | parallel.ts | 5 pairs (RGB) | identical |
| `omkHudHeader` sparkle colors | layout.ts | 5-stop ramp | case-insensitive identical |

Hashes of the rendered frame corpora (sha256, first 16 hex):
- sigil frames: `617f50787ed2a1d9`
- sweep frames: `03e48822b32e84f6`

`BRAND_HEX` value check (all matched the original literals, case-insensitive):
cyan `#00D6FF`, purple `#9D4EDD`, magenta `#FF47B2`, mint `#00FFC2`, amber `#FFB000`,
dark `#070B14`, cream `#E8F8FF`, sparkleWhite `#F4FFFF`, sparkleGold `#FFD166`.

## Non-rendered / value-only surfaces (parity by value equality)

- `src/theme/ansi.ts` `rgb()`/`bgRgb()`, `src/theme/metrics.ts`, `src/orchestration/log-streamer.ts`,
  `src/cli/v2/chat-repl.ts` prompt: SGR escapes are now assembled from numeric codes instead
  of literal `38;2;`/`48;2;`/`\x1b[3Xm` strings. The emitted byte sequence is unchanged
  (e.g. `[38,2,r,g,b].join(";")` → `"38;2;r;g;b"`; `${CSI}${37}m` → `"\x1b[37m"`).
- `src/memory/graph-viewer.ts`: emits HTML/SVG. Colors now interpolated from `GRAPH_VIEWER`
  (extended-palette) whose values equal the prior literals, so the generated document bytes are
  unchanged. The 5 graph-viewer tests (HTML structure) pass.
- `src/commands/design.ts`: OMK badge/SVG and the DESIGN.md scaffold are template payloads
  written into user projects; values now come from `BRAND_HEX`/`DESIGN_SCAFFOLD` (identical
  strings), and the `OPEN_DESIGN_OMK_VISUAL_BLOCK_RE` matcher still matches the generated block.

## Intentional differences

None. No color value, escape byte, or generated-document byte changed in this lane.
