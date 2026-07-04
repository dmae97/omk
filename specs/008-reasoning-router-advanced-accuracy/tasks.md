# Tasks: Reasoning Router Advanced Accuracy Harness

**Input**: `specs/008-reasoning-router-advanced-accuracy/{spec.md,plan.md}`  
**Prerequisites**: Goal 008 planning artifacts complete; user approval before implementation.  
**Output**: OMK DAG-ready task list.

## Phase 1: Evaluation Governance

- [ ] T001 [P] Add additive train/dev/holdout metadata to `packages/coding-agent/test/fixtures/reasoning-router-gold-set.ts`
  > role: qa
  > deps: none
  > files: [`packages/coding-agent/test/fixtures/reasoning-router-gold-set.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/009-reasoning-router-evaluation-governance.test.ts`
  > gate: command-pass
  > risk: high

- [ ] T002 Add governance benchmark, golden-diff, and McNemar scripts
  > role: qa
  > deps: T001
  > files: [`packages/coding-agent/test/suite/regressions/009-reasoning-router-evaluation-governance.test.ts`, `packages/coding-agent/scripts/reasoning-router/golden-diff.ts`, `packages/coding-agent/scripts/reasoning-router/mcnemar.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/009-reasoning-router-evaluation-governance.test.ts`
  > gate: command-pass
  > risk: high

## Phase 2: Source Modules Without Integration

- [ ] T003 [P] Implement default-off feedback collector
  > role: coder
  > deps: none
  > files: [`packages/coding-agent/src/core/router-feedback-collector.ts`, `packages/coding-agent/test/suite/regressions/010-reasoning-router-privacy-learning-ledger.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/010-reasoning-router-privacy-learning-ledger.test.ts`
  > gate: command-pass
  > risk: high

- [ ] T004 Implement deterministic offline bias compiler
  > role: coder
  > deps: T003
  > files: [`packages/coding-agent/src/core/reasoning-router-bias.ts`, `packages/coding-agent/scripts/reasoning-router/compile-bias-snapshot.ts`, `packages/coding-agent/test/suite/regressions/010-reasoning-router-privacy-learning-ledger.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/010-reasoning-router-privacy-learning-ledger.test.ts`
  > gate: command-pass
  > risk: high

- [ ] T005 [P] Implement Adaptorch advisory bridge module without session wiring
  > role: coder
  > deps: none
  > files: [`packages/coding-agent/src/core/adaptorch-bridge.ts`, `packages/coding-agent/test/suite/regressions/011-reasoning-router-adaptorch-bridge.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/011-reasoning-router-adaptorch-bridge.test.ts`
  > gate: command-pass
  > risk: high

## Phase 3: Prove Current v3 or Calibrate Versioned v4

- [ ] T006 Re-run current v3 against the new governance split
  > role: qa
  > deps: T002
  > files: [`packages/coding-agent/scripts/reasoning-router/calibrate-v3.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/009-reasoning-router-evaluation-governance.test.ts`
  > gate: command-pass
  > risk: medium

- [ ] T007 Conditional: implement confidence-bearing v4 classifier if T006 fails or owner chooses versioning
  > role: coder
  > deps: T006
  > files: [`packages/coding-agent/src/core/reasoning-router-v4.ts`, `packages/coding-agent/src/core/reasoning-router-v4-weights.ts`, `packages/coding-agent/test/suite/regressions/013-reasoning-router-v4-accuracy.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/013-reasoning-router-v4-accuracy.test.ts test/suite/regressions/009-reasoning-router-evaluation-governance.test.ts`
  > gate: command-pass
  > risk: medium

## Phase 4: Security Gates

- [ ] T008 Review learning ledger and bias compiler
  > role: reviewer
  > deps: T004
  > files: [`.omk/goals/009-reasoning-router-advanced-accuracy-implementation/gateS1-learning-review.md`]
  > verify: `grep -E "PASS|BLOCK" .omk/goals/009-reasoning-router-evaluation-governance/gateS1-learning-review.md`
  > gate: file-exists
  > risk: high

- [ ] T009 Review Adaptorch bridge
  > role: reviewer
  > deps: T005
  > files: [`.omk/goals/009-reasoning-router-advanced-accuracy-implementation/gateS2-bridge-review.md`]
  > verify: `grep -E "PASS|BLOCK" .omk/goals/009-reasoning-router-evaluation-governance/gateS2-bridge-review.md`
  > gate: file-exists
  > risk: high

## Phase 5: Single-Writer Integration

- [ ] T010 Wire learning bias and Adaptorch hint into auto-v3 or versioned auto-v4 path
  > role: coder
  > deps: T006, T008, T009
  > files: [`packages/coding-agent/src/core/agent-session.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts`, `packages/coding-agent/src/core/slash-commands.ts`, `packages/coding-agent/src/core/settings-manager.ts`]
  > verify: `npx tsgo --noEmit`
  > gate: command-pass
  > risk: high

- [ ] T011 Add precedence/activation tests for learning and Adaptorch advisory
  > role: qa
  > deps: T010
  > files: [`packages/coding-agent/test/suite/regressions/012-reasoning-router-learning-adaptorch-activation.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/012-reasoning-router-learning-adaptorch-activation.test.ts`
  > gate: command-pass
  > risk: high

## Phase 6: Documentation and Final Review

- [ ] T012 Update usage docs and changelog after behavior exists
  > role: coder
  > deps: T011
  > files: [`packages/coding-agent/docs/usage.md`, `packages/coding-agent/CHANGELOG.md`]
  > verify: `git diff --check -- packages/coding-agent/docs/usage.md packages/coding-agent/CHANGELOG.md`
  > gate: command-pass
  > risk: low

- [ ] T013 Run full targeted reasoning-router regression family
  > role: qa
  > deps: T012
  > files: []
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/003-reasoning-router.test.ts test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts test/suite/regressions/005-reasoning-router-v2-activation.test.ts test/suite/regressions/006-reasoning-router-v3-feature-engineering.test.ts test/suite/regressions/007-reasoning-router-v3-activation.test.ts test/suite/regressions/009-reasoning-router-evaluation-governance.test.ts test/suite/regressions/010-reasoning-router-privacy-learning-ledger.test.ts test/suite/regressions/011-reasoning-router-adaptorch-bridge.test.ts test/suite/regressions/012-reasoning-router-learning-adaptorch-activation.test.ts`
  > gate: command-pass
  > risk: medium

- [ ] T014 Run repository check and isolation checks
  > role: qa
  > deps: T013
  > files: []
  > verify: `npm run check && git diff --stat -- packages/ai packages/agent`
  > gate: command-pass
  > risk: medium

- [ ] T015 Produce final MERGE/BLOCK review
  > role: reviewer
  > deps: T014
  > files: [`.omk/goals/009-reasoning-router-advanced-accuracy-implementation/laneR1-review.md`]
  > verify: `grep -E "MERGE|BLOCK" .omk/goals/009-reasoning-router-evaluation-governance/laneR1-review.md`
  > gate: file-exists
  > risk: low

## Must Not Touch

- `packages/ai/**`
- `packages/agent/**`
- frozen v1/v2 router semantics
- prompt text, path, diff, provider payload, hook output, or credentials in any learning/Adaptorch payload
