# ADR: Dark-only README SVG assets derived from the night-city theme

- Status: accepted
- Date: 2026-06-10
- Owners: OMK theme contract lane (T4)
- Related: `themes/night-city.theme.json`, `scripts/assets-build.mjs`, `scripts/theme-check.mjs`, `proof/theme-2026-06-10/t1-t2-summary.md`

## Context

OMK ships a single `omk.theme.v1` theme — `night-city` (`mode: dark`) — as the source of
truth for all branded surfaces. Every foreground/background pair in that theme is
contrast-gated by `npm run theme:check` (text ≥ 4.5, indicator ≥ 3.0; 48 pairs, 0 failed),
and the gate blocks merge in CI. The 5 README SVG assets
(`readmeasset/omk-{badges,core-loop,evidence-ledger,logo-mark,provider-lanes}.svg`) are now
derived from that theme's primitives by `npm run assets:build`, which embeds a
`derived-from: omk.theme.v1/night-city@<hash>` provenance comment per SVG.

A light variant of the assets was considered for GitHub light-mode READMEs. There is no
light theme file, no light contrast matrix, and no reviewed light palette — generating one
by naive color inversion would ship pairs that were never gated.

## Decision

Do **not** build a light variant. Assets are dark-only and derive exclusively from the
single contrast-gated dark theme.

`scripts/assets-build.mjs` enforces this: it refuses any theme with `mode` other than
`dark` unless every foreground/background token pair actually used by the SVGs passes the
same 4.5/3.0 WCAG gates inline (the same model `theme:check` applies). The inline gate
also runs for dark themes, so a drifted primitive cannot silently ship an unreadable
asset.

## Consequences

- README assets render correctly on dark backgrounds only; light-mode viewers see the
  dark cards as framed panels (each SVG paints its own `dark` background rect, so nothing
  becomes unreadable on a light page).
- Introducing a light variant requires: a new `omk.theme.v1` theme file with
  `mode: light`, a full `npm run theme:check` pass for that file, and only then will
  `npm run assets:build --theme <file>` accept it (its inline used-pair gate must pass).
- Theme color changes propagate to assets only via `npm run assets:build`; the
  `@<hash>` provenance suffix makes a stale asset detectable against the current theme
  file hash.
