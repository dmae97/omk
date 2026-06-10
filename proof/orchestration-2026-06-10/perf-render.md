# Lane PERF-RENDER — cockpit render hot-path fixes

**Mode:** APPLY · behavior-preserving · no commit · no web
**Date:** 2026-06-10
**Scope:** 2 SAFE-ISOLATED items (P3#1, P3#2). RISKY single-pass renderer rewrite (P3#3) intentionally SKIPPED.

---

## Changed files & why

| File | Change |
|------|--------|
| `src/commands/cockpit/render.ts` (:956) | **P3#1** — replaced O(n²) per-iteration `while (body.length < bodyHeight) body.splice(stickyHeaderLines.length, 0, "")` loop with a single `body.splice(h, 0, ...Array(padCount).fill(""))`. |
| `src/theme/layout.ts` (`box` :38, `panel` :99) | **P3#2** — measure each line's visible width once (`stripAnsi(l).length`) and reuse it for both inner-width math and right-padding, removing the redundant second strip that `padEndAnsi()` performed internally. Dropped now-unused `padEndAnsi` import. |
| `src/theme/ansi.ts` | **No edit needed** — the redundant second strip lived in `layout.ts`’s `box`/`panel`; fixing it there is the minimal, in-scope change. `ansi.ts` left untouched (no global cache risk). |
| `test/perf-render-identity.test.mjs` (new) | Byte-identity + bench proofs (5 tests). |

Cockpit call path confirmed: `render.ts` → `terminal-layout.panel` → `theme/layout.box` (via `util/theme` → `theme/index` re-export). `box` **is** on the cockpit hot path. `util/terminal-layout.ts` is out of scope and untouched.

---

## Complexity before/after

**P3#1 body padding** (per cockpit refresh frame, renderer path)
- Before: `O(n²)` — N insertions each shifting the array tail (bodyHeight=800, len=10 ⇒ ~314k element moves/frame).
- After: `O(n)` — one splice inserting `padCount` empties at a fixed index. Identical final array.

**P3#2 ANSI strip cascade** (per panel line, per frame)
- Before: each line stripped **twice** inside `box`/`panel` — once for `rawInner` (`stripAnsi(l).length`) and again inside `padEndAnsi(l)`.
- After: stripped **once** per line; visible width reused. ~50% fewer `sanitizeTerminalText` passes on the box-side of the cockpit panel cascade (the ~160 regex-passes/frame item).

---

## Output-identity proof (snapshot equality)

`test/perf-render-identity.test.mjs` embeds faithful copies of the **original** `box`/`panel` bodies (the "before", using `padEndAnsi`) and asserts `strictEqual` against the optimized production functions across a representative matrix:
- titles: none / plain / ANSI-colored / Korean+symbol
- line sets: empty, plain, over-width, ANSI-colored, **wide CJK (한글/你好)**, **emoji 🚀🔥**, mixed
- P3#1: `newPad` vs `oldPad` `deepStrictEqual` over edge cases incl. no-pad, truncation, and an **800-line** body.

Algebraic identity: `padEndAnsi(l, w) === l + " ".repeat(max(0, w - stripAnsi(l).length))`, and `visibleWidth = stripAnsi(l).length` is reused verbatim ⇒ bytes unchanged.

---

## Test + bench results

```
node --test test/perf-render-identity.test.mjs   → 5 pass / 0 fail
  P3#2 box() byte-identical .......... ok
  P3#2 panel() byte-identical ........ ok
  P3#1 single-splice == loop ......... ok
  P3#1 micro-bench ................... ok   [perf-render] splice 800-line × 400: old=12.98ms new=2.51ms speedup=5.2x
  P3#1 cockpit frame integration ..... ok

Regression (existing): node --test cockpit-scroll, cockpit-render-core,
  cockpit-render-state, cockpit-render-rail, theme, theme-degradation,
  brand-theme  → 76 pass / 0 fail

npx tsc --noEmit | grep 'error TS'   → none (changed files clean)
eslint src/commands/cockpit/render.ts src/theme/layout.ts src/theme/ansi.ts → 0 warnings
npm run color:gate → passed
```

---

## Residual risk

- **Low.** Both changes are algebraically byte-identical and proven against reference implementations + 76 existing snapshot/structure tests.
- `Array(padCount).fill("")` spread is bounded by `bodyHeight` (≤ frame height, tens of rows) — no spread/stack-size concern.
- `theme/layout.panel` was optimized for consistency though the cockpit reaches `box`; both verified identical.
- `util/terminal-layout.ts` still double-strips via `truncateLine`+`padEndVisible` (out of scope) — a further ~25% strip reduction remains available there if a future lane is authorized to edit it.
- No commit made (per task). Concurrent lane edits (secret-scanner/sandbox/tool-dispatch) left untouched.
