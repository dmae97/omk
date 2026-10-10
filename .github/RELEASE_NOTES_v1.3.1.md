# OMK 1.3.1 preparation

**Status: source version bump, not a published release.** The GitHub Release,
`v1.3.1` tag and npm `latest` have not been advanced by this change. Do not install
`open-multi-agent-kit@1.3.1` until publication is independently confirmed.

All seven public workspace packages move together to 1.3.1. This is a patch
preparation for fixes and compatible additions. The current published 1.3.0
release and its changelog section remain unchanged. Dated 1.3.1 preparation
sections satisfy version-document parity but do not mark publication. The
next-cycle behavior changes stay under `[Unreleased]` pending the release audit.

## Memory changes prepared on main

- Source-quote memory wrappers release closed controller/store references and
  skip closed predecessors while preserving error and cancellation ownership.
  A pre-aborted request does not start predecessor work.
- Each memory request prices static system-prompt and tool-schema text once.
  Complete message, synthetic tool-pair and final-input accounting remains.
- Source and private-record reads allocate their statted byte length plus one,
  rather than 256 KiB/16 KiB maximum buffers. Size, identity, ownership,
  symlink/hardlink and complete-source scans remain enforced. V2 selection does
  not tokenize records with no lexical match.
- TUI `/session` shows memory state and eligible/omitted counts, never source
  quotes or a semantic verification verdict. It does not enable memory.
- The offline factorial CLI provides independent/dependent and memory-off/on
  controls over actual reopened stores. Its 1,200 deterministic evaluations are
  mechanism checks, not LLM efficacy, measured KV use or process-heap evidence.

See [recall hardening](../packages/coding-agent/docs/memory-recall-hardening.md),
[lifecycle/pricing](../packages/coding-agent/docs/memory-lifecycle-optimization.md)
and [offline experiment](../packages/coding-agent/docs/memory-factorial-experiment.md).
Other previously committed work since 1.3.0 remains in the existing Unreleased
changelog; this preparation does not incorporate other sessions' dirty files.

## Verification and remaining gate

The memory/runtime candidate passed 292 focused tests, 150 WPL tests, whole-tree
type checking, the isolated build and `npm run check`. A separate coverage run
passed 102 tests with 98.23% line and 85.86% branch coverage in the four changed
memory modules. An owned built-TUI session exercised `/session` at 120/80/40
columns and exited normally. The actual local AdaptOrch MCP client/server checked
tool/capability parity, two topology controls and physical transport closure.
These are scoped checks, not production certification or remote orchestration.

The full `./test.sh` attempt reached its 600-second bound. Proxy tests timed out
on both the unchanged base and candidate; verified-run tests failed in both with
varying individual failures. This evidence does not establish that every failure
is unrelated. Publication remains blocked until the full release suite passes,
the Unreleased changelogs are audited/finalized and the tag/Release/npm surfaces
agree. No security boundary, test assertion or release gate is bypassed.

The installed launcher and already-running TUI are not replaced by this source
version bump. Restart after a separately verified runtime update.
