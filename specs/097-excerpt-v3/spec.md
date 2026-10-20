---
description: "Excerpt v3: location-robust acceptance-diagnostic excerpt (failure-marker + diagnostic-shape anchors, decoy-safe, middle-aware fallback); default-off OMK_GOAL_DIAGNOSTICS_V3; spec only"
status: draft
supersedes: 095
---

# 097 — Acceptance-diagnostic excerpt v3

## Problem

Spec 095 (two-window excerpt) failed its single official holdout3 measurement: **0/10** (see
`specs/095-excerpt-two-window/holdout3-result.md`, output sha256 `6a215ea3…dff33d`). Reference-only,
"both GT lines anywhere in the excerpt" would be 7/10; the remaining 3 never show the first real error.

## Root causes (from holdout3, now training data)

1. **First real error not shown (deno, pytest, golangci).**
   - Decoy anchoring: the word "error" in *passing* test names (deno lines 3-5) anchors window 1.
   - Failure markers missing: `… FAILED (12ms)` (deno), `path::test FAILED [ 44%]` (pytest) match no pattern; anchor falls on a later block.
   - Diagnostic shape missing: `path:line:col: message (linter)` (golangci) matches nothing; warnings are excluded, so fallback head = warnings, tail = summary, errors elided in the middle.
2. **Fallback in the wrong spot (ruff, cmake).** Keyword-less `path:line:col: CODE msg` and `note:` / `make: *** … Stop` lines match no pattern; head/tail fallback spends window 1 on preamble.
3. **Window-2 rule vs merged/close windows (rspec, maven, ctest, exunit, webpack).** When first and last errors are close, windows merge or both land in window 1, and the 095 rule "last in window 2" fails although the user sees both. This is a rule-design issue, not a scorer bug (Tech Lead ruling).

## Proposed design (flag-gated, default off)

Flag `OMK_GOAL_DIAGNOSTICS_V3=1`; flag off = byte-identical 095/094 behaviour (golden test). Same caps (1,536 B / 40 lines).

- **D1 Failure-marker anchors** (tool-agnostic): line-level `FAILED`/`FAIL`/`Failed`/`***Failed`/`✗`/`failing` tokens as whole words or status columns.
- **D2 Diagnostic-shape anchor**: `^\S+:\d+(:\d+)?:\s` (file:line[:col]:) regardless of keyword, ranked below explicit errors, above fallback.
- **D3 Decoy suppression**: a line with a success marker (`ok`, `PASSED`, `✓`, `passed`) on the same line never anchors, even if it contains "error".
- **D4 Middle-aware fallback**: if no anchor, window 1 = first diagnostic-shape block or first block that is not a known structured-log info/warning line, not raw head.
  D4 skips lines **only** in these listed known formats (no generic `level=` matching):
  - logfmt: a `level=` key-value token with value `info`, `debug`, `trace`, `warn` or `warning` (e.g. `ts=… level=info msg=…`);
  - JSON line: a top-level `"level":` field with one of the same values (e.g. `{"level":"info",…}`).
  Lines whose level is `error` or `fatal` (logfmt `level=error|fatal`, JSON `"level":"error"|"fatal"`, case-insensitive) are **never skipped**.
  Lines in any other format are never skipped by D4. Required unit tests: (a) logfmt and JSON info/warning lines are skipped;
  (b) logfmt and JSON error/fatal lines are never skipped; (c) an unlisted format containing `level=info` is not skipped.
- **D5 Warnings**: warnings never anchor window 1 when a D1/D2 line exists later.
- Windows: window 1 around first anchor; window 2 around last anchor; if they overlap they merge into one window (allowed).

## Pass rule (fixed before implementation)

Per fixture: the real first error line (`groundTruthLine`) **and** the real last error line
(`groundTruthLastLine`) are each **inside the emitted excerpt** (any window, not inside an elision marker).
Fixtures that fit the cap whole are invalid (hard stop), as in 095.

### Rationale: this rule is a loosening, chosen after seeing holdout3

- 095 rule: first error in window 1 **and** the last error, if different, **in window 2**.
- 097 rule: both GT lines (`groundTruthLine`, `groundTruthLastLine`) **anywhere in the emitted excerpt**.
- This is a relaxation of the criterion, and it was made **after** the holdout3 results were seen.
- Reference only: the same holdout3 output scores **0/10 under the 095 rule** (official 095 verdict, unchanged)
  and **7/10 under the 097 rule**. holdout3 is not re-scored as a pass.
- The rule is fixed here, before any implementation commit, and is not changed after holdout4 is measured.

### Numeric acceptance criteria

| ID | Test | Pass |
|---|---|---|
| A1 | holdout4 (≥10 fixtures) | **10/10** by the rule above |
| A2 | holdout1 + holdout2 + holdout3 (regression floor, training) | ≥ 28/30 by the same rule **and** first error line (`groundTruthLine`) shown in 30/30 (no regression) |
| A3a | all diagnostics flags off | output byte-identical to main on all existing goal-diagnostics fixtures |
| A3b | only `OMK_GOAL_DIAGNOSTICS_V3` off | output byte-identical to the frozen 095 branch head `025bb97eed` (`feat/095-two-window-excerpt`; no further commits to that branch) on the same fixtures |
| A4 | caps | every excerpt ≤ 1,536 B and ≤ 40 lines |
| A5 | unit | decoy (success line containing "error") never anchors |
| A6 | unit | D4 known-format tests (skip info/warning; never skip error/fatal; unlisted format not skipped) |

D1–D5 were designed after seeing holdout3, so holdout1–3 results prove nothing about generalisation.
A2 is only a regression floor; the only real evidence is A1 (holdout4 10/10).

### What 10/10 proves

10/10 on holdout4 gives a one-sided 95% lower bound on the true pass rate of about **74%**
(0.05^(1/10) ≈ 0.741). holdout4 is therefore evidence that the flag is worth shipping **default-off**;
it is **not** evidence for default-on. Default-on is decided separately, on a larger set.

## Ordering (each a separate commit, in this order)

1. This spec (rule + criteria).
2. Scorer change + **unit tests asserting the scorer implements the 097 rule exactly** (inside-excerpt, merged windows count, elision markers don't, hard stop on fits-whole). Before any implementation commit.
3. **holdout4** committed: ≥10 new fixtures, authored by **Bench Analyst outside the team room**. Room members
   (Harness Engineer, Agent Researcher, Library Scout, PR Architect, Tech Lead, OMK) are not blind, since D1–D5 were posted there.
   The author receives only the format conditions (`/workspace/holdout4-request.md`), never D1–D5 or any pattern; manifest with 1-based `groundTruthLine`/`groundTruthLastLine`; at least 5 tools not in holdout1-3. Minimum counts (exactly as sent to Bench Analyst): >24 lines before the first error ≥4; error-like text on a non-error line ≥3; real failure line with no error keyword ≥2; failure shown only in the end summary ≥1. Each fixture entry has a `kind` field naming its type(s). manifest.json has a top-level `authorDeclaration` string attesting the author did not read spec 097, PR #174, or any `spec/097-*` branch before writing the fixtures.
4. Implementation (flag-gated).
5. **Single measurement** of holdout4 at the implementation head. FAIL ⇒ result recorded, no retune, new spec.

holdout3 is training only; it is not acceptance.

## Known risks

- Rule relaxation makes A1 easier than 095's; offset by fresh blind holdout4 and A2 regression.
- D2 may anchor on harmless `file:line:` log output (e.g. stack traces of passing tests) → noise.
- D1 whole-word `FAILED` may hit text like "0 FAILED" summaries; summary still informative but may displace window 1.
- Overfitting to holdout3 tool formats; mitigated by "5 new tools" in holdout4.
- Author independence of holdout4 cannot be enforced technically; recorded in commit message.

## Resolved questions (Tech Lead, before implementation)

1. A2 threshold — **resolved:** keep ≥ 28/30, plus first error line 30/30; A2 is a regression floor only, A1 is the evidence.
2. D4 scope — **resolved:** only listed known formats (logfmt `level=`, JSON `"level":`); error/fatal never skipped; tests for both.
3. holdout4 author — **resolved:** Bench Analyst outside the room, given format conditions only; no room member authors it.
4. Flag — **resolved:** separate `OMK_GOAL_DIAGNOSTICS_V3` (rollback = unset; A3 byte-identity simpler to check).

## Amendments (implementation decisions, recorded before any holdout4 measurement)

Both decisions below were found via synthetic unit tests in `packages/coding-agent/test/goal-acceptance-diagnostic-v3.test.ts`, before any holdout4 measurement. Implemented in `765cb68e57`.

1. **D5 stricter.** Warnings anchor window 1 only when no error-marker, failure-marker (D1), or `file:line` shape (D2) line exists anywhere in the output. This replaces "when a D1/D2 line exists later" above; a warning that comes after an error line no longer anchors either. Test group: `spec 097 D5 warnings`.
2. **Cut line dropped whole (flag on only).** With `OMK_GOAL_DIAGNOSTICS_V3=1`, a window-1 line after the anchor that would be truncated at the cap is dropped whole, not cut with a marker. It is then either elided by the middle marker or shown whole by window 2. The drop keeps an answer line from being half-shown in window 1 and lets it appear whole at the start of window 2. A mutation run (drop disabled) showed the 097 scorer still matches the cut line when it ends a segment, so this amendment is not needed for scoring and is justified by readability only. This was found through the synthetic generated outputs in `spec 097 A4 caps`. It is now pinned by the dedicated synthetic test `spec 097 amendment 2: window-1 line cut at cap is dropped whole`, which covers flag on (no partial line or cut marker inside window 1, the dropped line opens window 2, and the second answer line is still matched by the 097 scorer) and flag off (095 behaviour unchanged, the line is still cut). Flag off is unchanged (095 behaviour, A3b golden).

### Implementer declaration

The implementer (Harness Engineer) touched holdout4 only through an automated CR-byte check and the manifest sha256 check. The two amendments above came from synthetic unit tests, not from holdout4. The implementer cannot fully rule out having seen fixture content during those checks.

### Evaluation change (Tech Lead ruling, before any holdout4 measurement)

- **holdout3 label exposure:** some holdout3 manifest labels appeared on screen before holdout4 was written. holdout3 stays an A2 regression floor only.
- **holdout4 is reference-only.** It is measured once at the frozen, Tech Lead-approved implementation head, and the result is recorded. It is not used for A1.
- **A1 moves to holdout5.** holdout5 has ≥ 10 fixtures, written by Bench Analyst on `main`, with a top-level `authorDeclaration`. It uses no tool that appears in holdout1–4, including `go test`, `unittest`, `doctest`, and `node --test`. It has the same type minimums and `kind` field as holdout4. holdout5 is merged only after Tech Lead approves and freezes the implementation head. There is one official measurement, on that merge commit. Pass = 10/10.
- **Feature freeze:** 2026-10-23 12:00 KST. If A1 has not passed by then, 097 moves to 1.5.1.
