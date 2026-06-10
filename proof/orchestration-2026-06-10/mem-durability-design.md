# ADR — Append-Only / Incremental Durability for the Local Graph Memory Store

- **Status:** Proposed (DESIGN ONLY — no source edited)
- **Date:** 2026-06-10
- **Scope:** `src/memory/local-graph-memory-store.ts` persistence path only. EXACT query semantics + durability preserved. Provider/runtime/API surfaces untouched.
- **Skills applied:** omk-plan-first, omk-adaptorch-orchestration-review, omk-context-broker.
- **Evidence base:** `proof/orchestration-2026-06-10/perf-recon-p2.md` (Rank #1), `proof/orchestration-2026-06-10/perf-mem.md` (P2#1 cache landed). Live file: `.omk/memory/graph-state.json` = 64MB.

---

## Context

`mutateState()` (write / append / linkRun) runs `loadStateForMutation → mutator → saveState`. P2#1 already made the **read** side cheap: a process-local cache keyed by `mtimeMs+size+ctimeMs+ino` skips the 64MB `readFile`+`JSON.parse` on warm writes. The **remaining dominant cost** is `saveState()`:

```
saveState(state):
  payload = JSON.stringify(state, null, 2)   # ~64MB serialize, full graph, every mutation
  writeFileAtomic(canonicalPath, payload)    # temp + rename, ~64MB write
  writeFileAtomic(fallbackPath, payload)     # SECOND ~64MB write (hardcoded source-of-truth mirror)
```

So **every** mutation pays one full serialize (~64MB CPU + heap) and ~128MB of disk writes, regardless of how few nodes/edges actually changed (a typical `write()` touches Project/Session/Memory/MemoryVersion + ≤50 generated concept nodes + a handful of edges — single-digit KB of real change).

Hard constraints the design must respect:

1. **EXACT query semantics.** `read`, `search`, `mindmap`, `graphQuery`, `nodes` consume a `LocalGraphState` whose `nodes[]`/`edges[]` **array order** is load-bearing: `Array.find` first-occurrence (`findMemoryNode`), descending `updatedAt→createdAt→id` tiebreak (stable over insertion order), and `expandNeighborhood` BFS inclusion at the `limit` boundary all depend on it. Reconstructed state must be byte-for-byte equivalent in content **and order**.
2. **Durability ≥ current.** Current model is crash-safe per write via atomic rename. New model must be equal-or-better.
3. **Concurrent multi-process workers** (repo assumes this). Current whole-file atomic rename is silently **last-writer-wins-whole-file** → a concurrent writer's mutation is LOST. New model should not regress and ideally fixes this.
4. **No new native dependency** (in-flight no-native-lane decision) → rules out `better-sqlite3`.
5. **Public API signatures + outputs unchanged**; callers must not change.
6. **Mutator code unchanged** wherever possible (the mutators are the semantic contract; touching them risks query drift).

Mutator invariant we exploit: `upsertNode`/`upsertEdge` always write a **new object** (`{...existing, ...node}` / fresh edge) and prunes reassign arrays via `.filter()`. So every change is observable as an id-keyed put or delete; nothing is mutated field-in-place.

---

## Options

### A. Append-only delta log (JSONL of mutations) + periodic snapshot compaction — **RECOMMENDED**
Per mutation, append a small checksummed delta record (changed nodes/edges + tombstones + state meta) and `fdatasync`. Periodically fold the log into a fresh full snapshot. Cold reads = snapshot + replay tail; warm reads = existing cache.

- **Pros:** Removes the full serialize+write from the per-write path entirely (writes ~KB, not ~64MB). Per-write durability preserved via append+fsync. **Strictly improves** multi-process safety — concurrent mutations both land in the log and merge on replay instead of clobbering the whole file. Debuggable (human-readable JSONL, same family as `events.jsonl`/`evidence.jsonl`). Snapshot remains a valid `version:1` state for legacy readers.
- **Cons:** New on-disk format (snapshot + delta + manifest), replay + crash-recovery + compaction + cross-process lock logic. Highest engineering surface of the viable options.
- **Win ceiling:** ~1000–4000× per-write I/O reduction (matches recon "100–1000×").

### B. Batched / debounced full-write (coalesce N writes, flush on idle/threshold)
Keep the full-rewrite `saveState` but defer it: mark dirty, flush on op-count/idle/size threshold.

- **Pros:** Smallest diff, no format change, no recovery/replay logic. Real win for **bursty** write storms (N writes → 1 flush).
- **Cons:** Does **not** remove the 64MB serialize — only does it less often; steady-state amortized cost is still `O(file/N)` and each flush is still a 64MB stall. **Weakens durability**: an unflushed mutation in the debounce window is lost on crash unless paired with a WAL — at which point you've re-implemented Option A's log anyway. Partial win, low ceiling.

### C. Sharded / segmented state files keyed by subgraph
Split `nodes`/`edges` into per-subgraph (e.g., per-Memory-path or per-Run) files; rewrite only the touched shard.

- **Pros:** Touched-shard write is smaller than the whole graph. No log/replay.
- **Cons:** Cross-shard consistency (a write touches Project+Session+Memory+Version+concepts+edges spanning shards → multi-file atomicity problem, the exact thing atomic-rename solved for one file). `search`/`mindmap` must fan-in across all shards → cold-read cost grows, not shrinks. Re-sharding + global-order reconstruction is complex. Per-shard rewrite is still a full rewrite of that shard. Highest semantic risk for least durable guarantees.

### D. Embedded KV (e.g. better-sqlite3)
Store nodes/edges in SQLite; mutate rows incrementally.

- **Pros:** Mature WAL durability, indexed queries, transactional multi-writer.
- **Cons:** **Native dependency — conflicts with the in-flight no-native-lane decision** (build/prebuild/ABI matrix, the reason this lane exists). Forces a query-layer rewrite (current code is array-scan in JS) → large blast radius on EXACT-semantics guarantee. `sql.js` (WASM) avoids the native dep but loses mmap/WAL durability, adds a heavy dep, and still needs the query rewrite. Not now.

---

## Decision

Adopt **Option A: append-only delta log + periodic snapshot compaction**, with **Option B's debounce reused only as an optional fsync group-commit knob** (coalesce *durability syncs*, never coalesce *correctness*). Reject C (consistency/complexity, no durability gain) and D (native-dep conflict + query rewrite).

Rationale: A is the only option that (a) deletes the dominant `JSON.stringify(64MB)+write` from the hot path, (b) keeps per-write durability, (c) *improves* the existing silent multi-process whole-file-clobber bug, and (d) leaves all read/mutate code paths and the `LocalGraphState` shape untouched, so EXACT-semantics is provable rather than hoped.

### Change capture (no mutator rewrite of logic)
Introduce a passive **MutationRecorder** that instruments exactly three sinks already used by every mutator — `upsertNode` (record put id), `upsertEdge` (record put id), and the two prune reassignments in `replaceGeneratedMindmap` / `applyRunManifest` (record deleted ids by diffing ids before/after the `.filter()`). The recorder is the only new surface inside the store; mutator **business logic is unchanged**, so query semantics cannot drift from recorder presence. (Fallback if instrumentation is undesirable: reference-diff the post-state arrays against the pre-state id→object map — reliable because mutators always replace objects — but the explicit recorder is preferred as it does not depend on that invariant.)

---

## On-disk Format + Atomicity

Directory `.omk/memory/` (configurable via existing `local_graph.path` dirname):

| File | Role | Write strategy |
|------|------|----------------|
| `graph.snapshot.json` | Full `LocalGraphState` (`version:1`) at snapshot epoch `E`. A legacy reader can consume it as-is. | temp → `fsync(temp)` → `rename` → `fsync(dir)` |
| `graph.delta.jsonl` | Append-only journal of delta records since epoch `E`. | `open(O_APPEND)` → `write(record+"\n")` → `fdatasync(fd)` |
| `graph.manifest.json` | `{ formatVersion:2, snapshot, snapshotEpoch:E, delta, deltaBytesAtSnapshot:0 }`. The single commit pivot for compaction. | temp → fsync → rename |
| `graph-state.json` (legacy) | Retained, untouched, as backup + legacy-reader source during rollout. | not written by delta path |

**Delta record (one JSON object per line, newline-framed):**

```json
{"v":2,"epoch":E,"seq":N,"ts":"<iso>","meta":{"updatedAt":"...","project":{...},"ontology":"<ref>"},
 "nodes":{"del":["id",...],"put":[{node},...]},
 "edges":{"del":["id",...],"put":[{edge},...]},
 "crc":"<sha256 of the canonical record bytes with crc field omitted>"}
```

- **Ordering rule (correctness lemma):** serialize `del` arrays first, then `put` arrays **ordered by each item's index in the final `state.nodes`/`state.edges` array**. Replay applies all `del`s then all `put`s into an insertion-ordered `Map`. JS `Map` semantics (`set` on existing key keeps position; `set` on new/deleted key appends; `delete` removes) **exactly reproduce** the array's upsert-in-place / prune-survivor / re-add-at-tail order. Materialize `[...map.values()]` to get the `nodes[]`/`edges[]` arrays. Proven equivalent to the full-rewrite array under the golden test (below).
- **Atomicity / torn-write detection:** newline framing + per-record `crc`. `O_APPEND` keeps appends ordered; on local POSIX fs small records append atomically, and for any size the **only** position a tear can occur is the trailing record. Replay therefore tolerates exactly one partial/uncrc'd final line (drop it); any CRC mismatch or parse failure on a **non-final** line is corruption.
- **fsync:** default `fdatasync` per append → durability equals current atomic-rename. Optional group-commit (`OMK_MEMORY_GROUP_COMMIT_MS`/`_OPS`) batches the sync across N in-process appends (Option B idea) for throughput, trading a bounded sync window — off by default.

---

## Crash Recovery

Cold load (`loadState()` replacement):

1. Read `graph.manifest.json`. If absent → legacy mode: load `graph-state.json` (or empty/ENOENT per current semantics). If present → load `graph.snapshot.json` at `snapshotEpoch E` into base maps.
2. Stream `graph.delta.jsonl` line by line:
   - `JSON.parse` fails **and** it is the last line / EOF mid-line → **torn tail**, ignore (truncated on next compaction). Idempotent: the mutation that wrote it never `fdatasync`-returned success, so the caller treats it as not-applied.
   - `epoch !== E` → record predates current snapshot (already folded) or a newer snapshot exists → skip / stop (see compaction pivot).
   - CRC mismatch on a non-final line → corruption: **strict** → throw + write `*.repair.json` signal + `.bak` (reuse existing `writeInvalidStateRepair`); **non-strict** → stop replay at last good `seq` (never apply a corrupt record; everything up to it is preserved).
   - Good record → apply `del`s then `put`s to the maps; apply `meta`.
3. Materialize arrays → return `LocalGraphState`.

**Idempotency:** records are content-addressed by `(epoch,seq)` and apply as upsert/tombstone (set/delete by id). Re-running replay over the same log yields the same state. A half-written record is invisible (no successful fsync) so partial application cannot occur mid-record — records are all-or-nothing at the line boundary.

---

## Concurrency (multi-writer / multi-process)

- **In-process:** keep the existing `enqueueGraphWrite(path)` per-path promise chain — serializes appends + compaction within a process.
- **Cross-process critical section** (read-tail → apply → append → fsync, and compaction): guard with a **native-dep-free advisory lock** using atomic `mkdir`/`open(O_CREAT|O_EXCL)` on `graph.lock` (lock dir holds `{pid, host, ts}`; TTL + PID-liveness reclaim for stale locks). Only the append+sync window is held — short.
- **Catch-up under lock:** on acquiring the lock, compare `graph.delta.jsonl` size to the process's last-seen offset. If grown (another process appended), replay **only the new tail records** into the cached state before applying this mutation, then append. This keeps the P2#1 cache correct across processes **without** re-reading the 64MB snapshot. The existing `mtimeMs+size+ctimeMs+ino` guard is extended to also watch the **delta file** (its size/mtime), so a stale cache is detected and tail-caught-up rather than fully reloaded.
- **Durability improvement:** unlike the current whole-file rename (last-writer-wins, silently drops the loser's mutation), concurrent processes both append under the lock and **both mutations survive**, merged deterministically by `seq` on replay. Conflicting upserts to the same id resolve last-writer-wins **per node/edge** (higher `seq` wins) — strictly finer-grained than the current whole-file clobber.

---

## Backward-Compat + Migration

- **Transparent legacy reader:** if no `graph.manifest.json`, the loader reads the existing single `graph-state.json` exactly as today (including ENOENT/empty/invalid/strict handling). No behavior change when the flag is off.
- **Migration v1 → v2 (zero-data-loss, reversible):** on first delta-mode write (or explicit `omk memory migrate`):
  1. Load legacy `graph-state.json` fully (one read, same as today).
  2. Write `graph.snapshot.json` (epoch 1) via temp+fsync+rename; create empty `graph.delta.jsonl`; write `graph.manifest.json` as the commit pivot.
  3. **Leave `graph-state.json` in place, untouched, as backup.** Nothing is deleted.
- **Reversibility / downgrade:** a compactor folds snapshot+delta into a single `version:1` document and writes it back to `graph-state.json`, then removes the v2 sidecars → identical to pre-migration format. Because the legacy file is never destroyed and the snapshot is itself a valid `version:1` state, rollback is a metadata flip, not a data rebuild.
- **Hardcoded fallback mirror:** the current second write to the canonical `.omk/memory/graph-state.json` is replaced by "snapshot is the canonical full state; delta is the tail." During shadow rollout the legacy mirror can still be emitted on each compaction (not each write) to keep external/legacy consumers current.

---

## Compaction

- **Trigger (whichever first):** delta size > `OMK_MEMORY_COMPACT_BYTES` (default 8MB), OR record count > `OMK_MEMORY_COMPACT_OPS` (default 1000), OR age > `OMK_MEMORY_COMPACT_MS`. Cheap to check (one `stat` + a counter).
- **Procedure (runs on the write lane, so never torn):** the in-memory cached state already equals snapshot+tail → serialize it once (this is the *only* full 64MB serialize, now amortized 1/N writes) → `graph.snapshot.json.tmp` → fsync → rename → bump `snapshotEpoch` in a new `graph.manifest.json` (commit pivot) → start a fresh `graph.delta.jsonl` for the new epoch. Records of the old epoch are ignored by the `epoch` check, so a crash between snapshot-rename and manifest-pivot is safe (old manifest+old delta still fully describe state).
- **Non-blocking option:** inline-amortized first (simplest, correct). Future: run the serialize in a worker thread, keep appending to the current epoch's delta, then pivot — flagged as a later optimization, not required for the win.
- **Retention:** keep last `N=2` snapshots + the legacy `graph-state.json` until migration is verified; prune older snapshots after manifest pivot.

---

## Public API Invariance (proof)

Unchanged signatures: `read(path)`, `write(path,content)`, `append(path,content)`, `search(query,limit)`, `ontology()`, `mindmap(query,limit)`, `linkRun(runId,manifest)`, `graphQuery(query)`, `writeMirrorFiles(state)`, and the `status`/`strict`/`mirrorFiles`/`migrateFiles` getters. Output types (`MemorySearchResult`, `MemoryMindmap`, `GraphQueryResult`, `LocalGraphState`) unchanged.

Argument: every read method consumes a `LocalGraphState` from `loadState()`. The new `loadState()` returns a `LocalGraphState` whose `nodes`/`edges`/`project`/`ontology`/`updatedAt` are **deep-equal and order-equal** to the full-rewrite result (ordering lemma + golden test). Mutators are handed the same mutable `LocalGraphState` and run unchanged. Only `saveState` internals (and the cold-load path) change, below the public surface. Therefore no caller can observe a difference — proven by the old-vs-new golden equality harness, not asserted.

---

## Rollout

- **Feature flag (defaults to CURRENT behavior):** `OMK_MEMORY_DURABILITY` = `legacy` (default) | `delta`, mirrored by `[local_graph] durability = "legacy"|"delta"`. Off → byte-for-byte current code path.
- **Golden test:** generate a deterministic corpus = a recorded sequence of `write`/`append`/`linkRun` ops (incl. overflow >50 concepts, prune+re-add, multi-path). Run **both** backends step-by-step; assert `read`, `search`, `mindmap`, `graphQuery`, `nodes(type)` outputs are deep-equal at **every** step, and that the materialized `nodes[]`/`edges[]` arrays are order-identical. Add crash-injection: truncate the delta file mid-record, reload, assert state == last fsync'd op.
- **Phases:** (1) opt-in dev flag. (2) **shadow**: write both formats, read legacy, diff in CI/canary, alarm on any mismatch. (3) default `delta` with legacy fallback retained + periodic legacy mirror. (4) remove legacy after N green releases.
- **Kill-switch:** flip flag to `legacy`; the reversible compactor rewrites a current `graph-state.json` from snapshot+delta before legacy path resumes → no data loss, no manual repair.

---

## Risks

| # | Risk | Sev | Likelihood | Mitigation |
|---|------|-----|-----------|------------|
| 1 | Replay order ≠ full-rewrite array order → query drift (search tiebreak, BFS limit boundary) | High | Low | del-before-put + insertion-ordered Map lemma; order-equality golden test at every step |
| 2 | Recorder/reference-diff misses an in-place field mutation | High | Low | Explicit recorder on upsert/prune sinks; invariant guard test that all mutators replace objects |
| 3 | Torn / corrupt delta record | Med | Med | newline framing + per-record CRC; tolerate only trailing partial; strict-mode repair signal + `.bak` |
| 4 | Cross-process lock staleness / contention | Med | Low | `mkdir`/`O_EXCL` lock + TTL + PID-liveness reclaim; bounded critical section; legacy whole-file fallback if lock unobtainable |
| 5 | fsync-per-write latency | Low | Med | still ≪ 64MB write; optional group-commit knob |
| 6 | Crash between snapshot-rename and manifest-pivot | Med | Low | manifest is sole commit pivot; old epoch delta fully describes state until pivot |
| 7 | Disk growth (snapshots + delta) | Low | Med | size/op/time compaction triggers + N=2 retention |
| 8 | Cross-process cache staleness | Med | Low | delta-file size/mtime added to cache guard; tail catch-up under lock |

### Perf model

- **Write amplification:** current ≈ 64MB serialize + ~128MB write per mutation. New ≈ serialize delta (~1–50KB) + append + fsync; snapshot 64MB once per `N` (default ~1000) writes → amortized ~64KB/write. **≈ 1000–4000× reduction** in per-write I/O and CPU. Matches recon Rank #1 estimate.
- **Read path:** cold = snapshot read+parse (~ same as current single read) + replay ≤ N tail records (KB, microseconds). Warm = unchanged P2#1 cache (O(1)). Cross-process warm = tail catch-up of only new records, not 64MB.
- **Memory footprint:** transient replay maps ~ one full state during cold load (same order as current parse peak); steady-state cache retains one `LocalGraphState` (already true post-P2#1). No regression; snapshot serialize peak now paid 1/N instead of every write.

---

## Test Plan

1. **Order-equality golden** (old vs new) across the generated corpus, per-step, for all read methods + raw `nodes[]`/`edges[]` order. (Risk #1, #2, API invariance.)
2. **Crash recovery:** truncate delta mid-record / mid-line → reload → state == last fsync'd op; corrupt non-final record → strict throws + repair signal, non-strict stops at last good seq. (Risk #3, #6.)
3. **Multi-process:** two processes interleave writes to the same path under the lock → both mutations survive (vs documented legacy whole-file clobber); per-id last-writer-wins by seq. (Risk #4, durability improvement.)
4. **Cache coherence:** external process appends → first process's next write tail-catches-up, no 64MB reload, cache guard trips on delta growth. (Risk #8.)
5. **Compaction:** trigger by ops/bytes/time → new snapshot+epoch, old delta ignored, no torn state, retention prunes to N. (Risk #6, #7.)
6. **Migration round-trip:** legacy 64MB → v2 → downgrade compactor → legacy; assert query outputs identical at each hop and `graph-state.json` never deleted. (Migration zero-data-loss/reversible.)
7. **Flag default:** `OMK_MEMORY_DURABILITY` unset → exercises only the legacy path; regression suite (`local-graph-memory`, `graph-link-run`, `orchestration-state-machine`) stays green.
8. **Micro-bench:** TEMP 5k–10k-node state in `os.tmpdir()` (never the live file) → assert delta-write p50 < a small constant and ≥100× below the full-rewrite baseline.

### Quality gates (when implemented)
`npm run lint` · `npx tsc --noEmit` · `node --test test/local-graph-memory.test.mjs test/graph-link-run.test.mjs` · new `test/mem-durability-golden.test.mjs` · `npm run secret:scan`. No `any`; no mutator-logic edits; live `.omk/memory/graph-state.json` untouched.

---

## Consequences

- **Positive:** dominant per-write cost removed; durability preserved and multi-process safety improved; format is debuggable JSONL aligned with existing run artifacts; rollback is a flag flip; mutators and query code untouched so semantics are provable.
- **Negative / cost:** new format + replay + compaction + cross-process lock code; cold reads add a (bounded) tail replay; one full serialize still paid per compaction (amortized). Net strongly favorable given the 64MB-per-write baseline.
