# Feature Specification: Reasoning-Effort Router v2 (Accurate + Learning + AdaptOrch-Bridge)

**Feature Branch**: `004-reasoning-router-v2`
**Created**: 2026-07-03
**Status**: Draft (planning complete; implementation not started)
**Predecessor**: `specs/003-reasoning-effort-router/` (v1 shipped — local, static, deterministic)
**Input**: Make the per-task reasoning-effort router substantially more accurate via multi-signal classification, add offline learning from sanitized feedback, and define an external AdaptOrch override bridge — all while keeping the pure core deterministic and the local-only MVP guarantee intact.
**OMK Preset**: `omk`

## Source evidence (read these alongside this spec)

- `.omk/goals/004-reasoning-router-v2-plan/laneA-accuracy.md` — classifier accuracy design (gaps 1–7)
- `.omk/goals/004-reasoning-router-v2-plan/laneB-learning.md` — feedback collection + sanitized ledger + weight compilation
- `.omk/goals/004-reasoning-router-v2-plan/laneC-adaptorch.md` — external override bridge, TTL cache, fallback contract
- `.omk/goals/004-reasoning-router-v2-plan/laneD-evaluation.md` — gold set, metrics, A/B, regression suite, calibration loop

## Non-goals (explicit)

- v2 does NOT remove v1. v1 stays as the frozen fallback and the `v1-compat` weight preset reproduces v1 output bit-for-bit (regression oracle).
- v2 does NOT ship online learning enabled by default. Feedback collection is opt-in; weight compilation is manual.
- v2 does NOT depend on external AdaptOrch. The bridge is an optional overlay; absent/unreachable AdaptOrch falls back to local v2.
- v2 does NOT send raw prompt text, file paths, or secrets anywhere (learning ledger, telemetry, or AdaptOrch payload).

## Requirements

### Requirement 1 — Multi-signal weighted classifier (Priority: P1)

**Agent**: coder
**Skills**: omk-typescript-strict, omk-code-review
**Evidence Gate**: command-pass
**Risk**: high

**What**: Replace v1's first-match keyword precedence with a deterministic weighted multi-signal scorer, while keeping the pure functions side-effect-free and injectable.

**Acceptance**:
1. A pure `classifyTaskV2(input, weights)` where `weights: RouterWeights` is an explicit parameter (DI). Same `(input, weights)` ⇒ same output. No clock/random/I/O inside.
2. Signals fused per class `c`: `S(c) = Σ_j W[c][j] · x_j` over a documented feature vector (keyword-strong count, keyword-weak count, code-fence, diff-hunk, log2-length-bucket, multi-turn prior, context-pressure bucket, optional LLM-judge vote). Integer arithmetic only.
3. "fix the typo" classifies as `simple-edit` (not `debug`) — the v1 regression case is fixed. Verified by gold-set entry.
4. `DEFAULT_WEIGHTS` reproduces v1 output bit-for-bit on the v1 test corpus (the `v1-compat` oracle).
5. Margin gate: `margin = S(top1) − S(top2)`; low-margin triggers optional tier-2 LLM judge (default OFF) or AdaptOrch consultation (Req 4). Judge vote is injected as a feature, keeping the pure core deterministic.
6. Multi-turn context via an N=8 ring buffer with exponential decay + hysteresis (`margin < τ_sticky` keeps previous class); STRONG keyword signals bypass stickiness.
7. Context-pressure signal reuses existing `estimateProjectedContextTokens` (agent-session.ts ~L2068 per lane A); `pressure ≥ 0.75` de-escalates one ladder step, `≥ 0.90` two steps.

### Requirement 2 — Sanitized feedback ledger + offline weight compilation (Priority: P2)

**Agent**: coder
**Skills**: omk-typescript-strict, omk-security-review
**Evidence Gate**: command-pass
**Risk**: high (privacy)

**What**: Collect sanitized feedback tuples from auto turns; compile them offline into versioned `RouterWeights` snapshots. The pure core never learns — learning produces weights that are injected.

**Acceptance**:
1. Four feedback signals captured (each with documented trigger + sanitized schema):
   - S1 explicit `/think` override after an auto turn (ladder-delta EMA α=0.30)
   - S2 acceptance / no-override (weak decay α=0.02, no level move)
   - S3 hook outcome — `typecheck-after-edit` / `stop-verify` fail ⇒ effort-up bias (α=0.10, cap +1)
   - S4 regression — follow-up debug turn after an auto turn (α=0.20, effort-up)
2. Ledger stored at `~/.omk/agent/router-feedback/` (mode 0600). Stored fields are EXHAUSTIVELY enumerated and contain NO prompt text, NO prompt hash, NO file paths, NO hook output, NO credentials: `{taskClass, laneType, predictedLevel, actualLevel, signal, outcome, lenBucket, hadFence, hadDiff}` only.
3. Learning influence is a bounded integer bias `[-2, +2]` ladder steps applied on top of the static rule table; the existing clamp guarantees no unsupported/off level is ever produced.
4. Compilation is a separate deterministic CLI step that folds the ledger into a versioned `RouterWeights` snapshot. Sessions load+pin weights once at startup; no hot-swap mid-session.
5. Cold start: empty ledger ⇒ `DEFAULT_WEIGHTS` (v1-identical). Per-class strong-signal gate `n ≥ 5` before any bias is applied.
6. `protect-secrets` hook gates every ledger write. Collection is opt-in via a settings flag; default OFF.

### Requirement 3 — Evaluation harness + gold set (Priority: P1)

**Agent**: tester
**Skills**: omk-typescript-strict
**Evidence Gate**: command-pass
**Risk**: low

**What**: Establish whether v2 is more accurate than v1, with a reproducible benchmark, before any non-default weights ship.

**Acceptance**:
1. Gold set: ≥210 synthetic, dual-labeled entries (30/class × 7 classes), stored as a typed fixture with `GOLD_SET_VERSION`; 20% frozen holdout; synthetic-only prompts (never real user text).
2. Metrics: micro/macro top-1, per-class P/R/F1, confusion matrix, ladder-distance error, and cost-weighted accuracy (CWA) with asymmetric cost (linear over-effort, quadratic 2× under-effort).
3. Ship gate (all must hold): micro top-1 ≥ 85%, `CWA(v2) > CWA(v1)`, no class F1 < 0.60, ≤2% regression vs v1 on shared corpus.
4. New regression suite `packages/coding-agent/test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts` (table-driven, clones the existing `domain-routing-benchmark.test.ts` structure). v1 test file (`003-*`) stays frozen as the v1 contract.
5. Pure-module eval closes the xhigh/max faux-harness gap (calls the pure functions directly with explicit `availableLevels` arrays).
6. McNemar's exact test for the paired v1-vs-v2 ship decision.

### Requirement 4 — External AdaptOrch override bridge (Priority: P3)

**Agent**: coder
**Skills**: omk-typescript-strict, omk-security-review
**Evidence Gate**: command-pass
**Risk**: medium (external dependency)

**What**: An optional overlay where external AdaptOrch returns an advisory hint that may adjust the local decision. Local-first invariant: the local classifier always runs; AdaptOrch only nudges.

**Acceptance**:
1. Wire type `AdaptOrchAdvisoryV1` (untrusted, `confidence` required) is validated by an anti-corruption bridge module into internal `RouterOverrideHint`. Read/local tools only (`adaptorch_route_topology`, `adaptorch_capabilities`); `adaptorch_run` (write) is forbidden in the router path.
2. Async last-known-hint + TTL cache (recommended over blocking or next-turn apply). Staleness bounded by TTL.
3. Fallback contract: triggers F1–F9 (no token, transport unwired, error, timeout, schema-validation fail, low confidence, TTL expired, budget exhausted, circuit breaker) ⇒ transparent fallback to local v2 (never an error to the user).
4. Per-session budget: ≤5 consultations, ≥60s apart, 1.5s timeout. Trigger heuristic: manual `/think` inactive AND budget remaining AND cache expired AND `margin < τ_consult` AND decision differs by ≥2 ladder steps (material turn).
5. Outbound payload `ConsultPayloadV1` contains ONLY closed-enum / bounded-numeric features (top-2 classes + scores, margin, lenBucket, fence/diff booleans, pressure bucket). Raw prompt, paths, and history are structurally excluded. `protect-secrets` hook gates the call.
6. Confidence fusion: `manual > (valid+fresh+confidence≥τ_override(0.7) ? clamp(boundedStep(hint, ±2)) : local)`. Existing `resolveThinkingLevel` clamp guarantees model-capability safety; ±2-step bound limits external-misroute blast radius.
7. API drift absorbed by the anti-corruption module + `schemaVersion` pin + capabilities probe; worst case degrades to "external hint lost" (silent fallback).

### Requirement 5 — Precedence invariant + docs (Priority: P1)

**Agent**: reviewer
**Skills**: omk-docs-release
**Evidence Gate**: file-exists
**Risk**: low

**What**: Preserve the v1 precedence invariant end-to-end and document v2.

**Acceptance**:
1. Precedence is exactly: `manual /think <level>` > valid AdaptOrch hint (if enabled) > v2 router > model default. Manual mode never invokes router or AdaptOrch.
2. `packages/coding-agent/docs/usage.md` updated for weighted classification, opt-in learning, and the optional AdaptOrch bridge.
3. Changelog entry under `## [Unreleased]` / `### Added` in `packages/coding-agent/CHANGELOG.md`.

## Expected Files (implementation phase — NOT this planning goal)

- `packages/coding-agent/src/core/reasoning-router-v2.ts` (pure weighted classifier + weights types)
- `packages/coding-agent/src/core/reasoning-router-weights.ts` (`DEFAULT_WEIGHTS` = v1 oracle, compiled snapshots loader)
- `packages/coding-agent/src/core/router-feedback-collector.ts` (impure session layer; sanitized ledger)
- `packages/coding-agent/src/core/adaptorch-bridge.ts` (anti-corruption + TTL cache + fallback)
- `packages/coding-agent/test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts`
- `packages/coding-agent/test/fixtures/reasoning-router-gold-set.ts`
- `packages/coding-agent/docs/usage.md`, `packages/coding-agent/CHANGELOG.md`

## Verification Commands (implementation phase)

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts`
- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/003-reasoning-router.test.ts` (v1 oracle still green)
- `npm run check`

## Assumptions

- v1 (`reasoning-router.ts`) remains the fallback and ships unchanged unless v2 explicitly supersedes a function.
- The pure core stays deterministic; all impurity (history, pressure, telemetry, AdaptOrch) is injected or lives in a separate layer.
- `packages/ai` and `packages/agent` require no change (the resolved level still flows through the existing `reasoning` option and provider-side clamp).
- Online learning is OFF by default; the bridge is OFF by default. v2 default behavior matches v1 until the user opts in.
