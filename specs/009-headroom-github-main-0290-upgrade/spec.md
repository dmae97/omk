# Feature Specification: Headroom GitHub Main 0.29.0 Upgrade

**Feature Branch**: `009-headroom-github-main-0290-upgrade`  
**Created**: 2026-07-03  
**Status**: Completed  
**Input**: User request: `github.com/headroomlabs-ai/headroom` main branch upgrade, current main package version `0.29.0`  
**OMK Preset**: `omk`

## Agent-Oriented Requirements

### Requirement 1 - Headroom GitHub main version recognition (Priority: P1)

**Agent**: `omk-coder`  
**Skills**: `programming`, `headroom`  
**MCP**: `filesystem`  
**Evidence Gate**: targeted test pass  
**Risk**: low

**What**: Control panel Headroom runtime status must recognize upstream `github.com/headroomlabs-ai/headroom` version output, including current main `0.29.0`, while preserving forward-compatible `3.0` parsing and legacy `headroom-ai` 0.x output.

**Verify**:
1. Version parser accepts `github.com/headroomlabs-ai/headroom 3.0` and returns `3.0`.
2. Version parser accepts semver patch output such as `headroom version 0.29.0`.
3. Legacy output such as `headroom, version 0.22.4` remains supported.
4. Runtime display shows the installed version truthfully; after the requested upgrade it reports `headroom:0.29.0`.

**Acceptance**:
- `headroom --version` remains the first runtime source.
- `headroom version` is tried as a secondary CLI form.
- Python distribution metadata prefers `headroom` before legacy `headroom-ai`.
- The package upgrade itself is performed outside the repo package graph and does not edit `package.json` or lockfiles.

---

### Requirement 2 - Control panel fixture refresh (Priority: P2)

**Agent**: `omk-coder`  
**Skills**: `programming`  
**Evidence Gate**: targeted test pass  
**Risk**: low

**What**: Static control-panel reference fixtures should reflect the installed GitHub main version.

**Verify**:
- `control-panel-header.test.ts` and `control-panel-reference-fidelity.test.ts` use `headroom:0.29.0` for static snapshots.

---

### Requirement 3 - Spec-kit traceability (Priority: P1)

**Agent**: `omk-coder`  
**Skills**: `docs-write-concisely`  
**Evidence Gate**: file-exists  
**Risk**: low

**What**: Add `spec.md`, `plan.md`, and `tasks.md` for the Headroom GitHub main 0.29.0 upgrade.

**Verify**:
- Files exist under `specs/009-headroom-github-main-0290-upgrade/`.
- No secrets, raw prompts, `.env` data, tokens, or private runtime inventories are embedded.

## Expected Files

- `packages/coding-agent/src/modes/interactive/components/control-panel-runtime-status.ts` — Headroom version detection and parser.
- `packages/coding-agent/test/control-panel-runtime-status.test.ts` — parser/stable MCP/non-hub skill tests.
- `packages/coding-agent/test/control-panel-header.test.ts` — static header fixture update.
- `packages/coding-agent/test/control-panel-reference-fidelity.test.ts` — static reference fixture update.
- `specs/009-headroom-github-main-0290-upgrade/{spec.md,plan.md,tasks.md}` — spec-kit traceability.

## Verification Commands

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/control-panel-runtime-status.test.ts test/control-panel-header.test.ts test/control-panel-reference-fidelity.test.ts`
- `npm run check`

## Assumptions

- GitHub main currently declares `headroom-ai` package version `0.29.0`; no `3.0` tag/release was found.
- The PATH-leading `~/.local/bin/headroom` symlink is updated to the pyenv-installed 0.29.0 CLI, with the previous uv tool symlink preserved as a backup.
