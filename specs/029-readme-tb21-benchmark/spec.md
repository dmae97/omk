---
description: "Docs: publish the Terminal-Bench 2.1 comparison (OMK vs mini-swe-agent) in the README"
---

# Feature Specification: Terminal-Bench 2.1 Result in the README

**Specification ID**: `029-readme-tb21-benchmark`
**Feature Branch**: `docs/readme-r8-benchmark`
**Created**: 2026-10-06
**Status**: Accepted
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: A paired Terminal-Bench 2.1 run of OMK against mini-swe-agent finished on 2026-10-06 KST (89 tasks × 3 trials per harness, same model `grok-4.7` at reasoning effort `xhigh`). The README still says "No comparative benchmark result is published here yet." The owner's collaborator asked for the result to be published in the README with its caveats.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: not applicable (documentation only. No source, test, setting or default changes, so no harness metric can move. The PR reports a measurement; it does not claim leadership.)

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| not applicable | not measured | not applicable | README keeps "targets state-of-the-art quality" and "SOTA is not verified" | `node --test scripts/test/cli-harness-sota-governance.test.mjs` | `README.md` |

## Goal

Readers can see the one external comparison that exists, read its setup and
caveats, and cannot mistake it for a significant win or a SOTA claim.

## Agent-Oriented Requirements

### Requirement 1 - README benchmark section (Priority: P1)

**Agent**: writer
**Evidence Gate**: file-content + command-pass
**Risk**: low

**What**: Under "Evidence and limits", replace the "no comparative benchmark"
sentence with an accurate one and add a short "Benchmark: Terminal-Bench 2.1"
subsection: setup line, a results table, 3–5 caveat bullets and a link to the
full report.

**Acceptance** (how each is measured):
1. The setup line names the benchmark version (Terminal-Bench 2.1), tasks × trials (89 × 3), model and reasoning effort (`grok-4.7`, `xhigh`), run dates, the OMK build (1.3.0 evaluation build, commit `78cc483`, includes unmerged PRs) and the mini-swe-agent version (2.4.6). Measured by reading the README diff.
2. The table has one row per harness with success rate and n (75.8% 200/264, 71.6% 189/264), cost per trial ($0.581, $0.759) and median wall time per trial (482 s, 376 s). Every number matches the source report. Measured by comparing each cell with the run's report and summary JSON.
3. The bullets state that the difference (+4.2 pp, 95% CI [−1.9, +10.2]) is not statistically significant, that OMK is cheaper but slower, the audit corrections (prove-plus-comm excluded on both sides, contaminated passes zeroed, retried provider errors), the `pytorch-model-recovery` dash-prompt failure with its sensitivity number (+5.4 pp [0.0, +10.7]), and the budget and trial-count deviations. Measured by reading the README diff.
4. The README still contains "targets state-of-the-art quality as a CLI coding-agent harness" and "SOTA is not verified", and the old "No comparative benchmark result is published here yet" sentence is gone. Measured by `node --test scripts/test/cli-harness-sota-governance.test.mjs` and `rg`.
5. No other harness or external leaderboard figure is named; no "best", "leading", "#1" or "SOTA achieved" wording. Measured by `rg -i` over the changed files.

### Requirement 2 - Full report (Priority: P1)

**Agent**: writer
**Evidence Gate**: file-exists + command-pass
**Risk**: low

**What**: Add `packages/coding-agent/docs/benchmarks/r8-terminal-bench-2.1.md`
with method, overall and per-difficulty numbers, audit, caveats and
reproduction notes. The root `docs/` tree is gitignored working material, so the
report goes under the shipped `packages/coding-agent/docs/` tree.

**Acceptance**:
1. The README link resolves in a fresh checkout. Measured by `node scripts/check-doc-links.mjs`.
2. The file contains no secrets, tokens, IPs, or absolute machine paths. Measured by `rg` for `/workspace`, `/home/`, IPv4 patterns and token prefixes.

### Requirement 3 - Gates (Priority: P1)

- The first commit is this spec. Explicit-path staging.
- Dependency-free checks that read the touched files pass: `check-doc-links`, `check-release-consistency`, `sync-readme-releases --check`, `check-private-agent-home`, `check-release-surface`, and the SOTA governance test. `check-feature-claims` imports `typescript`, so it runs where `node_modules` is installed (CI `npm run check`).
- Biome does not check Markdown in this repository, so it is not run.

## Non-goals

- No chart images. The source charts carry non-English labels and a third-party reference line.
- No change to runtime behavior, the CHANGELOG, the landing page or `metrics.md`.
- No comparison with other harnesses, earlier runs or public leaderboards.
- No leaderboard submission and no SOTA claim.

## Expected Files

- `specs/029-readme-tb21-benchmark/spec.md`: this spec (first commit)
- `README.md`: "Evidence and limits" update and benchmark subsection
- `packages/coding-agent/docs/benchmarks/r8-terminal-bench-2.1.md`: full report

## Verification Commands

- `node scripts/check-doc-links.mjs`
- `node scripts/check-feature-claims.mjs` (needs `node_modules`)
- `node scripts/check-release-surface.mjs`
- `node scripts/check-release-consistency.mjs`
- `node scripts/sync-readme-releases.mjs --check`
- `node scripts/check-private-agent-home.mjs`
- `node --test scripts/test/cli-harness-sota-governance.test.mjs`

## Assumptions

- The run's report and summary JSON are the only sources for the published numbers.
- Raw trial logs stay private; only aggregate numbers and public task names are published.
