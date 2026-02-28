## Why

OMP already supports a global `defaultThinkingLevel`, but role-based model workflows (`modelRoles`) cannot encode role-specific thinking effort. This makes it hard to express real-world “same base model, different reasoning profile” setups (issue #186).

We want role switching (default/smol/slow/plan/commit) to be a true profile switch: model selection + (optional) thinking effort, with consistent behavior across interactive sessions and subagents.

## What Changes

- Allow `config.yml` `modelRoles` entries to include an optional thinking suffix using the existing thinking levels:
  - `provider/modelId[:off|minimal|low|medium|high|xhigh]`
  - No new thinking levels introduced; none removed.
- Treat `:off` as a meaningful explicit override (not ignored).
- Apply role-specific thinking on role switch:
  - When switching to a role whose config includes an explicit thinking level, the session thinking level is overwritten every time (and clamped to model capabilities).
- Make per-agent model overrides fully control thinking when explicitly specified:
  - `task.agentModelOverrides[agentName] = "…:thinking"` overrides agent frontmatter `thinking-level`.
- Update the existing `/model` window (Model Selector) to both display and edit per-role thinking:
  - Keep a single row per concrete model (no duplicates).
  - Show which roles point at the highlighted model, including each role’s configured thinking.
  - Add a thinking selection step when assigning a model to a role.
  - Support only built-in roles in the UI for now.
- Preserve existing behavior for configs without suffixes.

## Capabilities

### New Capabilities
- `model-spec-thinking`: Define a unified **ModelSpec** grammar and semantics for all configurable model strings, including thinking suffix parsing, precedence, and clamping.
- `tui-model-role-config`: Define `/model` TUI behavior for viewing/editing built-in role profiles (model + thinking) and how changes persist to `config.yml`.

### Modified Capabilities
- (none)

## Impact

- Config + model resolution (parsing, role expansion): `packages/coding-agent/src/config/model-resolver.ts`, settings accessors.
- Session model/thinking switching semantics: `packages/coding-agent/src/session/agent-session.ts`, startup selection in `packages/coding-agent/src/sdk.ts` and `src/main.ts`.
- Task/subagent execution precedence (thinking override wins): `packages/coding-agent/src/task/index.ts`, `packages/coding-agent/src/task/executor.ts`.
- TUI Model Selector: `packages/coding-agent/src/modes/components/model-selector.ts` and controller wiring.
- Tests and docs (README config example) updated to reflect the new `modelRoles` syntax.
