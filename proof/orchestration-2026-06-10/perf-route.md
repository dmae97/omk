# Perf Route P1 — Routing / Loop Hot-Path Micro-Fixes (APPLY)

**Date:** 2026-06-10
**Lane:** PERF-ROUTE
**Mode:** APPLY · behavior-preserving · no commit · no web
**Source recon:** `proof/orchestration-2026-06-10/perf-recon-p1.md` (P1#1, P1#2, P1#3)

---

## Changed files

| File | Change |
|------|--------|
| `src/orchestration/routing.ts` | P1#1 — module-level `Map<string, RegExp>` keyword-regex cache; `textMatchesKeyword` reuses compiled matcher; added `getKeywordMatcherRegExp` (test accessor) + exported `textMatchesKeyword`. |
| `src/runtime/runtime-router.ts` | P1#3 — precompute capability scores into `Map<AgentRuntime, number>` once per sort; comparators do O(1) lookups; exported `computeRuntimeCapabilityScore` + `sortRuntimesByCapabilityScore` (test). |
| `src/goal/control-loop.ts` | P1#2 — replaced five per-status `.filter()` passes with one `bucketRunStateNodesByStatus()` pass; exported helper + `RunStateNodeBuckets`. |
| `test/orchestration.test.mjs` | Focused regex-cache equivalence test. |
| `test/runtime-router.test.mjs` | Focused cached-sort vs recompute-reference ordering test. |
| `test/goal.test.mjs` | Focused single-pass bucket vs five-filter test. |

Diffstat: `6 files changed, 287 insertions(+), 17 deletions(-)`. No edits to `src/providers/*`, memory store, `package.json`, CI, or crates. No `any` introduced.

---

## Fix 1 — P1#1 `routing.ts` `textMatchesKeyword` (~:760)

- **Before:** `new RegExp((^|[^a-z0-9])${escaped}($|[^a-z0-9]))` compiled **on every call** — ~150 compiles per `selectTaskRouting`, once per DAG node.
- **After:** compiled RegExp memoized in module-level `keywordRegExpCache` keyed by the normalized keyword (escaped pattern is fully determined by the normalized key; no flags). First call per keyword compiles; all later calls reuse the same object.
- **Complexity:** per node `O(k × regex_compile)` → `O(k)` Map lookups; compiles bounded to **one per distinct keyword** for process lifetime.
- **Cache-growth guard:** keys come from a *fixed, bounded* route-candidate keyword set, so the Map cannot grow without bound; no eviction policy required (noted in-code).
- **Correctness:** the compiled RegExp has **no `/g` or `/y` flag**, so it is stateless across `.test()` calls (`lastIndex` stays 0) → sharing one instance is identical to recompiling.

## Fix 2 — P1#3 `runtime-router.ts` `computeRuntimeCapabilityScore` (~:691)

- **Before:** `compareRuntimeCandidates` (and `compareScoredRuntimes` tie-break) called `computeRuntimeCapabilityScore(a)` and `(b)` **inside `.sort()`** at 3 sites (`selectByIntent`, `select`, `execute`) → `O(r log r × c)` recomputations (`c` = `INTENT_CAPABILITY_WEIGHTS[intent]` width).
- **After:** `buildCapabilityScoreCache(runtimes, intent)` precomputes each candidate's score **once** into a `Map<AgentRuntime, number>` (keyed by object reference — id collisions cannot alias) before sorting; comparators read `capabilityScoreFromCache` (O(1)). In `select`, the cache is seeded directly from the already-computed `composite` values (zero extra compute).
- **Complexity:** `O(r log r × c)` → `O(r × c)` precompute **+** `O(r log r)` sort.

## Fix 3 — P1#2 `control-loop.ts` node classification (~:1144–1148)

- **Before:** 5 separate `runState?.nodes.filter(...)` passes per control-loop iteration (`failed`, `blocked`, `running`, `pending`, `done`→`success`).
- **After:** one `bucketRunStateNodesByStatus(runState)` pass appends each node into its status bucket via `switch`; destructured back into the original `failedNodes/blockedNodes/runningNodes/pendingNodes/successNodes` names. Unknown statuses ignored (matches prior filters).
- **Complexity:** `5 × O(n)` → `1 × O(n)` per iteration.

---

## Ordering / output preservation proof

- **Regex (Fix 1):** match path unchanged — `length < 2` → `false`; `^[a-z0-9]+$` → cached regex `.test(text)`; else `text.includes(normalized)`. Test compares `textMatchesKeyword` against a fresh-recompile reference over 8 texts × 7 keywords → identical; repeated calls stable (no `lastIndex` drift); `getKeywordMatcherRegExp("deploy") === getKeywordMatcherRegExp("Deploy")` proves cache hit returns the same instance.
- **Sort (Fix 2):** comparator chain is unchanged — `capabilityDelta` (now cache lookup of the *same* `computeRuntimeCapabilityScore`) → `priorityDelta` → `id.localeCompare` (total order). Test sorts via `sortRuntimesByCapabilityScore` and asserts `deepEqual` to the exact pre-change recompute-in-comparator reference across 9 intents × 3 input permutations, and that order is permutation-independent (stable tie-break).
- **Buckets (Fix 3):** single pass appends in iteration order, so each bucket equals the corresponding `.filter()` output element-for-element. Test asserts `deepEqual` of every bucket to its pre-change filter, exact id order (`failed=[n0,n6]`, `success=[n4,n7]`, `blocked=[n1,n9]`), and `undefined` runState → five empty buckets (matches `?? []`).

---

## Test results

| Command | Result |
|---------|--------|
| `node --test test/runtime-router.test.mjs` | **pass 20 / fail 0** (incl. new cached-sort test) |
| `node --test --test-name-pattern "keyword regex cache" test/orchestration.test.mjs` | **pass 1 / fail 0** |
| `node --test --test-name-pattern "bucketRunStateNodesByStatus" test/goal.test.mjs` | **pass 1 / fail 0** |
| `npx tsc --noEmit \| grep 'error TS'` | **0 errors** (0 total, 0 in changed files) |
| `npx tsc` (emit dist, used by tests) | clean build |

**Remaining risk:** none functional — all three changes are behavior-preserving and unit-verified against pre-change references. Heavy full-suite runs of `orchestration.test.mjs` / `goal.test.mjs` (CLI-spawning) were scoped to the new tests by name pattern; their unchanged tests were not re-run in this lane.
