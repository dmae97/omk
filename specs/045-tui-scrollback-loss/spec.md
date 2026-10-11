---
description: "Height resizes while a reply streams must not drop transcript rows from scrollback; add an env-gated in-process resize byte-offset log for exact replays"
---

# Feature Specification: TUI scrollback loss on height resize

**Specification ID**: `045-tui-scrollback-loss`
**Feature Branch**: `fix/tui-scrollback-loss`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Tech Lead, after Perf Engineer's 20-pair scrollback run for #79 (`/workspace/omk-perf-79/perf-results/scrollback-20/`): main `f887fd2` run `main-r4` lost the four code rows `value1_3`..`value1_6` of section 2, in tmux's own scrollback and in byte replay at every offset shift from −4096 to +4096. #79-r15 lost the same four rows. Find the cause on main with the capture, fix it test-first, and record resize offsets inside omk so replays stop depending on tmux `pipe-pane` file sizes (which lag by up to ~6 KB).
**OMK Preset**: `omk`
**Base**: main `5c9d738` (`packages/tui` identical to `f887fd2`)

## CLI Harness Target Impact

**Classification**: preserve

Interactive TUI rendering only; no model, tool, or orchestration path changes. Metrics that must not regress: the existing `packages/tui` suite (including `regression-resize-scrollback-stacking` and `regression-repaint-budget`, which bound duplicate history on resize), and frame output when the terminal size does not change (byte-identical: the new code runs only on a height change).

## Problem (from the main-r4 capture)

`main-r4/raw-terminal-output.bin` replayed with `@xterm/headless` (start 120×40, resizes as recorded in `capture.json`):

1. At 120×80 omk streams section 2's code block. The hardware cursor sits on the editor row; three footer rows are below it.
2. The terminal shrinks to 120×24 (offset 3845775). xterm.js removes rows *below the cursor* first (the three footer rows) and pushes only the rest into scrollback, so the screen top lands three rows higher than "last 24 rows".
3. One more frame written for 80 rows arrives before omk handles SIGWINCH (in-flight frame, offset 3845775–3851566). It rewrites the footer and scrolls; the screen now shows `value1_3` … footer.
4. omk handles the resize: `doRender` sees `heightChanged` and calls `fullRender(true)`. That homes the cursor (`\x1b[H`) and repaints only `newLines.slice(-24)`. Between the two frames the reply grew by 4 rows, so the tail starts at `value1_7`. The repaint overwrites the screen rows holding `value1_3`..`value1_6`, which had never reached scrollback. They are gone; nothing later re-emits them (the stream-end repair repaint is limited to `REPAINT_BUDGET_SCREENS` and starts at section 3).

Root cause: `packages/tui/src/tui.ts` `doRender`, height-change branch (`fullRender(true)` at the `heightChanged && !isTermuxSession()` check), together with the tail-only repaint in `fullRender` (`tailStart = newLines.length - height`, `\x1b[H`). The tail-only repaint assumes the screen top after a resize is exactly row `newLines.length - height`. That holds only if the terminal pushed exactly the rows above the new screen into scrollback *and* nothing changed since the last frame. Two common cases break it, and each loses rows:

- the terminal drops rows below the cursor on shrink (xterm.js does; the editor footer is below the cursor): loses as many rows as were dropped;
- rows were appended or changed since the last frame (streaming): loses as many rows as the tail moved.

## Design

### Fix: resync relative to the cursor before the tail repaint

A resize keeps the cursor's row and the rows above it (terminals scroll or pull rows around the cursor; they do not move it off its row). So on a height change, before the existing `\x1b[H` tail repaint, omk writes (inside the same synchronized-output block):

1. move up from the cursor's content row (`hardwareCursorRow`) to `first`, then
2. rewrite rows `first`..end with `\x1b[2K` + row + `\r\n`; rows that no longer fit scroll into scrollback in order.

With `len = newLines.length`, `top = min(cursorRow, len − 1)` and `changed` = the first row `< top` that differs from the last frame (else `top`):

`first = min(max(changed, len − height × REPAINT_BUDGET_SCREENS, 0), top)`

The budget (`REPAINT_BUDGET_SCREENS` = 4) only limits how far **up** already-printed rows are re-sent; it never moves `first` below the cursor's row. (The first version clamped from below and then moved the cursor *down* to `first`: cursor-down stops at the screen bottom, so when one resize frame appended more than the budget, e.g. 100 rows at 24 → 20 rows with +120 rows, the rows between the cursor and `first` were never written. Review Major 1.) `capped` = `first > changed` (the budget moved the start down).

**Rows are compared before overlays.** `changed` compares the rows the components rendered (`ResizeResync` keeps the pre-overlay rows of the last two frames, `previousBase`/`currentBase`), not the composited `previousLines`. A full-height overlay (the pinned right rail) shifts against the content when the screen scrolls, so the composited rows above the cursor all looked changed and every resize step re-sent the whole budget (100×40, rail overlay, 40 → 24 → 40 dragged one row at a time three times: rows 7× in scrollback). What is written is still the composited frame. (Review Major 2.)

**A frame that fits the screen is not resynced** (`len ≤ height`): the tail repaint writes all of it from the top, so nothing can be lost. Resyncing it was harmful when an overlay pads a short frame to the screen height: those rows are screen rows, not scrollback-anchored rows, so after a grow pulled rows back from scrollback the cursor's row no longer mapped to the same content row and the line feeds pushed the pulled-back rows into scrollback again (10 rows + rail, 40 → 24 → 40 → 12 → 40: every row 3×; main 1×). (Review Minor 2.)

The tail repaint then lands on a screen that already holds the same rows. If the move up is clamped at the screen top (the first changed row already scrolled away), the changed rows print below their stale copies: duplicated, never lost. When nothing changed and no rows were dropped, step 2 rewrites only the cursor row and the rows below it in place.

`OMK_DEBUG_REDRAW=1` logs the decision on the height-change line: `terminal height changed (A -> B; resync first=F changed=C cursorRow=R capped=bool)`, or `resync none (frame fits: new=N <= height=H)`.

Code: `packages/tui/src/terminal-resync.ts` (`resyncAfterResize`, `resyncStart`, `ResizeResync`, plus `REPAINT_BUDGET_SCREENS`, moved out of `TUI` so both repairs share it), called from the height-change branch of `TUI.doRender`. Width changes keep the existing path (the terminal reflows rows, so row identity does not survive), and so does Termux.

### Resize log: `OMK_TUI_RESIZE_LOG=<path>`

When set, omk appends JSON lines to `<path>` (synchronously, `appendFileSync`):

- **On every resize event**, at the moment omk handles it and before it renders:
  `{"bytes":N,"cols":C,"rows":R,"t":T,"prevCols":PC,"prevRows":PR}`
- **On terminal stop** (TUI stop, including SIGINT/SIGTERM/SIGHUP shutdown paths that stop the TUI):
  `{"final":true,"bytes":N}`. Also on process `exit` when no final line with the same byte count was written yet: a dead terminal's EIO goes from the stdout error handler straight to `process.exit(129)` without stopping the TUI (this is what `tmux kill-server` does to the capture runs), and the exit hook still records the total. After a normal stop the exit hook sees the same count and writes nothing.

`bytes` is the cumulative UTF-8 byte length of everything omk handed to stdout through its terminal writer (`TerminalOutput.write`, the same `submittedBytes` counter as the output stats), counted at the `write()` call. These are omk-side bytes, not pty bytes: no compensation for ONLCR `\n` → `\r\n`; the replayer converts. The tty's ONLCR turns *every* `\n` into `\r\n`, including the `\r\n` omk already writes, so the pty stream carries one extra byte per `\n`: raw offset R matches omk count B when `R − (number of \n in raw[0..R)) = B`. `t` is `performance.now()` in ms (monotonic). `prevCols`/`prevRows` are the size at the previous logged event (the size at start for the first one).

**Bounds.** A resize line's `bytes` is an **upper bound** for where the resize hit the byte stream: bytes omk wrote but the terminal (tmux) had not read yet may be processed at the new size. The external `pipe-pane` file size taken before `resize-window` is a **lower bound**. The replayer judges at both ends and at the midpoint.

**Counted raw writes.** Terminal bytes written from outside the render path go through `writeTerminalRaw(data)` (exported by `omk-tui`): while a TUI is writing it routes through that TUI's `TerminalOutput` (registered on its first write, cleared by `stop`), so `bytes` and the output stats count them; with no TUI running it writes to stdout as before. Users: the completion-sound BEL (`coding-agent/src/core/completion-sound-io.ts`) and the OSC 52 clipboard sequence (`coding-agent/src/utils/clipboard.ts`). (Review Major 4.)

**Notes.** Node emits `resize` only when the tty size actually changed, so the SIGWINCH omk sends itself on start (stale size after suspend) logs a line only if the size changed while omk was stopped; there are no same-size lines. A suspend/resume cycle (external editor, Ctrl+Z) stops and restarts the terminal, so there can be more than one `final` line; readers take the last one. Writes made while the TUI is stopped (the external-editor notice printed with `process.stdout.write`) are not counted. One module-level `exit` listener serves every `TerminalOutput` (each `stop` removes its own entry, the next write re-adds it), so creating several TUIs does not stack listeners. (Review Minor 3.)

**Zero cost when unset**: no log object is created, and `TerminalOutput.withResizeLog` returns the original resize handler unchanged, so a resize does no extra work and no file is touched.

Code: `packages/tui/src/terminal-resize-log.ts` (`TerminalResizeLog`), owned by `TerminalOutput` (`packages/tui/src/terminal-output.ts`), wired in `ProcessTerminal.start` (`packages/tui/src/terminal.ts`). The final line is written from `TerminalOutput.stop()`, which `ProcessTerminal.stop()` already calls.

## Acceptance criteria

1. `packages/tui/test/regression-resize-scrollback-loss.test.ts` (xterm.js virtual terminal) fails on main and passes with the fix:
   - shrink 40 → 24 rows with three footer rows below the cursor: every transcript row is in scrollback exactly once (main loses 3);
   - shrink 80 → 24 while four rows are appended in the resize frame: every row exactly once (main loses 4);
   - the main-r4 shape (stream, terminal resized, one frame rendered for the old height, resize frame with 4 more rows; 40 → 80 → 24 → 40 with footer rows): no row lost, none printed more than twice (main loses 4; the 2× copies from height *grows* exist on main too and are unchanged).
   - the resize frame appends more rows than the budget (100 rows, 24 → 20, +120 rows): every row exactly once (the first version of this fix lost `C100`..`C140`);
   - a row above the cursor changes in the resize frame (80 rows + 3 footer rows, 40 → 24, `C59` edited): the edited row is in scrollback exactly once and the stale one is gone;
   - full-height right overlay, 100×40, 100 rows + footer, 40 → 24 → 40 dragged one row per event three times: no row lost, none twice (the first version: rows 7×);
   - 10 short rows + the same overlay, 40 → 24 → 40 → 12 → 40: every row exactly once (the first version: 3×);
   - `OMK_DEBUG_REDRAW` height lines carry `first`/`changed`/`cursorRow`/`capped`.
   Unit tests (`terminal-resync.test.ts`): start at the first changed row; at the cursor row when nothing changed; nothing when the frame fits; budget cap boundary; never below the cursor; overlay-only changes do not count.
2. Existing `regression-resize-scrollback-stacking` and `regression-repaint-budget` tests still pass; the full `packages/tui` suite passes.
3. `packages/tui/test/terminal-resize-log.test.ts`: resize lines carry exact UTF-8 `bytes`, `cols`/`rows`, `prevCols`/`prevRows` and monotonic `t`, and are on disk before the resize handler runs; stop appends `{"final":true,"bytes":N}`; `ProcessTerminal` reads the variable; unset returns the same handler and writes no file; `writeTerminalRaw` bytes are counted while a TUI writes and go to stdout after stop; at most one `exit` listener however many outputs log. `coding-agent` tests: the BEL and the OSC 52 sequence reach the running `ProcessTerminal`'s stream and its `submittedBytes`.
4. Gates: `biome check` on changed files, `check-module-size`, `check-import-cycles`, `tsgo --noEmit` for `packages/tui` and `packages/coding-agent`, `coding-agent` vitest.
5. Real run: the scrollback-20 scenario (`capture_height79.py` with `OMK_TUI_RESIZE_LOG` added) on the fixed build loses no strict marker in tmux scrollback, and its `resize-log.jsonl` has one line per resize plus a final line. Results are listed under Verification.

## Non-goals

- Width-change repaints (row identity does not survive reflow) and Termux height changes.
- The duplicate rows a height *grow* leaves (tail repaint over rows the terminal pulled back from scrollback). Bounded by the stacking test; unchanged here.
- The stream-end repair repaint (`firstChanged < viewportTop`) and its duplicates of sections 3–6.
- #79 (windowing). This fix lands on main first; #79 rebases onto it and is re-measured.
- Changing the replayer (`/workspace/omk-staff-replay`) to read the resize log; Staff Engineer owns it.

## Expected Files

- `specs/045-tui-scrollback-loss/spec.md`
- `packages/tui/src/terminal-resync.ts` (new), `packages/tui/src/tui.ts`
- `packages/tui/test/regression-resize-scrollback-loss.test.ts` (new), `packages/tui/test/virtual-terminal.ts` (`resizeEmulatorOnly`, `announceResize`), `packages/tui/test/regression-repaint-budget.test.ts` (comment points at the moved constant)
- `packages/tui/src/terminal-resize-log.ts` (new), `packages/tui/src/terminal-output.ts`, `packages/tui/src/terminal.ts`
- `packages/tui/test/terminal-resize-log.test.ts` (new), `packages/tui/test/terminal-resync.test.ts` (new), `packages/tui/src/index.ts` (`writeTerminalRaw`)
- `packages/coding-agent/src/core/completion-sound-io.ts`, `packages/coding-agent/src/utils/clipboard.ts`, `packages/coding-agent/test/completion-sound.test.ts`, `packages/coding-agent/test/clipboard.test.ts`

## Verification (2026-10-11 KST, Tech Lead)

Scenario: `capture_height79.py` (scrollback-20) copied with `OMK_TUI_RESIZE_LOG=<run>/resize-log.jsonl` added to the omk environment; otherwise unchanged (120×40 → 80 → 24 → 40 at 0.8 s while one reply streams, ~20k-line `--continue` session, offline mock, tmux 3.5a, `nice -n 10`). Strict check = `/workspace/omk-staff-replay/check.mjs` (headline + 72 code lines). Box load (1-min) 1.3–3.0 during the runs; not a quiet box.

| arm | build | runs | strict loss, tmux scrollback | strict loss, replay at pipe offset (shift 0) |
| --- | --- | ---: | ---: | ---: |
| main | `5c9d738` (tui identical to `f887fd2`) | 10 | 3 (r1 `value1_4..1_6`, r8 section-2, r10 `value1_0`) | 2 (r8, r10) |
| fix | this branch | 10 | **0** | **0** |
| #79 + fix | `7ff7bba` + these commits cherry-picked (local only) | 10 | **0** | **0** |

Interleaved main/fix pairs. 0/10 vs 3/10 alone is weak evidence (Fisher one-sided p ≈ 0.105); the deterministic evidence is the regression tests, which fail on main and on #79 `7ff7bba` (3, 4 and 4 rows lost) and pass with the fix. Duplicate markers are unchanged: 46 in every tmux scrollback, fix and main alike (the stream-end repair repaint).

Resize log, fix runs: every run logged one line per resize; mapped to raw pty offsets with the ONLCR rule above, each omk offset is at or after the `pipe-pane` offset (0 to 6.4 KB later, about one frame), as an upper bound should be. On the run that also had `OMK_TUI_WRITE_LOG`, the final line maps exactly to the end of the raw capture (4,452,913 bytes). The 10 runs of the first batch were built before the exit hook and have no final line (`tmux kill-server` exits through EIO without a TUI stop); the 11 runs after it all have one. Replaying the fix and #79+fix captures at the omk offset and at the midpoint: no loss in any of them. At pipe offset −64 (earlier than the lower bound) 2 of the 10 fix runs show a loss in replay; tmux itself lost nothing in those runs.

The real runs above used the first version (`7d75aac`). The review changes (budget never below the cursor, pre-overlay comparison, no resync for frames that fit, counted raw writes) are covered by the tests in criteria 1 and 3 and were not re-run in tmux.

Not verified: real terminals (iTerm2, Windows Terminal/conpty, kitty, Alacritty) — whether each keeps the cursor's row across a height resize the way xterm.js and tmux do; Termux; resizes with a real overlay open in a real terminal (covered in xterm.js only); #79's own verdict (it needs a rebase onto this and a fresh 20-pair run).
