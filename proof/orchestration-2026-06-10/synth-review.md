# Wave-Synth Review — 3 Impl Lanes (READ-ONLY)

**Date:** 2026-06-10 · **Mode:** read-only, no edits, no web
**Skills:** omk-code-review, omk-security-review, omk-quality-gate, omk-evidence-contract
**Ignored (concurrent workers):** src/providers/*, src/providers/anthropic/, src/runtime/runtime-backed-task-runner.ts, CLAUDE.md, .claude/, test/anthropic-refusal-mitigation.test.mjs, test/provider-openrouter-fable-activation.test.mjs

---

## VERDICTS

| Lane | Scope | Verdict |
|------|-------|---------|
| A — memory durability | graph-delta-log.ts (new), local-graph-memory-store.ts, mem-durability-golden.test.mjs | **APPROVE-WITH-NITS** (legacy default provably safe; delta mode has MUST-FIX before GA) |
| B — native removal | package.json, .github/*, docs/adr, package-audit.mjs, doctor, proof.ts, proof-bundle.schema.ts | **APPROVE-WITH-NITS** (PRESERVE intact, build/CI green; incomplete schema/doc cleanup) |
| C — perf backlog | system24-renderer.ts, terminal-layout.ts, perf-backlog-identity.test.mjs | **APPROVE** (byte-identical, stateless regexes, real reference tests) |

---

## LANE A — Memory durability (APPROVE-WITH-NITS)

### PASS (verified)
- **#1 Legacy = byte-identical (CRITICAL, MET).** `git diff src/memory/local-graph-memory-store.ts` shows every new path gated behind `this.durability === "delta"`. The legacy bodies are verbatim-extracted into `loadStateLegacy()` (store.ts:867), the `else` branch of `mutateState` (store.ts:~1046 `mutator(...); saveState(state)`), the `else` branch of `loadStateForMutation` (store.ts:~1072), and the post-early-return tail of `refreshGraphStateCache` (store.ts:~1110). `resolveDurabilityMode` (graph-delta-log.ts:57) returns `"legacy"` for unset **or any value ≠ "delta"**. `create()` now forwards `env` (store.ts:338) but it is only consumed in the delta branch. Test 5 (golden test) asserts snapshot/delta/manifest files do **not** exist in legacy mode. **No legacy-mode behavior change.**
- **#2 CRC framing + del-before-put + insertion-ordered Map.** `computeRecordCrc` = sha256(`JSON.stringify(recordWithoutCrc)+"\n"`); `verifyRecordCrc` destructure-rest rebuild keeps stable key order (graph-delta-log.ts:84–98). `replayDeltas` applies all `del` then all `put` into insertion-ordered Maps, materialized via `[...map.values()]` (graph-delta-log.ts:250–290). CRC correct.

### MUST-FIX (delta mode only — default legacy unaffected)
- **MAJOR — torn-tail recovery is not idempotent across resumed writes.** `parseDeltaLog` discards a torn last line only on **read** (graph-delta-log.ts:~330) and `appendDelta` uses O_APPEND with **no truncation of the torn bytes** (graph-delta-log.ts:200–225). If a write resumes after a crash-torn tail (last line lacks trailing `\n`), the next record concatenates onto the torn fragment → a **mid-file** unparseable line on the next cold load: strict mode **throws** (`Delta log corruption`, graph-delta-log.ts:~300), non-strict mode `break`s and **silently drops every record after it (data loss)**. The crash-recovery tests (mem-durability-golden.test.mjs:~190–250) only read after injection — they never resume a write then reload, so this is untested. Fix: on recovery, physically truncate the log to the last good record offset (or guard appendDelta against a non-newline-terminated file).

### NITS
- **MEDIUM — "reproduces EXACT array order of the full-rewrite" is overstated.** `replaceGeneratedMindmap` does `state.nodes = state.nodes.filter(...)` then `upsertNode`→push (repositions regenerated concept nodes to the array end) on every 2nd+ write/append to a path. `computeDelta` emits no `del` for a re-added id, and `replayDeltas` `Map.set` **keeps the old position** for an existing key → replayed array order **diverges** from the in-memory full-rewrite. Functionally masked because all consumers sort (search by updatedAt, mindmap by sortRank/label, findLatestMemoryVersionNode by updatedAt), but the design "Replay correctness lemma … Proven via golden equality test" and report summary line 3 are not literally true.
- **MEDIUM — golden Test 1 does not assert raw array order.** It deepStrictEquals **sorted** search-by-path, mindmap as a **Set** of type:label, and graphQuery as **counts** — never raw `state.nodes`/`state.edges`. Deep-equality is used, but only on order-normalized projections, so it cannot prove the order claim (and would not catch the divergence above). No `structuredClone` is used; no read/write cache aliasing bug found (reads always reload from disk; writes mutate-then-recache the same ref).
- **LOW — 2 eslint warnings live in Lane A's NEW file** graph-delta-log.ts: `lockPath` unused (L48), `_crc` unused (L91). The native-removal report mis-attributes these as "sibling lane, not touched" — they are Lane A's.

---

## LANE B — Native(Rust) removal (APPROVE-WITH-NITS)

### PASS (verified)
- **#4 PRESERVE intact.** `git status` is clean for rust-forge-renderer.ts, web-bridge/native-host.ts, chat/native-root-loop.ts, test/no-kimi-native-turn.test.mjs (and all P1–P16). None deleted or modified.
- **#5 Zero importers + valid scripts/CI.** `rg native-safety src` → none; doctor consumers clean; `build:clean` (tsc) green per report ⇒ no dangling imports/types. package.json: no `native:`/`rust:` refs, `release:check|full|rc` + `verify:no-kimi` de-wired, **valid JSON**. All 3 workflows parse as valid YAML; the deleted `native` jobs are gone and **no orphan `needs:`** remains — `release.yml` package `needs:[quality,native]→[quality]`, `smoke-test.yml` package `needs: native` removed.
- **#6 ADR present, Accepted, from draft.** docs/adr/0001-no-native-rust-lane.md exists, `Status: Accepted`; promoted verbatim from proof/rust-lane-2026-06-10/adr-draft-no-native-lane.md (only title `000X (DRAFT)`→`0001` and `Status: PROPOSED`→`Accepted` changed).

### MUST-FIX
- **MEDIUM — contract drift: published JSON schema still lists the removed scenario.** `schemas/omk.proof-bundle.v1.schema.json:17` keeps `"native-safety"` in the `scenario` enum, although it was removed from src/contracts/proof.ts, src/schema/proof-bundle.schema.ts (zod), scripts/proof-check.mjs, and scripts/regression-proof-matrix.mjs. Manifest C3/C4 missed the JSON schema; `schema:check` has no cross-sync check so the drift passed silently. Published JSON contract now disagrees with the TS/zod contract.

### NITS
- **MEDIUM — stale/broken docs referencing deleted assets** (the ADR itself scoped "README/CHANGELOG native-lane claims", but they were not updated):
  - README.md:374–377 documents `npm run native:build`, `scripts/build-native.mjs`, `dist/native/<platform-arch>/omk-safety`, `src/util/native-safety.ts` — all deleted ⇒ broken instructions.
  - MAINTAINERS.md:11 instructs `npm run native:build` as a local release gate — script no longer exists.
- **LOW** — ROADMAP.md:82 lists the native-safety scenario; CHANGELOG.md (164,228,251,294,323,346) references native:build/native-safety (historical entries are defensible to keep as history).
- **LOW** — package.json has a stray blank line where the 5 scripts were removed (between `verify:no-kimi` and `no-kimi:default-surface`); valid JSON, cosmetic.

---

## LANE C — Perf backlog (APPROVE)

### PASS (verified)
- **#7 Byte-identical output (caching only).** renderPanelLine new path proven equal to old `padRight` (`len>=width?s:s+" ".repeat(width-len)`) for fit / overflow / `inner≤0` edge cases; terminal-layout `panel()` new inline pad equals `padEndVisible` (`value+" ".repeat(max(0,width-vw))`). The perf test compares **production** fns (renderPanelLineForTest/renderInlineForTest/panel) against **faithful pre-edit references** (refRenderPanelLine/refRenderInline/refPanel) over plain/ANSI/CJK/emoji/overflow/markdown inputs — not a self-comparison tautology.
- **Hoisted regexes are stateless.** RE_BOLD_STAR/UNDER/ITALIC/INLINE_CODE/LINK are `/g` but used **only** with `String.replace` (resets lastIndex); RE_HEADER/RE_LIST_ITEM are non-global with `.match`; RE_HR is non-global with `.test`. **No `/g` + `.test()`/`.exec()` lastIndex-reuse bug.**
- **#8 Clean.** No `any`, `@ts-ignore`, deleted tests, or silenced errors in any of the three lane files.

### NITS
- **LOW** — adds test-only exports `visibleLenForTest`, `renderPanelLineForTest`, `renderInlineForTest` (public-surface widening); trivial.

---

## Evidence checked
- `git status` + `git diff` for package.json, ci.yml, release.yml, smoke-test.yml, local-graph-memory-store.ts, system24-renderer.ts, terminal-layout.ts, contracts/proof.ts, proof-bundle.schema.ts, proof-check.mjs, regression-proof-matrix.mjs.
- Full read: graph-delta-log.ts, mem-durability-golden.test.mjs, perf-backlog-identity.test.mjs, store (loadState/mutateState/cache), ADR.
- `node -e JSON.parse(package.json)` → VALID; `js-yaml` load of 3 workflows → OK; `eslint graph-delta-log.ts` → 2 warnings; repo-wide `rg` for dangling refs; ADR-vs-draft diff; helper defs padRight/padEndVisible/visibleTerminalWidth.

## Evidence NOT checked
- Did **not execute** `node --test` suites or full `npm run build:clean`/`npm test` — relied on static analysis + impl reports + tsc-green inference for "tests pass"/"no broken imports".
- Did not line-by-line audit every C1–C10 consumer diff (covered by tsc-green + diff --stat).
- Concurrent-worker files excluded per instructions.

## Merge / release recommendation
- **Native removal (B) + perf (C) + memory in DEFAULT legacy mode (A):** SAFE to merge **after** fixing the Lane B JSON-schema drift (MUST-FIX) and the README/MAINTAINERS stale instructions.
- **Enabling `OMK_MEMORY_DURABILITY=delta` in production:** **BLOCK** until Lane A torn-tail truncation fix lands and the array-order claim is corrected or backed by a raw `state.nodes`/`state.edges` deep-equality test.

## MUST-FIX list
1. **Lane A (delta):** truncate delta log to last good record on recovery so a resumed write after a torn tail cannot corrupt/strict-throw/lose records (graph-delta-log.ts appendDelta/parseDeltaLog). Add a resume-after-torn reload test.
2. **Lane A (delta/test):** correct the "exact array order" claim OR add a test asserting raw `state.nodes`/`state.edges` deep-equality (legacy vs delta-replay).
3. **Lane B (contract):** remove `"native-safety"` from `schemas/omk.proof-bundle.v1.schema.json:17` to re-sync with zod/TS.
4. **Lane B (docs):** update README.md:374–377 and MAINTAINERS.md:11 (delete native:build / build-native.mjs / dist/native / native-safety.ts instructions) per the ADR's own removal scope.
5. **Lane A (lint):** resolve the 2 warnings in graph-delta-log.ts (lockPath L48, _crc L91).
