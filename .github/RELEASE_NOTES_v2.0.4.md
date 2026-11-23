# OMK v2.0.4

OMK 2.0.4 fixes a stalled turn when a provider closes a stream before returning a final result. The CLI reports the failure instead of waiting indefinitely.

- If a forced OAuth refresh throws during a turn or context compaction, OMK shows a `/login` hint without displaying the raw refresh error. The existing one-retry limit is unchanged.
- Closing a session releases its in-memory evidence deletion holds. Session search normalizes each transcript once per search, and the OpenTUI status panel skips serialization while a worker frame is in flight.
- Standalone archive checks run on Linux, macOS, and Windows for x64 and ARM64. The checks run the CLI without an external Node.js or Bun; on Linux and macOS they also verify that OpenTUI renders and the CLI exits normally.

All eight public npm packages move to 2.0.4 in lockstep. See the [coding-agent changelog](../packages/coding-agent/CHANGELOG.md#204---2026-11-23) for details.
