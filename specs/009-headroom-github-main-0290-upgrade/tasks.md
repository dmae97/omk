# Tasks: Headroom GitHub Main 0.29.0 Upgrade

**Input**: `specs/009-headroom-github-main-0290-upgrade/{spec.md,plan.md}`  
**Prerequisites**: Existing control-panel status implementation and tests.  
**Output**: OMK DAG-ready task list.

## Phase 1: Runtime Parser

- [x] T001 Update Headroom version detection in `packages/coding-agent/src/modes/interactive/components/control-panel-runtime-status.ts`
  > role: coder
  > deps: none
  > files: [`packages/coding-agent/src/modes/interactive/components/control-panel-runtime-status.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/control-panel-runtime-status.test.ts`
  > gate: command-pass
  > risk: low

- [x] T002 Add parser coverage for `github.com/headroomlabs-ai/headroom 3.0`, patch semver, and legacy output
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/test/control-panel-runtime-status.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/control-panel-runtime-status.test.ts`
  > gate: command-pass
  > risk: low

## Phase 2: Control Panel Fixtures

- [x] T003 Refresh static control-panel header fixture to Headroom 0.29.0
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/test/control-panel-header.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/control-panel-header.test.ts`
  > gate: command-pass
  > risk: low

- [x] T004 Refresh static reference-fidelity fixture to Headroom 0.29.0
  > role: coder
  > deps: T001
  > files: [`packages/coding-agent/test/control-panel-reference-fidelity.test.ts`]
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/control-panel-reference-fidelity.test.ts`
  > gate: command-pass
  > risk: low

## Phase 3: Spec-kit Traceability

- [x] T005 Add spec-kit documents for the Headroom GitHub main 0.29.0 upgrade
  > role: coder
  > deps: none
  > files: [`specs/009-headroom-github-main-0290-upgrade/spec.md`, `specs/009-headroom-github-main-0290-upgrade/plan.md`, `specs/009-headroom-github-main-0290-upgrade/tasks.md`]
  > verify: `test -f specs/009-headroom-github-main-0290-upgrade/spec.md && test -f specs/009-headroom-github-main-0290-upgrade/plan.md && test -f specs/009-headroom-github-main-0290-upgrade/tasks.md`
  > gate: file-exists
  > risk: low

## Phase 4: Runtime Upgrade

- [x] T006 Install `headroom-ai[all]` from `github.com/headroomlabs-ai/headroom@main`
  > role: coder
  > deps: none
  > files: []
  > verify: `python3 -m pip show headroom-ai`
  > gate: command-pass
  > risk: medium

- [x] T007 Update PATH-visible `headroom` symlink to the pyenv-installed 0.29.0 CLI and preserve previous uv symlink backup
  > role: coder
  > deps: T006
  > files: []
  > verify: `headroom --version`
  > gate: command-pass
  > risk: medium

## Phase 5: Verification

- [x] T008 Run targeted control-panel tests
  > role: qa
  > deps: T001, T002, T003, T004, T007
  > files: []
  > verify: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/control-panel-runtime-status.test.ts test/control-panel-header.test.ts test/control-panel-reference-fidelity.test.ts`
  > gate: command-pass
  > risk: low

- [x] T009 Run repository check
  > role: qa
  > deps: T008
  > files: []
  > verify: `npm run check`
  > gate: command-pass
  > risk: medium

## Must Not Touch

- `packages/ai/**`
- `packages/agent/**`
- secret files or environment files
- package lockfiles or dependency manifests
