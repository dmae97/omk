# Tasks: OMK 0.79.3 Machine-Checkable Hardening

**Input**: `spec.md`, `plan.md`
**Status**: implementation completed in working tree; verify before commit/release

## Phase 1 — Spec-kit / Docs Sync

- [x] T001 Create project-local spec-kit skeleton
  > role: planner
  > deps: none
  > files: [`.speckit/config.yaml`, `specs/constitution.md`, `specs/templates/*.md`]
  > risk: write
  > authority: write
  > verify: `test -f .speckit/config.yaml && test -f specs/constitution.md`
  > gate: file-exists

- [x] T002 Create active hardening feature spec
  > role: planner
  > deps: T001
  > files: [`specs/001-omk-0793-machine-checkable-hardening/spec.md`, `specs/001-omk-0793-machine-checkable-hardening/plan.md`, `specs/001-omk-0793-machine-checkable-hardening/tasks.md`]
  > risk: write
  > authority: write
  > verify: `test -f specs/001-omk-0793-machine-checkable-hardening/spec.md`
  > gate: file-exists

- [x] T003 Sync current-facing Markdown docs
  > role: coder
  > deps: T001
  > files: [`ROADMAP.md`, `docs/*.md`, `README.md`, `CHANGELOG.md`, `.omk/specs/native-orchestrator-phase1/*.md`]
  > risk: write
  > authority: write
  > verify: `npm run version:check`
  > gate: command-pass

## Phase 2 — Runtime Gates

- [x] T004 Extend release truth checker
  > role: coder
  > deps: none
  > files: [`scripts/check-version-consistency.mjs`]
  > risk: write
  > authority: write
  > verify: `npm run version:check`
  > gate: command-pass

- [x] T005 Make native risk/evidence gate machine-checkable
  > role: coder
  > deps: none
  > files: [`src/commands/chat/native-root-loop.ts`, `test/chat-runtime.test.mjs`]
  > risk: write
  > authority: write
  > verify: `node --test --test-timeout=300000 test/chat-runtime.test.mjs`
  > gate: command-pass

- [x] T006 Add staged tool authority mode
  > role: coder
  > deps: none
  > files: [`src/runtime/tool-dispatch-contracts.ts`, `test/tool-authority-wiring.test.mjs`]
  > risk: write
  > authority: write
  > verify: `node --test --test-timeout=300000 test/tool-authority-wiring.test.mjs`
  > gate: command-pass

- [x] T007 Add health-aware router and executeTask trace
  > role: coder
  > deps: none
  > files: [`src/runtime/runtime-router.ts`, `test/runtime-router.test.mjs`]
  > risk: write
  > authority: write
  > verify: `node --test --test-timeout=300000 test/runtime-router.test.mjs`
  > gate: command-pass

- [x] T008 Apply headroom compaction to effective capsule
  > role: coder
  > deps: none
  > files: [`src/runtime/headroom-policy.ts`, `src/runtime/runtime-backed-task-runner.ts`, `test/runtime-router.test.mjs`]
  > risk: write
  > authority: write
  > verify: `node --test --test-timeout=300000 test/headroom-policy.test.mjs test/runtime-router.test.mjs`
  > gate: command-pass

## Phase 3 — Full Verification

- [x] T009 Run local verification gates
- [x] T010 Address P0 residuals and P1 observability cluster
  > role: root-coordinator
  > deps: T009
  > files: [`src/commands/chat/native-root-loop.ts`, `src/orchestration/executor.ts`, `src/runtime/runtime-router.ts`, `src/runtime/runtime-backed-task-runner.ts`, `src/runtime/kimi-print-runtime.ts`, `src/util/session.ts`, `test/chat-runtime.test.mjs`, `test/runtime-router-advisory-boundary.test.mjs`]
  > risk: write
  > authority: write
  > verify: `node --test test/chat-runtime.test.mjs test/runtime-router.test.mjs test/runtime-health.test.mjs test/provider-policy-resolution.test.mjs test/evidence-gate.test.mjs test/codex-approval-mapping.test.mjs test/runtime-router-advisory-boundary.test.mjs test/headroom-policy.test.mjs`
  > gate: command-pass
- [x] T011 Add theme version sync gate to `version:check`
  > role: coder
  > deps: T009
  > files: [`scripts/check-version-consistency.mjs`, `test/version-consistency.test.mjs`]
  > risk: write
  > authority: write
  > verify: `node --test test/version-consistency.test.mjs`
  > gate: command-pass
- [x] T012 Automate `src/brand`↔`themes` theme JSON synchronization
  > role: coder
  > deps: T011
  > files: [`scripts/sync-themes.mjs`, `package.json`]
  > risk: write
  > authority: write
  > verify: `npm run theme:sync && npm run theme:check`
  > gate: command-pass
  > role: qa
  > deps: T003, T004, T005, T006, T007, T008
  > files: [`.omk/runs/omk-0793-machine-checkable-hardening/result.md`]
  > risk: shell
  > authority: shell
  > verify: `npm run check && npm run build:clean && npm run lint && npm run secret:scan && npm run version:check && npm test`
  > gate: command-pass
