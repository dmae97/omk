## ADDED Requirements

### Requirement: ModelSpec supports optional thinking level suffix
The system SHALL support a ModelSpec string format for configurable model references:

- `ModelSpec := <model-pattern-or-id>[:<thinkingLevel>]`
- `thinkingLevel` MUST be one of: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- If no `:thinkingLevel` suffix is present, the ModelSpec SHALL be treated as having **no explicit thinking override**.

#### Scenario: Valid thinking suffix is recognized
- **WHEN** a configuration value is set to `openai-codex/gpt-5.3-codex:high`
- **THEN** the system MUST interpret the configured thinking level as `high`

#### Scenario: No suffix means no explicit override
- **WHEN** a configuration value is set to `openai-codex/gpt-5.3-codex`
- **THEN** the system MUST treat the ModelSpec as having no explicit thinking override

### Requirement: ModelSpec parsing MUST be exact-match-first for colon-containing model IDs
When resolving a ModelSpec against an available model registry, the system MUST:
1) Attempt to resolve the full string as a model identifier/pattern first.
2) Only if that fails, interpret the final `:<suffix>` as a thinking level **when** `<suffix>` is a valid thinking level.

This SHALL prevent mis-parsing model IDs that contain colons as part of the ID.

#### Scenario: Exact model ID containing colons is not treated as thinking
- **WHEN** a model registry contains a model whose identifier matches a string containing colons (e.g. `provider/model:tag`)
- **AND** a ModelSpec is set to that exact identifier (no extra suffix)
- **THEN** the system MUST resolve the model without interpreting `:tag` as a thinking level

#### Scenario: Trailing valid thinking suffix applies when full identifier does not resolve
- **WHEN** a ModelSpec is set to `provider/model:tag:high`
- **AND** `provider/model:tag:high` does not resolve to an exact model identifier
- **THEN** the system MUST resolve the model using `provider/model:tag`
- **AND** the system MUST set the explicit thinking override to `high`

### Requirement: Switching to a role with explicit thinking MUST overwrite session thinking
If a built-in role is configured with an explicit thinking override in its ModelSpec, switching to that role MUST update the session’s thinking level to the configured value every time.

If the role has no explicit thinking override ("default" mode in UI), switching to the role MUST NOT change the session thinking level (except for capability clamping).

#### Scenario: Switching to a role with explicit thinking overwrites thinking
- **WHEN** the `plan` role is configured with an explicit thinking override (e.g. `:high`)
- **AND** the user switches to the `plan` role
- **THEN** the system MUST set the session thinking level to `high`

#### Scenario: Switching to a role without explicit thinking preserves current thinking
- **WHEN** the `default` role is configured without a thinking suffix
- **AND** the session thinking level is currently `minimal`
- **AND** the user switches to the `default` role
- **THEN** the session thinking level MUST remain `minimal` (unless clamped by model capability)

### Requirement: Explicit thinking level `off` MUST be supported
`off` is a valid explicit thinking level meaning "no reasoning requested".

If a ModelSpec includes `:off`, the system MUST:
- set the session thinking level to `off`, and
- omit any reasoning/thinking configuration from subsequent model invocations (i.e., do not request a reasoning effort/budget).

Note: providers/models MAY still apply internal reasoning or defaults; this requirement only constrains request intent and session state.

#### Scenario: Role config explicitly disables thinking
- **WHEN** `modelRoles.smol` is configured as `openai-codex/gpt-5.3-codex:off`
- **AND** the user switches to the `smol` role
- **THEN** the session thinking level MUST become `off`

### Requirement: Task subagent overrides MUST allow explicit thinking to override agent defaults
When spawning subagents via the task system:
- If `task.agentModelOverrides[agentName]` includes an explicit `:thinkingLevel`, that thinking level MUST override the agent definition’s frontmatter `thinking-level`.
- If the override does not include explicit thinking, the agent definition’s frontmatter `thinking-level` MUST apply.

#### Scenario: Override thinking wins over agent frontmatter
- **WHEN** an agent definition sets `thinking-level: minimal`
- **AND** `task.agentModelOverrides[agentName]` is configured as `provider/model:high`
- **THEN** the spawned subagent MUST run with thinking level `high`

#### Scenario: Agent frontmatter applies when override has no thinking
- **WHEN** an agent definition sets `thinking-level: minimal`
- **AND** `task.agentModelOverrides[agentName]` is configured as `provider/model` (no thinking suffix)
- **THEN** the spawned subagent MUST run with thinking level `minimal`

### Requirement: Thinking level MUST be clamped to model capabilities
When applying a thinking level to a model:
- If the selected model does not support reasoning, the effective thinking level MUST be `off`.
- If the selected model does not support `xhigh`, a configured `xhigh` MUST be clamped to `high`.

#### Scenario: xhigh clamps to high when unsupported
- **WHEN** a thinking-capable model does not support `xhigh`
- **AND** the configured thinking level is `xhigh`
- **THEN** the effective thinking level MUST be `high`
