# Feature Specification: Harness Control Plane VNext P0

**Feature Branch**: `001-harness-control-plane-vnext`  
**Created**: 2026-06-18  
**Status**: Draft  
**Input**: User requested a deterministic, transactional, auditable Harness Control Plane across compaction continuity, interactive model/theme state, and extension compatibility diagnostics.

## Agent-Oriented Requirements

### Requirement 1 - Compaction budget and summary contract validation (Priority: P0)

**Agent**: coder  
**Skills**: test-driven-development, ddd-software-architecture  
**MCP**: adaptorch, filesystem  
**Evidence Gate**: command-pass  
**Risk**: medium

**What**: Include previous summary, base prompt, custom instructions, system prompt, XML wrappers, and tokenizer margin in summary input budget. Add deterministic summary contract validation/fallback for required sections.  
**Verify**: focused compaction tests and `npm run check`.

**Acceptance**:
1. Very large `previousSummary` reduces conversation packing budget.
2. Summary output missing required sections is repaired or falls back deterministically.
3. Korean failure/decision/evidence keywords receive high-signal packing weight.

### Requirement 2 - Interactive state transaction P0 (Priority: P0)

**Agent**: coder  
**Skills**: test-driven-development  
**MCP**: adaptorch, filesystem  
**Evidence Gate**: command-pass  
**Risk**: high

**What**: Prevent invalid theme persistence and avoid model selector writing default settings before session model changes complete.  
**Verify**: focused interactive tests.

**Acceptance**:
1. `ModelSelectorComponent` selection does not persist settings directly.
2. Settings theme change persists only after `setTheme()` succeeds.
3. Existing extension UI invalid-theme behavior remains unchanged.

### Requirement 3 - Compatibility classifier P0 (Priority: P0)

**Agent**: coder  
**Skills**: test-driven-development  
**MCP**: adaptorch, filesystem  
**Evidence Gate**: command-pass  
**Risk**: medium

**What**: Replace boolean legacy extension detection internals with structured tri-state diagnostics, inspect both `pi` and `omk` manifests, and expand source extension detection.  
**Verify**: migration deprecation tests.

**Acceptance**:
1. Manifests with both `pi` and `omk` inspect both.
2. `.mjs`, `.cjs`, `.mts`, `.cts`, `.tsx`, `.jsx` entrypoints warn.
3. Malformed `package.json` yields unknown structured diagnostic but does not emit a false legacy warning.

## Expected Files

- `packages/coding-agent/src/core/compaction/compaction.ts`
- `packages/coding-agent/src/modes/interactive/components/model-selector.ts`
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/migrations.ts`
- `packages/coding-agent/test/compaction.test.ts`
- `packages/coding-agent/test/interactive-mode-status.test.ts`
- `packages/coding-agent/test/suite/regressions/3217-scoped-model-order.test.ts`
- `packages/coding-agent/test/migrations-deprecation.test.ts`

## Verification Commands

- `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/compaction.test.ts test/interactive-mode-status.test.ts test/migrations-deprecation.test.ts test/suite/regressions/3217-scoped-model-order.test.ts`
- `npm run check`

## Assumptions

- P0 slices are implemented first; semantic-unit optimizer, scoped keybinding router, bounded extension scanner, migration dry-run/apply, and JSONL event ledger follow-ups are covered by T010-T013.
- No new runtime dependency is required.
