# Spec 115: `OMK_WRITE_STALE_GUARD`: refuse a whole-file `write` over content the model has not seen

Status: draft, Tech Lead decisions applied (spec only, no code). Base: omk `d6737aa35e` (main after #250).
Phase 1 ships `shadow` mode (log only, output unchanged), checked by unit tests; no paid A/B
for this PR. Real refusal (`=1`) needs the shadow rate plus an A/B first.

## Problem

The `write` tool replaces an existing file with no check of what is on disk.

- `packages/coding-agent/src/core/tools/write.ts:91-111`: inside `withFileMutationQueue` it
  runs `ops.mkdir(dir)` and then `ops.writeFile(absolutePath, content)`. The only look at the
  existing file is `existsSync(absolutePath)` for diagnostics (`:105`).
- `edit` is safe by design: `edit.ts:188-198` reads the current bytes and `oldText` must match
  them, so a stale view fails instead of clobbering. `write` has no such check.
- `read.ts:110` / `:138` read the file, but nothing records what was read.

So a whole-file `write` silently drops anything the model did not see:
1. the file was never read in this session (model writes from memory or a guess),
2. the file changed after the model read it (user edit in the editor, a formatter or
   codegen run via `bash`, a subagent/worker, another omk session),
3. the model read only part of it (`offset`/`limit`, or truncated at
   `DEFAULT_MAX_LINES`/`DEFAULT_MAX_BYTES`, `read.ts:151-185`) and rewrites the whole file
   (not handled in phase 1, see Later phase).

`file-mutation-queue.ts` serialises writes in one process but does not detect any of these.

## Reference (idea only)

- OpenCode (`sst/opencode`, MIT): `FileTime.read` / `FileTime.assert` refuse a write/edit if
  the file was not read in the session or its mtime is newer than the recorded read.
- Claude Code (closed source, behaviour only): "File has not been read yet" / "File has been
  modified since read" errors on Write.

**No code is copied.** If the implementation PR copies from OpenCode it keeps the MIT notice in
a file header (MIT, no NOTICE needed). Nothing from closed source.

## Decisions (Tech Lead, resolved)

1. **Partial reads are out of phase 1.** `offset`/`limit` reads are common, so refusing on them
   would cause many false refusals. Phase 1 checks only "never read in this session" and
   "changed on disk since last read (sha256)". Partial-read handling is a later-phase note.
2. **No `bash` tracking.** The write-time hash check is enough. After a successful `edit` or
   `write` in this session, the read record's hash is updated to the new content, so
   re-writing a file the session just wrote is not refused.
3. **`shadow` ships first.** `OMK_WRITE_STALE_GUARD=shadow` never refuses. It only logs
   "would refuse" to the run log, and tool output is identical to flag off. `=1` (real
   refusal) waits for the shadow rate and an A/B. The refusal message names the next action:
   "read the file first".
4. **The read record lives on the session object**, not a module-level map (a module-level map
   would outlive the session and leak). Cap: 1000 files, LRU eviction.

## Change

New env flag `OMK_WRITE_STALE_GUARD`, **default off**. Read per tool call (`process.env`, like
`OMK_EXEC_TRUNCATE_MIDDLE`), so tests can toggle it.

- **Off (unset, empty, anything but `shadow` or `1`)**: byte-identical tool output, details and
  description to `d6737aa35e`. Nothing is recorded (no memory cost).
- **Read record (`shadow` and `1`)**:
  - New module `packages/coding-agent/src/core/tools/file-read-ledger.ts` exports a class
    `FileReadLedger` (`canonicalPath -> { sha256, size }`), with LRU eviction at **1000**
    entries. The instance is owned by the **session object** and passed to the tools. It is
    dropped with the session (on new session or `/new`) and kept across compaction, because the
    bytes on disk are what matters, not the context. Subagents and workers get their own.
  - Key = `canonicalizeForWrite` (`workspace-write-guard.ts:21`), so symlinks and `..` map to
    the same key as the write.
  - `read` records the sha256 of the **full file bytes on disk** at read time, whatever the
    `offset`/`limit`/truncation (no partial-read check in phase 1). Images are recorded too.
  - After a **successful** `write` or `edit`, the entry is set or refreshed to the sha256 of the
    new content. So write→write, edit→write and read→edit→write pass without a re-read.
- **Check** (`write`, inside `withFileMutationQueue`, before `mkdir`/`writeFile`): if the target
  exists and is a regular file of size > 0, hash it. The verdict is "would refuse" when
  - there is no entry → reason `not_read`,
  - or the hash differs → reason `changed_on_disk`.
  New files (ENOENT) and empty existing files (size 0) are always allowed, with no prior read
  (Tech Lead decision).
- **`shadow`**: never refuses. On "would refuse", if `OMK_RUN_LOG_DIR` is set, call
  `appendRunLog` with `{ event: "write_stale_guard", mode: "shadow", reason, sessionId,
  parentSessionId, seq, pathHash }`. **No path at all (Tech Lead decision):** the record holds
  only `pathHash`, computed with `editPathHash(absolutePath)` from
  `src/core/tools/edit-match-observe.ts` (#235: sha256 of `node:path` `normalize(absolutePath)`,
  first 16 hex chars), reused, not reimplemented, so records join with `edit-match.jsonl`.
  **No file content and no hashes of the model's content.** The write then runs as with the flag off; tool output,
  details and description stay identical to off.
- **`1`** (only after the shadow rate and an A/B): throw, no write, with the same run-log
  record (`mode: "enforce"`). Messages:
  - `not_read` → `Refusing to overwrite <path>: it exists and was not read in this session. Read the file first, then write (or use edit).`
  - `changed_on_disk` → `Refusing to overwrite <path>: it changed on disk since you last read it. Read the file first, then write.`
- `edit`: unchanged apart from the hash refresh above (it already checks content).
- Custom `operations` (SSH etc., `write.ts:88` comment): the guard is skipped, the same rule as
  edit diagnostics in #250, because a local hash cannot see the remote file. Listed under risks.
- Hashing uses `node:crypto`. 0 new deps, no workflow edits, no CHANGELOG.

### Later phase (not in this spec)

- Partial-read refusal (read with `offset`/`limit` or truncated, then whole-file `write`).
  Revisit only with a shadow count that shows it matters and a low false-refusal rate.

## Success criterion

1. Unit: all cases in Tests pass. Flag-off and `shadow` snapshots are byte-identical to base.
2. Shadow rate: with `shadow` on, count `write_stale_guard` records per task in the run log
   (no model calls beyond the runs already planned). An offline replay over local session JSONL
   can give an early estimate. `=1` is proposed only after Tech Lead accepts that rate and an
   A/B shows no regression.

## Tests

New `packages/coding-agent/test/spec115-write-stale-guard.test.ts`:

1. Off: write over an unread existing file succeeds; content/details identical to base; no ledger entries.
2. `1`: write new file → ok.
3. `1`: write over unread existing file → throws, file unchanged.
4. `1`: read then write → ok. Read with `offset`/`limit` then write → ok (no partial-read check in phase 1).
5. `1`: read, external `fs.writeFileSync` change, write → throws, file keeps the external bytes.
6. **Hash refresh:** `1`: read → write → write → ok; read → edit → write → ok; write new file → write again → ok.
7. **Refusal message text:** `not_read` and `changed_on_disk` messages contain the path and "Read the file first".
8. **Shadow logs, output identical:** `shadow` with `OMK_RUN_LOG_DIR` set: write over unread file succeeds; tool result/details deep-equal to flag off; run log has exactly one `write_stale_guard` record with `reason: "not_read"` and no file content. Same for `changed_on_disk`. Record has no `path` field and no path text; its `pathHash` equals `editPathHash(absolutePath)` for the same file (joins with `edit-match.jsonl`). Without `OMK_RUN_LOG_DIR`: nothing written, no error.
9. **LRU cap:** read 1001 distinct files; the first is evicted (a write to it is a "would refuse"), the last 1000 are kept; touching an entry moves it to most-recent.
10. `1`: symlink path and `a/../b` path map to one ledger key.
11. `1`: empty existing file → ok.
12. `1`: custom `operations` → guard skipped.
13. `1`: a refused write does not bump `getFileMutationGeneration()` and does not leave the queue locked (next write proceeds).
14. Ledger isolated per session (two sessions in one process); dropping a session drops its ledger.

## Risks

- With `=1`, more round-trips: the model must `read` before rewriting. That is the point, but it
  costs tokens. The shadow rate bounds it before enforcing.
- Writes via `bash` (`cat > f`) bypass the guard, and `bash` changes are only caught by the hash
  at the next `write`. Not a sandbox.
- Whole-file write after a partial read is not caught in phase 1 (see Later phase).
- Hashing on every overwrite and every read: one extra full-file read, bounded by file size.
- LRU eviction can cause a "would refuse" on a file read long ago (more than 1000 files back).
- SSH/custom operations get no protection.

## Rollback

Unset the flag (default). To remove the code, revert the PR. No data migration; the ledger is
memory-only and the run-log records are additive.
