# Delta-Mode Cross-Process Advisory Lock — Implementation Report

**Date:** 2026-06-10  
**Scope:** `OMK_MEMORY_DURABILITY=delta` only; legacy default unchanged  
**Files changed:** `src/memory/graph-delta-log.ts`, `src/memory/local-graph-memory-store.ts`, `test/fixtures/delta-lock-worker.mjs`, `test/mem-delta-lock.test.mjs`

---

## 1. Lock Protocol

```
lockPath = <graph-state>.delta.lock
```

- **Acquire** — atomic exclusive create via `fs.openSync(lockPath, 'wx')`, then write a JSON holder record `{ pid, hostname, startedAt }` for diagnostics. `wx` guarantees cross-process atomicity on all POSIX and Windows targets.
- **Guarded section** — `withDeltaLock(graphPath, fn, env, maxWaitMs)` wraps the entire delta read-modify-append-write critical section (load → diff → append → compaction) inside `LocalGraphMemoryStore.mutateState`.
- **LEGACY mode** (`OMK_MEMORY_DURABILITY` unset) — `withDeltaLock` is a zero-cost passthrough; no lock file is ever created.
- **Release** — always executed in a `finally` block. `releaseDeltaLock` re-reads the holder record and verifies `pid === process.pid && hostname === os.hostname()` before `unlinkSync`. If the lock was stolen or replaced by another process, the unlink is skipped.

## 2. Stale-Recovery Rule

When acquisition fails with `EEXIST`, the waiter reads the current holder record and evaluates:

1. **TTL expiry** — if `startedAt` is older than **30 s**, the lock is stale.
2. **Dead-pid check (same host only)** — if `hostname` matches the local host and `process.kill(pid, 0)` throws `ESRCH`, the owning process is provably dead → stale.
3. **Foreign host** — only TTL applies; never break a live remote lock.
4. **Unparseable lockfile** — treated as stale (break and retry).

If stale, the waiter `unlinkSync(lockPath)` and retries immediately. If live, the waiter sleeps with **jittered bounded backoff** (`50 ms` base, `1000 ms` cap) until `maxWaitMs` (default `30 s`), then throws a clear timeout error. The caller **must not** proceed unlocked.

## 3. Verification Results

### New tests — `test/mem-delta-lock.test.mjs`
| Test | Result |
|------|--------|
| Concurrent writers (3 workers × 8 writes) — no lost updates, no torn/interleaved records | **PASS** |
| Stale-lock recovery — dead pid on local host | **PASS** |
| Stale-lock recovery — expired TTL on foreign host | **PASS** |
| Live-lock timeout — throws instead of proceeding unlocked | **PASS** |

**Concurrency details:**
- Total delta records after 24 parallel appends: **24** (expected 24).
- Every record is a valid, newline-terminated v2 frame with a matching CRC.
- Replay yields **24 unique nodes**; no duplicate or missing ids.

### Existing memory-durability suites
| Suite | Pass / Total |
|-------|--------------|
| `test/mem-durability-golden.test.mjs` | 8 / 8 |
| `test/mem-durability-recovery.test.mjs` | 2 / 2 |
| `test/local-graph-memory.test.mjs` | 11 / 11 |
| `test/graph-link-run.test.mjs` | 5 / 5 |
| `test/perf-mem-store.test.mjs` | 1 / 1 |

### Static checks
```
npx tsc --noEmit | grep 'error TS'   → none (0 errors)
npx eslint src/memory/graph-delta-log.ts → 0 problems (0 warnings)
```

## 4. GO / NO-GO Recommendation — Default Flip

**Recommendation: NO-GO** — keep `OMK_MEMORY_DURABILITY` legacy-unset as the default.

| Criterion | Status | Rationale |
|-----------|--------|-----------|
| **Lock soak** | ⚠️ Unproven at scale | The new lock passes targeted concurrency tests (3 workers, 8 writes each) but has not been exercised under real OMK multi-worker DAG load or long-running agent sessions. |
| **Compaction under load** | ⚠️ Not stress-tested | Compaction rewrites snapshot + manifest while holding the lock. High-frequency compaction with large graphs could spike latency and trigger cascading timeouts; no load matrix exists yet. |
| **Migration reversibility** | ✅ Supported | Reverting to legacy reads the latest snapshot and ignores deltas; no destructive forward-only migration. However, *default flip* is a one-way behavioral change for new projects that never created a legacy file. |

**Exit criteria for revisiting the default:**
1. At least **2–4 weeks** of production soak with active opt-in (`OMK_MEMORY_DURABILITY=delta`) across multiple users/platforms.
2. A CI stress matrix covering ≥8 parallel workers, ≥1 000 writes, and forced compaction mid-run with zero timeouts.
3. No new issues filed against delta-mode data loss, stale-lock false positives, or cross-platform lock failures.

Until then, delta mode remains an **explicit opt-in**.
