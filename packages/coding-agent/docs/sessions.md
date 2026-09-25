# Sessions

OMK saves conversations as sessions so you can continue work, branch from earlier turns, and revisit previous paths.

## Session Storage

Sessions auto-save to `~/.omk/agent/sessions/`, organized by working directory. Each session is a JSONL file with a tree structure.

```bash
omk -c                  # Continue most recent session
omk -r                  # Browse and select from past sessions
omk --no-session        # Ephemeral mode; do not save
omk --name "my task"    # Set session display name at startup
omk --session <path|id> # Use a specific session file or partial session ID
omk --fork <path|id>    # Fork a session file or partial session ID into a new session
```

Use `/session` in interactive mode to see the current session file, session ID, message count, tokens, and cost.

Stored sessions can also be inspected or appended from scripts:

```bash
omk sdk session status [id] [--json]
omk sdk session tail [id] [--limit 20]
omk sdk session inspect [id]
omk sdk session send <id> "message"
```

Without `--live`, `send` requires an exact session ID and appends only when the session has no active owner; it does not execute the message. An explicitly enrolled owner (`OMK_SESSION_CONTROL=1`) also supports `send <id> "text" --live`, `status <id> --live` and `abort <id> --live` over private local IPC. Live failures never fall back to appending. See [Local live session control](#local-live-session-control) and [SDK](sdk.md#inspect-persisted-sessions-from-the-cli).

Opt-in [project source-quote memory](#project-source-quote-memory) can carry explicitly pinned evidence across sessions in the same workspace. Recall revalidates the source on every model request and does not persist its tool-data projection in the transcript.

For the JSONL file format and SessionManager API, see [Session Format](session-format.md).

## Local live session control

Experimental, opt-in POSIX control of an already-running persisted session. Start
its owner with `OMK_SESSION_CONTROL=1 omk`, or call `await session.startControl()`
from the SDK. No configuration file is changed. An ephemeral session cannot enroll.
Once a message has persisted, use the exact session ID:

```bash
omk sdk session status <id> --live
omk sdk session send <id> "Continue the selected task" --live
omk sdk session send <id> "Use the smaller change" --live --steer
omk sdk session send <id> "Then run the focused test" --live --follow-up
omk sdk session abort <id> --live
```

`--cwd` and `--session-dir` retain their lookup meanings. Prefixes and paths are
not live IDs. A failed live request never falls back to a transcript write or an
automatic retry. An unknown outcome must be inspected before retrying.
`accepted` means preflight accepted or cancellation requested, not task completion.
`lastOutcome` describes the prompt producer, not verification or physical exit.
Steering/follow-up requires a running prompt and shares its budget. Live text does
not expand slash commands or prompt templates.

Abort signals the prompt (including preflight), bash, compaction and branch summary.
It is not termination evidence and does not forcibly exit the owner process.

The native socket lives in a fresh `0700` directory with mode `0600`. An owner-only
descriptor next to the transcript binds canonical path, exact ID, socket and fresh
enrollment token. The server checks its current identity and owner lease before
dispatch. The client checks descriptor/socket type, permissions and UID. Tokens
never appear in CLI output. Stale descriptors are not automatically reclaimed.
Cleanup removes only a descriptor matching its own token and socket.

Limits: one frame per connection, 32 KiB UTF-8 frame, 16,384 UTF-16 text units,
8 connections, 10-second request timeout, 1024 distinct mutation IDs per enrollment.
Duplicate mutation IDs and exhaustion refuse. This is an in-memory replay fence,
not durable exactly-once delivery. Same-UID directory attacks, remote peers and
Windows ACLs are outside this slice. Existing tool/admission policies still apply.

`await session.close()` seals work admission and joins registered producers,
tool/lane settlement, logical streams and native MCP closure before releasing its
owner lease. Normal runtime replacement and interactive/print/RPC disposal use it.
Legacy `dispose()` stays synchronous when idle and starts close when busy; prefer
`close()` to observe cleanup errors. Unknown/uncooperative work can keep close
pending. Reentrant close from that session's own operation is refused rather than
self-deadlocking. Hosts must schedule replacement/close outside such an operation.
Direct low-level Agent/SessionManager calls, unregistered detached work, plugin
background work, remote effects and crash recovery remain separate boundaries.

## Project source-quote memory

Experimental, explicitly pinned source quotes, not automatic fact extraction or
semantic truth verification. The host reads the quote itself; a caller's statement
or successful command exit cannot substitute for source evidence.

```typescript
const admission = await session.rememberSource({
  path: "docs/architecture.md", startLine: 12, endLine: 16,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
});
// accept + recordId, or abstain/escalate + a fixed reason
console.log(session.memoryStatus); // counts/state, never quote text
if (admission.verdict === "accept") await session.forgetMemory(admission.recordId);
```

Recall requires `OMK_VERIFIED_MEMORY=1` and Context Budget V2 (global
`contextBudget.enabled` or `OMK_CONTEXT_GOVERNOR=1`). Both remain opt-in; no setting
or environment file is changed. Each provider request, including tool continuations,
rechecks source digest/span, workspace identity, expiry and revocation. The V2
planner admits only exact quotes or omission under a 2048-token evidence cap, with
512 estimated wrapper tokens reserved and complete final-input accounting.

The provider receives a host-originated closed `omk_project_memory` tool-call/result
pair, labelled `omk-host`. JSON quote data is not system, user-instruction or skill
text. It is transient: not appended to the transcript or compacted, no memory-plan
disk cache and no extra model call. This structural contract does not establish
semantic resistance to every injection or live-provider compatibility.

Storage is `.omk/verified-memory/`, with owner-only POSIX files, exclusive immutable
publication and mutation locks. Records carry opaque IDs/workspace digests, relative
source references and a host-created protocol Observation. Hashes correlate bytes;
they do not authenticate a malicious same-UID writer or prove the quote true.
The local wall clock is trusted for TTL.

Limits: 32 retained records (including revoked/expired), 256 KiB source, 2 KiB quote,
16 inclusive source lines, 16 KiB record, 7-day default and 30-day maximum TTL.
Traversal, hidden/internal paths, symlinks, hardlinks, credential filenames and
binary input refuse. Forced credential-shape and existing injection-pattern checks
scan the complete source before quote selection. They are best-effort, conservative
rules, not DLP or calibrated probabilities.

Changed/deleted sources, expiry and revocation omit evidence. `forgetMemory()` adds
an idempotent tombstone; it does not erase historical bytes. Re-pin explicitly to
record new evidence. The workspace owner can delete the memory directory to erase
retained records/reset capacity. No global-memory fallback or sync is performed.
`memoryStatus` reports disabled, empty, ready, unavailable or budget-omitted with
bounded counts/projection estimates. An invalid store contributes no evidence;
the ordinary task can continue without this optional context.

Automatic extraction, procedural advice, cross-workspace memory, learned ranking,
Windows support and default promotion remain outside this slice. Promotion requires
independently labeled admission data and same-model, same-budget task success,
recall, latency and token-cost measurements. Local Faux fixtures are not such gains.

## Retries and Termination Events

Each provider attempt writes its own `run_started`/`run_finished` journal pair and emits `session_termination`. A retryable termination is attempt-level when `auto_retry_start` follows it; consumers should not treat that event alone as the end of the outer `prompt()` call.

If a retry or failover succeeds, the later attempt emits `completed` and becomes `session.lastTermination`. If retry budget is exhausted, the last provider failure remains final. Quota, billing-cycle exhaustion, and provider-capacity waits (`at capacity`, Anthropic `overloaded_error`) are classified as `provider.rate_limit` and can switch through the configured provider-resilience chain before retrying. A Codex ChatGPT-account unsupported-model 400 or Anthropic `claude_code_version_too_old` is `configuration.invalid`: `/new session` will not grant access; switch with `/model`. See [Provider Resilience](provider-resilience.md).

## Session Commands

| Command | Description |
|---------|-------------|
| `/resume` | Browse and select previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set the current session display name |
| `/session` | Show session info |
| `/goal [objective]` | Show or set the durable goal; `checkpoint <json>` records Goal/Core/Verified/Open/Next continuity |
| `/tree` | Navigate the current session tree |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Summarize older context; see [Compaction](compaction.md) |
| `/export [file]` | Export session to HTML |
| `/share` | Upload as private GitHub gist with shareable HTML link |

`/goal` state lives under the working directory, not in one session file. Seam checkpoints are digest-correlated revisions in the same goal journal; session entries contain only their goal ID, revision, and digest. The unkeyed digest is not workspace authentication, so checkpoint prose loaded on resume is not promoted to user authority. See [Run Protocol](run-protocol.md#durable-goal-lifecycle).

## Resuming and Deleting Sessions

`/resume` opens an interactive session picker for the current project. `omk -r` opens the same picker at startup.

In the picker you can:

- search by typing
- toggle path display with Ctrl+P
- toggle sort mode with Ctrl+S
- filter to named sessions with Ctrl+N
- rename with Ctrl+R
- delete with Ctrl+D, then confirm

When available, omk uses the `trash` CLI for deletion instead of permanently removing files.

### Listing and full-history search

The `/resume` and `--resume` pickers keep metadata (name, first message, dates,
count and ancestry), not every session's concatenated message text. Typing a
query reads full user/assistant text from the original JSONL files, at most two
files at a time. Fuzzy tokens, quoted phrases, regex, ordering, named filters and
all-project scope remain available. Search covers all stored message branches,
not only visible rows or the current branch.

A loading state is shown until search settles. Changing the query or scope
cancels obsolete work; replacement work waits for its reads to settle, and old
results cannot overwrite the current query. Missing/unreadable or replaced
session identities are reported rather than treated as fully searched. Each
query rereads the source, so appended text is searchable without a stale sidecar.

This does not change JSONL durability, resume, copying, export, or branch storage.
No disk index is introduced. A search still temporarily materializes up to two
full text projections; one very large entry or first message can still be large.

## Naming Sessions

Use `/name <name>` to set a human-readable session name:

```text
/name Refactor auth module
```

Set the name at startup with `--name` or `-n`:

```bash
omk --name "Refactor auth module"
omk --name "CI audit" -p "Review this build failure"
```

Named sessions are easier to find in `/resume` and `omk -r`.

## Branching with `/tree`

Sessions are stored as trees. Every entry has an `id` and `parentId`, and the current position is the active leaf. `/tree` lets you jump to any previous point and continue from there without creating a new file.

<p align="center"><img src="images/tree-view.png" alt="Tree View" width="600"></p>

Example shape:

```text
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ user: "Let's try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ user: "That worked..."  ← active
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

### Tree Controls

| Key | Action |
|-----|--------|
| ↑/↓ | Navigate visible entries |
| ←/→ | Page up/down |
| Ctrl+←/Ctrl+→ or Alt+←/Alt+→ | Fold/unfold or jump between branch segments |
| Shift+L | Set or clear a label on the selected entry |
| Shift+T | Toggle label timestamps |
| Enter | Select entry |
| Escape/Ctrl+C | Cancel |
| Ctrl+O | Cycle filter mode |

Filter modes are: default, no-tools, user-only, labeled-only, and all. Configure the default with `treeFilterMode` in [Settings](settings.md).

### Selection Behavior

Selecting a user or custom message:

1. Moves the leaf to the selected message's parent.
2. Places the selected message text in the editor.
3. Lets you edit and resubmit, creating a new branch.

Selecting an assistant, tool, compaction, or other non-user entry:

1. Moves the leaf to that entry.
2. Leaves the editor empty.
3. Lets you continue from that point.

Selecting the root user message resets the leaf to an empty conversation and places the original prompt in the editor.

## `/tree`, `/fork`, and `/clone`

| Feature | `/tree` | `/fork` | `/clone` |
|---------|---------|---------|----------|
| Output | Same session file | New session file | New session file |
| View | Full tree | User-message selector | Current active branch |
| Typical use | Explore alternatives in place | Start a new session from an earlier prompt | Duplicate current work before continuing |
| Summary | Optional branch summary | None | None |

Use `/tree` when you want to keep alternatives together. Use `/fork` or `/clone` when you want a separate session file.

## Branch Summaries

When `/tree` switches away from one branch to another, omk can summarize the abandoned branch and attach that summary at the new position. This preserves important context from the path you left without replaying the whole branch.

When prompted, choose one of:

1. no summary
2. summarize with the default prompt
3. summarize with custom focus instructions

See [Compaction](compaction.md) for branch summarization internals and extension hooks.

## Session Format

Session files are JSONL and contain message entries, model changes, thinking-level changes, labels, compactions, branch summaries, and extension entries.

For parsers, extensions, SDK usage, and the full SessionManager API, see [Session Format](session-format.md).
