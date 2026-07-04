# Implementation Plan: Reasoning-Effort Router v2

**Branch**: `004-reasoning-router-v2` | **Date**: 2026-07-03 | **Spec**: `spec.md`
**OMK Preset**: `omk` | **Status**: PLANNING COMPLETE — implementation not started; awaits user go.

## Summary

Upgrade the v1 router into a more accurate v2 via four cooperating layers: (1) a pure weighted multi-signal classifier with a v1-compat oracle, (2) a sanitized opt-in feedback ledger feeding offline weight compilation, (3) a reproducible gold-set benchmark with a ship gate, and (4) an optional external AdaptOrch override bridge with TTL cache + transparent fallback. Local-first and deterministic-core invariants from v1 are preserved.

## Cross-lane consistency resolutions (synthesis decisions)

These reconcile points where the four lane designs touched each other:

1. **Lane A ↔ Lane D tunable contract** — Lane A's weight/feature matrix is the input contract for Lane D's calibration sweep. The `RouterWeights` schema is frozen FIRST (Lane A owns it); Lane D tunes values, never structure.
2. **Lane A ↔ Lane B purity boundary** — Lane B's learning output is a `RouterWeights` snapshot injected into Lane A's pure `classifyTaskV2(input, weights)`. Learning never enters the pure function.
3. **Lane A ↔ Lane C margin reuse** — Lane C's AdaptOrch consultation trigger reuses Lane A's `margin = S(top1)−S(top2)` and the `τ_consult` threshold. Single source of truth for "uncertain turn".
4. **Lane B ↔ Lane D outcome signal** — Lane B's S3 (hook-fail) and S4 (regression) signals feed Lane D's online monitoring log format. Same `{taskClass, predictedLevel, outcome}` schema, different sinks (ledger vs telemetry).
5. **v1 oracle is sacrosanct** — `DEFAULT_WEIGHTS` must reproduce v1 bit-for-bit. Every lane's design references this as the regression floor.

## Architecture (layered)

```
┌─ Session layer (impure) ──────────────────────────────────────┐
│  prompt() → gather signals (history, pressure, laneType)      │
│           → [AdaptOrch bridge: optional TTL-cached hint]      │
│           → call pure core with (input, weights, hint)        │
│           → apply resolved level to turn (no settings write)  │
│           → FeedbackCollector writes sanitized ledger (opt-in) │
└───────────────────────────────────────────────────────────────┘
          │ (explicit params only)
          ▼
┌─ Pure core (deterministic, testable) ────────────────────────┐
│  classifyTaskV2(input, weights) → TaskClass  (weighted score) │
│  resolveThinkingLevel(class, availableLevels, bias, hint)     │
│                                  → ThinkingLevel  (clamped)   │
└───────────────────────────────────────────────────────────────┘
          ▲ (loaded+pinned at startup)
┌─ Weights ────────────────────────────────────────────────────┐
│  DEFAULT_WEIGHTS (v1 oracle) | compiled snapshots (offline)   │
└───────────────────────────────────────────────────────────────┘
```

## Lane Grants (implementation-wave DAG — NOT yet dispatched)

Evidence root: `.omk/goals/004-reasoning-router-v2-plan/`. Write scopes are disjoint. Edges: I1 freezes types; I2/I3/I5 parallel after I1; I4 after I2 (needs weights schema); I6 after all; I7 gates merge.

| Lane | Role | Authority | Write Scope | Skills | MCP | Acceptance | Evidence |
|------|------|-----------|-------------|--------|-----|------------|----------|
| I1 types-freeze | omk-planner | write-scoped (types only) | `reasoning-router-v2.ts` type exports + `reasoning-router-weights.ts` (`RouterWeights`, `DEFAULT_WEIGHTS` v1-oracle, feature vector) | programming, omk-typescript-strict | filesystem | types compile; `DEFAULT_WEIGHTS` reproduces v1 on 003 corpus | `laneI1-types.md` |
| I2 classifier | omk-coder | write-scoped | `reasoning-router-v2.ts` `classifyTaskV2` impl (scorer, margin, ring-buffer history, pressure bucket, hysteresis) | programming, omk-typescript-strict, ast-grep | filesystem, serena | Req 1 acceptance; "fix the typo"→simple-edit; v1-oracle green | `laneI2-classifier.md` |
| I3 resolver+session | omk-coder | write-scoped | `resolveThinkingLevelV2` + agent-session.ts wiring (history/pressure injection, no settings write) | programming, omk-typescript-strict | filesystem | Req 1.6/1.7; manual precedence intact; packages/ai+agent diff=0 | `laneI3-resolver.md` |
| I4 feedback+learning | omk-coder | write-scoped | `router-feedback-collector.ts` + offline compile CLI + ledger format | programming, omk-security-review | filesystem | Req 2; sanitized fields only; protect-secrets gates writes; opt-in default OFF | `laneI4-learning.md` |
| I5 eval-harness | omk-tester | write-scoped (tests+fixtures) | `004-reasoning-router-v2-accuracy.test.ts` + gold-set fixture | programming, debugging | filesystem | Req 3; ship gate table runnable; pure-module xhigh/max coverage | `laneI5-eval.md` |
| I6 adaptorch-bridge | omk-coder | write-scoped | `adaptorch-bridge.ts` (anti-corruption, TTL cache, F1–F9 fallback, budget) | programming, omk-security-review | filesystem, github(read) | Req 4; fallback transparent; write tool forbidden; payload minimal | `laneI6-bridge.md` |
| I7 reviewer | omk-reviewer | review-only | none (docs fixups delegated back to owning lane) | review-work, omk-docs-release | filesystem-readonly, github | Req 5 precedence end-to-end; `npm run check` EXIT=0; v1+gold tests green; merge verdict | `laneI7-reviewer.md` |

Relevant always-on hooks per lane (evidence-wise): `typecheck-after-edit` + `eslint-after-edit` for I1–I6; `protect-secrets` for I4/I6 (ledger + outbound payload); `pre-shell-guard` for all; `stop-verify` + `subagent-stop-audit` for I7.

## Phasing recommendation

- **Phase A (accuracy, no learning/bridge)**: I1 → I2 → I3 → I5 (partial: gold-set accuracy only). Delivers the core user ask "more accurate algorithm" with v1 fallback. Safe to ship.
- **Phase B (opt-in learning)**: I4 + I5 (calibration loop). OFF by default.
- **Phase C (external bridge)**: I6. OFF by default; only if user wants AdaptOrch integration.

Each phase is independently shippable and independently revertible.

## Complexity check

| Concern | Decision | Rationale |
|---------|----------|-----------|
| New runtime deps | none | Pure TS; integer arithmetic; existing harness. |
| Breaking changes | no | v1 stays; DEFAULT_WEIGHTS = v1 oracle; manual mode default unchanged. |
| Non-determinism | contained | Pure core stays deterministic; impurity is injected param or separate layer. |
| Privacy surface | ledger + outbound payload | Both sanitized to closed enums; protect-secrets gates; opt-in. |
| External dependency | AdaptOrch bridge isolated | Anti-corruption module + fallback contract; OFF by default. |

## Quality gates

- v1 oracle: `003-reasoning-router.test.ts` stays green (24/24).
- v2 accuracy: `004-reasoning-router-v2-accuracy.test.ts` meets ship gate (Req 3.3).
- Repo: `npm run check` EXIT=0.
- Build: `npm run build` only on explicit user request for runtime application.
