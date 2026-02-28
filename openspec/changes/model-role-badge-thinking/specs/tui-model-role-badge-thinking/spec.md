## ADDED Requirements

### Requirement: /model role badges MUST show explicit thinking effort inline

When rendering a model row in `/model`, the UI MUST display each matching built-in role badge.

If the role is configured with an explicit thinking level (via a ModelSpec `:<thinkingLevel>` suffix), the UI MUST append a short thinking-effort annotation immediately after the badge, separated by a space (e.g. `[SMOL] (min)`).

If the role has no explicit thinking suffix ("default" mode), the UI MUST NOT append a thinking-effort annotation.

#### Scenario: Explicit thinking effort is shown after the role badge
- **WHEN** a model row is rendered for a model assigned to the `smol` role
- **AND** `modelRoles.smol` is configured with an explicit thinking suffix (e.g. `provider/model:minimal`)
- **THEN** the row MUST include the `smol` role badge followed by a thinking annotation (e.g. `[SMOL] (min)`)

#### Scenario: Default/no-suffix role does not show an effort annotation
- **WHEN** a model row is rendered for a model assigned to the `commit` role
- **AND** `modelRoles.commit` is configured without a thinking suffix (e.g. `provider/model`)
- **THEN** the row MUST include the `commit` role badge
- **AND** the row MUST NOT include a thinking-effort annotation for that badge

### Requirement: Thinking-effort annotations MUST use a compact display mapping

The thinking-effort annotation text MUST be derived from the configured thinking level using this mapping:
- `minimal` → `min`
- `off|low|medium|high|xhigh` → render the level name as-is

#### Scenario: Minimal is displayed as min
- **WHEN** a role is configured with explicit thinking `:minimal`
- **THEN** the badge annotation MUST render as `(min)`

#### Scenario: Medium is displayed as medium
- **WHEN** a role is configured with explicit thinking `:medium`
- **THEN** the badge annotation MUST render as `(medium)`

### Requirement: /model details MUST NOT duplicate per-role thinking in a separate section

The `/model` details panel MUST NOT display a dedicated per-role thinking list/section (e.g. a "Role Thinking" block) if that information is already presented inline next to role badges.

#### Scenario: Details panel does not show a Role Thinking section
- **WHEN** a model row is highlighted in `/model`
- **THEN** the details panel MUST NOT render a dedicated "Role Thinking" section
