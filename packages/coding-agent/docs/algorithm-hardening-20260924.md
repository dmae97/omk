# Algorithm boundary hardening (working tree, 2026-09-24)

This candidate is based on `8b5a572d294ac3d6fb120dbdf9a932682228dd8b` (v1.2.4).
It is not a release note or a claim that the complete repository passed CI.

- DAG task rejection is observed on creation; exiting the frontier joins every
  started task and retains execution and settlement failures. Multiple failures
  may now surface as `AggregateError`.
- DAG memo insertion and hits detach nested claim arrays and objects. A caller
  editing the cache map itself remains outside this isolation guarantee.
- Dependency construction skips only read/read pairs and keeps the existing
  conflict predicate for every potentially conflicting pair. Source-directed
  edges and the all-write worst case are unchanged.
- ECRAF resource maps read own properties only. ECRAF remains a pure planner and
  is not activated in the live frontier by this patch.
- Provider retries validate finite option values before dispatch, check already
  aborted signals, parse server delay metadata defensively, and sleep with
  monotonic elapsed time in timer-safe chunks. The default server-delay cap and
  zero-disables-cap meaning remain unchanged.
- Workload permit waiters are checked for expiry at grant time, not only by the
  timer callback. `monotonicNow` can be injected for tests and must return finite,
  nondecreasing readings. The existing `now` callback remains an audit timestamp.
- Context ranking, redundancy, exchange, selected-output order, and cache/plan
  hashes use UTF-16 code-unit ID order. The selection cache policy is
  `sel-4-codeunit`; the public optimizer identifier stays the same. Caller
  policy-version overrides must also be versioned.

The accompanying offline package passed 67 tests and 17 patch-installer tests;
its scheduler and some module boundaries are explicit test seams. In this
checkout, focused agent (92), AI (24), and coding-agent (94) tests passed, as
well as `tsgo --noEmit` and the downstream guards run separately. The full
`npm run check` stopped at the documentation-link guard: the unrelated, existing
`docs/themes.md` edits link to two untracked theme JSON files. The full gate,
CLI/TUI and live provider paths are not verified by these tests. No comparative
task-success, billing, end-to-end latency, CI, default-policy or SOTA benefit
is established.
