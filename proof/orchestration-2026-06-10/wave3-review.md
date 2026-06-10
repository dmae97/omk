# Wave-3 REVIEW gate — Lanes C1 & C2

Date: 2026-06-10
Mode: READ-ONLY review (no edits to source, no web).
Skills applied: omk-code-review, omk-security-review, omk-evidence-contract.
Scope reviewed (exactly 4 artifacts):
- src/mcp/secret-scanner.ts + test/secret-scanner.test.mjs (Lane C1)
- src/runtime/sandbox-profile.ts + test/sandbox-writable-roots.test.mjs (Lane C2)
Explicitly NOT reviewed (concurrent worker): src/providers/model-registry.ts,
src/providers/provider-runtime.ts, test/provider-openrouter-fable-activation.test.mjs.

Trusted (not rerun): node --test both suites 59/59 PASS; tsc --noEmit clean for
changed files; npm run secret:scan PASS.

---

## VERDICTS

- Lane C1 (secret-scanner getLineColumn): **APPROVE**
- Lane C2 (sandbox writableRoots helpers): **APPROVE-WITH-NITS**

---

## Lane C1 — secret-scanner.ts getLineColumn

VERDICT: APPROVE

Correctness (binary search reproduces exact 1-based line/col):
- computeLineStarts (src/mcp/secret-scanner.ts:739-745): lineStarts[0]=0, pushes
  i+1 after every "\n". Single O(n) pass. Correct invariant.
- Binary search (src/mcp/secret-scanner.ts:764-776): rightmost lineStarts[mid]
  <= offset using mid=(lo+hi+1)>>1; line=lo+1, column=offset-lineStartOffset+1.
  Standard rightmost-leq, terminates, lineStarts length>=1 so lo>=0 always.
- Edge cases (all verified correct vs original loop):
  * offset 0 -> lo=0 -> line 1, col 1. PASS
  * offset right after "\n" -> lands on next line-start -> col 1. PASS
  * offset at EOF (offset===text.length) -> index built over full text. PASS
  * no-newline content -> lineStarts=[0] -> col=offset+1. PASS
  * CRLF -> only "\n" keyed; "\r" counted as ordinary column char, identical to
    original. PASS
- No off-by-one found.

Backward-compat (src/mcp/secret-scanner.ts:744-762):
- getLineColumn signature gains optional lineStarts?: number[]; when omitted the
  fallback branch is a byte-for-byte copy of the original O(offset) loop.
- rg getLineColumn src => only 2 callers (scanText :455, findInText :698), both
  internal/private, both pass the precomputed index. No external/legacy caller
  can break. PASS.

Tests (test/secret-scanner.test.mjs +3):
- refLineColumn brute-force ref is an exact copy of the original loop; equality
  asserted per-finding on a 300+ match multi-line/CRLF input — strongest possible
  regression guard. Explicit start/after-\n/EOF case. Micro-bench guards the
  quadratic regression (<1500ms, generous).
- No `any`, no deleted tests, no silenced errors, no scope creep.

Nit (non-blocking): doc comment says "byte offset" but values are UTF-16 code
units (match.index). Matches original behavior exactly — wording only.

Evidence vs wave2-c1.md: COMPLETE and accurate (files, hunks, complexity,
edge-case table, tests, commands all match the diff).

---

## Lane C2 — sandbox-profile.ts writableRoots helpers

VERDICT: APPROVE-WITH-NITS

Prefix-safety (src/runtime/sandbox-profile.ts:113-126):
- root /a/b DENIES sibling /a/bc: rootWithSep="/a/b/", "/a/bc" !startsWith =>
  false. Test (c) confirms. PASS
- ".." escape denied: nodePath.resolve collapses .. before compare
  (/a/b/../../etc/passwd -> /etc/passwd outside root). Test (d) confirms. PASS
- in-root ".." allowed (/a/b/sub/../ok.txt -> /a/b/ok.txt). Test confirms. PASS
- root itself + nested allowed; multi-root any-match. Tests confirm. PASS
- Defensive: empty-string root skipped (if (!root) continue) — prevents ""
  resolving to cwd and over-permitting. Good.

Safe-default non-breaking (src/runtime/sandbox-profile.ts:111):
- empty/undefined roots => isPathWritable true; assertWritable no-op. Current
  metadata-only behavior preserved; enforcement only activates on explicit
  non-empty writableRoots. Test (a) confirms. Truly non-breaking. PASS

Error class (src/runtime/sandbox-profile.ts:91-104): names resolved target +
roots only; no secret values leaked. Good per omk-security-review.

No `any`, no deleted tests, no silenced errors.

Symlink/realpath gap: resolve != realpath, so a symlink inside a root pointing
outside still passes. Documented as residual in wave2-c2.md. ACCEPTABLE for this
gate (IO-free helper); track as follow-up.

NITS / MUST-TRACK (none blocking this READ-ONLY gate):
1. Lane title is "Enforce writableRoots in tool dispatch" but dispatch wiring is
   DEFERRED — helpers are correct + tested yet UNUSED in the live path, so there
   is NO runtime write protection yet. Documented in wave2-c2.md with exact
   wiring point (tool-dispatch-contracts.ts:192/202, ToolAuthorityWiring:46).
   Must be tracked as a follow-up; do not market C2 as active enforcement.
2. src/runtime/sandbox-profile.ts has NO trailing newline at EOF (diff: "\ No
   newline at end of file"; confirmed `[]);}` with no \n). Cosmetic; eslint
   passed so config does not enforce eol-last. Recommend adding on next edit.
3. test/sandbox-writable-roots.test.mjs imports from dist/ — depends on a prior
   build; fine given trusted tsc/build evidence.

Evidence vs wave2-c2.md: COMPLETE and HONEST (explicitly flags deferred wiring,
symlink residual, Windows casing). No overclaim.

---

## Evidence checked vs not checked
- Checked: full git diff of both src files; both test files; getLineColumn caller
  enumeration; untracked-file ownership; no-any/no-deleted-test scan; EOF newline.
- Trusted (not rerun, per instruction): node --test 59/59, tsc --noEmit, secret:scan.
- Not checked (out of scope, concurrent worker): model-registry.ts,
  provider-runtime.ts, provider-openrouter-fable-activation.test.mjs.

## Scope-creep check: PASS
Only the 4 in-scope files changed for C1/C2. The 3 provider artifacts belong to
the concurrent worker and were left untouched (not reviewed, not reverted).

## Merge / release recommendation
APPROVE both lanes to merge. C1 ships as-is. C2 ships as tested IO-free helpers;
open a tracked follow-up to (a) wire assertWritable into dispatch and (b) add
realpath/symlink resolution before C2 can be claimed as active enforcement.
