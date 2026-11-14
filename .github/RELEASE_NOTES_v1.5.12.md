# OMK v1.5.12

OMK 1.5.12 is a patch release from `main`. It bounds subagent work by effort,
keeps ownership of workers that have not confirmed termination, restores skill
instructions lost to compaction, makes MCP recovery reach the next tool call and
fixes two provider-failover defects. Rust-core and v2 development are not
included.

## Contributors

Thank you to [@Abhinav3499](https://github.com/Abhinav3499) for the test work
merged in this cycle: coverage for the durable file-mode helpers (#382) and a
stabilized timing assertion in the RPC client lifecycle test (#383).

The README now opens with everyone who has sent a pull request to OMK (#405).

## Subagent execution

- Every effort, including Ultra, has finite limits per `subagent` call. Ultra no
  longer removes the task, concurrency, internal deadline or outer tool-timeout
  caps (#403).

  | Parent effort | Concurrent workers | Logical tasks | Default budget |
  | --- | ---: | ---: | ---: |
  | off / minimal | 1 | 4 | 2 minutes |
  | low | 1 | 4 | 3 minutes |
  | medium | 2 | 6 | 4 minutes |
  | high | 2 | 8 | 6 minutes |
  | xhigh | 3 | 8 | 8 minutes |
  | max | 4 | 12 | 10 minutes |
  | ultra | 4 | 16 | 14 minutes |

- **Behavior change outside Ultra.** Earlier releases ran up to 4 workers at once,
  accepted 8 parallel or graph tasks and used a 14 minute default budget at every
  effort. Concurrency is now 1 at low and below and 2 at medium and high, the task
  limit also applies to `chain` calls, and the default budget follows the effort.
  A call with many independent tasks can take longer, and a short budget can
  return a long task as incomplete. Set `executionBudgetMs` (60,000 to 840,000)
  to choose the budget yourself (#403).
- Workers receive the parent's effort as `--thinking`; the worker clamps it to
  its resolved model (#403).
- When the host run has a deadline, worker budgets leave 30 seconds for the lead
  to integrate results, run required checks and report. The remaining time is
  checked again immediately before each spawn; with no capacity left the call
  returns an incomplete result instead of starting a worker (#403).
- Single and chain launches use the same session lane authority as graph and
  parallel work. A worker whose process termination is unconfirmed keeps its
  ownership and resource reservation; a timeout alone does not mark it complete
  (#403).

These limits are engineering bounds. No latency or memory measurement backs
them, and they do not guarantee that every delegated task finishes before the
lead does. See
[subagent execution budgets](../packages/coding-agent/docs/subagents.md).

## Skills

- Automatic skill loading checks the current retained context before skipping a
  body admitted earlier. Instructions removed by compaction or branch navigation
  are loaded again in their existing admission slot. A body still present is not
  duplicated, a changed body needs a new slot, and the lifetime admission cap is
  never reset. Restoring a body can raise prompt tokens for that turn (#402).
- `skill-autoload.jsonl` records `contextChecked`, `contextAbsent` and
  `restoredFromHistory`. They describe delivery, not whether the skill was applied
  correctly (#402).
- Skill discovery no longer probes for `.gitignore`, `.ignore` and `.fdignore` in
  every directory; it uses the directory listing it already read. The discovered
  skill set is unchanged (#394).

## MCP

- After `mcpCheckHealth({ reconnectFailed: true })` reconnects a server, the
  session uses the replacement server's tool catalog, including changed names and
  schemas. Disabled tool selections are kept. A call made against the old
  connection fails and is not replayed against the new one (#401).

## Provider failover

- An automatic failover or route rotation is recorded in the session only. It no
  longer becomes the saved default model, so the next session starts on the model
  you chose (#395).
- When the model a failover switched to rejects the request outright, for example
  `403 Access to model denied`, OMK marks it failed for the turn and tries the next
  authenticated candidate. With a `--model`/`--provider` pin, a denied candidate
  still ends the turn (#395).

## Not in this release

- The `OMK_SUBAGENT_ADAPTORCH` routing-result consumer (#404) is deferred to a
  later version.

## Verification scope

The subagent, skill and MCP changes are covered by offline tests with local
fixtures. They were not exercised against a live model end to end, on macOS or
Windows process termination, or with before/after memory and latency
measurements.

All seven public workspace packages are released at 1.5.12. No dependency
changed.
