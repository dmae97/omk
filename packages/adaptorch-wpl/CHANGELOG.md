# Changelog

## [Unreleased]

## [1.2.4] - 2026-09-23

### Changed

- Lockstep version alignment with the OMK packages. This cycle's changes live in `open-multi-agent-kit`.

## [1.2.3] - 2026-09-23

### Changed

- Lockstep version alignment with the OMK packages. This cycle's changes live in `open-multi-agent-kit`.

## [1.2.2] - 2026-09-23

### Changed

- Lockstep version alignment with the OMK packages. This cycle's changes live in `open-multi-agent-kit`.

## [1.2.1] - 2026-09-23

### Fixed

- `routeTopology` reads the DAG from the tool's top-level `subtasks`/`dependencies` arguments, so an MCP caller that passes them at the top level is honored instead of failing to see a DAG.

## [1.2.0] - 2026-09-20

## [1.0.0] - 2026-09-18

## [0.99.0] - 2026-09-13

## [0.98.5] - 2026-09-12

### Changed

- Lockstep version alignment with the OMK packages; no additional WPL behavior is introduced by this version update.

## [0.98.4] - 2026-09-10

### Added

- Added side-effect-free service-link helpers for explicit onboarding surfaces.

### Fixed

- Submission now requires apply eligibility, a non-preview run, run IDs and confirmed adjudication. Deep-wall evidence requires nonempty digest/command and exit code zero; deep checks cannot clear a pre-existing human-review requirement.

## [0.98.3] - 2026-09-06

### Added

- Added readonly VERA vocabulary guards and pure `projectProofClosure()`, `projectProofEvaluationFailure()` and `admitVeraOutcome()` projections. Candidate failure, environment uncertainty, missing evidence and open effects stay distinct. A projected `SHIP` is not release authorization; no remote service is called automatically.

## [0.98.2] - 2026-09-02

## [0.98.1] - 2026-08-30

## [0.98.0] - 2026-08-28

## [0.97.0] - 2026-08-24

## [0.96.2] - 2026-08-21

### Fixed

- Updated the topology client to read and validate AdaptOrch's current `topology` response field and six supported topology values. Malformed or obsolete responses now fail closed before approval comparisons.

## [0.96.1] - 2026-08-20

### Notes

- Version lockstep with `open-multi-agent-kit@0.96.1`; no functional changes in this package.

## [0.96.0] - 2026-08-16

## [0.95.2] - 2026-08-15

## [0.95.1] - 2026-08-01

## [0.95.0] - 2026-07-31

## [0.94.1] - 2026-07-27

## [0.94.0] - 2026-07-27

## [0.93.0] - 2026-07-26

## [0.92.0] - 2026-07-23

## [0.91.0] - 2026-07-21

### Changed

- Promoted from experimental design-stage to stable and wired as a runtime dependency of `open-multi-agent-kit` (lockstep `0.91.0`). The package now ships the Work Packet Loop state machine, outcome adjudicator, B2C correctness-wall mapping, deep verification wall, and receipt signing as part of the CLI distribution.

## [0.90.8] - 2026-07-13

## [0.90.7] - 2026-07-11

### Fixed

- Fixed package repository metadata after the GitHub repository rename by aligning it with `dmae97/omk`.

## [0.90.6] - 2026-07-09

### Added

- Added B2C Correctness Wall orchestration APIs (`evaluateCorrectnessWall`, policy wall, deep-wall evidence gate, live/fixture OA transports, repair hints/budget, signed receipts) with unit coverage; advisory evidence-gated verdicts only (not formal correctness proof).

## [0.90.5] - 2026-07-07

## [0.90.4] - 2026-07-04

### Added

- Added deterministic retry-backoff groundwork for AdaptOrch packets: `backoffDelayMs` combines exponential delay caps with stable per-packet jitter so the same packet id and retry count always produce the same delay.

### Changed

- Adjudication reasons are now structured: `AdjudicationResult` and `PerRunVerdict` carry a machine-readable `reason_code` from the closed `ADJUDICATION_REASON_CODES` set alongside the human-readable `reason` string, and `projectVerdictToDisposition` branches on `reason_code` through a compile-time-total disposition table instead of substring-matching the reason text (which could falsely escalate on incidental wording like "scoped variable" or miss reroutes when drift reasons lacked the word "schema"). `CheckResult` gains an optional `code` field so `content_check`/`trace_check` hooks can classify failures (e.g. `SCOPE_VIOLATION`, `SCHEMA_DRIFT`) explicitly.

## [0.90.3] - 2026-07-02

## [0.90.2] - 2026-07-02

### Added

- Added the experimental AdaptOrch-native Work Packet Loop as the private `omk-adaptorch-wpl` workspace package (adaptorch client, work-packet state machine, adjudicator registry, and loop runner). Not published to npm.
