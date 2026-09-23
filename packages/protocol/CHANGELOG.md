# Changelog

## [1.2.2] - 2026-09-23

### Changed

- Lockstep version alignment with the OMK packages. This cycle's changes live in `open-multi-agent-kit`.

## [1.2.1] - 2026-09-23

### Added

- `RunPublishCommand` with `parseRunPublishCommand` and `runOid`: the wire contract for a verified-run publication command, plus a full-object-name validator that treats an all-zero value as an unborn ref.

## [1.2.0] - 2026-09-20

## [1.0.0] - 2026-09-18

### Added

- Strict-evidence contract: `StrictEvidenceBinding`, `StrictEvidenceSnapshot`, `StrictEvidenceReport`, and `StrictEvidenceCompletion` wire types with parsers, plus `evaluateStrictEvidence` wired into evaluation so an admitted snapshot can gate results. A snapshot is evidence, not approval or execution by itself.

## [0.99.0] - 2026-09-13

### Added

- `RunDagWriter` accepts optional `maxConcurrentTasks: 1 | 2`. Omitted concurrency stays omitted in parsed contracts, preserving legacy serialization and digests. The field describes an approved bound; it does not authorize or execute tasks by itself.

## [0.98.5] - 2026-09-12

### Added

- Added immutable verified-run contracts and validated start, candidate-resume, writer-restart and task-retry commands, plus bounded static DAG types and ordering helpers. Protocol data does not execute or approve work by itself.

## [0.98.4] - 2026-09-10

### Added

- Added bounded `explainBlockingCut()` metadata and opt-in `witnessIndependence: "explicit-groups"`. The compatibility default remains observation-ID grouping.

### Fixed

- Shared DAG branches can share a repair instead of choosing incompatible local minima. Composite-local obligations remain visible. A bounded-search greedy fallback explicitly does not claim minimum cardinality.

## [0.98.3] - 2026-09-06

### Added

- Claim Closure Graph v1 types, validation, pure proof-closure evaluation and minimal blocking-cut analysis. Required/advisory claims, source/environment bindings, stale observations, trust floors, witness groups, workspace scope and open effects remain distinct. Callers must supply trustworthy evidence; a result is not a runner attestation or release approval.

Earlier lockstep releases predate this package-specific changelog; see the repository release notes.
