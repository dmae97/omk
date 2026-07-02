# Feature Specification: OMK v0.90.2 Full Upgrade

**Feature Branch**: `002-omk-v0902-full-upgrade`
**Created**: 2026-07-02
**Status**: Draft
**Input**: User description: "현재 OMK v0.90.2로 완전 업그레이드 — evaluate the project, land the pending 0.90.x work, reconcile the v0.90.1 release lineage, fix npm publishing, release v0.90.2, and upgrade the installed launcher."
**OMK Preset**: `omk` (DAG-optimized, parallel-agent ready)

## Agent-Oriented Requirements

### Requirement 1 - Land the 0.90.x WIP payload (Priority: P1)

**Agent**: coder / reviewer
**Skills**: git-master, programming
**Evidence Gate**: command-pass
**Risk**: medium

**What**: Commit the ~114-file working-tree payload (max thinking level, Claude Sonnet 5, Zyloo provider, reverse-skill routing, `!` skill launcher, computer-use MCP presets, release-consistency check, hooks-migration fix, TUI control panel, ctx cache telemetry) as scoped commits; restore `test.sh` exec bit.
**Verify**: `npm run check` and `bash test.sh` pass on a clean tree (`git status --short` empty).

**Acceptance**:
1. `git status --short` reports no unstaged application files.
2. `npm run check` exits 0 (biome, pinned-deps, ts-imports, release-consistency, shrinkwrap, tsgo, browser-smoke).
3. `bash test.sh` exits 0.

---

### Requirement 2 - Reconcile v0.90.1 release lineage (Priority: P1)

**Agent**: coder
**Skills**: git-master
**Evidence Gate**: command-pass
**Risk**: high

**What**: Merge tag `v0.90.1` (`210b43aae`, `de6a18533`) into `main`. Package versions resolve to `0.90.1`; released `[0.90.1]` changelog sections remain immutable below current `[Unreleased]` entries.
**Verify**: `git rev-list --left-right --count HEAD...v0.90.1` returns `N 0`; `npm pkg get version --workspaces` returns `0.90.1` for all packages.

**Acceptance**:
1. `v0.90.1` is an ancestor of `main`.
2. All workspace versions equal `0.90.1` before the release bump.
3. No released changelog section was edited.

---

### Requirement 3 - Dependency security pass (Priority: P2)

**Agent**: coder / security
**Skills**: programming
**Evidence Gate**: command-pass
**Risk**: medium

**What**: Resolve the 3 HIGH advisories (`esbuild` GHSA-g7r4-m6w7-qqqr, `protobufjs` GHSA-f38q-mgvj-vph7 / GHSA-wcpc-wj8m-hjx6, `undici` multiple) with pinned bumps via `npm install --ignore-scripts`; regenerate lockfile and shrinkwrap.
**Verify**: `npm audit` reports 0 high; `npm run check` and `bash test.sh` pass.

---

### Requirement 4 - Release-surface docs refresh (Priority: P2)

**Agent**: coder / reviewer
**Skills**: docs
**Evidence Gate**: command-pass
**Risk**: low

**What**: Update root `README.md` and `packages/coding-agent/README.md` (v0.80.8 badges/links/assets → v0.90.2), add `.github/RELEASE_NOTES_v0.90.2.md`, and complete the `/cl` changelog audit on the latest `main` commit.
**Verify**: `node scripts/check-release-consistency.mjs` ok; no non-historical `v0.80.8` references remain in release surfaces.

---

### Requirement 5 - npm trusted publishing repair (Priority: P1, user action)

**Agent**: operator (user) + reviewer
**Skills**: none (npmjs.com settings)
**Evidence Gate**: command-pass (post-release)
**Risk**: high

**What**: Configure npm Trusted Publisher for `open-multi-agent-kit`, `omk-ai`, `omk-agent-core`, `omk-tui`: repo `dmae97/open-multi-agent-kit`, workflow `build-binaries.yml`, environment `npm-publish`. Root cause: v0.90.1 `publish-npm` failed with E404 on PUT (OIDC rejection). Fallback: one-time manual `npm publish --ignore-scripts` per package.
**Verify**: the `v0.90.2` tag run's `publish-npm` job succeeds.

---

### Requirement 6 - Release v0.90.2 and upgrade the installed launcher (Priority: P1)

**Agent**: coder / qa
**Skills**: git-master
**Evidence Gate**: command-pass
**Risk**: high

**What**: Run the local release smoke, then `OMK_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch` (0.90.1 → 0.90.2). After CI publish, rebuild `/home/yu/omk` so the launcher at `~/.omk/agent/bin/omk` serves 0.90.2.
**Verify**: `npm view open-multi-agent-kit version` == `0.90.2` (and the other three); GitHub Release `v0.90.2` is Latest; `omk --version` reports 0.90.2.

## Expected Files

- `packages/*/CHANGELOG.md` — `/cl`-audited `[Unreleased]` → `[0.90.2]` sections (release script)
- `README.md`, `packages/coding-agent/README.md` — v0.90.2 release surface
- `.github/RELEASE_NOTES_v0.90.2.md` — GitHub release notes
- `package-lock.json`, `packages/coding-agent/npm-shrinkwrap.json` — pinned dep bumps + release refresh
- `.omo/plans/omk-v0.90.2-upgrade-20260702.md` — master plan (created)

## Verification Commands

- `npm run check` — full static gate (biome, tsgo, consistency, shrinkwrap, browser-smoke)
- `bash test.sh` — all non-e2e tests
- `node scripts/check-release-consistency.mjs` — release metadata drift
- `npm audit` — 0 high after Requirement 3
- `npm run release:local -- --out /tmp/omk-local-release --force` — pre-release smoke
- `gh run watch <v0.90.2 Build Binaries run> --exit-status` — CI publish
- `npm view open-multi-agent-kit version` — post-release npm state

## Assumptions

- Upstream `badlogic/pi-mono` (latest `v0.80.3`) is not a sync target; 0.90.x is OMK-native.
- `omk-adaptorch-wpl` remains private and unpublished.
- npmjs.com trusted-publisher settings are user-controlled and outside agent scope.
- The accepted permanent gap: `0.90.1` never ships on npm.
