---
description: "Verified-memory record reads refuse a record that grew or shrank during the read, without relying on ctime"
---

# Feature Specification: Size check when reading a verified-memory record

**Specification ID**: `041-memory-record-grow-check`
**Feature Branch**: `fix/memory-record-grow-check`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Runtime Engineer reported that `test/memory-recall-cost.test.ts` > "refuses a record that grows during its bounded read" failed once in #63's CI and fails 5 of 5 times on main `226e096` on the shared box. Tech Lead assigned it to Staff Engineer as a small PR.

## Root cause

This is a bug in `readPrivateRecord` (`src/core/verified-memory-store.ts`), not in the test.

- The function stats the record, allocates `size + 1` bytes, reads, stats again, and refuses the record when it "changed during read". The only change checks are `ctimeNs` (before vs after vs `lstat`), `ino` and `dev`, plus `length > MAX_RECORD_BYTES`. It never compares the size or the number of bytes read with the size it started from.
- Linux file timestamps come from a coarse clock (one scheduler tick). Two writes inside the same tick leave `ctime` unchanged. On this box (overlayfs), `writeFileSync` followed by `appendFileSync` kept the same `ctimeNs` in 200 of 200 tries. So a record that grows during the read passes every check, and the extra byte the `+ 1` buffer was sized to catch is read and parsed.
- The sibling readers already do this: `readMemorySource` checks `before.size !== after.size`; `durable-file-io.ts`, `session-file-head.ts`, `verified-run/storage.ts` and `replay-ledger-lock-owner.ts` check size or bytes read. `readPrivateRecord` is the only one that relies on `ctime` alone.
- CI usually passes because its timing happens to cross a tick between the two writes.

## Requirements

1. `readPrivateRecord` refuses the record ("memory record changed during read") when the bytes read differ from the size it started with, or when the size differs between the first `fstat`, the second `fstat` and the final `lstat`. Existing checks stay.
2. No change to valid reads, to the error text, or to the allocation size (`size + 1`, which the "bounds record buffers" test pins).
3. The existing test becomes deterministic. A second case covers a record that shrinks during the read.
4. Out of scope: a same-size in-place rewrite inside one clock tick. Size and timestamps cannot see it; catching it would need a content hash, and the record is already private (mode 0600, owner checked, `O_NOFOLLOW`, single link).

## Acceptance criteria

- `vitest run test/memory-recall-cost.test.ts` passes 20 runs in a row on this box (`--repeat` or a loop), with "refuses a record that grows during its bounded read" failing on main `226e096` 5 of 5 before the fix.
- New case "refuses a record that shrinks during its bounded read" fails without the fix on this box and passes with it.
- `npm run check` passes; no module-size baseline change.

## Expected Files

- `specs/041-memory-record-grow-check/spec.md` (first commit)
- `packages/coding-agent/src/core/verified-memory-store.ts`
- `packages/coding-agent/test/memory-recall-cost.test.ts`
- `packages/coding-agent/CHANGELOG.md` (Fixed), `README.md` (release sync)
