---
description: "One opt-in directory, OMK_RUN_LOG_DIR, where each runtime feature appends its own JSONL diagnostics for benchmark verdicts"
---

# Feature Specification: Shared run log directory

**Specification ID**: `042-run-log-dir`
**Feature Branch**: `feat/run-log-dir`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Bench Analyst found that #100 (spec 034) records restores and steers only through `appendEntry` and `events.emit`, which never reach `omk.jsonl` in bench runs (`--no-session --mode json`). The same gap may exist for 035/032 and spec 038's Adaptorch calls. Bench Analyst asked for one directory env instead of one env per feature, so the TB adapter copies one directory into `agent/`. Tech Lead confirmed one shared function, merged before #100, 035/032 logging and Perf Engineer's cache log, and set the privacy rule below.

## Requirements

1. **One env.** `OMK_RUN_LOG_DIR=<dir>` turns logging on. Unset or blank, `appendRunLog` returns `false` at once and creates no file or directory.
2. **One file per feature.** `appendRunLog(name, record)` appends one JSON line to `<dir>/<name>.jsonl`. `name` must match `^[a-z0-9][a-z0-9-]{0,63}$`, so a record can never be written outside `<dir>`. Planned names: `deliverable-guard`, `finish-check`, `adaptorch-calls`, `cache`.
3. **Fields added to every line**, after the record so a record cannot overwrite them:
   - `t`: wall-clock epoch ms (`Date.now()`).
   - `elapsedFraction`: `readRunBudget()?.elapsedFraction` from the shared run clock (spec 036), or `null` when no clock is bound.
   - `pid`: `process.pid`.
   - `role`: `"worker"` when `OMK_RUN_LOG_ROLE=worker`, else `"lead"`. The subagent worker env (`subagentWorkerEnv`) sets `OMK_RUN_LOG_ROLE=worker` whenever the parent has `OMK_RUN_LOG_DIR`, so verdicts can keep only the lead's lines. Workers inherit the directory and append to the same files.
4. **Synchronous and best effort.** The write is one `appendFileSync` of one line, so it works on a SIGTERM path. Any failure (unwritable dir, a value `JSON.stringify` rejects) returns `false` and never throws into the run.
5. **Privacy.** Records carry hashes, paths and numbers only. Prompt text, file contents and env values must never be put in a record. `appendRunLog` itself adds nothing but the four fields above.

## Acceptance (`test/run-log.test.ts`)

1. Unset env: returns `false`, nothing created.
2. Set env: two calls append two lines to `<dir>/<name>.jsonl` with `t`, `elapsedFraction: null`, `pid`, `role: "lead"`; a missing `<dir>` is created.
3. With the shared clock bound at 40 s of 100 s, `elapsedFraction` is 0.4.
4. `OMK_RUN_LOG_ROLE=worker` gives `role: "worker"`; a record cannot overwrite `t`, `elapsedFraction`, `pid` or `role`.
5. Names such as `../x`, `x/y`, `A`, `""` are refused and write nothing.
6. An unwritable target returns `false` without throwing.
7. The written line contains no env value: neither `OMK_RUN_LOG_DIR` nor any other variable from the env.
8. (`examples/extensions/subagent/worker-env.test.ts`) `subagentWorkerEnv` sets `OMK_RUN_LOG_ROLE=worker` only when the parent has `OMK_RUN_LOG_DIR`, and passes the directory down.

## Non-goals

- Using it from any feature. #100, 035/032, 038 and the cache log adopt it in their own PRs.
- Rotation, size caps or locking. Lines are small and appended with `O_APPEND`.

## Expected Files

- `specs/042-run-log-dir/spec.md` (first commit)
- `packages/coding-agent/src/core/run-log.ts`
- `packages/coding-agent/examples/extensions/subagent/worker-env.ts`
- `packages/coding-agent/test/run-log.test.ts`
- `packages/coding-agent/examples/extensions/subagent/worker-env.test.ts`
- `packages/coding-agent/docs/environment-variables.md`
