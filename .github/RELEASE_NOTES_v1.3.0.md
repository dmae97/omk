# OMK v1.3.0

## Give your coding agent a check it has to pass

OMK 1.3.0 connects durable goals to an acceptance command you approve. It also
repairs the interactive goal loop and makes cancelled verified runs resumable.
All seven public workspace packages move together to 1.3.0.

This is a minor release under OMK's version policy: cancellation changes the
verified-run state and journal contract. Read the compatibility notes below
before upgrading integrations that consume run status or journals.

## What's new

- **Goals that finish on a passing check.** Start a goal with `/goal <objective>`,
  then approve its acceptance command with `/goal verify <command>`. After each
  settled turn, OMK runs that command through its default local bash sandbox. A
  pass completes the goal on the checked workspace. A failure starts the next
  round with the command and exit code; the command's output stays out of the
  model context. `/goal complete` requires a passing receipt from this session
  that still matches the workspace. Editing files or moving HEAD makes that
  receipt stale. See [acceptance checks](../packages/coding-agent/docs/run-protocol.md#acceptance-checks).
- **A repaired interactive goal loop.** Through 1.2.4, the controller tried to
  send the next turn before the session released the preceding one. The round
  was spent while the session rejected the message with `Agent is already
  processing`. OMK now queues the continuation after the turn settles; an
  attempt awaiting an automatic retry does not consume a round. Goal
  transitions also tolerate a wall clock that steps backward. SDK callers can
  use the newly exported `nextDurableGoalTimestamp()` for the same timestamp
  rule.
- **Cancel now, resume later.** A cancelled `omk run` stays `paused`, so you can
  recover with `restart-writer`, `resume`, or `retry-tasks`. `omk run cancel`
  requests cancellation from another shell without signaling a PID. A check
  interrupted during verification is no longer signed as a failed check. See
  [cancellation](../packages/coding-agent/docs/verified-run.md#취소와-원격-취소).
- **Preview cleanup before deleting workspaces.** `omk run gc` reports eligible
  derived workspaces by default. Add `--execute` to prune workspaces belonging
  to runs that can no longer be recovered. Journals, receipts, and attestations
  remain. See [artifact GC](../packages/coding-agent/docs/verified-run.md#artifact-gc).
- **More reliable execution and MCP shutdown.** The verified-run authority
  store uses monotonic elapsed time instead of failing when the wall clock
  moves backward. Errors outside the run contract include a bounded error kind
  and code. An MCP server that exits during startup is isolated while other
  servers keep their tools; malformed tool results are rejected. Transport
  reconnection waits for physical shutdown, and RPC waiters settle when their
  child process fails or exits.
- **Context admission and recovery.** Requests are checked against the model's
  input ceiling before dispatch. Automatic compaction uses that ceiling, stale
  provider usage no longer blocks a compacted session, and oversized MCP server
  schemas can be temporarily withheld to fit the selected model. Warnings name
  withheld servers, which return on a model with room. See the
  [changelog](../packages/coding-agent/CHANGELOG.md) for detailed contracts and
  additional runtime fixes.
- **Dependency security patches.** The release pins `brace-expansion` to
  5.0.12, the CLI's `undici` to 8.10.2, and Gondolin's nested `undici` to 6.28.1.
  These are compatible patches for the current dependency lines.
- **macOS process locks under non-English locales.** Replay-ledger identity
  probes use the C locale for BSD `ps`, so Korean or other localized date names
  no longer make a live process appear unavailable. Acceptance-check test
  repositories also use canonical physical temporary paths on macOS, keeping
  workspace-mismatch checks intact across `/var` and `/private/var` aliases.

## Compatibility and platform support

- A live verified run interrupted by `SIGINT`, `SIGTERM`, or `omk run cancel`
  now becomes `paused` with `failure: cancelled`, rather than terminal
  `failed`. Its journal records a new `interrupted` event. OMK 1.2.4 and earlier
  cannot read that journal. Status consumers must handle `paused`.
- When a goal has an approved acceptance command, `/goal complete` requires its
  current passing receipt. Without an approved command, the existing rule for
  evidence in the current generation still applies. Acceptance approvals live
  in the OMK process; approve the command again after restarting.
- Context Budget V2 uses the `sel-4-codeunit` selection-cache policy. Entries
  written under the previous policy are not reused.
- Built-in local bash requires `sandbox-exec` on macOS or `bwrap` with
  unprivileged user namespaces on Linux. It blocks network access by default
  and refuses execution when the sandbox backend is unavailable. The
  `omk run` verified-run workflow requires Linux and usable user, PID, and
  network namespaces. See [containerization](../packages/coding-agent/docs/containerization.md)
  and [verified-run prerequisites](../packages/coding-agent/docs/verified-run.md).

## Known dependency limitation in the optional Gondolin example

The optional Gondolin extension depends on `node-forge` 1.4.0. As of
October 4, 2026, its upstream RSA signature-verification advisory has no patched
npm release. It is not an installed dependency of the main CLI. The production
audit scoped to `open-multi-agent-kit` reports zero vulnerabilities; the
repository-wide audit still reports Gondolin and `node-forge`. OMK does not
claim a clean audit for every example. See
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and the
[upstream fix](https://github.com/digitalbazaar/forge/pull/1152).

## Upgrade after publication

Once the 1.3.0 npm packages are published:

```bash
npm install -g open-multi-agent-kit@1.3.0 --ignore-scripts
omk --version
```

Restart any running OMK process after installing. Binary archives will be
available in the GitHub Release assets. A release is complete only when the
`v1.3.0` tag is reachable from `main`, its GitHub Release exists, and npm
`latest` points to 1.3.0 for all seven public packages.

Try an acceptance check on a repository with a focused local test command. If
the workflow is useful, [star OMK](https://github.com/dmae97/omk) and share the
task, command, platform, and result in an
[issue](https://github.com/dmae97/omk/issues). Reproducible reports help other
developers decide whether OMK fits their work.
