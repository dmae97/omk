# Changelog

## [Unreleased]

### Added

- Added deterministic retry-backoff groundwork for AdaptOrch packets: `backoffDelayMs` combines exponential delay caps with stable per-packet jitter so the same packet id and retry count always produce the same delay.

### Changed

- Adjudication reasons are now structured: `AdjudicationResult` and `PerRunVerdict` carry a machine-readable `reason_code` from the closed `ADJUDICATION_REASON_CODES` set alongside the human-readable `reason` string, and `projectVerdictToDisposition` branches on `reason_code` through a compile-time-total disposition table instead of substring-matching the reason text (which could falsely escalate on incidental wording like "scoped variable" or miss reroutes when drift reasons lacked the word "schema"). `CheckResult` gains an optional `code` field so `content_check`/`trace_check` hooks can classify failures (e.g. `SCOPE_VIOLATION`, `SCHEMA_DRIFT`) explicitly.

## [0.90.3] - 2026-07-02

## [0.90.2] - 2026-07-02

### Added

- Added the experimental AdaptOrch-native Work Packet Loop as the private `omk-adaptorch-wpl` workspace package (adaptorch client, work-packet state machine, adjudicator registry, and loop runner). Not published to npm.
