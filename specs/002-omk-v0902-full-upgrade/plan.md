# Implementation Plan: OMK v0.90.2 Full Upgrade

**Branch**: `002-omk-v0902-full-upgrade` | **Date**: 2026-07-02 | **Spec**: `specs/002-omk-v0902-full-upgrade/spec.md`
**OMK Preset**: `omk`
**Master plan**: `.omo/plans/omk-v0.90.2-upgrade-20260702.md`

## Summary

Bring the repo from the current split state (main at 0.90.0 with a 114-file WIP; v0.90.1 tag/GitHub release orphaned off main; npm stuck at 0.90.0 due to a failed OIDC trusted-publishing job) to a single consistent v0.90.2 release across git, GitHub, npm, and the locally installed launcher. Order matters: land WIP → merge v0.90.1 → dep security → docs/`/cl` → publish-infra fix (user) → local smoke → `release:patch` → verify → rebuild local dist.

## Runtime Inventory

- **Harness**: not present (plain repo session; `.omk/runs/` used for evidence only)
- **MCP Scope**: project (`github` via `gh` CLI, filesystem)
- **Skills**: git-master, programming, debugging (CI logs)
- **Authority**: operator (user) is final approver for release execution and npmjs.com settings; agent prepares and verifies.

## Agent Routing

| Phase | Primary Role | Secondary Roles | Evidence Gate |
|-------|--------------|-----------------|---------------|
| WIP landing | coder | reviewer | command-pass |
| Lineage merge | coder | reviewer | command-pass |
| Dep security | coder | security | command-pass |
| Docs refresh | coder | reviewer | command-pass |
| Publish infra | operator (user) | reviewer | command-pass (post-tag CI) |
| Release + verify | qa | coder | command-pass |

## Project Structure

```text
packages/{agent,ai,coding-agent,tui,adaptorch-wpl}/   # lockstep 0.90.1 → 0.90.2
README.md, packages/coding-agent/README.md            # release surface v0.90.2
.github/RELEASE_NOTES_v0.90.2.md                      # new release notes
package-lock.json, packages/coding-agent/npm-shrinkwrap.json
.omo/plans/omk-v0.90.2-upgrade-20260702.md            # master plan + evidence log
specs/002-omk-v0902-full-upgrade/                     # this spec set
```

## Complexity Check

| Concern | Decision | Rationale |
|---------|----------|-----------|
| New dependencies | none (bumps only) | undici/protobufjs/esbuild HIGH advisories; pinned, `--ignore-scripts` |
| Breaking changes | No | patch release; WIP is additive per `[Unreleased]` changelogs |
| Parallel tasks | 2 lanes max | dep-security and docs-refresh can parallelize after the merge; release is strictly serial |
| MCP/secret exposure | None | npm OIDC config stays on npmjs.com; no tokens in artifacts |

## Decision Log

- Merge tag `v0.90.1` into `main` (not rebase, not re-tag): released tags are immutable and `release:patch` from 0.90.0 would collide with the existing `v0.90.1` tag.
- Ship the WIP as the v0.90.2 payload: its features are already described under `[Unreleased]` in the package changelogs.
- CI trusted publishing is the primary npm path; manual pinned `npm publish --ignore-scripts` is the documented fallback only.
- `0.90.1` stays permanently unpublished on npm; accepted and documented.

## Quality Gates

- **Static**: `npm run check` (biome, pinned-deps, ts-imports, release-consistency, shrinkwrap, tsgo, browser-smoke)
- **Tests**: `bash test.sh` (non-e2e suites; 658/0 baseline green on 2026-07-02)
- **Security**: `npm audit` → 0 high; scheduled npm-audit workflow returns green
- **Release smoke**: `npm run release:local -- --out /tmp/omk-local-release --force` + node/bun `--help|--version|--list-models|-p` + tmux interactive
- **Publish**: `gh run watch` v0.90.2 Build Binaries (`publish-npm` pass); `npm view` × 4 == 0.90.2
- **Local runtime**: `npm run build` then `omk --version` == 0.90.2 via `~/.omk/agent/bin/omk`
