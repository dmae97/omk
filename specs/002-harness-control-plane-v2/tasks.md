# Tasks: Harness Control Plane V2

**Input**: `specs/002-harness-control-plane-v2/spec.md`  
**Plan**: `specs/002-harness-control-plane-v2/plan.md`  
**Topology**: hierarchical DAG  
**Output**: deterministic, replayable harness control protocol

## Phase 0 — Authority and Spec Foundation

- [x] HCP-00 Remove provider-hardcoded authority from spec templates
  > role: planner
  > deps: none
  > lane: spec-replay-qa
  > files: [`specs/templates/plan-template.md`, `specs/002-harness-control-plane-v2/spec.md`]
  > skills: [blueprint, ddd-software-architecture]
  > mcp: [filesystem, memory]
  > hooks: [protect-secrets.sh]
  > verify: `grep -R "Kimi is final writer" specs/templates specs/002-harness-control-plane-v2 && exit 1 || true`
  > gate: command-pass
  > requirementIds: [R6]
  > risk: low

## Phase 1 — Machine Spec and Ledger Foundations

- [x] HCP-01 Implement spec compiler schema and parser
  > role: coder
  > deps: HCP-00
  > lane: spec-replay-qa
  > files: [`packages/coding-agent/src/core/spec-kit/**`, `packages/coding-agent/test/spec-kit-compiler.test.ts`, `package.json`]
  > skills: [blueprint, ddd-software-architecture, tdd-test-driven-development]
  > mcp: [filesystem, adaptorch, context7]
  > hooks: [protect-secrets.sh, typecheck-after-edit.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/spec-kit-compiler.test.ts`
  > gate: command-pass
  > requirementIds: [R6]
  > risk: medium

- [x] HCP-02 Implement Event Ledger V2 core schema, canonical hashing, redaction, and append path
  > role: security
  > deps: HCP-00
  > lane: ledger-security-architect
  > files: [`packages/coding-agent/src/core/harness-control-events.ts`, `packages/coding-agent/test/harness-control-events.test.ts`]
  > skills: [security-review, ddd-software-architecture, tdd-test-driven-development, verification-loop, zeroize-audit]
  > mcp: [filesystem, memory, adaptorch]
  > hooks: [protect-secrets.sh, pre-shell-guard.sh, stop-verify.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/harness-control-events.test.ts`
  > gate: command-pass
  > requirementIds: [R1]
  > risk: high

## Phase 2 — Ledger Verification, Transactions, Compaction, Router Primitives

- [x] HCP-03 Implement ledger verifier and operation completeness checks
  > role: tester
  > deps: HCP-02
  > lane: ledger-security-architect
  > files: [`packages/coding-agent/src/core/harness-control-replay.ts`, `packages/coding-agent/test/harness-control-replay.test.ts`]
  > skills: [ai-regression-testing, verification-loop, property-based-testing]
  > mcp: [filesystem, memory]
  > hooks: [protect-secrets.sh, stop-verify.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/harness-control-replay.test.ts`
  > gate: command-pass
  > requirementIds: [R1, R7]
  > risk: high

- [x] HCP-04 Implement transaction coordinator core
  > role: architect
  > deps: HCP-02
  > lane: transaction-migration-architect
  > files: [`packages/coding-agent/src/core/transaction-coordinator.ts`, `packages/coding-agent/test/transaction-coordinator.test.ts`]
  > skills: [ddd-software-architecture, systematic-debugging, tdd-test-driven-development]
  > mcp: [filesystem, memory, ouroboros]
  > hooks: [protect-secrets.sh, stop-verify.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/transaction-coordinator.test.ts`
  > gate: command-pass
  > requirementIds: [R2]
  > risk: high

- [x] HCP-07 Implement compaction emergency budget path and typed Markdown summary parser
  > role: coder
  > deps: HCP-02
  > lane: continuity-input-router
  > files: [`packages/coding-agent/src/core/compaction/compaction.ts`, `packages/coding-agent/test/compaction.test.ts`]
  > skills: [headroom, ai-regression-testing, tdd-test-driven-development]
  > mcp: [filesystem, memory, adaptorch]
  > hooks: [precompact-checkpoint.sh, protect-secrets.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/compaction.test.ts`
  > gate: command-pass
  > requirementIds: [R4]
  > risk: medium

- [x] HCP-09 Implement keybinding scope stack and runtime dispatch router
  > role: coder
  > deps: HCP-02
  > lane: continuity-input-router
  > files: [`packages/tui/src/keybindings.ts`, `packages/tui/test/keybindings.test.ts`, `packages/coding-agent/src/modes/interactive/**`]
  > skills: [coding-standards, tdd-test-driven-development, verification-loop]
  > mcp: [filesystem, adaptorch]
  > hooks: [typecheck-after-edit.sh, stop-verify.sh]
  > verify: `cd packages/tui && node --test test/keybindings.test.ts`
  > gate: command-pass
  > requirementIds: [R5]
  > risk: high

- [x] HCP-10 Add ledger lock, fsync, rotation, and artifact root policy
  > role: security
  > deps: HCP-02
  > lane: ledger-security-architect
  > files: [`packages/coding-agent/src/core/harness-control-events.ts`, `packages/coding-agent/test/harness-control-events.test.ts`]
  > skills: [security-review, verification-loop]
  > mcp: [filesystem]
  > hooks: [protect-secrets.sh, stop-verify.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/harness-control-events.test.ts`
  > gate: command-pass
  > requirementIds: [R1]
  > risk: high

## Phase 3 — Transaction Integrations and Continuity Enhancements

- [ ] HCP-05 Integrate interactive model/thinking/theme changes with transaction coordinator
  > role: coder
  > deps: HCP-04
  > lane: transaction-migration-architect
  > files: [`packages/coding-agent/src/modes/interactive/interactive-mode.ts`, `packages/coding-agent/test/interactive-mode-status.test.ts`, `packages/coding-agent/test/suite/regressions/3217-scoped-model-order.test.ts`]
  > skills: [tdd-test-driven-development, systematic-debugging]
  > mcp: [filesystem, memory]
  > hooks: [typecheck-after-edit.sh, stop-verify.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/interactive-mode-status.test.ts test/suite/regressions/3217-scoped-model-order.test.ts`
  > gate: command-pass
  > requirementIds: [R2]
  > risk: high

- [ ] HCP-06 Implement atomic extension migration transaction
  > role: security
  > deps: HCP-04
  > lane: transaction-migration-architect
  > files: [`packages/coding-agent/src/migrations.ts`, `packages/coding-agent/test/migrations-deprecation.test.ts`]
  > skills: [security-review, differential-review, tdd-test-driven-development]
  > mcp: [filesystem, github, memory]
  > hooks: [protect-secrets.sh, pre-shell-guard.sh, stop-verify.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/migrations-deprecation.test.ts`
  > gate: command-pass
  > requirementIds: [R3]
  > risk: high

- [ ] HCP-08 Implement compaction semantic dependency graph, dependency closure, and dedup novelty
  > role: coder
  > deps: HCP-07
  > lane: continuity-input-router
  > files: [`packages/coding-agent/src/core/compaction/compaction.ts`, `packages/coding-agent/test/compaction.test.ts`]
  > skills: [headroom, tdd-test-driven-development, property-based-testing]
  > mcp: [filesystem, memory]
  > hooks: [precompact-checkpoint.sh, protect-secrets.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/compaction.test.ts`
  > gate: command-pass
  > requirementIds: [R4]
  > risk: medium

- [ ] HCP-11 Add spec scripts and traceability CLI
  > role: coder
  > deps: HCP-01, HCP-03
  > lane: spec-replay-qa
  > files: [`scripts/spec-check.mjs`, `scripts/spec-compile.mjs`, `scripts/spec-verify.mjs`, `package.json`, `packages/coding-agent/test/spec-kit-compiler.test.ts`]
  > skills: [blueprint, verification-loop, tdd-test-driven-development]
  > mcp: [filesystem, github]
  > hooks: [protect-secrets.sh, stop-verify.sh]
  > verify: `npm run spec:check && npm run spec:compile`
  > gate: command-pass
  > requirementIds: [R6]
  > risk: medium

## Phase 4 — Replay Reduce

- [ ] HCP-12 Implement integrated replay verifier
  > role: qa
  > deps: HCP-03, HCP-04, HCP-06, HCP-08, HCP-09, HCP-11
  > lane: spec-replay-qa
  > files: [`packages/coding-agent/src/core/harness-control-replay.ts`, `packages/coding-agent/test/harness-control-replay.test.ts`, `scripts/spec-verify.mjs`]
  > skills: [verification-loop, ai-regression-testing, ddd-software-architecture]
  > mcp: [filesystem, memory, ouroboros]
  > hooks: [stop-verify.sh, subagent-stop-audit.sh]
  > verify: `npm run spec:verify`
  > gate: command-pass
  > requirementIds: [R7]
  > risk: high

## Phase 5 — Review, QA, Shipping

- [ ] HCP-13 Run subsystem regression suite
  > role: qa
  > deps: HCP-12
  > lane: spec-replay-qa
  > files: []
  > skills: [verification-before-completion, ai-regression-testing]
  > mcp: [filesystem]
  > hooks: [stop-verify.sh]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/harness-control-events.test.ts test/harness-control-replay.test.ts test/transaction-coordinator.test.ts test/migrations-deprecation.test.ts test/compaction.test.ts test/interactive-mode-status.test.ts test/suite/regressions/3217-scoped-model-order.test.ts && cd ../tui && node --test test/keybindings.test.ts`
  > gate: command-pass
  > requirementIds: [R8]
  > risk: low

- [ ] HCP-14 Run full repository check
  > role: qa
  > deps: HCP-13
  > lane: spec-replay-qa
  > files: []
  > skills: [verification-before-completion]
  > mcp: [filesystem]
  > hooks: [stop-verify.sh]
  > verify: `npm run check && git diff --check`
  > gate: command-pass
  > requirementIds: [R8]
  > risk: low

- [ ] HCP-15 Run adversarial code/security review
  > role: reviewer
  > deps: HCP-14
  > lane: spec-replay-qa
  > files: []
  > skills: [code-review, security-review, differential-review]
  > mcp: [filesystem, github, memory]
  > hooks: [subagent-stop-audit.sh, npm-audit-summary.sh]
  > verify: `write review artifact under .omk/runs/harness-control-plane-v2/review.md`
  > gate: file-exists
  > requirementIds: [R8]
  > risk: low

- [ ] HCP-16 Update final result artifact
  > role: reviewer
  > deps: HCP-15
  > lane: spec-replay-qa
  > files: [`.omk/runs/harness-control-plane-v2/result.json`]
  > skills: [verification-before-completion]
  > mcp: [filesystem, memory]
  > hooks: [stop-verify.sh]
  > verify: `test -f .omk/runs/harness-control-plane-v2/result.json`
  > gate: file-exists
  > requirementIds: [R8]
  > risk: low

- [ ] HCP-17 Commit and push logical changes
  > role: root
  > deps: HCP-16
  > lane: root
  > files: explicit changed files only
  > skills: [git-commit, verification-before-completion]
  > mcp: [github, filesystem]
  > hooks: [stop-verify.sh]
  > verify: `git status --branch --short`
  > gate: command-pass
  > requirementIds: [R8]
  > risk: medium

## Parallel Writer Conflict Rules

- HCP-01/HCP-02 may run in parallel: disjoint files.
- HCP-03/HCP-04/HCP-07/HCP-09/HCP-10 may run in parallel except HCP-03 and HCP-10 both touch ledger files; serialize those two if same files are edited.
- HCP-05 and HCP-06 may run in parallel after HCP-04: disjoint primary files.
- HCP-07 and HCP-08 are serial due compaction file overlap.
- HCP-11 and HCP-12 are serial due spec/replay script overlap.

## Evidence Artifacts

- `.omk/runs/harness-control-plane-v2/ledger.md`
- `.omk/runs/harness-control-plane-v2/transactions.md`
- `.omk/runs/harness-control-plane-v2/continuity-router.md`
- `.omk/runs/harness-control-plane-v2/spec-replay.md`
- `.omk/runs/harness-control-plane-v2/replay-report.json`
- `.omk/runs/harness-control-plane-v2/result.json`
