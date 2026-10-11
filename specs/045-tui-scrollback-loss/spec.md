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

1. move up from the cursor's content row (`hardwareCursorRow`) to `first` = the first row that differs from the last frame, but not below the cursor's row, and not earlier than `REPAINT_BUDGET_SCREENS` screens above the end;
2. rewrite rows `first`..end with `\x1b[2K` + row + `\r\n`; rows that no longer fit scroll into scrollback in order.

The tail repaint then lands on a screen that already holds the same rows. If the move up is clamped at the screen top (the first changed row already scrolled away), the changed rows print below their stale copies: duplicated, never lost. When nothing changed and no rows were dropped, step 2 rewrites only the cursor row and the rows below it in place.

Code: `packages/tui/src/terminal-resync.ts` (`resyncAfterResize`, plus `REPAINT_BUDGET_SCREENS`, moved out of `TUI` so both repairs share it), called from the height-change branch of `TUI.doRender`. Width changes keep the existing path (the terminal reflows rows, so row identity does not survive), and so does Termux.

### Resize log: `OMK_TUI_RESIZE_LOG=<path>`

When set, omk appends JSON lines to `<path>` (synchronously, `appendFileSync`):

- **On every resize event**, at the moment omk handles it and before it renders:
  `{"bytes":N,"cols":C,"rows":R,"t":T,"prevCols":PC,"prevRows":PR}`
- **On terminal stop** (TUI stop, including SIGINT/SIGTERM/SIGHUP shutdown paths that stop the TUI):
  `{"final":true,"bytes":N}`. Also on process `exit` when no final line with the same byte count was written yet: a dead terminal's EIO goes from the stdout error handler straight to `process.exit(129)` without stopping the TUI (this is what `tmux kill-server` does to the capture runs), and the exit hook still records the total. After a normal stop the exit hook sees the same count and writes nothing.

`bytes` is the cumulative UTF-8 byte length of everything omk handed to stdout through its terminal writer (`TerminalOutput.write`, the same `submittedBytes` counter as the output stats), counted at the `write()` call. These are omk-side bytes, not pty bytes: no compensation for ONLCR `\n` → `\r\n`; the replayer converts. The tty's ONLCR turns *every* `\n` into `\r\n`, including the `\r\n` omk already writes, so the pty stream carries one extra byte per `\n`: raw offset R matches omk count B when `R − (number of \n in raw[0..R)) = B`. `t` is `performance.now()` in ms (monotonic). `prevCols`/`prevRows` are the size at the previous logged event (the size at start for the first one).

**Bounds.** A resize line's `bytes` is an **upper bound** for where the resize hit the byte stream: bytes omk wrote but the terminal (tmux) had not read yet may be processed at the new size. The external `pipe-pane` file size taken before `resize-window` is a **lower bound**. The replayer judges at both ends and at the midpoint.

**Notes.** omk sends itself SIGWINCH on start (stale size after suspend), which logs one line with unchanged size. A suspend/resume cycle (external editor, Ctrl+Z) stops and restarts the terminal, so there can be more than one `final` line; readers take the last one. Writes that bypass the terminal writer (the external-editor notice printed with `process.stdout.write` while the TUI is stopped) are not counted.

**Zero cost when unset**: no log object is created, and `TerminalOutput.withResizeLog` returns the original resize handler unchanged, so a resize does no extra work and no file is touched.

Code: `packages/tui/src/terminal-resize-log.ts` (`TerminalResizeLog`), owned by `TerminalOutput` (`packages/tui/src/terminal-output.ts`), wired in `ProcessTerminal.start` (`packages/tui/src/terminal.ts`). The final line is written from `TerminalOutput.stop()`, which `ProcessTerminal.stop()` already calls.

## Acceptance criteria

1. `packages/tui/test/regression-resize-scrollback-loss.test.ts` (xterm.js virtual terminal) fails on main and passes with the fix:
   - shrink 40 → 24 rows with three footer rows below the cursor: every transcript row is in scrollback exactly once (main loses 3);
   - shrink 80 → 24 while four rows are appended in the resize frame: every row exactly once (main loses 4);
   - the main-r4 shape (stream, terminal resized, one frame rendered for the old height, resize frame with 4 more rows; 40 → 80 → 24 → 40 with footer rows): no row lost, none printed more than twice (main loses 4; the 2× copies from height *grows* exist on main too and are unchanged).
2. Existing `regression-resize-scrollback-stacking` and `regression-repaint-budget` tests still pass; the full `packages/tui` suite passes.
3. `packages/tui/test/terminal-resize-log.test.ts`: resize lines carry exact UTF-8 `bytes`, `cols`/`rows`, `prevCols`/`prevRows` and monotonic `t`, and are on disk before the resize handler runs; stop appends `{"final":true,"bytes":N}`; `ProcessTerminal` reads the variable; unset returns the same handler and writes no file.
4. Gates: `biome check` on changed files, `check-module-size`, `check-import-cycles`, `tsgo --noEmit` for `packages/tui`.
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
- `packages/tui/test/terminal-resize-log.test.ts` (new)

## Verification

Filled in from the runs; see the PR body.
