# Wave-P Performance Review — 2026-06-10

**Scope:** PERF-MEM, PERF-ROUTE, PERF-RENDER lanes only.  
**Skills applied:** `omk-code-review`, `omk-industrial-control-loop`, `omk-evidence-contract`.  
**Bar:** Behavior-preservation (byte/semantic identity of outputs, ordering, error paths).

---

## Summary Verdict

| Lane | Verdict |
|------|---------|
| PERF-MEM | **APPROVE-WITH-NITS** |
| PERF-ROUTE | **APPROVE** |
| PERF-RENDER | **APPROVE** |

No MUST-FIX defects. Two concrete NITs are documented below with remediation guidance.

---

## 1. PERF-MEM

### Files reviewed
- `src/memory/local-graph-memory-store.ts`
- `src/orchestration/state-persister.ts`
- `test/perf-mem-store.test.mjs`

### Evidence checked
- [x] `search()` O(N²)→O(N) index yields identical results vs brute-force reference (test asserts `deepEqual` for 10 query/limit combos).
- [x] `structuredClone` save output is byte-identical to `JSON.parse(JSON.stringify(...))` on the test fixture (secret redaction, nested arrays, null).
- [x] Cache-hit write path produces same on-disk state as cold read (sequential writes + external-injection invalidation test).
- [x] 5k-node micro-bench completes under CI thresholds.

### Findings

#### NIT-1 (src/memory/local-graph-memory-store.ts:503-516) — Cache blind spot: identical size+mtime external edit
**Severity: LOW–MEDIUM**

`loadStateForMutation` guards the cache with `mtimeMs + size`. If a concurrent external writer replaces the file with **exactly the same byte length** within the same millisecond (or the filesystem timestamp resolution window), the cache will not invalidate and the next mutation will overwrite the external change without observing it.

- **Why this is acceptable today:** The file is only ever written through `enqueueGraphWrite`, which serializes writes per process. Multi-process concurrency on the same graph file is already an unsupported/undefined edge-case in the existing codebase (no cross-process file locking).
- **Why it is not a MUST-FIX:** The old code had the exact same TOCTOU window (`loadState` → mutate → `saveState`). The cache does not widen the window; it only skips the JSON.parse on cache hits.
- **Remediation:** Add an inline comment or a small `// CAVEAT:` note above `loadStateForMutation` documenting that the guard is best-effort and that true multi-writer safety would require an atomic read-modify-write or file locking. No code change required.

#### NIT-2 (src/orchestration/state-persister.ts:65) — `structuredClone` is safe for current `RunState`, but not future-proof against non-JSON-plain fields
**Severity: LOW**

`structuredClone` preserves `Date`, `Map`, `Set`, `BigInt`, `undefined`, etc., whereas `JSON.parse(JSON.stringify(...))` strips or transforms them. The current `RunState` contract (`src/contracts/orchestration.ts`) is JSON-plain (strings, numbers, booleans, arrays, plain objects), so the two clone methods produce byte-identical output after `JSON.stringify(toSave, null, 2)`.

- **Risk:** If a future contributor adds a `Date` or `Map` field to `RunState`, `structuredClone` will silently preserve it through redaction, and `JSON.stringify` will serialize it differently (or drop it) compared to the old round-trip.
- **Remediation:** Add a static assertion or JSDoc constraint on `RunState` requiring it to remain JSON-serializable, or add a runtime JSON-round-trip assertion behind `NODE_ENV === "test"`. Alternatively, keep the `structuredClone` comment and extend it to mention the JSON-plain invariant. No immediate code change required.

---

## 2. PERF-ROUTE

### Files reviewed
- `src/orchestration/routing.ts`
- `src/runtime/runtime-router.ts`
- `src/goal/control-loop.ts`

### Evidence checked
- [x] Module-level `RegExp` cache uses flag-less patterns (`new RegExp(...)` with no flags); `/g` `lastIndex` bug impossible.
- [x] Cache keys are normalized keywords (`normalizeText`), which are deterministic and bounded; no unbounded growth or eviction required.
- [x] `compareRuntimeCandidates` + `compareScoredRuntimes` ordering is unchanged (composite → capability → priority → `localeCompare` tie-break).
- [x] JavaScript `Array.prototype.sort` is stable (ES2019+); decorate-sort-undecorate semantics are preserved because the comparator is deterministic and total.
- [x] `bucketRunStateNodesByStatus` appends in iteration order, matching the original five separate `.filter()` passes.

### Findings

No issues. The precomputed capability-score cache replaces O(r log r · c) re-computation with O(r log r + c). The `Map<AgentRuntime, number>` is keyed by object reference, so distinct objects with the same `id` cannot alias—matching the old per-call recompute semantics exactly.

---

## 3. PERF-RENDER

### Files reviewed
- `src/commands/cockpit/render.ts`
- `src/theme/layout.ts`
- `test/perf-render-identity.test.mjs`

### Evidence checked
- [x] `body.splice(h, 0, ...Array(padCount).fill(""))` is byte-identical to the old per-iteration loop for all tested cases (incl. 800-line body).
- [x] `box()` / `panel()` outputs are byte-identical to reference implementations for ANSI, CJK, emoji, empty, long-line, and mixed inputs.
- [x] `padEndAnsi` replacement matches the exact formula `str + " ".repeat(Math.max(0, len - stripAnsi(str).length))` confirmed in `src/theme/ansi.ts`.
- [x] No off-by-one in padding: `Math.max(0, innerWidth - w)` guarantees non-negative repeat count.

### Findings

No issues. The single-strip optimization is a pure mechanical refactoring: `stripAnsi` (which delegates to `sanitizeTerminalText`) is called once per line instead of twice. Because `visibleTerminalWidth` uses the same `sanitizeTerminalText` path, width calculations remain consistent.

---

## 4. Cross-cutting checks

| Check | Result |
|-------|--------|
| `any` introduced | None |
| Deleted / weakened tests | None |
| Scope creep beyond named files | None (only `src/memory`, `src/orchestration`, `src/runtime/runtime-router.ts`, `src/goal/control-loop.ts`, `src/commands/cockpit`, `src/theme/layout.ts`) |
| Type safety regressions | None |
| Export surface changes | Minor: `textMatchesKeyword`, `getKeywordMatcherRegExp`, `computeRuntimeCapabilityScore`, `sortRuntimesByCapabilityScore`, `bucketRunStateNodesByStatus` are newly exported for testability. No breaking changes. |

---

## Merge / Release Recommendation

**RECOMMEND MERGE** after addressing the two NITs (documentation-only).

- Run `node --test test/perf-mem-store.test.mjs test/perf-render-identity.test.mjs` on CI before merge.
- No security or behavior-change risk.
