## ADDED Requirements

### Requirement: /model list MUST remain one row per concrete model
The `/model` window (Model Selector) SHALL render each available concrete model exactly once.

Role assignments (default/smol/slow/plan/commit) MUST be displayed as role badges on the model row, and the UI MUST NOT duplicate model rows to represent role or thinking differences.

#### Scenario: Same model used by multiple roles does not create duplicate rows
- **WHEN** `modelRoles.default` and `modelRoles.plan` both resolve to the same concrete model
- **THEN** the `/model` list MUST show a single row for that model
- **AND** the row MUST display both role badges

### Requirement: /model details MUST display per-role thinking for the highlighted model
When a model row is highlighted in `/model`, the UI MUST display which built-in roles currently resolve to that model.

For each matching role, the UI MUST display the role’s configured thinking mode:
- the explicit thinking level if the role ModelSpec includes `:<thinkingLevel>`
- otherwise `default` (no explicit override; preserve current session thinking except for capability clamping)

#### Scenario: Distinct thinking per role is visible in details
- **WHEN** `modelRoles.plan` is configured as `provider/model:high`
- **AND** `modelRoles.default` is configured as `provider/model:medium`
- **AND** the user highlights `provider/model` in `/model`
- **THEN** the details panel MUST show both roles and their respective thinking levels (`plan: high`, `default: medium`)

### Requirement: Assigning a model to a role MUST prompt for thinking selection
When the user selects the action “Set as <role>” in `/model`, the UI MUST prompt for thinking configuration for that role.

The thinking selection menu MUST:
- include `default`, `off`, `minimal`, `low`, `medium`, `high`
- include `xhigh` only when supported by the selected model
- preselect the role’s current configured thinking mode

#### Scenario: Thinking selection includes default and existing global levels
- **WHEN** the user selects “Set as plan” for a thinking-capable model
- **THEN** the UI MUST offer `default|off|minimal|low|medium|high` at minimum

### Requirement: Role assignment MUST persist as ModelSpec string in config.yml
After choosing a model and thinking mode for a role, the UI MUST persist the role value to `config.yml` as:
- `provider/modelId` if thinking mode is `default`
- `provider/modelId:<thinkingLevel>` if thinking mode is an explicit thinking level (including `off`)

#### Scenario: Persist default without suffix
- **WHEN** the user assigns a model to the `smol` role
- **AND** the user selects thinking mode `default`
- **THEN** `modelRoles.smol` MUST be persisted without a thinking suffix

#### Scenario: Persist explicit thinking with suffix
- **WHEN** the user assigns a model to the `plan` role
- **AND** the user selects thinking mode `high`
- **THEN** `modelRoles.plan` MUST be persisted with suffix `:high`

### Requirement: Setting the default role MUST update the active session model (and thinking when explicit)
When assigning a model to the `default` role via `/model` (non-temporary):
- the active session model MUST switch to the selected model
- if an explicit thinking level was selected, the active session thinking MUST be set to that level
- if `default` was selected, the active session thinking MUST remain unchanged (except for clamping)

#### Scenario: Setting default with explicit thinking updates session thinking
- **WHEN** the user assigns a model to the `default` role
- **AND** the user selects thinking mode `minimal`
- **THEN** the active session thinking MUST become `minimal`


#### Scenario: Setting default with default thinking preserves current thinking
- **WHEN** the user assigns a model to the `default` role
- **AND** the user selects thinking mode `default`
- **AND** the active session thinking is `high`
- **THEN** the active session thinking MUST remain `high` (unless clamped by model capability)
### Requirement: /model MUST only expose built-in roles
The `/model` UI MUST only expose built-in roles (`default`, `smol`, `slow`, `plan`, `commit`) for viewing and editing.

#### Scenario: Custom role keys are not shown in /model
- **WHEN** `config.yml` contains additional non-built-in keys under `modelRoles`
- **THEN** the `/model` UI MUST NOT show those keys as role badges or role assignment actions
