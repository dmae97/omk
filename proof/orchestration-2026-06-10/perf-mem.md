# Lane PERF-MEM — Memory-Graph Store Perf (APPLY, behavior-preserving)

**Date:** 2026-06-10
**Mode:** APPLY · behavior-preserving · NO durability/format change · NO async-flush · NO JSONL · no commit · no web
**Recon source:** `proof/orchestration-2026-06-10/perf-recon-p2.md`

---

## Changed files

| File | Change |
|------|--------|
| `src/memory/local-graph-memory-store.ts` | Fix P2#2 (search O(N²)→O(N)) + Fix P2#1 (mutateState process-local cache) |
| `src/orchestration/state-persister.ts` | Fix P2#3 (`structuredClone` clone replaces JSON round-trip) |
| `test/perf-mem-store.test.mjs` *(new)* | identical-results, clone-parity, cache-hit, cache-invalidation, 5k micro-bench |

The live `.omk/memory/graph-state.json` was **not** touched (`git status --porcelain` empty). No edits to `src/providers/*`, `package.json`, CI, or crates. No `any` introduced. `git diff --stat`: store +125/-2, persister +4/-1.

---

## Fix-by-fix: before/after complexity

### P2#2 — `search()` (was `~:435`)
- **Before:** for each Memory node, `readFromState()` → `findMemoryNode()` (O(N) scan) + `findLatestMemoryVersionNode()` (O(N) node scan + O(E) edge scan). With M Memory nodes ⇒ **O(M·(N+E)) ≈ O(N²)**.
- **After:** `buildMemoryContentIndex(state)` does **one** pass building `memoryById: Map<id,node>`, `versionsByPath: Map<path,node[]>`, and `updateFromByMemoryId: Map<memoryId,Set<versionId>>` ⇒ **O(N+E)** build, then **O(1)** memoized resolve per path ⇒ **O(N+E) total**.
- **Identical results & ordering:** resolver reuses the exact same memory-by-id lookup (`memoryNodeId(path)`, first-occurrence = `Array.find`), the same UPDATES-edge filter, and the same descending `updatedAt → createdAt → id` tiebreak; pre-sort order preserved by insertion order. Proven equal to a brute-force reference of the original algorithm across 10 query/limit cases.

### P2#3 — `state-persister.ts save()` (was `~:65`)
- **Before:** `JSON.parse(JSON.stringify(state))` — full serialize **then** full parse just to deep-clone before redaction/re-serialize (2× serialization, 2× peak heap).
- **After:** `structuredClone(state)` (Node ≥17) — native deep clone, no parse round-trip. Final `redactSecrets(...)` + `JSON.stringify(toSave, null, 2)` unchanged.
- **Identical output:** `RunState` is JSON-plain (verified: only strings/numbers/booleans/arrays/nested objects — no `Date`/`Map`/`Set`/functions). Test asserts the persisted bytes are **byte-identical** to the old code path.

### P2#1 — `mutateState()` (was `~:839`) — SAFE SUBSET ONLY
- **Before:** every write did a full `loadState()` = `readFile` + `JSON.parse` of the whole (≈66MB) graph on **every** mutation ⇒ O(file_size) read+parse per write.
- **After:** process-local `graphStateCache: Map<path, {state, mtimeMs, size}>`. `loadStateForMutation()` reuses the cached parsed object **only** when `statSync(path)` reports the same `mtimeMs` **and** `size` as the cached snapshot; on a hit the disk read+parse is skipped entirely. After each successful `saveState`, `refreshGraphStateCache()` re-stats the just-written file and stores `{state, mtimeMs, size}`.
- **Format/durability unchanged:** same synchronous atomic `writeFileAtomic` (temp + rename), same on-disk JSON, same return values, same error behavior. Cache is populated **only** from a state we just persisted, so it never masks `loadState`'s ENOENT / empty / invalid / strict-mode handling.

#### Cache-invalidation rule (multi-writer correctness)
> A cache entry is honored **iff** `statSync(path).mtimeMs === cached.mtimeMs && statSync(path).size === cached.size`. Any difference (concurrent external writer), a missing entry, or an un-stat-able file ⇒ **invalidate** and fall back to a full `loadState()` (fresh disk re-read). After a successful write, the cache mtime/size is refreshed from the just-written file.

---

## Test + bench results

Command: `node --test test/perf-mem-store.test.mjs`
```
ok 1 - search() index matches brute-force O(N^2) reference (Fix P2#2)
ok 2 - state-persister structuredClone save output is byte-identical to JSON-clone (Fix P2#3)
ok 3 - mutateState cache: cache-hit writes equal cold reads (Fix P2#1)
ok 4 - mutateState cache: invalidates when external writer changes file size/mtime (Fix P2#1)
ok 5 - micro-bench: 5k-node TEMP state keeps search + N writes under threshold
# pass 5  # fail 0
[perf-mem bench] nodes=10000 search=89.0ms 50writes=2211.8ms (avg 44.2ms)
```
- Micro-bench builds a **TEMP** 5,000-memory state (10,000 nodes + 5,000 edges) in `os.tmpdir()` — never the real 66MB file. search < 5,000ms ✓, 50 sequential writes < 30,000ms ✓.

Regression: `node --test test/local-graph-memory.test.mjs test/graph-link-run.test.mjs test/orchestration-state-machine.test.mjs` ⇒ **30 pass / 0 fail**.

Typecheck: `npx tsc --noEmit 2>&1 | grep -E 'error TS'` ⇒ **no output** (0 errors, none in changed files).

---

## Residual risk
- **Memory footprint:** the cache retains one full parsed `LocalGraphState` per graph path between writes (≈66MB for the production file) instead of letting it GC after each mutation. Bounded to one entry per distinct graph path in-process; dropped if the file becomes un-stat-able.
- **Multi-writer:** correctness rests on `mtimeMs`+`size` detecting external writes. Theoretical blind spot = an external writer producing the exact same `size` **and** identical `mtimeMs` (filesystem mtime granularity). In practice graph mutations change `size`, so a size-preserving same-millisecond external edit is the only un-detected case; in-process writes remain serialized by `enqueueGraphWrite` per path. No durability/format/async-flush change, so the on-disk contract is unchanged.
- **structuredClone** assumes `RunState` stays JSON-plain; if a future field adds `Date`/`Map`/`Set`/class instances, clone semantics (not output) could diverge — covered by the byte-identical parity test as a guard.
