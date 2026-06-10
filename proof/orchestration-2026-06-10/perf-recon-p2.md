# Perf Recon P2 — SCAN/PARSE/IO + Memory/Graph Hot Paths

**Scope:** READ-ONLY reconnaissance. No edits made.  
**Date:** 2026-06-10  
**Files examined:** 8  
**Tools:** rg, cat, sed, jq

---

## RANKED Findings Table

| Rank | File:Line | Hot-Path Justification | Complexity | Behavior-Preserving Fix + Expected Gain | Risk |
|------|-----------|------------------------|------------|------------------------------------------|------|
| 1 | `src/memory/local-graph-memory-store.ts:839-843` (mutateState) + `:751` (loadState) + `:795` (saveState) | **Every** memory write (omk_memory_write, linkRun, append) does full read→parse→modify→stringify→atomic-write of `graph-state.json` (noted 66MB). The `enqueueGraphWrite` serializes but does NOT reduce I/O cost. | O(file_size) per write ≈ 132MB alloc per op (parse+stringify) | **Fix:** Add in-memory LRU cache with dirty-flag + async flush; or switch to append-only JSONL journal for nodes/edges with background compaction. Keep atomic JSON as checkpoint fallback. **Gain:** 100–1000× write-latency reduction. | SAFE-ISOLATED |
| 2 | `src/memory/local-graph-memory-store.ts:435-451` (search) + `:850-865` (readFromState / findLatestMemoryVersionNode) | `search()` iterates all Memory nodes, then for **each** node calls `readFromState()` → `findLatestMemoryVersionNode()`, which scans **all** nodes filtering by type+path, then scans **all** edges for UPDATES to build a Set, then filters+sorts nodes again. | O(N²) in node count (N memory nodes × N total nodes/edges scanned) | **Fix:** Maintain `Map<path, LocalGraphNode[]>` index for MemoryVersion nodes and `Map<memoryId, Set<versionId>>` for UPDATES edges. Rebuild index once on loadState. **Gain:** O(N²) → O(N log N) or O(N). | SAFE-ISOLATED |
| 3 | `src/orchestration/state-persister.ts:65` (save) | `save()` deep-clones the entire RunState via `JSON.parse(JSON.stringify(state))` before redaction and re-serialization. This doubles CPU work and peak heap for every run state update. | O(state_size) memory + CPU, 2× serialization cost | **Fix:** Replace with `structuredClone(state)` (native, no re-parse) or perform redaction in-place without a full clone. **Gain:** ~2× CPU and ~2× memory reduction on each save. | SAFE-ISOLATED |
| 4 | `src/memory/local-graph-memory-store.ts:463-530` (mindmap) + `:967-985` (expandNeighborhood) + `:987-1002` (buildMindmapTree) | `mindmap()` BFS scans `state.edges` **inside** the while-loop for every queued node. `buildMindmapTree()` runs `state.edges.filter()` + `state.nodes.find()` per recursive call. No adjacency index exists. | O(N × E) worst-case; for dense graphs each node touches all edges | **Fix:** Build adjacency lists `Map<id, Edge[]>` and `Map<id, Node>` once at load time; reuse in expandNeighborhood and tree build. **Gain:** O(N×E) → O(N + E). | SAFE-ISOLATED |
| 5 | `src/util/secret-mask.ts:5-70` (maskSensitiveText) | 16 chained `.replace()` calls with distinct regexes; each does a full string scan. Called on diagnostics, logs, CLI output. Regexes are compiled at module load (good), but 16 passes is wasteful. | O(K × T) where K=16, T=text length | **Fix:** Compose into a single-pass replacer using one composite regex with alternation + a dispatch table, or use a char-scan state machine. **Gain:** ~10× on large text blocks. | SAFE-ISOLATED |
| 6 | `src/mcp/secret-scanner.ts:286-326` (scanText) + `:456-476` (findInText) / `:340-350` (redactText) | `scanText()` runs `pattern.exec(text)` (correct), but then `redactText()` runs `result.replace(pattern.pattern, …)` — a **second** full-text scan per pattern. For P patterns this is 2×P passes. | O(P × T) per scan | **Fix:** Accumulate match ranges during the exec loop, then apply replacements in a single reverse-order pass. **Gain:** ~5–10× on large inputs. | SAFE-ISOLATED |
| 7 | `src/mcp/secret-scanner.ts:507-575` (scanDir) + `:577-608` (walkDir) | `scanDir()` builds a complete file list via `walkDir()` before processing, then sequentially reads + scans each file. No concurrency limit; large directories block. | O(files × avg_size × P) with serial I/O | **Fix:** Stream directory walk with a bounded concurrency pool (e.g., p-limit(8)) for read+scan. **Gain:** 3–5× on large directories. | SAFE-ISOLATED |
| 8 | `src/evidence/run-trace.ts:249-263` (generateReport) | Four deeply nested `.reduce()` traversals over `nodes → attempts` to compute token/EV metrics. Each metric re-walks the entire attempt set. | O(metrics × nodes × attempts) with high constant factor | **Fix:** Single-pass accumulation collecting all aggregates while iterating attempts once. **Gain:** ~3× on report generation for high-attempt runs. | SAFE-ISOLATED |

---

## Secret-Scanner Quadratic Check (P2.6)

- `src/mcp/secret-scanner.ts:860-895` — `getLineColumn()` uses binary search on precomputed `lineStarts` array: **O(log n)** per lookup. ✅ Already fixed.
- `computeLineStarts()` is O(T) once per scan: ✅ acceptable.
- No other O(n²) offset loops or repeated `.indexOf`/`.slice` in loops remain in secret-scanner.ts.

---

## Memory/Graph I/O Hot-Path Summary

- **66MB graph-state.json** is loaded via `readFile` + `JSON.parse` on **every** `mutateState` call (writes, appends, linkRun).
- `saveState` does `JSON.stringify(state, null, 2)` on the **entire** graph, then atomic-writes it.
- No incremental/delta write path exists. No in-memory cache beyond the transient `state` variable inside `mutateState`.
- `writeMirrorFiles` (inside `mutateState`) additionally iterates all nodes for each mirror file type, adding O(types × N) overhead.

---

## Files Scanned

1. `src/util/fs.ts` (re-export barrel)
2. `src/util/fs/internal.ts`
3. `src/util/fs/core.ts`
4. `src/mcp/omk-project-server.ts`
5. `src/mcp/secret-scanner.ts`
6. `src/memory/local-graph-memory-store.ts`
7. `src/memory/memory-store.ts`
8. `src/memory/memory-config.ts`
9. `src/orchestration/state-persister.ts`
10. `src/util/secret-mask.ts`
11. `src/evidence/run-trace.ts`
12. `src/evidence/attempt-record.ts`
13. `src/evidence/diagnosis.ts`
14. `src/evidence/evidence-trust-score.ts`

*(14 files inspected; 8 primary files reported in ranked table.)*

---

## Verification Commands (for later)

```bash
# Measure graph-state.json size
ls -lh .omk/memory/graph-state.json

# Count memory-write calls in a sample run (grep events.jsonl)
rg '"omk_memory_write"' .omk/runs/*/events.jsonl | wc -l

# Profile state-persister save latency (add console.time around JSON.parse(JSON.stringify)):
# → Expected baseline: ~50-200ms for typical run state; ~500ms-2s for large states.

# Profile local-graph-memory-store mutateState:
# → Expected baseline: 100-500ms per write with 66MB graph-state.json.
```
