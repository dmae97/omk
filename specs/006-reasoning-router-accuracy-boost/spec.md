# Feature Specification: Reasoning-Router Accuracy Boost (v3 Plan)

**Feature**: `006-reasoning-router-accuracy-boost`  
**Status**: Planning complete; implementation not started.  
**Predecessor**: v2 core + `/think auto-v2` activation completed.  
**Goal**: Make the OMK per-task reasoning-effort router more accurate than v2 without changing v1/v2 semantics by adding a future opt-in `auto-v3` router, stronger evaluation, default-off learning, and optional AdaptOrch advisory.

## Non-goals

- Do not change `/think auto` (v1) or `/think auto-v2` behavior.
- Do not mutate `V1_COMPAT_WEIGHTS` or current `DEFAULT_WEIGHTS`.
- Do not enable learning or external AdaptOrch by default.
- Do not store or transmit raw prompt text, hashes, paths, hook output, tool output, provider payloads, or secrets.

## Requirement 1 — Contextual v3 classifier

Create a pure deterministic `classifyTaskV3(input, weights)` and versioned `V3_DEFAULT_WEIGHTS`.

Acceptance:
- Extract bounded contextual features: leading intent, localized edit object, diagnostic failure evidence, review scope, plan-brief markers, refactor expansion.
- Use bounded comparable weights instead of v2's giant precedence diagonal for production v3 scoring.
- Preserve pure-core invariants: no clock, random, I/O, model calls, network, or settings writes.
- Keep v1/v2 router functions available and unchanged.
- Fix the current v2 miss clusters: simple-edit vs debug/code-gen, review-vs-debug, plan-vs-review, long plan brief with incidental debug words.
- Focused sentinels pass, including: `correct spelling`→simple-edit, `fix punctuation in error message`→simple-edit, `add error handling`→code-gen, `review diff for regressions`→review, `design audit log architecture`→plan, long migration brief→plan.

## Requirement 2 — Evaluation and calibration

Strengthen the benchmark so v3 cannot pass by overfitting visible rows.

Acceptance:
- Split gold set into `train`, `dev`, and locked `holdout` while preserving existing IDs.
- Add category and feature tags: clear-match, borderline, adversarial, fallback.
- PR/dev hard gates: `CWA(candidate) > CWA(v2)`, micro ≥0.95 for v3 target or explicit calibrated threshold, macro F1 ≥0.85, min class F1 ≥0.70, severe-under ≤0.02, class-flip ≤0.02.
- Release/holdout gate: aggregate-only output; holdout not worse than dev by >0.05 micro or >0.003 CWA.
- Generate machine JSON + markdown golden diff artifacts for every candidate.
- McNemar exact test is reported; significance claims require `b+c >= 20` and `p <= 0.05`.

## Requirement 3 — Privacy-preserving learning (default OFF)

Plan learning as sanitized, offline, bounded bias only.

Acceptance:
- Ledger is default-off; `/think auto-v2` or future `/think auto-v3` does not imply learning consent.
- User-level opt-in only; no project-local setting that can be committed.
- Ledger directory mode `0700`; files `0600`; symlinks/non-regular files refused.
- Record schema has exactly: `{taskClass,laneType,predictedLevel,actualLevel,signal,outcome,lenBucket,hadFence,hadDiff}`.
- Internal schema allowlist + secret/sensitive scan runs before append; fail closed.
- Offline compile is deterministic, canonical JSON, no network/model calls, sessions pin one snapshot at startup.
- Bias is bounded `[-2,+2]`; no nonzero bias until `nStrong >= 5`.

## Requirement 4 — Optional AdaptOrch advisory bridge (default OFF)

AdaptOrch may only nudge a completed local v3 decision.

Acceptance:
- Precedence: `manual /think <level> > valid fresh AdaptOrch hint > v3 local router > model default`.
- Bridge path uses read/advisory surfaces only; `adaptorch_run` and all write/execute tools are forbidden.
- Payload contains only closed enums, booleans, and bounded numbers: top classes/levels, margin bucket, len bucket, fence/diff, pressure, optional lane type.
- No prompt text/hash/history/path/model ID/session ID/tool output/hook output/secrets in payload.
- Session-memory TTL cache, budget ≤5/session, ≥60s interval, 1.5s timeout, circuit breaker after 3 failures.
- Every fallback path silently returns local v3, never a user-visible error.
- Hint can move level by at most ±2 and is clamped to model capabilities.

## Requirement 5 — Activation and precedence

v3 ships only as an explicit selection path.

Acceptance:
- Add future `/think auto-v3`, `/think auto v3`, `/think auto:v3` only after v3 gates pass.
- `/think auto` remains v1; `/think auto-v2` remains v2.
- Concrete `/think <level>` always returns to manual mode and bypasses local router, learning, and AdaptOrch.
- `packages/ai` and `packages/agent` remain unchanged.
