# Changelog

## [Unreleased]

## [1.5.10] - 2026-10-27

## [1.5.9] - 2026-10-26

## [1.5.8] - 2026-10-24


## [1.5.7] - 2026-10-23


## [1.5.6] - 2026-10-22


## [1.5.5] - 2026-10-21


## [1.5.4] - 2026-10-20

### Changed

- Lockstep version alignment with OMK 1.5.4. No functional changes in this package.

## [1.5.3] - 2026-10-19

### Changed

- Lockstep version alignment with OMK 1.5.3. No runtime behavior changed in this package.

## [1.5.2] - 2026-10-18

### Changed

- Lockstep version alignment with OMK 1.5.2 to restore publication of all seven workspace packages after the 1.5.1 registry staging conflict. Provider recovery behavior is unchanged from 1.5.1.

## [1.5.1] - 2026-10-18

## [1.5.0] - 2026-10-18

## [1.4.3] - 2026-10-17

### Changed

- Lockstep version alignment with OMK 1.4.3. Serialized protocol contracts are unchanged.

## [1.4.2] - 2026-10-16

### Changed

- Lockstep version alignment with OMK 1.4.2. Serialized protocol contracts are unchanged.

## [1.4.1] - 2026-10-13

### Changed

- Lockstep version alignment with OMK 1.4.1. Serialized protocol contracts are unchanged.

## [1.4.0] - 2026-10-11

## [1.3.2] - 2026-10-10

### Changed

- Lockstep version alignment with the OMK packages; no changes in this package.

## [1.3.1] - 2026-10-08

> Published 2026-10-08: tag `v1.3.1` (`a989d88`), GitHub Release and npm `latest` for all seven packages, built from that commit.

### Changed

- Lockstep source-version alignment with the OMK packages. Serialized protocol contracts remain unchanged by this preparation.

## [1.3.0] - 2026-10-04

### Changed

- Lockstep version alignment with the OMK packages. This cycle's changes live in `open-multi-agent-kit`.

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
