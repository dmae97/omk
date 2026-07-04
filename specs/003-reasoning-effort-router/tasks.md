# Tasks: Per-Task Reasoning-Effort Router

**Input**: `spec.md`, `plan.md`
**Prerequisites**: Canonical checkout `/home/yu/omk` is writable; `specs/003-reasoning-effort-router/` spec-kit exists.
**Output**: OMK DAG-ready task list with execution metadata.

## Phase 1: Bootstrap

- [ ] T001 Confirm recon facts: ThinkingLevel union, per-turn `reasoning` flow, `prompt()` insertion point
  > role: explorer
  > deps: none
  > files: [`packages/agent/src/types.ts`, `packages/agent/src/agent.ts`, `packages/coding-agent/src/core/agent-session.ts`]
  > verify: `rg -n 'reasoning: this._state.thinkingLevel' packages/agent/src/agent.ts && rg -n 'getAvailableThinkingLevels' packages/coding-agent/src/core/agent-session.ts`
  > gate: summary-present
  > risk: low

- [ ] T002 Write lane evidence stub files under the goal evidence root
  > role: planner
  > deps: T001
  > files: [`.omk/goals/003-reasoning-effort-router/laneB-coder-core.md`, `.omk/goals/003-reasoning-effort-router/laneC-providers-audit.md`, `.omk/goals/003-reasoning-effort-router/laneD-tester.md`, `.omk/goals/003-reasoning-effort-router/laneE-reviewer.md`]
  > verify: `ls .omk/goals/003-reasoning-effort-router/`
  > gate: file-exists
  > risk: low

## Phase 2: Core Implementation (lane B)

- [ ] T003 Create pure `reasoning-router.ts`: task-class union, classifier, static rule table, clamp helper; freeze exports
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/src/core/reasoning-router.ts`]
  > verify: `rg -n 'classifyTask|resolveThinkingLevel' packages/coding-agent/src/core/reasoning-router.ts`
  > gate: diff-nonempty
  > risk: medium

- [ ] T004 Add `auto` thinking mode state to AgentSession and wire per-turn resolution into `prompt()` before agent dispatch, without overwriting the persisted default level
  > role: coder
  > deps: T003
  > files: [`packages/coding-agent/src/core/agent-session.ts`]
  > verify: `rg -n 'thinkingMode|reasoning-router' packages/coding-agent/src/core/agent-session.ts`
  > gate: diff-nonempty
  > risk: medium

- [ ] T005 Accept `/think auto` and expose auto entry in the thinking selector; update `/think` command metadata
  > role: coder
  > deps: T004
  > files: [`packages/coding-agent/src/modes/interactive/interactive-mode.ts`, `packages/coding-agent/src/core/slash-commands.ts`]
  > verify: `rg -n 'auto' packages/coding-agent/src/core/slash-commands.ts packages/coding-agent/src/modes/interactive/interactive-mode.ts`
  > gate: diff-nonempty
  > risk: medium

## Phase 3: Parallel Lanes (C and D, after T003 export freeze)

- [ ] T006 Providers audit: confirm `packages/ai` untouched and `clampThinkingLevel` remains final clamp; record advisory verdict
  > role: security
  > deps: T003
  > files: [`.omk/goals/003-reasoning-effort-router/laneC-providers-audit.md`]
  > verify: `git diff --stat packages/ai && rg -n 'clampThinkingLevel' packages/ai/src/models.ts`
  > gate: summary-present
  > risk: low

- [ ] T007 Add regression test on faux harness: classifier determinism, clamp-to-capability, override precedence
  > role: tester
  > deps: T003, T004, T005
  > files: [`packages/coding-agent/test/suite/regressions/003-reasoning-router.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/003-reasoning-router.test.ts`
  > gate: command-pass
  > risk: low

## Phase 4: Docs and Review (lane E)

- [ ] T008 Document `/think auto`, classifier inputs, and precedence; add changelog entry under Unreleased/Added
  > role: reviewer
  > deps: T005
  > files: [`packages/coding-agent/docs/usage.md`, `packages/coding-agent/CHANGELOG.md`]
  > verify: `rg -n 'think auto|reasoning router' packages/coding-agent/docs/usage.md packages/coding-agent/CHANGELOG.md`
  > gate: diff-nonempty
  > risk: low

- [ ] T009 Reviewer verdict: spec acceptance walkthrough, lane evidence complete, no `packages/ai` diff
  > role: reviewer
  > deps: T006, T007, T008
  > files: [`.omk/goals/003-reasoning-effort-router/laneE-reviewer.md`]
  > verify: `git diff --stat packages/ai | wc -l`
  > gate: summary-present
  > risk: medium

## Phase 5: Verification and Build

- [ ] T010 Run repository quality gate
  > role: qa
  > deps: T009
  > files: []
  > verify: `npm run check`
  > gate: command-pass
  > risk: medium

- [ ] T011 Build packages so `dist/` is refreshed for the installed launcher (only on explicit user request for runtime application; restart TUI after)
  > role: qa
  > deps: T010
  > files: [`packages/coding-agent/dist/**`]
  > verify: `npm run build`
  > gate: command-pass
  > risk: medium
