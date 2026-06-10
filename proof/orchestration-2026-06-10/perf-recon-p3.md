# Perf Recon P3 — RENDER/STRING/SERIALIZE Hot Paths

**Scope:** READ-ONLY recon. No edits performed.  
**Files scanned:** 12 renderer/theme/cockpit source files  
**Date:** 2026-06-10

---

## Executive Summary

The cockpit render path (`src/commands/cockpit/render.ts`) dominates cost per frame, with an **O(n²) array-splice loop** and **redundant ANSI sanitization cascades** (~7 regex passes per line, twice per line). The System24 assistant-final path (`src/cli/ui/system24-renderer.ts`) is the second hotspot: **~8+ regex operations per line** of markdown output, multiplied by streaming `control:output` double-stripping. The OKLab LUT is confirmed built once — not a concern.

---

## Ranked Findings Table

| Rank | File:Line | Hot-Path Justification | Complexity | Behavior-Preserving Fix + Expected Gain | Risk |
|------|-----------|------------------------|------------|----------------------------------------|------|
| **1** | `src/commands/cockpit/render.ts:956` | **Per cockpit refresh frame** (~200 ms–2 s). Frame padding loop `while (body.length < bodyHeight) body.splice(stickyHeaderLines.length, 0, "");` shifts the tail array on every iteration. For bodyHeight=50 and current length=10, 40 splices shift up to 40+39+…+1 ≈ 800 element moves. | **O(n²)** array shifts | Replace loop with single splice: `body.splice(stickyHeaderLines.length, 0, ...Array(bodyHeight - body.length).fill(""));` or preallocate array length. **Gain:** removes quadratic cost; ~2–5× faster on large frames. | **SAFE-ISOLATED** |
| **2** | `src/commands/cockpit/render.ts:829` → `src/theme/layout.ts:89` → `src/theme/ansi.ts:43` | **Per cockpit refresh frame**. `panel()` → `box()` calls `stripAnsi()` → `sanitizeTerminalText()` (4 regex `.replace()` + `stripBrokenAnsi` 3 more) to compute max width. `panel()` also calls `padEndVisible()` → `visibleTerminalWidth()` → `sanitizeTerminalText()` **again** on the same lines. 4 panels × ~20 lines × 2 sanitizes ≈ **160 regex passes/frame**. | **O(lines × regex passes)** | Cache `stripAnsi` result per line inside `box`, or add a `visibleWidthFast` that reuses the already-truncated/sanitized `processed` array from `panel()`. **Gain:** ~30–50% reduction in cockpit render CPU. | **SAFE-ISOLATED** |
| **3** | `src/cli/ui/system24-renderer.ts:385–403` | **Per assistant:final message** (every assistant output). `event.text.split("\n")` then per line: `.match(RE_HEADER)`, `.match(RE_LIST_ITEM)`, `.match(RE_NUMBERED_LIST)`, `.test(HR)`, `.trim()`, `renderInline()` (5 regex replaces), `renderPanelLine()` → `visibleLen()` → `stripAnsi()`. For a 100-line output ≈ **800+ regex ops + 100 stripAnsi calls**. | **O(lines × regex ops)** | Cache `visibleLen` once per line (store in map). Combine `renderInline` into a single-pass loop instead of 5 chained `.replace()` calls. **Gain:** ~2–3× faster on large markdown blocks. | **SAFE-ISOLATED** for caching; **RISKY** for single-pass rewrite |
| **4** | `src/theme/layout.ts:62–78` (`gradient`) | **Per panel title render** (cockpit header + any titled panel). `gradient()` iterates per character, calling `esc(rgb(...))` which invokes `isColorEnabled()` + `isSafeAnsiCode(/^[0-9;]{1,48}$/)` **per character**. A 50-char title = 50 function calls + 50 regex tests. | **O(chars × fn calls)** | Hoist `const colorOn = isColorEnabled()` at gradient entry; use a thin `escFast(codes)` that skips `isSafeAnsiCode` when codes are known-generated from `rgb()`. **Gain:** ~2× faster gradient rendering, negligible at current scale but scales with title length. | **SAFE-ISOLATED** |
| **5** | `src/cli/ui/system24-renderer.ts:339–346` | **Per streaming control:output token/frame**. `stripAnsi(sanitizeUserVisibleOutput(event.text))` strips once, then `.split("\n")` iterates, and `renderPanelLine` calls `visibleLen` → `stripAnsi()` **again** on every line. Double-stripping on hot streaming path. | **O(tokens × lines × regex)** | Compute `visibleLen` from the already-stripped `sanitized` string, or cache strip results in a WeakMap. **Gain:** ~30% reduction in streaming render overhead. | **SAFE-ISOLATED** |
| **6** | `src/runtime/renderers.ts:173–176` | **Per assistant result** (ThemeRenderer). `content.split("\n")` allocates an intermediate array for potentially very large strings (10 KB+ file dumps). Creates ~200 string objects then loops to emit. | **O(content length)** allocation | Use a generator or `indexOf` loop to emit lines without `split` array, or cap to first N lines with overflow indicator. **Gain:** reduces GC pressure on large outputs; ~1.5–2× faster for >5 KB blocks. | **SAFE-ISOLATED** |
| **7** | `src/cli/ui/rich-renderer.ts:51–65` (`renderInlineMarkdown`) | **Per assistant:final message** (RichRenderer path). 5 chained `.replace()` passes per line (`**bold**, __bold__, *italic*, \`code\`, [links]`). For 100 lines = 500 regex passes. Regex literals are cached by V8, but 5 passes remain. | **O(lines × 5 regex)** | Combine bold/italic into fewer passes, or use a single manual scan. Low priority because RichRenderer is not the default. **Gain:** modest, ~20% on rich-rendered long messages. | **SAFE-ISOLATED** |
| **8** | `src/cli/theme/oklab-quantize.ts:112` | **Module load time only**. `XTERM_PALETTE` is built once via `buildXtermPalette()` at top level. | **O(1)** after load | Confirmed **NOT a hotspot**. LUT is cached. No fix needed. | **N/A** |

---

## Honorable Mentions (Lower Impact)

- **`src/runtime/renderers.ts:47`** — `stripAnsi` regex literal is cached by JS engine, but it’s duplicated in 15+ files. Consolidating into `theme/ansi.ts` would reduce bundle size and maintenance drift.
- **`src/commands/cockpit/render.ts:827`** — `layoutPanel(...).split("\n")` round-trips a string that `box` already joined. Returning lines directly from `box`/`panel` would eliminate the split, but gain is minor compared to #1–#3.
- **`src/util/terminal-layout.ts:73`** (`truncateLine`) — per-character loop over ANSI segments is necessary for correct width handling. No safe optimization without breaking CJK/wide-char support.

---

## Verification Commands (for later)

```bash
# 1. Confirm splice hotspot line still exists
grep -n 'while (body.length < bodyHeight) body.splice' src/commands/cockpit/render.ts

# 2. Count stripAnsi/sanitizeTerminalText call sites in cockpit render
grep -c 'stripAnsi\|sanitizeTerminalText' src/commands/cockpit/render.ts

# 3. Check gradient esc calls per char
grep -n 'esc(rgb(' src/theme/layout.ts

# 4. Confirm LUT is module-level const
grep -n 'const XTERM_PALETTE' src/cli/theme/oklab-quantize.ts
```
