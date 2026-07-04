# Implementation Plan: Reasoning Router Advanced Accuracy Harness

**Branch**: `008-reasoning-router-advanced-accuracy` | **Date**: 2026-07-03 | **Spec**: `specs/008-reasoning-router-advanced-accuracy/spec.md`  
**OMK Preset**: `omk`

## Summary

Goal 007 made `/think auto-v3` accurate on the visible non-holdout benchmark, but the next accuracy step should be **verification-first**, not immediate heuristic churn. The plan is to finish the unimplemented parts of the earlier accuracy-boost design: add train/dev/holdout governance, add confidence-bearing classifier outputs, add default-off privacy-preserving learning, and add a default-off Adaptorch advisory bridge that cannot block or leak prompt content. If the new holdout gate shows v3 already generalizes, skip recalibration. If it fails, tune or version a v4 classifier using the new gate.

## Runtime Inventory

- **Harness**: OMK Parallel Orchestrator; result artifact `.omk/goals/008-reasoning-router-advanced-accuracy-plan/result.json`
- **MCP Scope**: scoped per lane; use `filesystem`, `serena`, `understand-anything` advisory, `adaptorch` advisory only
- **Skills**: `adaptorch`, `ulw-plan`, `programming`, `ai-regression-testing`, `eval-harness`, `benchmark`, `security-review`, `agent-architecture-audit`, `review-work`, `docs-write-concisely`
- **Authority**: root coordinator synthesizes; future implementation must use single-writer lane grants
- **Graph note**: Understand-Anything graph is stale; direct file reads/tests override graph claims

## Key Design Decisions

| Decision | Plan |
|---|---|
| Accuracy strategy | Gate first, tune second. v3 cannot be declared generally accurate until dev/holdout governance exists. |
| Classifier evolution | Prefer `reasoning-router-v4.ts` + `reasoning-router-v4-weights.ts` if v3 has shipped in a release. If still unreleased, in-place v3 calibration is acceptable only after DG-B review. |
| Confidence output | Add `ClassifierVerdictV4` with `scores`, `margin`, `runnerUp`, `confidenceBand`, `fallbackReason`, `suppressedFeatureIds`, and audit flags. |
| Learning | Default off, user-global opt-in only, local JSONL allowlist, no raw prompt/path/diff/session/provider payload. |
| Adaptorch | Default off, advisory-only, no mutating run submission from router path, cached/fallback-only in synchronous turn path. |
| Manual precedence | `/think <level>` always wins and bypasses router, learning, and Adaptorch. |

## Algorithm Plan

### Proposed v4 pipeline

1. `extractFeaturesV4(input)`
   - leading intent
   - second-clause intent for compound prompts
   - local edit object
   - implementation object
   - diagnostic evidence
   - review scope
   - plan brief
   - refactor cue
   - code fence/diff marker
   - bounded negation window
   - language confidence bucket
   - history/pressure/judge slots
2. `applySuppressionV4(features)`
   - implementation object suppresses local-edit classification
   - leading review/plan/refactor suppresses generic diagnostic terms unless hard runtime evidence exists
   - negation nulls local keyword hits in a small look-back window
3. `scoreClassesV4(gated, weights)`
   - restore v2-style weight tables; no hardcoded magic numbers inside classifier
4. `buildVerdictV4(scores, features)`
   - task class plus confidence/margin/runner-up/audit metadata
5. `resolveThinkingLevelV4WithUncertainty(verdict, availableLevels, bias, hint)`
   - low confidence escalates or holds; never de-escalates below local class on text-only cues
   - context pressure may reduce only non-critical classes and only with explicit bounds
   - Adaptorch hints are bounded and cannot bypass manual mode

### Non-goals

- No new task classes.
- No dependency on NLP/tokenizer packages.
- No changes to `packages/ai` or `packages/agent`.
- No changes to frozen v1/v2 behavior.

## Agent Routing

| Phase | Primary Role | Secondary Roles | Evidence Gate |
|---|---|---|---|
| Evaluation governance | `omk-tester` | `omk-reviewer` | split invariant + benchmark command pass |
| Algorithm/verdict module | `omk-coder` | `omk-tester` | targeted test + `tsgo --noEmit` |
| Learning ledger | `omk-coder` | `omk-security` | privacy tests + security PASS |
| Adaptorch bridge | `omk-coder` | `omk-security` | bridge fallback tests + security PASS |
| Integration | `omk-coder` | `omk-tester` | precedence activation tests |
| Documentation | docs-scoped `omk-coder` | `omk-reviewer` | `git diff --check` |
| Final review | `omk-reviewer` | `omk-security` | targeted tests + `npm run check` |

## Project Structure

```text
packages/coding-agent/src/core/
├── reasoning-router-v4.ts              # future classifier/verdict module if versioned
├── reasoning-router-v4-weights.ts      # future calibratable weights if versioned
├── router-feedback-collector.ts        # future default-off local ledger collector
├── reasoning-router-bias.ts            # future offline bias snapshot reader/compiler runtime
├── adaptorch-bridge.ts                 # future advisory anti-corruption layer
└── agent-session.ts                    # sole future integration writer

packages/coding-agent/test/fixtures/
├── reasoning-router-gold-set.ts        # additive split/category/tag metadata
└── reasoning-router-adversarial-set.ts # optional deterministic adversarial fixtures

packages/coding-agent/test/suite/regressions/
├── 009-reasoning-router-evaluation-governance.test.ts
├── 010-reasoning-router-privacy-learning-ledger.test.ts
├── 011-reasoning-router-adaptorch-bridge.test.ts
└── 012-reasoning-router-learning-adaptorch-activation.test.ts

packages/coding-agent/scripts/reasoning-router/
├── golden-diff.ts
├── mcnemar.ts
├── calibrate-v3.ts or calibrate-v4.ts
└── compile-bias-snapshot.ts
```

## Complexity Check

| Concern | Decision | Rationale |
|---|---|---|
| New dependencies | none by default | Regex/bounded arithmetic is enough; dependency changes require separate approval. |
| Breaking changes | no | All new behavior opt-in/versioned; v1/v2/v3/manual semantics preserved. |
| Parallel tasks | 4 independent chains in Wave 1 | Evaluation, learning, Adaptorch bridge, and algorithm design can be isolated by file scope. |
| MCP/secret exposure | scoped | Adaptorch bridge payload allowlist excludes raw text, paths, IDs, hooks, tools, or provider payload. |
| Security gates | required before integration | Learning and Adaptorch affect reasoning effort; both need read-only security PASS. |

## Implementation DAG

### Wave 1: independent foundations

- **E1**: Add gold-set split/category/tag metadata.
- **E2**: Add benchmark runner, golden-diff, McNemar, aggregate-only holdout report.
- **L1**: Add default-off feedback collector and privacy tests.
- **L2**: Add deterministic offline bias compiler.
- **B1**: Add Adaptorch advisory bridge module and fallback tests.

### Wave 2: prove or tune

- **A1**: Re-run current v3 against new governance gates.
- **A2**: Conditional recalibration/versioning only if A1 fails.
- **S1**: Security review learning ledger.
- **S2**: Security review Adaptorch bridge.

### Wave 3: single writer integration

- **V1**: Sole writer for `agent-session.ts`, optional settings/interactive status wiring.
- **V2**: Activation/precedence tests: manual > Adaptorch hint > v3+learning bias > v3 local > model clamp.

### Wave 4: docs after behavior exists

- **D1**: Update usage/changelog only after Wave 3 passes.

### Wave 5: final review

- **R1**: Read-only final MERGE/BLOCK review.

## Quality Gates

- Targeted v1/v2/v3/v4/evaluation/learning/bridge regression family must pass.
- `npm run check` must pass cleanly with no fixes applied on final rerun.
- `git diff --stat -- packages/ai packages/agent` must be empty.
- Security gates S1/S2 must be PASS before Wave 3 integration.
- Holdout report must be aggregate-only.
- Learning and Adaptorch default-off status must be tested.

## Owner Decision Gates

| Gate | Question | Default |
|---|---|---|
| DG-A | Continue spec 006 or create a separate execution spec? | Create execution under spec 008 for clarity; keep spec 006 as historical plan. |
| DG-B | Tune v3 in place or version as v4? | If v3 released, version as v4. If unreleased, in-place is allowed after A1. |
| DG-C | Settings-only opt-in or new `/think` mutating subcommands? | Settings-only global opt-in plus read-only `/think` status display. |

## Recommended Execution Goal

Use a new implementation goal, e.g. `.omk/goals/009-reasoning-router-evaluation-governance/result.json`, after user approval. Goal 008 is planning-only and should remain product-code-free.
