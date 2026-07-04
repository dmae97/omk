# Tasks: Reasoning-Effort Router v2

**Status legend**: `[ ]` not started | `[~]` in progress | `[x]` done
**Phase**: PLANNING COMPLETE. Implementation awaits explicit user go (Phase A → B → C per plan.md).

## Phase A — Accuracy (core ask, no learning/bridge)

### T001 — Freeze v2 types + DEFAULT_WEIGHTS (v1 oracle)
- [ ] **Owner**: I1 omk-planner | **Deps**: none | **Phase**: A
- **Files**: `packages/coding-agent/src/core/reasoning-router-v2.ts` (type exports), `packages/coding-agent/src/core/reasoning-router-weights.ts`
- **Do**: Define `RouterWeights` schema (feature vector + per-class weight matrix + thresholds `τ_sticky`, `τ_consult`, `margin` gate). Define `DEFAULT_WEIGHTS` that reproduces v1 `classifyTask` output bit-for-bit.
- **Verify**: types compile; `classifyTaskV2(input, DEFAULT_WEIGHTS) === classifyTask(input)` for the entire `003-reasoning-router.test.ts` input table.
- **Gate**: command-pass | **Risk**: medium (oracle fidelity is the regression floor)

### T002 — Implement weighted multi-signal classifier
- [ ] **Owner**: I2 omk-coder | **Deps**: T001 | **Phase**: A
- **Files**: `packages/coding-agent/src/core/reasoning-router-v2.ts` (`classifyTaskV2` body)
- **Do**: Integer scorer `S(c) = Σ_j W[c][j]·x_j`; features per lane A §2 (strong/weak keyword counts, code-fence, diff-hunk, log2-len-bucket, multi-turn prior, pressure bucket, optional judge vote). Margin gate. Ring-buffer N=8 + exp decay + hysteresis. STRONG keywords bypass stickiness.
- **Verify**: "fix the typo" → `simple-edit`; determinism (no Date/random/I/O); v1 oracle still holds.
- **Gate**: command-pass | **Risk**: high (algorithmic correctness)

### T003 — Resolver v2 + session wiring
- [ ] **Owner**: I3 omk-coder | **Deps**: T001 | **Phase**: A
- **Files**: `packages/coding-agent/src/core/reasoning-router-v2.ts` (`resolveThinkingLevelV2`), `packages/coding-agent/src/core/agent-session.ts`
- **Do**: `resolveThinkingLevelV2` applies bounded bias `[-2,+2]` + pressure de-escalation + AdaptOrch hint (no-op stub for Phase A) + existing clamp. Wire into `prompt()` at the v1 insertion point (verify current line — explorer noted drift ~L1361→L1373). Inject history + pressure as explicit params; never write settings.
- **Verify**: manual `/think` precedence intact; `packages/ai` + `packages/agent` diff=0; reasoning-false models bypass.
- **Gate**: command-pass | **Risk**: medium

### T004 — Gold set + accuracy regression suite (Phase A portion)
- [ ] **Owner**: I5 omk-tester | **Deps**: T002, T003 | **Phase**: A
- **Files**: `packages/coding-agent/test/fixtures/reasoning-router-gold-set.ts`, `packages/coding-agent/test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts`
- **Do**: ≥210 synthetic dual-labeled entries (30/class), 20% holdout. Metrics: micro/macro top-1, per-class P/R/F1, confusion, ladder-distance, CWA. Ship gate per spec Req 3.3. Pure-module xhigh/max coverage.
- **Verify**: ship gate runnable; v1 test (`003-*`) still 24/24.
- **Gate**: command-pass | **Risk**: low

## Phase B — Opt-in Learning (default OFF)

### T005 — Sanitized feedback collector + ledger
- [ ] **Owner**: I4 omk-coder | **Deps**: T001 (weights schema) | **Phase**: B
- **Files**: `packages/coding-agent/src/core/router-feedback-collector.ts`
- **Do**: Signals S1–S4 per lane B. Ledger at `~/.omk/agent/router-feedback/` 0600. Stored fields EXHAUSTIVE: `{taskClass, laneType, predictedLevel, actualLevel, signal, outcome, lenBucket, hadFence, hadDiff}` — no prompt text/hash/paths/secrets. protect-secrets gates writes. Opt-in flag, default OFF.
- **Verify**: grep confirms no prompt text in ledger; cold-start ⇒ DEFAULT_WEIGHTS; `n≥5` gate before bias.
- **Gate**: command-pass | **Risk**: high (privacy)

### T006 — Offline weight compile CLI
- [ ] **Owner**: I4 omk-coder | **Deps**: T005 | **Phase**: B
- **Files**: compile step (CLI or script) producing versioned `RouterWeights` snapshots
- **Do**: Deterministic fold of ledger into versioned snapshot. Sessions load+pin once at startup; no hot-swap. Bounded integer bias `[-2,+2]`.
- **Verify**: same ledger ⇒ same snapshot (deterministic compile); compiled weights pass T004 ship gate.
- **Gate**: command-pass | **Risk**: medium

## Phase C — External AdaptOrch Bridge (default OFF)

### T007 — Anti-corruption bridge + TTL cache + fallback
- [ ] **Owner**: I6 omk-coder | **Deps**: T001, T002 (margin) | **Phase**: C
- **Files**: `packages/coding-agent/src/core/adaptorch-bridge.ts`
- **Do**: `AdaptOrchAdvisoryV1` (untrusted) → validate → `RouterOverrideHint`. Read/local tools only; `adaptorch_run` forbidden. TTL cache. Fallback F1–F9 ⇒ local v2. Budget ≤5/60s, 1.5s timeout. Trigger: manual inactive AND budget AND cache-expired AND `margin<τ_consult` AND ≥2-step material turn.
- **Verify**: each F1–F9 fallback returns local result with no user-visible error; write tool never invoked.
- **Gate**: command-pass | **Risk**: medium (external dep)

### T008 — Minimal consult payload + confidence fusion
- [ ] **Owner**: I6 omk-coder | **Deps**: T007 | **Phase**: C
- **Files**: `packages/coding-agent/src/core/adaptorch-bridge.ts`
- **Do**: `ConsultPayloadV1` closed-enum/bounded-numeric only. Fusion `manual > (valid+fresh+conf≥0.7 ? clamp(hint,±2) : local)`. protect-secrets gates outbound call.
- **Verify**: payload schema rejects raw prompt/paths; ±2 bound caps external misroute.
- **Gate**: command-pass | **Risk**: medium

## Cross-cutting

### T009 — Precedence invariant end-to-end review
- [ ] **Owner**: I7 omk-reviewer | **Deps**: all prior | **Phase**: A/B/C gate
- **Files**: none (review-only; docs fixups delegated back)
- **Do**: Verify `manual > AdaptOrch > v2 router > model default` across all phases. Confirm packages/ai+agent diff=0.
- **Verify**: trace each precedence path in code; `npm run check` EXIT=0; v1+gold tests green.
- **Gate**: review-merge | **Risk**: low

### T010 — Docs + changelog
- [ ] **Owner**: I7 omk-reviewer (or delegate to omk-coder) | **Deps**: T009 | **Phase**: ships with each phase
- **Files**: `packages/coding-agent/docs/usage.md`, `packages/coding-agent/CHANGELOG.md`
- **Do**: Document weighted classification (Phase A), opt-in learning (Phase B), AdaptOrch bridge (Phase C). Changelog `[Unreleased]/Added`.
- **Verify**: file-exists; matches implementation.
- **Gate**: file-exists | **Risk**: low

### T011 — Runtime build (only on user request)
- [ ] **Owner**: coordinator | **Deps**: T009 | **Phase**: on-request
- **Do**: `npm run build` + TUI restart, only if user wants the change live in dist/.
- **Verify**: interactive smoke (tmux) per AGENTS.md.
- **Gate**: smoke-pass | **Risk**: low
