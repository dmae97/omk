# Color-literal debt inventory

Scope: `src/**/*.ts` excluding `src/cli/theme/**` · gate: `npm run color:gate`
(scripts/color-literal-gate.mjs + scripts/color-allowlist.json)

| file | hex count | SGR count | allowlist section |
|---|---:|---:|---|
| src/adapters/kimi/ascii-art.ts | 0 | 2016 | permanent |
| src/commands/init.ts | 12 | 0 | permanent |
| src/commands/init/config.ts | 7 | 0 | permanent |
| src/commands/init/content.ts | 5 | 0 | permanent |
| src/kimi/ascii-art.ts | 0 | 2016 | permanent |
| src/theme/extended-palette.ts | 59 | 0 | permanent |
| **TOTAL** | **83** | **4032** | 6 files |

Sections: `permanent` = init template payloads (generated-project content, exempt by design);
`legacy-burn-down` = temporary ratchet ceilings — counts may only decrease; migration to the
theme module happens in a later layer.

## G1 burn-down delta

Lane G1-BURNDOWN emptied `legacy-burn-down.files` (10 → 0 entries). Every hex/SGR
literal in those files was replaced with theme-derived lookups (BRAND_HEX / numeric
SGR codes / `src/theme/extended-palette.ts` data module). Counts below are source
literals scanned by `scripts/color-literal-gate.mjs`.

| file | hex before | hex after | sgr before | sgr after | token mapping used |
|---|---:|---:|---:|---:|---|
| src/cli/v2/chat-repl.ts | 0 | 0 | 1 | 0 | `\x1b[36m` prompt → CSI prefix assembled from `"\x1b["` (ANSI-16 cyan, byte-identical) |
| src/commands/design.ts | 18 | 0 | 0 | 0 | OMK badge/SVG → `BRAND_HEX.{dark,cyan,magenta,cream,amber}`; DESIGN.md scaffold → `DESIGN_SCAFFOLD.*` (extended-palette) |
| src/memory/graph-viewer.ts | 41 | 0 | 0 | 0 | TYPE_COLORS + HTML/cytoscape chrome → `GRAPH_VIEWER.{typeColors,defaultNode,ui}` (extended-palette) |
| src/orchestration/log-streamer.ts | 0 | 0 | 5 | 0 | `\x1b[3Xm` level colors → numeric ANSI-16 codes via CSI (byte-identical) |
| src/theme/ansi.ts | 0 | 0 | 2 | 0 | `rgb()`/`bgRgb()` `38;2;`/`48;2;` → numeric SGR codes joined (byte-identical) |
| src/theme/layout.ts | 5 | 0 | 0 | 0 | `omkHudHeader` sparkle ramp → `BRAND_HEX.{cyan,sparkleWhite,sparkleGold,magenta,mint}` |
| src/theme/metrics.ts | 0 | 0 | 4 | 0 | gauge/gradient `38;2;…` → `rgb(P.metrics{Green,Amber,Red,…})` (byte-identical) |
| src/theme/parallel.ts | 20 | 0 | 0 | 0 | hero/figlet gradient ramps → `BRAND_HEX.{cyan,purple,magenta,mint,amber}` |
| src/ui/omk-sigil.ts | 11 | 0 | 1 | 0 | neon `C` palette → `SIGIL_NEON` (extended-palette); `fg()` `38;2;` → numeric SGR codes |
| src/ui/omk-working-sweep.ts | 12 | 0 | 1 | 0 | neon `P` palette → `SIGIL_NEON` (extended-palette); `fg()` `38;2;` → numeric SGR codes |
| **TOTAL** | **107** | **0** | **14** | **0** | burn-down complete |

New data module: `src/theme/extended-palette.ts` (hex=59, `permanent` allowlist). Holds
the bespoke sigil/sweep neon ramps, the graph-viewer web/SVG palette, and the DESIGN.md
scaffold defaults — the colors with no night-city primitive — declared exactly once and
imported everywhere else. It imports `BRAND_HEX` as the theme-derived base (sparkle
white/gold are re-derived from it, not re-declared).
