# Tasks: Harness Control Plane VNext P0

**Input**: `specs/001-harness-control-plane-vnext/spec.md`  
**Prerequisites**: plan.md, spec.md  
**Output**: OMK DAG-ready task list with execution metadata

## Phase 1: Bootstrap

- [x] T001 [P] Bootstrap spec-kit artifacts and feature spec under `specs/001-harness-control-plane-vnext/`
  > role: planner
  > deps: none
  > files: [`.speckit/config.yaml`, `specs/constitution.md`, `specs/001-harness-control-plane-vnext/spec.md`, `specs/001-harness-control-plane-vnext/plan.md`, `specs/001-harness-control-plane-vnext/tasks.md`]
  > verify: `test -f specs/001-harness-control-plane-vnext/spec.md`
  > gate: file-exists
  > risk: low

## Phase 2: RED Tests

- [x] T002 [P] Add compaction budget and summary validation tests in `packages/coding-agent/test/compaction.test.ts`
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/test/compaction.test.ts`]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/compaction.test.ts`
  > gate: command-pass
  > risk: medium

- [x] T003 [P] Add interactive persistence tests in `packages/coding-agent/test/interactive-mode-status.test.ts` and model selector regression test
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/test/interactive-mode-status.test.ts`, `packages/coding-agent/test/suite/regressions/3217-scoped-model-order.test.ts`]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/interactive-mode-status.test.ts test/suite/regressions/3217-scoped-model-order.test.ts`
  > gate: command-pass
  > risk: medium

- [x] T004 [P] Add migration classifier tests in `packages/coding-agent/test/migrations-deprecation.test.ts`
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/test/migrations-deprecation.test.ts`]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/migrations-deprecation.test.ts`
  > gate: command-pass
  > risk: medium

## Phase 3: Implementation

- [x] T005 Implement compaction budget accounting and summary validator in `packages/coding-agent/src/core/compaction/compaction.ts`
  > role: coder
  > deps: T002
  > files: [`packages/coding-agent/src/core/compaction/compaction.ts`]
  > verify: focused compaction test command
  > gate: command-pass
  > risk: medium

- [x] T006 Implement interactive persistence fixes in `model-selector.ts` and `interactive-mode.ts`
  > role: coder
  > deps: T003
  > files: [`packages/coding-agent/src/modes/interactive/components/model-selector.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts`]
  > verify: focused interactive/model test command
  > gate: command-pass
  > risk: high

- [x] T007 Implement structured migration classifier internals in `packages/coding-agent/src/migrations.ts`
  > role: coder
  > deps: T004
  > files: [`packages/coding-agent/src/migrations.ts`]
  > verify: focused migration test command
  > gate: command-pass
  > risk: medium

## Phase 4: Verification

- [x] T008 Run combined focused Vitest and `npm run check`
  > role: qa
  > deps: T005, T006, T007
  > files: []
  > verify: `npm run check`
  > gate: command-pass
  > risk: low

- [x] T009 Update result evidence artifact
  > role: reviewer
  > deps: T008
  > files: [`.omk/runs/harness-control-plane-vnext/result.json`]
  > verify: `test -f .omk/runs/harness-control-plane-vnext/result.json`
  > gate: file-exists
  > risk: low

## Phase 5: Follow-up Slices

- [x] T010 Add semantic-unit middle packing for summary input compression
  > role: coder
  > deps: T005
  > files: [`packages/coding-agent/src/core/compaction/compaction.ts`, `packages/coding-agent/test/compaction.test.ts`]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/compaction.test.ts`
  > gate: command-pass
  > risk: medium

- [x] T011 Add scoped keybinding dispatch guardrails
  > role: coder
  > deps: T006
  > files: [`packages/tui/src/keybindings.ts`, `packages/tui/test/keybindings.test.ts`]
  > verify: `cd packages/tui && node --test test/keybindings.test.ts`
  > gate: command-pass
  > risk: medium

- [x] T012 Add bounded recursive extension scan plus dry-run/apply migration plan API
  > role: coder
  > deps: T007
  > files: [`packages/coding-agent/src/migrations.ts`, `packages/coding-agent/test/migrations-deprecation.test.ts`]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/migrations-deprecation.test.ts`
  > gate: command-pass
  > risk: medium

- [x] T013 Add harness-control JSONL event ledger and wire selected state transitions
  > role: coder
  > deps: T010, T011, T012
  > files: [`packages/coding-agent/src/core/harness-control-events.ts`, `packages/coding-agent/test/harness-control-events.test.ts`, `packages/coding-agent/src/core/compaction/compaction.ts`, `packages/coding-agent/src/migrations.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts`]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/harness-control-events.test.ts test/migrations-deprecation.test.ts test/compaction.test.ts test/interactive-mode-status.test.ts test/suite/regressions/3217-scoped-model-order.test.ts` + `npm run check`
  > gate: command-pass
  > risk: medium
