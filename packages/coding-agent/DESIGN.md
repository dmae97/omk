# OMK TUI Control Design System

## Product Surface

OMK interactive startup/control mode is a terminal-first operations console. It uses the paper/ink/vermillion design language of the README hero (`readmeasset/omk-hero.svg`): ink text, one accent for the Verify stage and live signals, figure-plate captions, hairline square frames. The console stays dense and scan-friendly; it is not a marketing layout.

OMK shares this drafting language with the separate AdaptOrch product (commit `182425b8a2`) but has its own mark. No TUI surface, theme name or alias uses the AdaptOrch name or marks.

## Visual Tokens

Colour comes only from theme tokens. The default themes are the paper pair; other built-in themes keep their own palettes but the same roles.

| Role | Token | `omk-paper-dark` | `omk-paper-light` |
| --- | --- | --- | --- |
| Ink (primary text, wordmark) | `text` | `#ede6d6` | `#141414` |
| Secondary ink (labels, captions) | `muted` | `#b3ad9d` | `#4d4d4d` |
| Tertiary ink (plates, hints) | `dim` | `#8f8a82` | `#6a675f` |
| Accent (Verify stage, active tab, running state) | `accent` | `#f0503f` | `#b8261f` |
| Hairline frames | `borderMuted` | `#43413d` | `#bdb8ab` |
| Component boundaries | `border` | `#6f6c65` | `#857f76` |
| Status | `success` / `warning` / `error` | `#41996a` / `#ce791f` / `#ea6154` | `#285f42` / `#7e4a13` / `#a2211b` |

- Palette source: AdaptOrch `frontend/src/index.css`. Three dark values are one step lighter than the web tokens (accent `#e84131`, tertiary `#87827a`, emphatic line) so text keeps 4.5:1 and boundaries 3:1 on common terminal backgrounds such as `#1e1e1e`; `test/theme-paper.test.ts` measures every role.
- Accent dosage: the accent marks the Verify stage (mark node and spoke, rule, the word `Verify`, flow `VERIFY`), the active tab, the `active` authority state, focus and critical signals. Titles, identities, section labels, counters, git branches, uptime, model ids, theme names and decorative bars use ink, never the accent.

## Status Vocabulary

- States (`control-plane-view-model.ts`): `ok` ✓, `active` ●, `blocked` !, `degraded` ▲, `unknown` ?, `stale` ~, `inconclusive` ◐.
- Status color comes only from `authorityStyle`: ok success, active accent, blocked error, unknown muted, degraded/stale/inconclusive warning.
- Every status renders glyph plus text (`✓ idle`, `? unverified`), never color alone.
- A missing source renders `unknown`, never healthy.
- VERIFY reads `unverified` in interactive sessions: no evidence workflow is wired to the interactive session, and prompt settlement or a completed turn never upgrades it.
- Context pressure: elevated >= 70%, critical >= 90%, shared by the control rail, the pinned sidebar and the footer's context figure.
- Percentages are floored at display precision in the rail, the pinned sidebar and the footer's context figure (69.96% shows `69.9%`, never `70.0%`), so a figure never reaches a band before its color does.

## Typography

- Terminal monospace only. The wordmark is the one display element: a half-block serif `OMK` after the Georgia Bold wordmark of the README hero (heavy stems, hairline curves, slab serifs).
- Figure plates and subtitles are uppercase captions (`FIG. 01 · THE CONTROL LOOP`, tracked `O P E N   M U L T I - A G E N T   K I T`).
- Sentence case for copy, uppercase for status values in the status line. No emoji.
- Compact rows over large prose. No viewport-scaled text.

## Layout

- `src/modes/interactive/layout-class.ts` is the only owner of breakpoints: XS < 80, SM 80–119, MD 120–159, LG >= 160 columns. The numbers are provisional pending native visual QA.
- Right rails render only at MD/LG, and every rail gate calls `railFits`. The startup deck checks only its render width; the control-pane overlay and the pinned status sidebar check terminal columns and need >= 16 rows. Pinning the sidebar (`Ctrl+Q`) on a smaller terminal shows the `pinnedRailNotice` status line: `Status sidebar pinned; it shows at 120+ columns and 16+ rows.`
- Two surfaces. The startup header (deck rail column, hero, narrow compact plate, narrow expanded brand block) scrolls into terminal scrollback, where any later change re-emits up to four screens (`REPAINT_BUDGET_SCREENS` in `omk-tui`). It renders only turn-stable values at a fixed height: no queue count, failure card, CPU or RSS. The control-pane overlay, the pinned sidebar and the footer are anchored to the viewport and carry the live values.
- Wide view: the hero on the left, left-aligned like the README hero (no centred brochure lines), and a fixed-width control pane on the right.
- Frames are square hairlines (`┌─┐ └─┘`); single-column layouts use captioned plate rules (`┌─ LABEL ─┐`, `├─ LABEL ─┤`, `└─┘`).
- Below MD the startup panel is a closed plate: `OMK · OPEN MULTI-AGENT KIT`, the lede, the status line `OMK vX · VERIFY … · MODEL … · ANSI ON|OFF`, the key hints. The expanded view adds the wordmark block (text fallback when it does not fit) and `THEME` once. When the pinned sidebar does not fit, the bottom status bar stays.

## Motion

- One motion only: when the expanded view opens, the wordmark inks in from its pencil underdrawing (`borderMuted` to `text`), top row first, and the Verify accent stamps on last. 420 ms, ease-out, 60 ms frames, never looping (`control-panel-motion.ts`).
- The reveal changes colour only; line count and widths are identical at every frame.
- Skipped for reduced motion (`OMK_REDUCED_MOTION`), `NO_COLOR`, non-TTY output without `FORCE_COLOR`, a hidden header and widths below the wordmark.

## Components

- Hero deck (`control-panel-brand.ts`): framed title chip `omk vX · OMK://CONTROL`; plate row `FIG. 01 · THE CONTROL LOOP` … `MIT · PROVIDER-NEUTRAL`; OMK's control-loop mark (hub, three ink nodes, the Verify node and spoke in the accent) beside the serif wordmark; tracked subtitle; accent rule; lede `Scope the work. Route the right agents.` / `Verify every release.`; flow `SCOPE → ROUTE → VERIFY → REPLAY`; meta row `MODEL … · THEME … · ANSI …`. All copy comes from the README hero. RUN, VERIFY and CTX appear only in the rail beside it.
- Right control pane (`control-plane-rail.ts`): tab bar, OMK://CONTROL identity, then RUN, VERIFY, CONTEXT, RESOURCES, TODO and SESSION. `RailSurface` selects the rows:
  - `header` (startup deck column), fixed height: RUN `state`; VERIFY `verdict`, the rail's only evidence row; CONTEXT `model`, `think`, `ctx`, `meter`, `opt`; RESOURCES `gov`, `ext` (configured MCP/skill counts, neutral color); TODO; SESSION.
  - `overlay` (control-pane overlay in expanded view): the header rows plus RUN `queue`, a failure card after a settled turn that did not complete (`cause`, `phase`, `effects`, `retry`, `next`, from the session termination record), and RESOURCES `cpu` and `rss`. `cpu` is host CPU, the value the resource governor admits on and the footer's `CPU` figure shows; it reads `▲ busy` at or above the governor's busy threshold, and OMK's own process CPU never sets it. `rss` is the OMK process RSS.
- Status rows project one `ControlPlaneViewModel`: `buildControlPlaneViewModel` over the signals that one adapter, `readControlPlaneSignals`, reads from the live session. The rail adds only tabs, identity, TODO and SESSION.
- Pinned status sidebar: projects the same view model as `run`/`vrfy` rows, failure essentials (`why`, `rtry`, `next`), and a `ctx` row and meter in the context pressure color.
- Expanded resources: unboxed terminal sections below the deck.

## QA Gates

- Component render regression must prove expanded mode preserves the fixed control pane.
- tmux capture must show no overflow at the target reference width; visual QA renders the capture (paper dark and light) and checks it against the README hero before completion.
- Status rows derive from `ControlPlaneViewModel`; no hardcoded state strings or decorative telemetry in the rail.
- Startup header surfaces render only turn-stable values; live values stay in viewport-anchored surfaces. `test/control-plane-header-surface.test.ts` requires identical header output across queue, failure card, CPU and RSS changes.
- Status rows pass session, journal and file-system text through `singleLineDisplayText`, so no escape sequence, control character or bidi mark reaches the terminal.
- `test/control-panel-brand.test.ts` holds the brand rules: fixed geometry at every reveal value, the accent only on the Verify stage, no AdaptOrch name on any control-panel surface.
- The release gate (`scripts/check-release-consistency.mjs`) requires the plate `FIG. 01 · THE CONTROL LOOP` in `control-panel-brand.ts`.
