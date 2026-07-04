# Tasks: Reasoning-Router Accuracy Boost (v3)

Status legend: `[ ]` not started | `[~]` in progress | `[x]` done.  
This is a planning artifact only; no implementation has started.

## Phase 0 — Benchmark foundation

### T001 — Split and tag gold set
- [ ] Owner: P1 omk-tester | Deps: none
- Files: `packages/coding-agent/test/fixtures/reasoning-router-gold-set.ts`
- Do: Add `split`, `category`, `featureTags`, `labelVersion` while preserving entry IDs.
- Verify: counts per class/split; holdout remains 6/class; no real user text.
- Gate: targeted fixture invariant test.

### T002 — Add v3 benchmark runner
- [ ] Owner: P1 omk-tester | Deps: T001
- Files: `packages/coding-agent/test/suite/regressions/006-reasoning-router-v3-feature-engineering.test.ts`
- Do: Compare v1, v2, and candidate v3 on dev split; emit benchmark JSON.
- Verify: dev hard gates enforced; holdout excluded unless locked mode.
- Gate: command-pass.

### T003 — Golden diff artifact generator
- [ ] Owner: P3 omk-tester | Deps: T002
- Files: `packages/coding-agent/scripts/reasoning-router/*` or test utility path chosen by implementer
- Do: Generate JSON + markdown diff against last accepted run.
- Verify: deterministic output; no raw holdout prompt logs in protected mode.
- Gate: artifact schema test.

## Phase 1 — v3 local algorithm

### T004 — Define v3 feature/weight types
- [ ] Owner: P2 omk-coder | Deps: T001
- Files: new `packages/coding-agent/src/core/reasoning-router-v3.ts` and/or v3 weights module
- Do: Add `RouterFeaturesV3`, `RouterWeightsV3`, bounded scorer, `V3_DEFAULT_WEIGHTS`.
- Verify: pure module; no Date/random/I/O; v1/v2 exports unchanged.
- Gate: `tsgo --noEmit`.

### T005 — Implement contextual feature extraction
- [ ] Owner: P2 omk-coder | Deps: T004
- Files: v3 core only
- Do: Implement leading intent, local edit cue, diagnostic evidence, review scope, plan brief, refactor cue, suppression rules.
- Verify: focused sentinels for each feature family pass.
- Gate: targeted v3 feature test.

### T006 — Calibrate v3 weights
- [ ] Owner: P3 omk-tester | Deps: T005
- Files: calibration script/tests only
- Do: Sweep bounded weights on train/dev; accept candidate by constrained objective.
- Verify: `CWA(v3)>CWA(v2)`, micro target, class flip cap, severe-under cap.
- Gate: benchmark JSON + golden diff.

### T007 — Holdout release check
- [ ] Owner: P1/P3 omk-tester | Deps: T006
- Files: holdout test or script
- Do: Run aggregate-only holdout gate in locked mode.
- Verify: holdout not worse than dev by configured deltas; no per-entry leakage.
- Gate: release-only command-pass.

## Phase 2 — Activation

### T008 — Add opt-in `/think auto-v3`
- [ ] Owner: P4 omk-coder | Deps: T006
- Files: `interactive-mode.ts`, `slash-commands.ts`, `agent-session.ts` only if enum expansion is required
- Do: Add `/think auto-v3`, `/think auto v3`, `/think auto:v3`; keep v1/v2/manual behavior unchanged.
- Verify: faux provider regression for v1/v2/v3/manual precedence.
- Gate: targeted test + `npm run check`.

### T009 — Docs/changelog for v3
- [ ] Owner: P7 omk-reviewer/docs | Deps: T008
- Files: `packages/coding-agent/docs/usage.md`, `packages/coding-agent/CHANGELOG.md`
- Do: Document v3, benchmark gate, and opt-in status.
- Verify: docs match implementation.
- Gate: review.

## Phase 3 — Default-off learning

### T010 — Sanitized feedback collector
- [ ] Owner: P5 omk-coder + omk-security | Deps: T004
- Files: `packages/coding-agent/src/core/router-feedback-collector.ts`, tests
- Do: Implement exact allowlist schema, internal sensitive scan, default-off opt-in, 0700/0600 storage, symlink refusal.
- Verify: default-off no files, schema exactness, sentinel leak tests, file-mode tests.
- Gate: security approval + targeted tests.

### T011 — Offline deterministic compile
- [ ] Owner: P5 omk-coder | Deps: T010
- Files: compile CLI/script + tests
- Do: Compile sanitized ledger into bounded bias snapshot; sessions load/pin once at startup.
- Verify: same ledger -> byte-identical snapshot; `nStrong>=5`; bias in `[-2,+2]`; empty ledger -> defaults.
- Gate: determinism test + router benchmark.

## Phase 4 — Default-off AdaptOrch advisory

### T012 — Bridge anti-corruption module
- [ ] Owner: P6 omk-coder + omk-security | Deps: T004
- Files: `packages/coding-agent/src/core/adaptorch-bridge.ts`, unit tests
- Do: Strict schemas, read/advisory tool allowlist, payload builder, inbound validator.
- Verify: rejects raw prompt/path/secret fields; forbids `adaptorch_run`.
- Gate: security tests.

### T013 — TTL/cache/budget/fallback integration
- [ ] Owner: P6 omk-coder | Deps: T012, T008
- Files: bridge + `agent-session.ts` auto-v3 path
- Do: Session-memory cache, budget, timeout, circuit breaker, async refresh, fallback F1-F9.
- Verify: manual precedence, valid hint fusion, low confidence fallback, budget/cache/circuit tests.
- Gate: targeted tests.

## Final gate

### T014 — End-to-end review
- [ ] Owner: P7 omk-reviewer | Deps: all shipping tasks in selected phase
- Files: none unless docs delegated
- Do: Trace `manual > AdaptOrch > v3 local > model default`, confirm v1/v2 unchanged, confirm `packages/ai`/`packages/agent` diff=0.
- Verify: targeted tests + `npm run check`.
- Gate: MERGE/BLOCK verdict.
