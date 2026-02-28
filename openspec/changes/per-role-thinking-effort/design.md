## Context

OMP today has two separate concepts:
- **Model selection** (what model to call): persisted via `modelRoles` in `~/.omp/agent/config.yml` and manipulated via the `/model` (Model Selector) UI.
- **Thinking level** (reasoning effort for thinking-capable models): persisted globally via `defaultThinkingLevel` and optionally modified per-session via thinking-level changes (session history).

This creates a gap for role-based workflows:
- A role (default/smol/slow/plan/commit) can point to a model, but cannot encode role-specific thinking effort.
- Multiple flows consume role aliases (`pi/<role>`) (notably subagents), so “role thinking” needs to propagate consistently, not just for the interactive session.

Constraints and existing behavior to preserve:
- Thinking levels are exactly: `off|minimal|low|medium|high|xhigh` (no new levels, none removed).
- Existing parsing for `pattern:thinkingLevel` already exists for `enabledModels` and override patterns.
- TUI must avoid duplicated model rows; the model list should remain one row per model.
- Support only built-in roles in the UI for now; custom keys may exist in YAML but are not editable in TUI.

## Goals / Non-Goals

**Goals:**
- Treat each built-in model role as a **profile** that can optionally specify thinking effort.
- Extend `modelRoles` config value syntax to allow `provider/modelId[:thinkingLevel]`, including `:off`.
- Ensure role switching applies role thinking whenever explicitly configured (always overwriting session thinking on role switch).
- Ensure per-agent model overrides can explicitly override thinking (override wins over agent frontmatter `thinking-level`).
- Update the existing `/model` UI to:
  - Display current per-role thinking configuration for the highlighted model.
  - Allow selecting thinking level when assigning a model to a role.

**Non-Goals:**
- Adding a new “Models” pane in `/settings` (we will keep all role configuration in `/model`).
- Editing arbitrary/custom role keys in TUI.
- Changing memory-extraction thinking usage (memories uses fixed reasoning in code).
- Introducing provider-specific new thinking levels or budgets beyond existing global knobs.

## Decisions

### 1) Persist role thinking in the existing model string (ModelSpec)
**Decision:** encode per-role thinking as an optional suffix in the role value string:
- `ModelSpec := <pattern-or-id>[:<thinkingLevel>]`
- `thinkingLevel ∈ {off,minimal,low,medium,high,xhigh}`

**Rationale:**
- Matches existing patterns already in the repo (`enabledModels`, model override patterns).
- Backwards compatible: suffix is optional.
- Avoids introducing additional settings keys or structured YAML objects.

**Alternatives considered:**
- Structured object per role (e.g. `{ model: ..., thinking: ... }`): clearer but larger schema/UI work and inconsistent with existing `pattern:level` usage.
- Separate `modelRoleThinkingLevels` map: avoids suffix parsing but adds parallel configuration and increases cognitive load.

### 2) Centralize parsing via existing pattern parser (exact-match-first)
**Decision:** interpret `modelRoles.<role>` values using the existing `parseModelPatternWithContext` algorithm (exact match first, then treat last `:` as thinking suffix only if it’s a valid thinking level).

**Rationale:**
- Correctly handles model IDs that include colons (OpenRouter-style), by only treating the last colon as thinking if exact match fails.
- Avoids brittle string splitting.

**Alternatives considered:**
- Modify `parseModelString` to strip a thinking suffix unconditionally: simpler, but potentially ambiguous for providers/models that legitimately end in `:high` and lacks the exact-match guard.

### 3) Make `:off` an explicit override everywhere
**Decision:** treat `:off` as a real explicit thinking override, both in `modelRoles` and `task.agentModelOverrides`.

**Rationale:**
- `off` is part of the existing global thinking toggle set.
- Users must be able to explicitly request no reasoning per role/override (best-effort; providers may still apply internal reasoning/defaults).

### 4) `/model` is the sole built-in role editor (no Settings ▸ Models pane)
**Decision:** extend Model Selector to edit thinking as part of “Set as <role>”.

**Rationale:**
- `/settings` cannot represent `record` settings today.
- `/model` already owns “assign model to role” and is the natural place to treat roles as (model + thinking) profiles.

### 5) TUI display: single model row + details show role thinking
**Decision:** keep **one row per model** and show role thinking in the details area for the highlighted model.

**Example:** if `default` and `plan` point to the same model but different thinking, show both role badges on the row, and show per-role thinking in the details panel.

**Alternatives considered:**
- Duplicate model rows by (model,role) or (model,thinking): makes search/navigation confusing and breaks the model list mental model.

### 6) Subagent thinking precedence
**Decision:** explicit thinking in `task.agentModelOverrides[agentName]` wins over agent frontmatter `thinking-level`.

**Rationale:**
- This is required for “thinking customization for agent overrides” to be real.
- Bundled agents often set default thinking; override must be able to supersede it.

**Note:** we do not introduce “carry-forward parent session thinking” as a default for subagents; agent frontmatter defaults remain in effect unless overridden via explicit thinking in overrides or via role-based ModelSpec.

## Risks / Trade-offs

- **[Risk] Missed callsite continues strict parsing of `provider/modelId` and breaks when suffix is present** → **Mitigation:** centralize ModelSpec parsing helpers and add tests covering all major flows (startup, role switching, /model UI, subagent overrides).
- **[Risk] Ambiguous `:high` in real model IDs** → **Mitigation:** use exact-match-first parsing with the available model registry.
- **[Risk] Config churn: existing writers overwrite role strings and drop suffix** → **Mitigation:** ensure all writers that update `modelRoles.<role>` preserve existing thinking suffix unless explicitly changed.
- **[Risk] UI complexity (extra thinking submenu)** → **Mitigation:** preselect current thinking for the role; Enter defaults to “keep current”; hide unsupported options.

## Migration Plan

- No automatic migration required: existing configs remain valid.
- After change, `/model` will write role values as `provider/modelId[:thinking]`.
- Users downgrading to older OMP versions should remove thinking suffixes manually (older versions will treat suffix as part of the model id).

## Open Questions

- Should the `/model` action menu display current thinking inline (e.g. `Set as Plan (thinking: high)`) in addition to the details panel?
- How should the UI display roles whose stored value is a pattern that resolves ambiguously (advanced config)? (Initial approach: UI stores exact models; display best-effort only.)
