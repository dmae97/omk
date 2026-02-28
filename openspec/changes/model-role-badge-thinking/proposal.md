## Why

The `/model` window currently surfaces per-role thinking effort in a separate "Role Thinking:" block in the details panel, which is easy to miss and visually disconnected from the role badges users scan first.

Placing thinking effort next to each role badge makes role+effort configuration glanceable and reduces UI clutter.

## What Changes

- Update `/model` model rows so each role badge may be followed by a short thinking effort annotation, e.g. `[SMOL] (min) [COMMIT] (medium)`.
- Remove the dedicated "Role Thinking:" details section (the information is now colocated with badges).
- Define a compact display mapping for thinking levels (e.g. `minimal` → `min`) while keeping config semantics unchanged.
- Preserve existing behavior for roles with no explicit thinking suffix ("default" mode): no explicit override is applied; thinking is only clamped to model capability.

## Capabilities

### New Capabilities
- `tui-model-role-badge-thinking`: Display per-role thinking effort next to role badges in `/model` and define the abbreviation/display rules.

### Modified Capabilities
- (none)

## Impact

- Primary code surface: `packages/coding-agent/src/modes/components/model-selector.ts` (row rendering + details panel content).
- Secondary code surface: any shared badge/formatting helpers (if extracted) and potentially the theme/styling for dim annotations.
- Tests: likely lightweight unit tests for the thinking-level → display-label mapping (avoid brittle ANSI snapshot tests).
