# Spec 095 — official holdout3 result (single measurement)

**Verdict: FAIL, 0/10 (official). Exit code 1. No retune, no re-measure. 095 is superseded by spec 097 (excerpt v3). PR for 095 is not opened; #170 stays on hold.**

- Commit measured: `24b93ad745` (branch `feat/095-two-window-excerpt`)
- Command: `node scripts/goal-diagnostic-measure.ts test/fixtures/goal-diagnostics-holdout3`
- Result output sha256: `6a215ea32d172e153bae48986206e69d7dba7c3fd3aec20f870777a662dff33d`
- Env: Node 22, `OMK_TRUST_PROJECT=0`, load1 2.38 -> 2.55
- Scorer: Tech Lead ruled the scorer implements the 095 pass rule as written (first error in window 1 AND, if different, last error in window 2). 0/10 is official; not a scorer bug.

## Disclosure: accidental pre-run

Before holdout3 was committed, the measurement script was run once by accident (Agent Researcher). That run exited 1. It was not used for any decision, and no code, pattern or fixture was changed between it and the official run.

## Per-fixture result (1-based sanitized lines; windows from the excerpt)

| Fixture | GT first | GT last | Excerpt windows / mode | First in | Last in | Root cause |
|---|---|---|---|---|---|---|
| rspec-28-pass | 35 | 44 | [32-50],[51-55] error-colon | 1 | 1 | Both in window 1; window 2 anchored past real last error (later candidate). Fails "last in window 2" rule |
| maven-zero-errors-decoy | 36 | 45 | [35-48] single merged window | 1 | 1 | Windows merged into one; rule needs window 2 |
| deno-error-names-decoy | 30 | 55 | [1-20],[52-55] error-colon | none | 2 | **Miss**: window 1 anchored on decoy "error" names in passing test titles (lines 3-5); real `... FAILED` line matches no pattern |
| ctest-fake-error | 34 | 45 | [28-46] single merged window | 1 | 1 | Windows merged; rule needs window 2 |
| exunit-summary-mid | 8 | 20 | fallback head/tail | 1 | 1 | Both in head fallback; rule needs window 2 |
| ruff-keywordless-28 | 30 | 39 | fallback head/tail | 2 | 2 | **Miss**: keyword-less lint lines match no pattern; head fallback shows passing preamble |
| golangci-warnings-first | 15 | 21 | fallback head/tail | none | none | **Miss**: `file:line:col:` diagnostics match no pattern; warnings excluded; head is all warnings, tail is summary; real errors in the elided middle |
| webpack-ansi-30 | 35 | 43 | [32-43] single merged window | 1 | 1 | Windows merged; rule needs window 2 |
| cmake-keywordless-36 | 38 | 42 | fallback head/tail | 2 | 2 | **Miss**: compiler `note:`/`make: ***` lines not matched; head fallback wasted on configure output |
| pytest-error-names-decoy | 26 | 48 | [39-48] pytest-e | none | 1 | **Miss**: `FAILED` on test-progress line not a pattern; first anchor is the later `E ` assertion block |

Reference only (not acceptance): if "both GT lines anywhere in the excerpt" were counted, the same output scores **7/10** (rspec, maven, ctest, exunit, webpack, ruff, cmake). Real algorithm misses on first-error location: deno, pytest, golangci; fallback in the wrong spot: ruff, cmake.

holdout3 is now training data for 097 and cannot be used as 097 acceptance.
