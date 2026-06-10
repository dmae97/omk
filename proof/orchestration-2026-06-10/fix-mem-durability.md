# Lane A FIX — Memory Delta Durability MUST-FIX + NITs

**Date:** 2026-06-10 · **Scope:** delta mode only (`OMK_MEMORY_DURABILITY=delta`)
**Skills:** omk-typescript-strict, omk-test-debug-loop
**Constraint honored:** legacy default (flag unset) byte-identical; edited ONLY
`src/memory/graph-delta-log.ts` + 1 new test. No commit, no web, no `any`.
Source of truth: `synth-review.md` (Lane A) + `impl-mem-durability.md`.

---

## Files changed

| File | Change |
|------|--------|
| `src/memory/graph-delta-log.ts` | Torn-tail physical truncation + byte-offset replay; order-faithful `computeDelta` (del-before-put repositioning); 2 eslint NITs removed. |
| `test/mem-durability-recovery.test.mjs` | **NEW** — raw-array order golden (deep-equal RAW nodes/edges in stored order) + resume-after-torn recovery test. |

`src/memory/local-graph-memory-store.ts` was **not** touched by this lane (the `M`
in git is the prior impl lane). Legacy code paths and `resolveDurabilityMode`
are unchanged ⇒ flag-unset behavior is byte-identical.

---

## 1. MUST-FIX — torn-tail physical truncation + offset (graph-delta-log.ts)

**Bug (review MAJOR):** `parseDeltaLog` discarded a torn last line only on read;
`appendDelta` (O_APPEND) never truncated the torn bytes, so a resumed write
concatenated onto the half-written fragment → mid-file unparseable line → strict
mode throws / non-strict drops every following record (data loss).

**Fix — mechanism:**
- `parseDeltaLog` rewritten to walk the **raw buffer** record-by-record over
  `\n` frames, tracking `validBytes` = byte offset (exclusive end) of the last
  valid, newline-terminated, CRC-verified record. Returns
  `{ records, validBytes, torn }`.
  - **Trailing** segment with no terminating newline ⇒ `torn=true`, excluded
    from `validBytes` (a crash mid-append).
  - **Mid-file** newline-terminated line that fails parse/CRC ⇒ strict **throws**,
    non-strict **stops replay at first corruption** (`break`) — never interleaved.
- `loadStateViaDelta`: when `torn`, it closes any cached append fd
  (`closeDeltaFdAsync`) then `truncateSync(deltaLogPath, validBytes)` **before**
  returning, so the next O_APPEND write lands exactly on the last valid record
  boundary (offset = `validBytes`, also surfaced on `DeltaLoadResult.validBytes`).
  Result: a resumed write can never merge into a half-written line.

## 2. MUST-FIX — raw-array order (del-before-put repositioning)

**Bug (review MEDIUM):** `replaceGeneratedMindmap` does `filter(...)` then
`upsertNode`→push, repositioning regenerated nodes to the array end. Old
`computeDelta` emitted no `del` for a re-added id and replay’s `Map.set` kept the
OLD position ⇒ replay order diverged from the legacy full-rewrite.

**Fix:** new `computeOrderedDelta<T>` keeps the longest front prefix of the final
array whose entries exist in pre-state with strictly increasing pre-positions
(stay in place), and treats everything from the first break onward as
**repositioned** — emit `del` (replay removes old Map slot) **then** `put` in
final order (replay re-inserts at the end). Replay applies all `del` then all
`put`, so del-before-put reproduces the legacy filter+repush ordering exactly,
for both nodes and edges. `replayDeltas` itself is unchanged.

**Order-fix proof (built `replayDeltas`, repositioning scenario):**
```
pre = [A,B,G]; mutation inserts N and re-adds G  → legacy = A,B,N,G
NEW   computeDelta: del=["G"] put=[…,N,G]  → replay = A,B,N,G   ✓ matches legacy
NAIVE (old) delta:                          → replay = A,B,G,N   ✗ diverges
```

## 4. NIT — eslint (2 warnings removed)

- L48 `lockPath` (advisory lock deferred, dead) — **deleted**.
- L91 `_crc` unused destructure — rewritten so `verifyRecordCrc` destructures
  and **uses** `crc` in the comparison (also dropped the unused `line` param).
- `npx eslint src/memory/graph-delta-log.ts` ⇒ **0 problems**.

## 3. NEW tests (test/mem-durability-recovery.test.mjs)

- **raw-array order golden** — runs an identical corpus (repeated writes/appends
  → triggers replaceGeneratedMindmap repositioning) through legacy and delta
  under a deterministic clock, then `deepStrictEqual`s the **RAW** `state.nodes`
  and `state.edges` arrays in stored order (id sequence + full objects; only the
  machine-specific absolute project root normalized) — not sorted/Set/count.
- **resume-after-torn** — writes N=5 records, tears record N’s tail, cold-reloads
  (⇒ state at N-1, log physically truncated to N-1 valid records ending on a
  clean `\n` frame), performs a NEW write, reloads again (⇒ new write intact, mN
  absent, no record interleaving/loss; every delta line a complete v2 frame).

---

## Verification (commands + results)

```
npx tsc --noEmit 2>&1 | grep 'error TS'        → none (0 errors)
npx eslint src/memory/graph-delta-log.ts        → 0 problems (0 warnings)
node --test test/mem-durability-golden.test.mjs → tests 8  / pass 8  / fail 0
node --test test/mem-durability-recovery.test.mjs → tests 2 / pass 2 / fail 0
node --test local-graph-memory + graph-link-run + perf-mem-store → 16 / 16 pass
```

## Remaining risk / follow-up
- Mid-file corruption in **non-strict** mode still leaves post-corruption bytes
  physically present (replay stops at first corruption, as specified); only the
  torn **trailing** record is physically truncated. Truncating mid-file
  corruption was intentionally out of scope (would be heavier data loss).
- `DeltaLoadResult.validBytes` is now surfaced but not yet consumed by the store
  writer (O_APPEND already lands at the truncated EOF); wire it in only if a
  future explicit-offset writer is added.
- Multi-process advisory lock remains deferred (impl-report risk #2); unchanged.
