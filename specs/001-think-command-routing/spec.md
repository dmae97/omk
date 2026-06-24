# Feature Specification: Think Command Routing

**Feature Branch**: `001-think-command-routing`
**Created**: 2026-06-18
**Status**: Draft
**Input**: Add `/think` and route `/model` selections into thinking-level selection in the canonical `/home/yu/omk` runtime.
**OMK Preset**: `omk`

## Requirements

### Requirement 1 - `/think` command (Priority: P1)

**Agent**: coder
**Skills**: omk-typescript-strict, omk-code-review
**Evidence Gate**: command-pass
**Risk**: low

**What**: Add `/think` as a built-in slash command in interactive mode.

**Acceptance**:
1. `/think` appears in built-in slash command metadata.
2. `/think` opens the thinking-level selector.
3. `/think <level>` applies a valid level from `session.getAvailableThinkingLevels()`.
4. Invalid levels show an error and do not change state.

### Requirement 2 - `/model` to thinking selector routing (Priority: P1)

**Agent**: coder
**Skills**: omk-typescript-strict
**Evidence Gate**: command-pass
**Risk**: medium

**What**: After model selection through `/model` selector or exact `/model <provider/model>` command, route the editor area to the same thinking-level selector.

**Acceptance**:
1. Successful model selection still persists model/provider settings.
2. Successful model selection opens the thinking selector.
3. Model auth or selection errors do not open the thinking selector.

### Requirement 3 - Runtime root clarity (Priority: P1)

**Agent**: reviewer
**Skills**: omk-docs-release
**Evidence Gate**: file-exists
**Risk**: low

**What**: Record that the installed launcher uses `/home/yu/omk` and requires a package build to update `dist/`.

**Acceptance**:
1. `specs/constitution.md` states the canonical runtime root and build rule.
2. User-facing docs mention `/think` and the `/model` → thinking selector flow.

## Expected Files

- `packages/coding-agent/src/core/slash-commands.ts` — built-in `/think` metadata.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — command handling and routing.
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts` — reusable thinking selector component.
- `packages/coding-agent/test/thinking-selector.test.ts` — regression coverage.
- `packages/coding-agent/docs/usage.md` — slash command docs.
- `packages/coding-agent/docs/quickstart.md` — model-switching docs.
- `specs/constitution.md` — canonical runtime/build rule.

## Verification Commands

- `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/thinking-selector.test.ts`
- `npm run check`
- `npm run build`

## Assumptions

- The user wants changes applied to `/home/yu/omk`, the canonical runtime checkout.
- The current OMK TUI must be restarted after build to load updated `dist/` files.
