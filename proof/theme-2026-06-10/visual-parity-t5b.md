# T5b visual parity evidence

Goal: prove the hotspot migration to the compiled theme changed zero rendered
bytes for representative cockpit/renderer frames.

## Method

`capture-frame.mjs` renders deterministically (fixed `Date.now`, `OMK_ANIMATION=off`,
`FORCE_COLOR=1`, `COLORTERM=truecolor`, fake 80×24 TTY stream) and JSON-escapes the
raw output bytes:

1. **neon-grid** `session:start` header — sparkle title (`renderOmkSparkleText`),
   gradient motto + status lines (`gradient-string`), theme-colored route/root lines.
2. **green-rain** `session:start` header.
3. **rust-forge** `session:start` header (incl. sigil sweep frame).
4. Cockpit sparkle title `◢█ OMK//CONTROL COCKPIT █◣` at fixed frame 42
   (the `src/commands/cockpit/render.ts` header line).
5. All `OmkBrandTheme.colors` SGR open sequences for SYSTEM24 / GREEN_RAIN /
   NEON_GRID / RUST_FORGE / MATRIX / PLAIN / HIGH_CONTRAST.

## Procedure & result

```
npm run build                                  # pre-migration tree   → exit 0
node proof/theme-2026-06-10/capture-frame.mjs > frame-before.txt      # exit 0
# ... T5b migration (src/brand, src/cli/ui, src/commands/cockpit, src/util) ...
npm run build                                  # post-migration tree  → exit 0
node proof/theme-2026-06-10/capture-frame.mjs > frame-after.txt       # exit 0
diff frame-before.txt frame-after.txt          # exit 0 — no output
```

**Result: `frame-before.txt` and `frame-after.txt` are byte-identical**
(truecolor SGR equality — no documented intentional changes were needed).

## Why parity holds by construction

- Night-city primitives in `src/brand/night-city.theme.json` carry exactly the
  hex values the old literals encoded (`#00D6FF`→cyan, `#00FFC2`→mint,
  `#FF47B2`→magenta, `#9D4EDD`→purple, `#FFB000`→amber, `#FF5874`→red,
  `#E8F8FF`→cream, `#070B14`→dark, `#758FA8`→gray).
- `brandTruecolorSgr` (via `compileTheme(…, "truecolor")`) emits
  `\u001b[38;2;R;G;Bm` — the same bytes the removed inline builder produced.
- Sparkle/gradient ramp hexes differ only in letter case
  (`#f4ffff`→`#F4FFFF` etc.); both `omk-sigil.ts#hexToRgb` and
  `gradient-string` parse case-insensitively, so emitted SGR bytes are equal
  (confirmed by the byte-identical captures above).
- tmux option strings interpolate the same uppercase hexes the literals held
  (`#22324A` pane border reproduced from `P.gridLine` rgb(34,50,74)).

Intentional non-parity surface (documented, not exercised by default):
`getCompiledBrandTheme()` exposes tier-aware (`detectColorTier`) 256/16/no-color
degradation for future use; existing brand constants intentionally remain
truecolor for byte parity.
