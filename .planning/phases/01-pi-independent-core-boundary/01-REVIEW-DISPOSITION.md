---
phase: 01-pi-independent-core-boundary
review: 01-REVIEW.md
status: resolved
updated: 2026-11-05
---

# Phase 1 review disposition

| Finding | Severity | Disposition | Next check |
|---|---|---|---|
| CR-01 | BLOCKER | resolved by independent closure review | Real-file wrapper controls and sentinel absence pass with nested policy enforcement |
| CR-02 | BLOCKER | resolved by final independent review | Directory-glob/literal collection now uses the existing collector; real user/project parity and sibling controls pass |
| CR-03 | BLOCKER | resolved by final independent review | Active ancestry is branch-local; both filtered and shorter-depth declaration orders select the allowed file |

The initial goal-verifier PASS and green tests did not cover these inputs. Main
inspected the reported expansion path and found that it admits existing paths
without nested policy or glob expansion. Keep phase 1 pending while real-file
regressions establish the behavior and the smallest shared fix.

Both findings reproduced before source edits as four assertion failures with zero
harness errors. Main independently reran nine files after correction, with 258
tests passed, and `npm run check` exited 0. The focused helper keeps the manager at
2240 pure LOC against the unchanged allowance of 2289. Closure awaits independent
re-review and the affected security check.

Closure review preserved the first fix for CR-01 but reproduced the remaining
CR-02 directory cases and new CR-03 with real files. The correction must reuse
directory collection and separate active-cycle state from final deduplication.
The malformed nested JSON concern did not reproduce and is not an open finding.

Final closure review returned PASS with no blockers or warnings. Its independent
27-test rerun and nine real-filesystem assertions passed. Main's latest targeted
run passed 266 tests across ten files, and the root check exited 0. The final
security auditor closed B01-D01 with no accepted or transferred risk.
