---
description: "Off-screen chat transcript windowing so TUI frame time and retained caches do not grow with history"
---

# Feature Specification: TUI Chat Transcript Windowing

**Specification ID**: `022-tui-chat-windowing`
**Created**: 2026-10-06
**Status**: Specified; implementation follows this document
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Tech-lead perf goal — in long interactive sessions, render time and TUI memory must not grow linearly with transcript length; implement off-screen windowing / virtualization for ChatContainer / message components.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: advance

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Keypress / frame latency | `main` @ `8baa7435f`: headless FakeTerminal 120×40 sync `doRender` ~1.6 / ~8.1 / ~52.7 ms mean at 5k / 25k / 100k transcript lines | Mean `doRender` ≤ 2.0 / 3.0 / 5.0 ms at 5k / 25k / 100k; 100k must not be ~4× the 25k figure (AC1) | Must stay below those ceilings on the same harness; no return to O(N) full-buffer reset+diff as the dominant term | `nice -n 19 node --experimental-strip-types` headless harness documented in AC1 (or PR body); `node --test packages/tui/test/windowed-container.test.ts packages/tui/test/line-reset-memo.test.ts` | PR #79 body before/after table; `packages/tui/test/windowed-container.test.ts` |
| Frozen render-cache retention | Every message keeps `cachedLines` / Box `cache.lines` for the full history | After freeze, frozen children’s render-cache char sum is **0** (AC2) | Frozen cache chars must remain 0 after freeze on the AC2 walk | same `node --test` windowed-container cache-release case | `releases render caches on frozen children` |
| Render equivalence | Full `Container` render is the oracle | Windowed ≡ full across resize, invalidate, live mutate, unsettled late-complete, generation bump, message-object swap, randomized late old-child mutation (AC3 / AC5) | `0` mismatches on those cases | `node --test packages/tui/test/windowed-container.test.ts` | that test file |

## Measurement findings (before design)

Headless harness on this box (`nice -n 19`, Node 22, FakeTerminal 120×40, sync `doRender`, chat of alternating `Box(Text)` / `Text` plus a live editor `Text` changed every frame):

| Transcript lines | `chat.render` mean | `doRender` mean | Notes |
| --- | ---: | ---: | --- |
| 5k | 0.32 ms | 1.6 ms | |
| 25k | 2.2 ms | 8.1 ms | Matches the reported ~9 ms keypress |
| 100k | 22.6 ms | 52.7 ms | Linear in line count |

Breakdown at 25k (one frame): tree render ~1.6 ms, applyLineResets-sim ~0.9 ms, full-buffer string diff ~5.2 ms. At 100k the diff alone is ~40 ms.

Retained heap after GC for 200 turns × ~20 KB text: process heap ~102 MB; `cachedLines` / Box `cache.lines` ≈ 8.2M chars (~15.6 MB UTF-16 rough).

Architecture note: `TUI.doRender` already paints only the visible tail into the terminal and leaves finished rows in scrollback, but every frame still (1) re-renders the full component tree to a full `newLines` array, (2) runs `applyLineResets` on every row, and (3) diffs against `previousLines`. Component `cachedLines` hits do not remove (2)/(3). Off-screen windowing alone cuts (1) for frozen messages and can drop their caches; stopping linear (2)/(3) requires reusing prior reset output for unchanged raw line refs (LineResetMemo). Both are in scope for this spec’s acceptance targets.

## Goal

Make interactive chat transcript rendering scale with the **live window** (viewport + margin), not with total history:

1. Finished messages that sit above the live window stop being re-rendered and release their render caches (`cachedLines` / Box cache).
2. A frozen-prefix line buffer supplies those rows on later frames so `previousLines` / scrollback semantics stay correct.
3. Unchanged raw line references reuse the previous frame’s reset-applied strings so applyLineResets and the diff loop stay on the cheap reference-equality path for the frozen prefix (and any other unchanged rows).

Correctness must hold across width resize, theme `invalidate()`, tool output expand/collapse in the live window, streaming append at the tail, and `/resume` with a large saved session (first render may be expensive; steady-state frames must not).

## Acceptance criteria

### AC1 — Frame time / keypress latency does not grow linearly

**Method** (document in the PR body; harness may live under `packages/tui/test/` as a runnable script or test):

- FakeTerminal: `columns=120`, `rows=40`; `write` is a byte sink (no xterm).
- Transcript: alternating user-like `Box(Text)` and assistant-like `Text`, `Spacer(1)` between, built until ≥ N lines; live editor `Text` below chat; each measured frame does `editor.setText(...)` then synchronous `doRender()` (private/`as` access is fine for the harness).
- Warm-up 5 frames after caches are populated; then ≥ 30 frames at 5k/25k, ≥ 12 at 100k.
- Report mean and p95 `doRender` ms.

**Pass**:

| N lines | Mean `doRender` after change |
| --- | --- |
| 5k | ≤ 2.0 ms |
| 25k | ≤ 3.0 ms (was ~8–9 ms on main) |
| 100k | ≤ 5.0 ms (was ~50 ms on main); must not be ~4× the 25k figure |

Steady-state cost may grow with the live window and changed tail, not with N.

### AC2 — Retained TUI render caches after freeze

**Method**: Build 200 turns × ~20 KB assistant/user text under a `WindowedContainer` / `ChatContainer` with a live-line budget that freezes the prefix; call `render(120)` once to freeze; `global.gc()` (`node --expose-gc`); walk the tree and sum characters in `cachedLines` and Box `cache.lines` for **frozen** children (must be 0). Optionally report process `heapUsed` delta for context (session structures outside TUI are out of scope).

**Pass**: After freeze, frozen children’s render caches hold **0** characters. Live-window caches may remain.

### AC3 — Windowed vs full render equivalence

**Method**: Automated test(s) in `packages/tui` and/or `packages/coding-agent`:

1. Build the same child list in a plain `Container` and a `WindowedContainer` (live budget small enough to freeze).
2. Assert `windowed.render(w)` deep-equals `full.render(w)` for a fixed width.
3. Resize to a different width; both must match again (windowed must thaw / re-layout).
4. Call `invalidate()` (theme path); both must match.
5. Mutate a live-tail child (simulate tool expand/collapse or streaming `setText` append); both must match.
6. Randomized property: random ASCII bodies, widths in `{40,80,120}`, freeze budgets, append/invalidate/resize, **and late mutation / message-object swap of early (likely frozen) children** — windowed output equals full output every step.

**Pass**: Zero mismatches on the scripted cases; randomized case reports 0 mismatches for the chosen trial count.

### AC5 — Unsettled children stay live; frozen changes thaw

**Method** (package tests with duck-typed stand-ins; coding-agent wiring of `isRenderSettled` is a follow-up via spec 026):

1. A child with `isRenderSettled() === false` must not enter the frozen prefix even when the live budget is exceeded; after it `complete()`s / settles, the next `render` must show the new content and match a full `Container`.
2. A settled child that was frozen, then bumps `getRenderGeneration()` (setText / expand / **message object replacement**), must thaw/recompute so the next `render` matches full and includes the new content. Windowing must not rely on message object identity alone.

**Pass**: Dedicated cases in `windowed-container.test.ts` for pending→complete, generation bump, and message-object swap; randomized suite includes late old-child mutation and swap.

### AC4 — Gates

From repo root, with `PATH` including Node 22 and `nice -n 19`:

- `node_modules/.bin/biome check` on every changed file
- `node scripts/check-module-size.mjs` (do not grow `interactive-mode.ts` past its baseline; new modules ≤ 250 pure LOC or justified)
- `node scripts/check-import-cycles.mjs`
- `../../node_modules/.bin/tsgo --noEmit -p .` in each touched package
- Related vitest / `node --test` paths for new and adjacent tests

## Non-goals

- **Box child-output reuse / shallow cache compare** (open PR #56 Box half) — do not rewrite `box.ts` matching logic here.
- **visibleWidth fast path** (#55), **MarkdownStreamCache** (#65), **SelectList column-width cache** (#67), **FooterMetricsTimer** (#69), **Markdown/Text setText dedupe** (#70) — leave to those PRs.
- Changing terminal scrollback / differential paint policy beyond what LineResetMemo + frozen prefix need.
- Dropping session/agent transcript retention (membench session-side duplication).
- Manual interactive QA on real terminals (explicitly unverified; report as such).
- Growing `interactive-mode.ts` to thread terminal rows; ChatContainer / WindowedContainer should own a configurable live-line budget with a safe default so the interactive-mode baseline does not rise.

## Design (chosen)

1. **`WindowedContainer`** (`packages/tui`): extends `Container`; keeps `frozenLines` + `frozenChildCount` + per-frozen `getRenderGeneration` snapshots; `setLiveLineBudget(n)`; on `render(width)`, thaw if width changed, `invalidate()`, a frozen child is unsettled, or a frozen child’s generation moved; render only children from `frozenChildCount`; while live lines exceed the budget, peel leading **settled** children into `frozenLines` and duck-type-release their render caches — **stop at the first unsettled child** (`isRenderSettled?(): boolean`; missing hook ⇒ settled); return `frozenLines.concat(live)`.
2. **`ChatContainer`**: extend `WindowedContainer` instead of `Container`; keep dispose/clear; default live budget (~3×40 or `setLiveLineBudget` from tests).
3. **`LineResetMemo`**: extract applyLineResets + kitty id scan to `line-reset-memo.ts`; reuse prior out/ids when `raw[i] === previous raw[i]` so frozen prefix refs stay reference-equal through reset and diff. Overlaps open PR #56’s memo file by intent; Box half of #56 stays out (non-goal).
4. **Settle semantics (single source of truth)**: packages/tui only defines the duck-typed hooks. Whether an assistant/tool message is settled is **not** reimplemented in coding-agent ad hoc — a shared predicate from spec `026-message-settled` (Staff) will back `isRenderSettled` / generation bumps on `AssistantMessageComponent` / `ToolExecutionComponent` in a **follow-up** once that PR lands. Generation must bump on content mutate **and** on agent-loop message-object replacement (`updateContent` / `setMessage` style), not only on in-place field mutation.

## Files to be touched

| Path | Change |
| --- | --- |
| `specs/022-tui-chat-windowing/spec.md` | This specification (first commit) |
| `packages/tui/src/windowed-container.ts` | New: frozen-prefix windowing |
| `packages/tui/src/line-reset-memo.ts` | New: LineResetMemo + SEGMENT_RESET / extractKittyImageIds move |
| `packages/tui/src/tui.ts` | Wire LineResetMemo; remove inlined reset/id helpers (pure LOC must not grow past baseline) |
| `packages/tui/src/index.ts` | Export `WindowedContainer`, `releaseRenderCache`, `isRenderSettled` |
| `packages/tui/test/windowed-container.test.ts` | Equivalence + freeze/cache-release tests (incl. randomized if feasible) |
| `packages/tui/test/line-reset-memo.test.ts` | Memo reuse / identity tests |
| `packages/coding-agent/src/modes/interactive/components/chat-container.ts` | Extend `WindowedContainer` |
| `packages/tui/CHANGELOG.md` | `[Unreleased]` entry |
| `packages/coding-agent/CHANGELOG.md` | `[Unreleased]` entry |
| Optional harness script under `packages/tui/test/` | AC1/AC2 measurement (not required to run in CI every time) |

Do **not** touch: `interactive-mode.ts` (baseline), `box.ts` / `markdown.ts` reuse logic from sibling PRs, `/workspace/omk-r7`, membench trees, or other agents’ worktrees.

## Risks / merge notes

- PR #56 also adds `line-reset-memo.ts` and rewires `tui.ts`. This spec’s memo should stay API-compatible (`apply`, `kittyImageIds`, `SEGMENT_RESET`, `extractKittyImageIds`) so a later merge keeps one implementation.
- **#65 MarkdownStreamCache**: `releaseRenderCache` already prefers an explicit `releaseRenderCache()` method and also clears a duck-typed `streamCache` field if present. When #65 merges, Markdown should implement `releaseRenderCache()` (or keep `streamCache` as an own field) so freeze drops the stream cache in one place — do not teach WindowedContainer about Markdown internals beyond that.
- **Follow-up (not in this PR’s coding-agent wiring)**: wire `isRenderSettled` / `getRenderGeneration` on assistant + tool components **only** by importing Staff’s shared settled predicate (spec 026). Until then, plain children remain freeze-eligible (hook absent ⇒ settled); TUI tests cover the hooks with stand-ins.
- Live-window expand/collapse and frozen generation bumps / message swaps are covered by AC3/AC5. Terminal scrollback rows already emitted for a prior view are not rewritten (existing TUI scrollback policy).
