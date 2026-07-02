# Tasks: OMK v0.90.2 Full Upgrade

**Input**: Design documents from `/specs/002-omk-v0902-full-upgrade/`
**Prerequisites**: plan.md (required), spec.md (required)
**Output**: OMK DAG-ready task list with execution metadata

## Phase 1: WIP landing

- [ ] T001 Review and commit the 114-file WIP as scoped feature commits (explicit paths only; no `git add -A`)
  > role: coder
  > deps: none
  > files: [`packages/*/src/**`, `packages/*/test/**`, `scripts/check-release-consistency.mjs`]
  > verify: `git status --short | wc -l` reports 0 unstaged app files
  > gate: command-pass
  > risk: medium

- [ ] T002 Restore `test.sh` exec bit and confirm both invocation paths
  > role: coder
  > deps: T001
  > files: [`test.sh`]
  > verify: `test -x test.sh && bash test.sh`
  > gate: command-pass
  > risk: low

- [ ] T003 Full static + test gate on clean tree
  > role: qa
  > deps: T002
  > files: []
  > verify: `npm run check && bash test.sh`
  > gate: command-pass
  > risk: medium

## Phase 2: Release lineage

- [ ] T004 Merge tag `v0.90.1` into `main` (versions → 0.90.1; released changelog sections immutable)
  > role: coder
  > deps: T003
  > files: [`packages/*/package.json`, `packages/*/CHANGELOG.md`, `package-lock.json`, `packages/coding-agent/npm-shrinkwrap.json`]
  > verify: `git merge-base --is-ancestor v0.90.1 HEAD && npm pkg get version --workspaces | grep -c '0.90.1'`
  > gate: command-pass
  > risk: high

## Phase 3: Parallel hardening

- [x] T005 [P] Pinned security bumps for undici / protobufjs / esbuild chains (`npm install --ignore-scripts`), regen shrinkwrap — DONE 2026-07-02 (Lanes C+D; also ws/vite; `npm audit` 0 vulnerabilities; evidence: `.omk/runs/v0902-upgrade-20260702/laneC-dep-security.md`, `laneD-protobufjs-residual.md`)
  > role: coder
  > deps: T004
  > files: [`package-lock.json`, `packages/coding-agent/npm-shrinkwrap.json`]
  > verify: `npm audit | grep -c 'high' || true` → 0 high; `npm run check && bash test.sh`
  > gate: command-pass
  > risk: medium

- [ ] T006 [P] Release-surface docs: READMEs v0.80.8 → v0.90.2, add `.github/RELEASE_NOTES_v0.90.2.md`
  > role: coder
  > deps: T004
  > files: [`README.md`, `packages/coding-agent/README.md`, `.github/RELEASE_NOTES_v0.90.2.md`]
  > verify: `node scripts/check-release-consistency.mjs`
  > gate: command-pass
  > risk: low

- [ ] T007 [P] `/cl` changelog audit on latest `main` commit (user-run prompt; AGENTS.md release blocker)
  > role: reviewer
  > deps: T004
  > files: [`packages/*/CHANGELOG.md`]
  > verify: user confirms `/cl` ran on HEAD
  > gate: summary-present
  > risk: medium

- [ ] T008 Configure npm Trusted Publisher for the 4 public packages (repo `dmae97/open-multi-agent-kit`, workflow `build-binaries.yml`, environment `npm-publish`) — USER ACTION on npmjs.com
  > role: operator
  > deps: none
  > files: []
  > verify: v0.90.2 tag run `publish-npm` job passes (checked in T011)
  > gate: command-pass
  > risk: high

## Phase 3b: WIP hardening (executed 2026-07-02, parallel lanes)

- [x] T014 Release-consistency algorithm v2: tag-lineage + release-surface drift detection (dev-warnings / `--release` errors) — Lane B, 7/7 tests, detects the v0.90.1 orphan incident
- [x] T015 WIP defect fixes from Lane A audit: `!` autocomplete start-of-message gate (Lane E, 35/35), reverse-skill 779-line dedup → named re-export shim (Lane G), CHANGELOG accuracy for presets/ctx-cache bullets (root)
- [x] T016 ai thinking-metadata reconciliation: stray `max` mappings removed via `generate-models.ts` + regeneration per changelog contract — Lane H, 3 fails → green
- [x] T017 Test-suite stabilization: env-fragile version-check tests (clear `OMK_SKIP_VERSION_CHECK`/`OMK_OFFLINE`), control-panel `│` regex fix; full `bash test.sh` exit 0 across all packages

## Phase 4: Release

- [ ] T009 Local release smoke from outside the repo (node + bun: --help/--version/--list-models/-p + tmux interactive)
  > role: qa
  > deps: T005, T006, T007
  > files: []
  > verify: `npm run release:local -- --out /tmp/omk-local-release --force && /tmp/omk-local-release/node/omk --version`
  > gate: command-pass
  > risk: medium

- [ ] T010 Execute release (0.90.1 → 0.90.2); review script-generated lockfile/changelog diffs; never rerun after tag push
  > role: coder
  > deps: T009
  > files: [`packages/*/package.json`, `packages/*/CHANGELOG.md`]
  > verify: `OMK_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch`
  > gate: command-pass
  > risk: high

- [ ] T011 Verify CI publish: Build Binaries for tag v0.90.2, `publish-npm` pass (idempotent tag-workflow rerun on transient failure)
  > role: qa
  > deps: T010, T008
  > files: []
  > verify: `gh run watch <run-id> --exit-status && npm view open-multi-agent-kit version | grep 0.90.2`
  > gate: command-pass
  > risk: high

## Phase 5: Local upgrade & closeout

- [ ] T012 Rebuild canonical runtime so `~/.omk/agent/bin/omk` serves 0.90.2
  > role: coder
  > deps: T011
  > files: [`packages/coding-agent/dist/**`]
  > verify: `npm run build && ~/.omk/agent/bin/omk --version | grep 0.90.2`
  > gate: command-pass
  > risk: low

- [ ] T013 Closeout: mark `.omo/plans/omk-v0.90.2-upgrade-20260702.md` done; prune landed worktrees; decide `.omk/modules/godmode` removal with user
  > role: reviewer
  > deps: T012
  > files: [`.omo/plans/omk-v0.90.2-upgrade-20260702.md`]
  > verify: plan marked done with evidence links
  > gate: summary-present
  > risk: low
