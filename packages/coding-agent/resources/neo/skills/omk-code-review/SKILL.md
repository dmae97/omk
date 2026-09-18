---
name: omk-code-review
description: Review implementation changes against contracts and real failure modes, preserve minimal patches, and verify regressions without confusing test counts, generated code volume or CI claims with production correctness.
---

# Code review and change verification

Read repository instructions and the complete affected function/module before making a broad edit. Establish the current base revision and inspect the actual diff. Review correctness, boundary conditions, cancellation, retries, concurrency, external effects and recovery according to their relevance. Avoid inventing a new abstraction before identifying a concrete failure it prevents.

## Evidence-led findings

For each material finding record the source location, input or execution sequence, expected invariant, observed behavior and smallest correction. Separate confirmed defects from conditional risks and unmeasured optimization ideas. Existing tests that merely reproduce the implementation's own assumptions are not independent evidence.

Where feasible, write a test that fails before the fix and passes afterwards. Cover invalid and empty input, duplicate identifiers, non-finite numbers, timeouts, stale state and partial failure where applicable. Use deterministic gates instead of timing sleeps for concurrency ordering. Do not mask errors with catch-and-ignore or loosen a guard to obtain a green result.

## Patch discipline

Preserve unrelated code, lockfiles and other contributors' changes. Avoid force pushes, broad staging, mass formatting or deleting unexplained modules. Explain any newly introduced dependency and its operational cost. Do not edit released changelog sections or generated catalogs manually.

Run targeted tests and repository gates in a credential-free environment. Report exactly which commands ran and their exit status. Separate static checks, mocked tests, integration tests and real provider/browser tests. If a base revision already fails CI, identify the baseline failure separately from the patch result; do not call the combined branch releasable.

## Completion

Confirm that the corrected behavior is connected to the live call path. A helper with unit tests but no caller is not a runtime fix. Document compatibility and disable/rollback behavior. Report remaining risks and the evidence needed to change the verdict. Test count and code size alone are not quality metrics.
