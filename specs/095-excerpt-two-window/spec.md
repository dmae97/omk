---
description: "Two-window acceptance-diagnostic excerpt (first + last error-like line) with a pre-registered injection rule; replaces 094's excerpt; default-off OMK_GOAL_DIAGNOSTICS; target 1.5.1; spec only"
---

# Feature Specification: two-window diagnostic excerpt

**Specification ID**: `095-excerpt-two-window`
**Feature Branch**: `spec/excerpt-two-window` from origin/main `27d2e59e65`
**Created**: 2026-10-20
**Status**: Spec only (no code); local commit, not pushed
**Target**: 1.5.1 (094 / PR #170 on hold, not merged before the 1.5.0 freeze 2026-10-23 12:00 KST)
**Constitution**: [specs/constitution.md](../constitution.md)
**Depends on**: 094 plumbing (flag, verifier head/tail window, fence, AC1–AC10) from PR #170 branch `feat/094-acceptance-diagnostics`.
**Behavior changes**: none by default (flag `OMK_GOAL_DIAGNOSTICS` stays default off).

## Problem and evidence

094 sends a bounded excerpt of a failed acceptance check to the repair turn.
Neither excerpt design kept the real first error 10/10 on a holdout set:

| design | commit | holdout | real first error kept |
|---|---|---|---|
| fixed head/tail split (768 B / 24 head lines) | `3233033072` fixtures, `fa491cc7fe` result | holdout1 (10) | **6/10** (lost whenever > 24 lines precede the error) |
| single window anchored at first error-like line, N = 3 | `d96da00856` design, `d3da973d9e` fixtures, `cb4ec26882` result | holdout2 (10) | **8/10** |

holdout2 misses (`cb4ec26882`, `test/goal-acceptance-diagnostic-holdout2.test.ts`):

1. `mocha-30-pass`: real first error `  1 failing` (line 35) matches no
   pattern; fallback middle elided it. Keyword-less failure.
2. `terraform-fake-error`: a `[WARN] … Error: transient throttling` line at
   line 2 hijacked the single anchor; the real `│ Error: Reference to
   undeclared resource` at line 51 was outside the window.

Plus two weak hits: `bazel` and `kotlin-deceptive` passed only because the whole
output fit the caps.

## Design

All matching, cutting and caps run on sanitized text
(`util.stripVTControlCharacters` + 094 ANSI/binary/C0 stripping).

0. **Patterns.** 094 list plus summary-line patterns `summary-failing`
   `^\s*\d+ failing\b` and `summary-failed` `\b[1-9]\d* (?:tests? )?failed\b`
   (success exclusions still apply first). **Tech Lead rule:** summary-line
   patterns may anchor **only window 2**, and only when no other error pattern
   matched anywhere; they never anchor window 1. **Note:** these were added after
   seeing holdout2 (mocha `1 failing` miss), so holdout2 is not evidence for
   them. holdout3 must not include mocha and must use only tools not used in
   holdouts 1–2.
1. **Eligible lines.** A line is an *anchor candidate* iff it matches a
   094 error pattern, matches no success exclusion, and passes the injection
   rule (below).
2. **Window 1** = around the **first** candidate: N1 = 3 lines before,
   filled forward.
3. **Window 2** = around the **last** candidate: N2 = 3 lines before, filled
   forward; if there is no candidate, or the last candidate is inside window 1,
   window 2 = tail of the output.
4. **Caps and fixed split** (total unchanged): 1,536 UTF-8 B / 40 lines,
   markers included. Window 1 ≤ 768 B / 20 lines, window 2 ≤ 768 B / 19
   lines, 1 line for the middle marker. **Fixed at 768/768** (20/19 lines +
   marker). Unused budget of window 1 is **not** moved to window 2. No data
   supports a longer window 2, so it is not given one. Code-point-safe cuts.
5. **No candidate** → 094 head/tail fallback (768 B / 24-line head, rest tail).
   Output that fits the caps whole is passed through unchanged.
6. Markers: `[… N bytes elided …]` before window 1 (if it does not start at
   line 1), between windows, and after window 2 (if cut).
7. Patterns only choose windows. No effect on verdict, gate, completion or
   approvals; 094 fence + escaping unchanged (AC7).

### Injection rule (fixed before any holdout3 measurement)

The check command is host-approved, but its output can contain text that the
model wrote into the workspace (logs, test names, fixtures). A pattern match
is **not** an anchor candidate if any of these hold:

- **R1 log-level prefix:** the line has a non-error log level before the
  match: `^\S*\s*\[?(WARN|WARNING|INFO|DEBUG|TRACE|NOTE)\]?[:\s]` or
  `level=(warn|info|debug|trace)` (case-insensitive).
- **R2 quoted/diff context:** the line starts (after trim) with `>`, `+`, `-`
  followed by a space, `#`, or `//` (diff, quote, comment echo).
- **R3 retry/ignored marker:** the line contains `retrying`, `(ignored)`,
  `will retry`, `attempt \d+/\d+` (case-insensitive).
- **R4 repeat cap:** only the first 2 matches of the *same* normalized line
  text (digits → `#`) are eligible; floods do not shift the last window.

Bound: a planted fake line that survives R1–R4 can occupy **at most one**
window. If it is the first candidate, window 2 still covers the last
candidate, which is the real error whenever the real error is the last
error-like line. Residual risk: a fake planted **after** the real error and
before the end hijacks window 2; then the first window still has the real
error only if it is the first candidate. A fake planted both before and after
defeats this design — stated, not mitigated in 095.

Each rule gets a unit test with a positive and a negative example.

### Decisions recorded before holdout3 (Tech Lead, 2026-10-20)

1. **Summary-line-only case: unchanged.** When only a summary line matches,
   window 1 is the head fallback and the summary line anchors window 2 only.
   Reason: a new placement rule to recover `ava-korean-28-pass` would be tuning
   to holdout2; holdout2 stays 9/10 with that fixture as a known miss.
2. **Lines rejected by R1–R4 count as nonexistent.** They do not count as
   "another error pattern matched" (so they cannot disable summary anchoring)
   and do not affect window selection. Reason: otherwise one planted
   `[WARN] Error:` line could switch off summary placement, the same injection
   steering R1–R4 exist to block.

### Implementer choices (fixed before holdout3)

- **R4 normalization:** the R4 key is the trimmed line with each run of digits
  replaced by `#`. Reason: repeated lines that differ only in counters,
  timestamps or ids collapse to one key, without fuzzier matching.
- **Marker byte allocation:** the leading marker counts inside window 1
  (768 B / 20 lines); the middle and trailing markers each reserve 48 B from
  window 2, and the trailing marker takes 1 of window 2's 19 lines; the total
  cap always holds. Reason: markers are budgeted up front so the 1,536 B /
  40-line cap can never be exceeded.
- **Long lines:** the anchor line is always kept, context lines above it are
  dropped first, and a line that still does not fit is cut at a
  code-point-safe byte budget. Reason: the anchor is the evidence; context is
  expendable, and cuts must never split a UTF-8 sequence.

## Pre-registration order (binding)

1. **Commit P:** patterns, exclusions, R1–R4, N1/N2, window caps as code
   constants + unit tests, and this spec section frozen.
2. **Commit H (Agent Researcher authors; Harness Engineer does not see or
   create it):** after Commit P, new `test/fixtures/goal-diagnostics-holdout3/`
   with 10 fixtures + `manifest.json`; every fixture has `groundTruthLine`
   (first real error) and `groundTruthLastLine` (last real error), 1-based on
   sanitized text. Composition: ≥ 3 with > 24 lines before the error; ≥ 3
   decoys; 1 planted fake `Error:`; ≥ 2 fallback (no pattern); ≥ 1
   summary-line-only; no mocha; only tools unused in holdouts 1–2.
3. **Commit M:** measurement test. Report per fixture: windows containing the
   real first and last lines (1 / 2 / none), matched pattern(s), fallback yes/no, whole
   passthrough yes/no.

**Pass (final, Tech Lead):** per fixture, the real first error line is inside
window 1 **and**, when `groundTruthLastLine` ≠ `groundTruthLine`, the real
last error line is inside window 2. 10/10 required. Missing ground truth =
FAIL. A FAIL means no retune and no remeasure (new spec). Note this is
stricter than the design bound above: a fake that takes window 1 fails the
fixture even if window 2 shows the real error. Missing ground truth =
FAIL. **Every holdout3 fixture must exceed the cap (> 1,536 B or > 40 lines
after sanitize).** A fixture that fits whole (passthrough) does not count toward
10/10; such fixtures are invalid and must be replaced by the holdout author
before measurement (bazel/kotlin in holdout2 passed only by fitting whole). holdout1 (10), holdout2
(10) and the 12 original fixtures are **regression only**. No relaxation, no
retuning after measurement; a miss means a new spec.

10/10 gives a one-sided 95% Clopper–Pearson lower bound of ≈ 74%
(0.05^(1/10) = 0.741). 10/10 means ship-eligible, not high reliability.

## Acceptance criteria

| ID | Test | Pass |
|---|---|---|
| E1 | holdout3 | 10/10: first error in window 1 and (if different) last error in window 2 |
| E2 | caps, all 32 fixtures + 1 MiB generated | ≤ 1,536 B, ≤ 40 lines; each window within its share |
| E3 | R1–R4 unit tests | each rule rejects its positive, accepts its negative |
| E4 | fake-first fixture (unit) | real last error in window 2 |
| E5 | multibyte (Korean + ZWJ emoji) | valid UTF-8, no U+FFFD, caps hold |
| E6 | 094 AC1–AC10 | unchanged, incl. flag-off golden byte-identical |
| E7 | regression | report holdout1/holdout2/original counts; not a gate |

## Flag

`OMK_GOAL_DIAGNOSTICS` only, default off; unset/`0` byte-identical to today's
message (094 golden test). Target 1.5.1. No default-on (094 PREREG: −5 pp
criterion undecidable on the 88-task set).

## Tests (targeted only)

`test/goal-acceptance-diagnostic*.test.ts`, `test/goal-verification.test.ts`,
`test/goal-controller-acceptance.test.ts`, `test/suite/goal-acceptance-loop.test.ts`,
`test/suite/agent-session-retry-events.test.ts`; `env -u TYPESAFE_API_KEY`,
temp HOME, Node ≥ 22.19, biome, tsgo.

## Risks

- R1–R4 may reject a real error line (e.g. a real error logged at WARN).
  holdout3 measures this.
- Fake lines both before and after the real error defeat two windows.
- Keyword-less first errors without a summary line are still only covered by
  window 2 context or the tail, which E1 does not count.
- Secrets in output reach the provider (masking removed by #165; accepted,
  default off).

## Out of scope

Default-on, provider send policy, structured path/line parser, raw artifact
lookup, changes to verdict/gate/completion.

## Open questions

None open; Tech Lead decisions recorded above.
