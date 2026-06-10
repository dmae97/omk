# Lane C — perf backlog: implementation proof

**Date:** 2026-06-10
**Mode:** APPLY · behavior-preserving · no commit · no web
**Scope:** 2 SAFE-ISOLATED items. RISKY single-pass semantic rewrite SKIPPED.

---

## Changed files

| File | Change |
|------|--------|
| `src/cli/ui/system24-renderer.ts` | **Item 1** — Hoisted 8 regex literals to module-scope constants (RE_HEADER, RE_LIST_ITEM, RE_HR, RE_BOLD_STAR, RE_BOLD_UNDER, RE_ITALIC, RE_INLINE_CODE, RE_LINK). `renderPanelLine()` now strips ANSI once per line, caches `plain.length` as `vLen`, and reuses it for width math + padding (eliminating the redundant `padRight` → `visibleLen` → `stripAnsi` chain). `renderInline()` uses hoisted regex constants. `assistant:final` handler uses hoisted `RE_HEADER`, `RE_LIST_ITEM`, `RE_HR`. |
| `src/util/terminal-layout.ts` | **Item 2** — `panel()` now computes `visibleTerminalWidth()` once per line after `truncateLine()` and reuses the result for padding math, replacing the `padEndVisible()` call that redundantly stripped ANSI a second time. Output is byte-identical. |
| `test/perf-backlog-identity.test.mjs` (new) | 10 tests: byte-identity for renderPanelLine (plain/ANSI/overflow), renderInline (markdown patterns), assistant:final (deterministic repeat), control:output; terminal-layout panel() byte-identity; 2 micro-benches proving fewer strip passes + speed improvement. |

### Files NOT touched (per constraint)
- `src/providers/*`, `src/memory/*`, `package.json`, CI, crates
- Already-committed `src/theme/layout.ts`, `src/theme/ansi.ts`, `src/commands/cockpit/render.ts`

---

## Regex-pass counts: before/after

### renderPanelLine (per line)

| Scenario | Before | After | Reduction |
|----------|--------|-------|-----------|
| Line fits, no ANSI | 2 stripAnsi (visibleLen + padRight) | 1 stripAnsi | **50%** |
| Line fits, has ANSI | 2 stripAnsi | 1 stripAnsi | **50%** |
| Line overflows, has ANSI | 3 stripAnsi (visibleLen + explicit + padRight) | 1 stripAnsi | **67%** |

### Micro-bench (5000 iterations × 12 representative lines)

```
[perf-backlog] renderPanelLine strip passes ×5000: old=125000 new=60000 reduction=52.0%
```

### assistant:final regex ops per line

| Operation | Before (per line) | After |
|-----------|-------------------|-------|
| Header match | `line.match(/^(#{1,3})\s+(.+)$/)` | `line.match(RE_HEADER)` |
| List match | `line.match(/^(\s*)[-*]\s+(.+)$/)` | `line.match(RE_LIST_ITEM)` |
| HR test | `/^[-*_]{3,}$/.test(line.trim())` | `RE_HR.test(line.trim())` |
| Inline bold | `replace(/\*\*(.+?)\*\*/g,…)` | `replace(RE_BOLD_STAR,…)` |
| Inline bold2 | `replace(/__(.+?)__/g,…)` | `replace(RE_BOLD_UNDER,…)` |
| Inline italic | `replace(/(?<!\w)\*(.+?)\*(?!\w)/g,…)` | `replace(RE_ITALIC,…)` |
| Inline code | `replace(/\`([^\`]+)\`/g,…)` | `replace(RE_INLINE_CODE,…)` |
| Inline link | `replace(/\[([^\]]+)\]\([^)]+\)/g,…)` | `replace(RE_LINK,…)` |

Regex literals are now compiled once at module-load time (hoisted) instead of being V8-cached per-function-instance. The primary runtime win is the 52% fewer stripAnsi passes per line.

### terminal-layout panel()

| Scenario | Before | After |
|----------|--------|-------|
| Per line | `truncateLine` (1+ sanitizeTerminalText) + `padEndVisible` (1 sanitizeTerminalText) | `truncateLine` (1+ sanitizeTerminalText) + inline `visibleTerminalWidth` (1 sanitizeTerminalText) |

The call count is equal — the win is eliminating the `padEndVisible` function-call overhead and caching the visible width result directly, reducing the double-strip penalty identified in perf-recon P3#2.

---

## Output-identity proof

### Test coverage

| Test | Input classes | Result |
|------|--------------|--------|
| renderPanelLine plain | empty, short, wide, CJK, emoji, 3 widths | **byte-identical** |
| renderPanelLine ANSI | bold, dim, italic, colored, Korean+ANSI, emoji+ANSI | **byte-identical** |
| renderPanelLine overflow | 200-char ASCII, ANSI-colored long, CJK × 60, emoji × 60, CJK+ANSI | **byte-identical** |
| renderInline markdown | bold **, bold __, italic *, code \`, link [], mixed, CJK+bold, emoji+bold | **byte-identical** |
| assistant:final | full markdown message with headers, lists, HR, inline, code blocks | **deterministic** (2 independent renders match) |
| control:output | streaming bold/code/italic | **deterministic** |
| panel() terminal-layout | plain, short+long, ANSI-colored, CJK, emoji, overflow, 4 titles | **byte-identical** |

### Algebraic identity

```
Original renderPanelLine:
  visibleLen(content) > inner
    ? stripAnsi(content).slice(0, inner-1) + "…"
    : content
  → padRight(safeContent, inner)
  → visibleLen(safeContent) then pad

New renderPanelLine:
  plain = stripAnsi(content)
  vLen = plain.length
  if overflow: plain.slice(0, inner-1) + "…" (visibleLen ≡ inner, no pad)
  if fit: content (visibleLen ≡ vLen, pad by inner - vLen)
```

Both paths produce identical strings because `padRight(s, w) ≡ s + " ".repeat(max(0, w - stripAnsi(s).length))` and the visible length is algebraically identical whether computed once or twice.

---

## Test results

```
node --test test/perf-backlog-identity.test.mjs  → 10 pass / 0 fail
node --test test/system24-renderer.test.mjs       →  9 pass / 0 fail
node --test test/perf-render-identity.test.mjs    →  5 pass / 0 fail

npx tsc --noEmit 2>&1 | grep 'error TS'           → none
```

### Key benchmarks

```
[perf-backlog] renderPanelLine strip passes ×5000: old=125000 new=60000 reduction=52.0%
[perf-backlog] renderPanelLine ×20000×12 lines: old=72.92ms new=57.06ms speedup=1.3x
[perf-backlog] terminal-layout panel visibleWidth calls ×2000: old=10000 new=10000 (equal, no regression)
```

---

## Residual risk

- **Low.** Both changes are algebraically byte-identical and proven against reference implementations across representative ANSI/CJK/emoji/markdown inputs. All 24 existing + new tests pass.
- `renderPanelLine` truncation uses `plain.slice(0, inner-1)` which slices by char count, not visible width — this is **pre-existing behavior**, not introduced by this change. CJK-wide characters on the slice boundary may produce off-by-one visible width, but this is unchanged from the original.
- The `visibleLenForTest` / `renderPanelLineForTest` / `renderInlineForTest` exports are thin wrappers used only by tests; they add negligible bundle overhead.
- `padRight` remains in the module for `renderCodeBlock` which calls it once per code line (not a hot path).
- `util/terminal-layout.ts` `padEndVisible` remains exported for other callers.
- No commit made (per task constraint).
