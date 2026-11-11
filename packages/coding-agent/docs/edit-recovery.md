# Recovering from an edit failure

The built-in `edit` tool still requires unique, non-overlapping `oldText` regions. All
entries in `edits[]` are checked against the original file before anything is written.
Overlapping matches within one string, such as `aaa` in `aaaa`, are ambiguous too.

When matching fails, the error keeps its original diagnostic and adds a bounded recovery
hint for the first failing `edits[]` entry:

- Indentation-only differences: candidate `read(offset=..., limit=...)` ranges in the
  current file. Re-read those ranges and copy the exact indentation before retrying.
- Multiple matches: candidate one-based `line:column` positions. Re-read the relevant
  locations and add the smallest surrounding context that makes `oldText` unique.
  Columns count UTF-16 code units, and fuzzy matches are mapped back to the original text.
- An absent `oldText` with `newText` already present: a note giving the replacement's line.
  This is an observation, not proof that the intended edit was applied. Re-read the file
  before deciding whether another edit is needed. Empty or whitespace-only replacements
  never trigger this note.
- Other missing text: a reminder to re-read the current file before retrying.

For example, an edit searching for `def f():\nreturn 1` in a file with four spaces before
`return` remains an error. Its hint points to the matching line range; OMK does not remove
indentation, choose a candidate, rewrite the file, or claim success.

Hints use only the content already read for the edit, including custom/remote operations.
They add no file text to the response or run log and perform no extra filesystem reads.
The existing run-log reason codes and successful edit responses are unchanged.

Detailed hints are skipped for files over 256,000 UTF-16 code units, any edit text over
32,000 code units, or batches over 64 entries. At most five candidate locations are shown;
each suggested read starts with at most 20 lines. Empty searches, no-op replacements and
cross-entry overlap errors retain their existing diagnostics. A diagnostic failure never
replaces the original error.

These hints do not automatically retry or expand write permissions. No model-based
next-turn recovery benchmark has been run, so they make no success-rate or read-count
improvement claim.
