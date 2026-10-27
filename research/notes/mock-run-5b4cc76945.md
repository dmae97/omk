# Free mock run on main 5b4cc76945

- Commit: `5b4cc76945`
- Model: `mock/mock-oracle` (scripted, no tool calls)
- Trials: 4
- Counts: all 0 (G1 qualifying tasks, outcome-unknown, lane branches)
- **NOT used as evidence.** This only confirms the research scripts run on the real log format.
- Found: bench `summary.json` contains bare `NaN`; `lane_branch_count.mjs` now parses it tolerantly and reports `skippedNonNumeric`.
