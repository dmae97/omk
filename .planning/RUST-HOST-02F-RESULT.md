# Native obsolete GC continuation, 2026-11-09

## Scope

- `omk run gc --prune-obsolete` is now an explicit opt-in for orphan/legacy native
  execution records that cannot participate in the current authority-bound reconnect
  protocol (1.5-era/unbound records). It has no effect without `--execute`.
- An orphan/legacy bundle is deleted only after proving it is not a live execution:
  terminal event, no binding digest, recorded host is not alive by PID/start ticks,
  and any namespace witness is gone. Private, complete, aged files are required.
  Invalid, live, recoverable, bound, shared or symlinked records remain untouched.
- Sidecar-only bundles are eligible for cleanup when the strict orphan shape,
  private-file and retention checks pass. A recorded live host is never deleted.
- Existing authority-bound retention and reconnect behavior is unchanged.

## Files

- `packages/coding-agent/src/core/verified-run/native-record-obsolete.ts`:
  strict legacy/orphan shape, terminal/host/witness checks, durable removal.
- `native-record-files.ts`: shared private-file removal now also supports
  sidecar-only bundles while preserving payload-last deletion.
- `native-record-gc.ts`: opt-in orphan/legacy inventory routing under the
  existing authority lease, without advancing epochs or dispatching work.
- `run-gc-types.ts`: optional `obsolete` report option, preserving old callers.
- `run-gc.ts`: optional-boolean validation and backward-compatible defaults.
- `verified-run-cli.ts`, `verified-run-cli-args.ts`: explicit CLI flag/help.
- `test/verified-run-obsolete-native-gc.test.ts` and `helpers/native-storage.ts`:
  private synthetic orphan/legacy/live fixtures and actual source CLI coverage.

## Verification

- RED: `red.log` initially showed all orphan/legacy entries kept as
  `unreferenced`; `green-final-unit.log` passed after implementation.
- Real source CLI: `cli-test-final.log` passed
  `omk run gc --prune-obsolete --execute` on synthetic orphan/legacy data.
- Focused regression: `final-focused-recheck.log`, exit 0.
- Native authority/GC regression: `final-native.log`, exit 0.
- Root check: `root-check.log`, exit 0; script tests 588 passed / 30 skipped / 0 failed.
- Final biome/import-cycle/module-size/doc-link/diff checks: exit 0.
- No default verified-run state directory existed, so no actual user records were
  deleted. No commit, push, version change, installed-engine activation or release.

Evidence root: `/mnt/omkdata/tmp/opencode/omk-rust-obsolete-gc-20261109-01a1be6d/`.

Remaining limits: this is Linux source-engine acceptance, not packaged/installer,
desktop, cross-platform or milestone release acceptance. Unknown or live records
are still preserved. Proposed commit message: `orphan/legacy native 실행 기록 정리 추가`.
