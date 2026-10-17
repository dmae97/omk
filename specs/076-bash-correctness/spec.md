---
description: "bash correctness for 1.5.0: a signal-killed command is an error, the outer tool timeout keeps the output seen so far, and write reports UTF-8 bytes (bug fixes, no flag)"
---

# Feature Specification: bash correctness (signal exit, timeout output, byte counts)

**Specification ID**: `076-bash-correctness`
**Feature Branch**: `fix/076-bash-correctness` from origin/main `b94639dec6`
**Created**: 2026-10-17
**Status**: Implementation (local commits; not pushed)
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Harness Engineer's audit (`/workspace/omk-he-audit-candidates.md`, main `b94639dec6`), items #1 (stage 1 only), #3 and #15. Scope set by OMK, Harness Engineer and Tech Lead for 1.5.0 (feature freeze 2026-10-23 12:00 KST).
**Depends on**: 066 (output truncation caps, on main).
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: correctness fix, no flag. Results that used to be wrong (a false success, an empty timeout, a wrong byte count) become right. Results that were already right stay byte-identical.

| Dimension | Baseline (main `b94639dec6`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Signal exit | `echo before; kill -9 $$` returns success `"before\n"`; ops return `{"exitCode":null}` | Tool throws; text contains `before` and `Command terminated by signal SIGKILL`; ops return `signal: "SIGKILL"` | Any success result for a signal death fails CI | `npx vitest run test/spec076-bash-correctness.test.ts` in `packages/coding-agent` | that file |
| Outer timeout output | `toolTimeouts.bash=1000`, `echo partial-line; sleep 3`: result is only the timeout notice | Result contains `partial-line` followed by the unchanged timeout notice | Losing streamed text fails CI | same file + `npx vitest run test/tool-timeout-partial-output.test.ts` in `packages/agent` | those files |
| write byte count | `content.length` (UTF-16 code units) | `Buffer.byteLength(content, "utf8")` | Wrong count for Korean/emoji fails CI | same coding-agent file | that file |
| Existing behaviour | current bash, tool-timeout and tools tests | all green unchanged | any existing assertion change | vitest on the touched test files | test output |

## Problem

- **#3 Signal exit.** `utils/child-process.ts:100-106` `onExit(code)` drops the `signal` argument, so a process killed by a signal resolves `null`. `core/tools/bash.ts:249` (`exitCode !== 0 && exitCode !== null`) then lets `null` through as a normal success. An OOM-killed test run looks like a passing command, which is worst for the finish check and for "tests passed" claims.
- **#1 Outer timeout output.** `packages/agent/src/tool-timeout.ts:258-259` builds the timeout result with `createTimeoutToolResult(toolName, timeoutMs)` only. Everything the tool already streamed through `tool_execution_update` is dropped, so the model re-runs the same command or gives up.
- **#15 write bytes.** `core/tools/write.ts:91` reports `content.length` as bytes. Korean text is 3 bytes per syllable in UTF-8, so the model cannot check sizes against limits.

## Design

### 1. Signal exit (#3)

- `waitForChildProcess` keeps its `Promise<number | null>` signature for its other callers (`core/exec.ts`, `rtk-output.ts`). A new `waitForChildProcessExit(child)` resolves `{ code, signal }`, and `waitForChildProcess` is built on it.
- `BashOperations.exec` returns `{ exitCode: number | null; signal?: NodeJS.Signals | null }`. `signal` is optional, so custom operations (SSH, extensions) that return only `exitCode` still type-check and behave as today.
- `createLocalBashOperations` returns the signal. Abort and the inner timeout are checked first, as today, so their messages do not change.
- `bash.ts`: when `exitCode` is `null` and `signal` is set, throw `Command terminated by signal <NAME>` after the output, the same way as a non-zero exit. SIGKILL adds ` (possibly killed for running out of memory)`. `null` with no signal stays a success, as today.

### 2. Outer timeout output (#1 stage 1)

- `runToolCallWithTimeout` remembers the last partial result the tool streamed before the race settled.
- `createTimeoutToolResult(toolName, timeoutMs, partial?)`: when the partial has text, the result is that text, a blank line, and the unchanged timeout notice. The text goes through the existing `truncateTail` (`harness/utils/truncate.ts`, 2000 lines / 50 KB, the same limits as bash and 066); it is not a new cap. For bash the streamed snapshot is already within those limits, so this is a no-op there. If the partial's `details.fullOutputPath` is a string, the notice is followed by `Full output: <path>`.
- Images and other non-text blocks in the partial are not carried over. The envelope (`disposition: "timeout"`, `synthetic: true`, `reason`, `timeoutMs`) is unchanged.
- With no streamed text, the result is byte-identical to main.
- Stage 2 (honouring a per-call `timeout` above the 300 s outer timer, flag `OMK_BASH_HONOR_CALL_TIMEOUT`) is 1.5.1 and not part of this spec.

### 3. write bytes (#15)

- `write.ts`: `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path}`. ASCII content gives the same text as before.

## Agent-Oriented Requirements

### Requirement 1 - Audit repros become regression tests (Priority: P0)

1. The audit repros are split by package boundary: the #1 repro (outer timeout drops partial output) lives in `packages/agent/test/tool-timeout-partial-output.test.ts`, and the #3 repros (ops return no signal; tool reports success for `kill -9 $$`) plus the #15 repro (write with Korean text) live in `packages/coding-agent/test/spec076-bash-correctness.test.ts`. Both files fail on main `b94639dec6` before the fixes (recorded in the commit message). The coding-agent file does not import `packages/agent/src` directly.

### Requirement 2 - Signal exit (Priority: P0)

1. The tool throws for a signal death, with the output first and `Command terminated by signal SIGKILL` (and the OOM hint) last.
2. Ops return `signal: "SIGKILL"` and `exitCode: null`.
3. Custom ops returning only `{ exitCode: null }` still give a success (unchanged).
4. Abort and inner-timeout messages are unchanged.

### Requirement 3 - Timeout output (Priority: P0)

1. The outer-timeout result contains the streamed text and then the timeout notice, unchanged.
2. Without streamed text the result is byte-identical to main.
3. Streamed text over 2000 lines / 50 KB is cut by `truncateTail` with the default limits.
4. Updates that arrive after the timeout won are not used.

### Requirement 4 - write bytes (Priority: P0)

1. `write` with `"안녕"` reports `6 bytes`; ASCII content reports the same number as before.

### Requirement 5 - Gates (Priority: P0)

1. biome on changed files, `check-module-size`, `check-import-cycles`, `tsgo --noEmit -p .` in `packages/coding-agent`, and vitest on the new and touched test files pass. The pre-commit hook runs on every commit.

## Known risks

- A tool other than bash that streams a large partial text now has it in the timeout result (capped at 50 KB / 2000 lines by `truncateTail`). Before, it got only the notice.
- A signal death that the user expected to be harmless (for example a command that kills its own shell on purpose) is now an error. That is the intended fix.
- `withPartialOutput`은 마지막 partial만 남긴다. Earlier streamed snapshots are not merged, so a later partial that replaces text can lose earlier text.

## Non-goals

- #1 stage 2 (per-call timeout above 300 s): 1.5.1.
- #6 (non-interactive bash env), #11 (metrics `signal` field): separate specs.
- User `!` bash (`core/bash-executor.ts`) and `core/exec.ts` signal handling.

## Expected Files

- `packages/coding-agent/src/utils/child-process.ts`
- `packages/coding-agent/src/core/tools/bash-operations.ts`, `bash-local-operations.ts`, `bash.ts`
- `packages/coding-agent/src/core/tools/write.ts`
- `packages/agent/src/tool-timeout.ts`, `packages/agent/src/tool-execution-boundary.ts`
- `packages/coding-agent/test/spec076-bash-correctness.test.ts`, `packages/agent/test/tool-timeout-partial-output.test.ts`
