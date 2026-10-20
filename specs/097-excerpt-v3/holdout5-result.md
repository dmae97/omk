# 097 holdout5 result (Tech Lead verdict: FAIL, A2 first-line 30/30 broken by holdout3 exunit-summary-mid; 097 moves to 1.5.1; no rerun/tuning)

# 097 official holdout5 measurement (single run, 2026-10-21 07:28 KST)
Commit 5da6c32a928d3a914a730c7d2650d3d57155fb0c (origin spec/097-excerpt-v3 head), parents c86ec94ab7 + a8a64c0e96 verified. Detached worktree /workspace/omk-eval-097-holdout5/repo; no merge/push by me. (An earlier local merge 2490cc49c2 was discarded unscored per steering.)
Scorer: packages/coding-agent/scripts/goal-diagnostic-measure.ts --rule=097 (pure fs read + excerpt build; no network/model/child-process calls). Node v22.23.3, nice -n 10, OMK_TRUST_PROJECT=0, OMK_GOAL_DIAGNOSTICS_V3=1, TMPDIR=/workspace/omk-eval-097-holdout5/tmp. load1 1.17. node_modules symlinked (read-only) from /workspace/omk-he-097-spec. 
holdout5 manifest sha256 359046732e6d115ebf352032d42c9b8e95f190f9fa4fb71aca913c0a12a3cb26

| set | fixture | GT first–last | firstShown | lastShown | result |
|---|---|---|---|---|---|
| ref | jest-assertions.txt | 4–38 | true | false | FAIL |
| ref | jest-coverage-threshold.txt | 37–37 | true | true | PASS |
| ref | mocha-deep-equal.txt | 41–41 | true | true | PASS |
| ref | tsc-listfiles.txt | 1–5 | true | true | PASS |
| ref | eslint-warnings-then-errors.txt | 44–46 | true | true | PASS |
| ref | mypy-strict.txt | 2–41 | true | true | PASS |
| A1 | pyright-basic.txt | 2–38 | true | true | PASS |
| A1 | yamllint-truthy-then-syntax.txt | 28–29 | true | true | PASS |
| A1 | markdownlint-docs.txt | 1–52 | true | true | PASS |
| A1 | stylelint-standard.txt | 3–42 | true | true | PASS |
| A1 | bats-tap.txt | 28–32 | true | true | PASS |
| A1 | htmlhint-attrs.txt | 4–24 | true | true | PASS |
| A1 | c8-branch-threshold.txt | 38–38 | true | true | PASS |
| A1 | sqlfluff-ansi.txt | 9–82 | true | true | PASS |
| A1 | cpplint-done-flood.txt | 30–39 | true | true | PASS |
| A1 | codespell-context.txt | 3–111 | true | true | PASS |

- A1 (10 listed): 10/10 → PASS. Ref-6: 5/6 (jest-assertions last line 38 not shown). Script total 15/16.
- holdout4 (reference): 3/11.
- A2 criterion (specs/097-excerpt-v3/spec.md line 61): "| A2 | holdout1 + holdout2 + holdout3 (regression floor, training) | ≥ 28/30 by the same rule **and** first error line (`groundTruthLine`) shown in 30/30 (no regression) |"
  holdout3: 9/10 (exunit-summary-mid first line not shown). holdout1 and holdout2: scorer HARD STOP exit 2 (manifests have 0/10 entries with groundTruthLine+groundTruthLastLine; first error: "vitest-60-pass.txt: missing or invalid groundTruthLine", "playwright-40-pass.txt: missing or invalid groundTruthLastLine"). A2 therefore cannot be scored by the official script → not established; already ≥1 first-line miss in holdout3, so "first line 30/30" fails as measured. Not rerun/tuned.
