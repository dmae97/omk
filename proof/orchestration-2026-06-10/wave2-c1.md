# Lane C1 — secret-scanner getLineColumn perf fix

Date: 2026-06-10
Scope: behavior-preserving O(matches×n) → O(n + matches·log n) fix.
Constraint compliance: edited ONLY `src/mcp/secret-scanner.ts` and
`test/secret-scanner.test.mjs`. No package.json / CI / crates / native touched.
Not committed. No web. No `any` introduced.

## Files changed

- `src/mcp/secret-scanner.ts` (+48 / -11)
- `test/secret-scanner.test.mjs` (+83)

## Diff hunks summary

1. `getLineColumn(text, offset)` → `getLineColumn(text, offset, lineStarts?)`.
   - New optional `lineStarts?: number[]` param (backward compatible — other
     callers / external callers without the index get the original loop).
   - When `lineStarts` is omitted: identical original O(offset) scan (fallback).
   - When provided: binary search for the rightmost line-start `<= offset`.
     `line = idx + 1`, `column = offset - lineStarts[idx] + 1`.

2. New helper `computeLineStarts(text): number[]`.
   - `lineStarts[0] = 0`; pushes `i + 1` after every `"\n"`. Single O(n) pass.

3. Call sites updated to build the index once per scan and pass it:
   - `scanText` (~:454): `const lineStarts = this.computeLineStarts(text);`
     then `getLineColumn(text, offset, lineStarts)`.
   - `findInText` (~:696): same pattern.

## Before / after complexity

- Before: `getLineColumn` is O(offset) and is called once per match. With M
  matches over content length N this is O(M·N) → quadratic on large inputs with
  many matches.
- After: `computeLineStarts` runs once per scanned string = O(N). Each match
  lookup is O(log L) where L = number of lines. Total O(N + M·log L). Memory:
  one `number[]` of size L per scan.

## Behavior preservation (edge cases verified)

- offset at start (0) → line 1, col 1.
- offset immediately after `"\n"` → col 1, line incremented.
- offset at EOF (offset === text.length) → handled by full-content index.
- CRLF: `"\r"` is NOT a line break in the original; binary search keys only on
  `"\n"`, so `"\r"` is counted as an ordinary column char exactly as before.
- No-newline content → col = offset + 1 (matches original).
- Regression test asserts equality against a brute-force reference
  (`refLineColumn`, copied from the original loop) for EVERY finding on a
  300+-match multi-line input mixing leading/mid/CRLF lines.

## Tests added (test/secret-scanner.test.mjs)

- `line/col match brute-force reference on multi-line input with many matches`
  — 300+ AWS-key matches; asserts line AND column equal brute-force ref per find.
- `line/col correct at edge offsets (start, after \n, EOF)` — explicit
  start/after-newline/EOF assertions.
- `micro-bench: 200KB input with 500 matches completes well under threshold`
  — builds ~200KB input with exactly 500 matches; asserts elapsed < 1500ms.

## Commands run + result

```
$ npx tsc            # secret-scanner.ts: 0 errors (dist emitted, computeLineStarts present)
                     # NOTE: pre-existing unrelated errors in src/runtime/sandbox-profile.ts
                     #       (concurrent edit by another lane, not touched here)
$ node --test test/secret-scanner.test.mjs
# tests 53
# pass 53
# fail 0
=> PASS  (incl. tests 13/14/15 = the 3 new Lane C1 tests)

$ node node_modules/eslint/bin/eslint.js --max-warnings=0 src/mcp/secret-scanner.ts
ESLINT_EXIT=0   => PASS (clean)
```

## Remaining risk / follow-up

- Low. Change is behavior-preserving and covered by per-finding equality
  assertions. Fallback path keeps any unknown external callers identical.
- Test suite imports from `dist/`; a full project build is blocked by an
  UNRELATED pre-existing TS error in `src/runtime/sandbox-profile.ts` (another
  lane's in-progress edit). It does not affect secret-scanner emit/tests.
