# Tasks: Think Command Routing

**Input**: `spec.md`, `plan.md`
**Prerequisites**: Canonical checkout `/home/yu/omk` is writable.
**Output**: OMK DAG-ready task list with execution metadata.

## Phase 1: Bootstrap

- [x] T001 Verify the running launcher resolves to `/home/yu/omk/packages/coding-agent/dist/cli.js`
  > role: explorer
  > deps: none
  > files: [`/home/yu/.omk/agent/lib/omk-canonical-launcher.cjs`]
  > verify: `read /home/yu/.omk/agent/lib/omk-canonical-launcher.cjs`
  > gate: summary-present
  > risk: low

- [x] T002 Create project-local spec-kit skeleton without overwriting existing artifacts
  > role: planner
  > deps: T001
  > files: [`.speckit/config.yaml`, `specs/constitution.md`, `specs/templates/spec-template.md`, `specs/templates/plan-template.md`, `specs/templates/tasks-template.md`]
  > verify: `test -f .speckit/config.yaml && test -f specs/constitution.md`
  > gate: file-exists
  > risk: low

## Phase 2: Core Implementation

- [x] T003 Add `/think` command metadata and autocomplete
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/src/core/slash-commands.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts`]
  > verify: `rg 'name: "think"|thinkCommand' packages/coding-agent/src`
  > gate: diff-nonempty
  > risk: low

- [x] T004 Extract reusable thinking selector component and route `/think` to it
  > role: coder
  > deps: T003
  > files: [`packages/coding-agent/src/modes/interactive/components/settings-selector.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts`]
  > verify: `rg 'ThinkingSelectorComponent|handleThinkCommand' packages/coding-agent/src`
  > gate: diff-nonempty
  > risk: medium

- [x] T005 Route successful `/model` selections to the thinking selector
  > role: coder
  > deps: T004
  > files: [`packages/coding-agent/src/modes/interactive/interactive-mode.ts`]
  > verify: `rg 'showThinkingSelector' packages/coding-agent/src/modes/interactive/interactive-mode.ts`
  > gate: diff-nonempty
  > risk: medium

## Phase 3: Docs and Tests

- [x] T006 Update user-facing command docs
  > role: reviewer
  > deps: T003
  > files: [`packages/coding-agent/docs/usage.md`, `packages/coding-agent/docs/quickstart.md`]
  > verify: `rg '/think|thinking-level selector' packages/coding-agent/docs`
  > gate: diff-nonempty
  > risk: low

- [x] T007 Add targeted regression test
  > role: coder
  > deps: T004
  > files: [`packages/coding-agent/test/thinking-selector.test.ts`]
  > verify: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/thinking-selector.test.ts`
  > gate: command-pass
  > risk: low

## Phase 4: Build and Verification

- [x] T008 Run repository quality gate
  > role: qa
  > deps: T007
  > files: []
  > verify: `npm run check`
  > gate: command-pass
  > risk: medium

- [x] T009 Build packages so `dist/` is refreshed for the installed launcher
  > role: qa
  > deps: T008
  > files: [`packages/coding-agent/dist/**`]
  > verify: `npm run build`
  > gate: command-pass
  > risk: medium
