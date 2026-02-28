## Context

The `/model` window (Model Selector) is the primary place users inspect and edit role → model assignments.

After adding per-role thinking effort configuration, the UI currently shows per-role thinking in a separate details-panel block ("Role Thinking:"), which is visually disconnected from the row-level role badges that users scan first.

This change adjusts the presentation only; it does not change how ModelSpec thinking is parsed, persisted, or applied.

## Goals / Non-Goals

**Goals:**
- Make role + thinking effort configuration glanceable directly from the model list rows.
- Keep the list one-row-per-model (no duplication) and avoid adding a second “thinking” table/section.
- Preserve existing semantics:
  - explicit `:<thinking>` continues to override session thinking when selecting that role
  - no suffix (“default” mode) continues to mean “no explicit override” (preserve current session thinking except for capability clamping)

**Non-Goals:**
- Changing ModelSpec syntax, thinking level semantics, or precedence rules.
- Adding new thinking levels or provider-specific controls.
- Reworking `/model` navigation, sorting, or role assignment flow.

## Decisions

1) **Display thinking effort adjacent to role badges**

- Decision: Render thinking effort as a short dim annotation immediately following the role badge: `[SMOL] (min)`.
- Rationale: Matches the user’s scanning behavior (badge first), keeps the badge styling intact, and avoids a dedicated details section.
- Alternatives:
  - Put effort inside the badge (`[SMOL min]`): compact, but badge becomes harder to scan and may overflow more often.
  - Render a separate “effort badge” (`[SMOL] [min]`): clearer than parentheses, but visually heavier.
  - Keep the details-panel block: lowest effort but does not solve glanceability.

2) **Only annotate non-default thinking modes**

- Decision: If a role’s thinking mode is `default` (no explicit suffix), do not append a `(...)` annotation.
- Rationale: Reduces clutter and width; explicit overrides are the important exceptions to call out.
- Trade-off: Users can’t distinguish “default (no suffix)” vs “not configured / unknown” purely from the row. The role badge still indicates assignment; thinking can be inspected by entering the role assignment flow.

3) **Abbreviation rules**

- Decision: Keep annotations compact; minimum mapping:
  - `minimal` → `min`
  - other levels (`off|low|medium|high|xhigh`) render as-is
- Rationale: Aligns with the example (`min`) and avoids inventing a full new shorthand vocabulary.
- Alternative: abbreviate `medium` → `med`, `xhigh` → `xhi`, etc. (more compact but introduces new conventions).

4) **Remove the dedicated details-panel “Role Thinking” section**

- Decision: Remove the block that lists roles and thinking effort in the details panel.
- Rationale: Prevent duplicated information and keeps the details panel focused on model metadata.

## Risks / Trade-offs

- **[Risk] Row width increases and truncation hides badges/annotations** → **Mitigation:** only annotate non-default modes; keep abbreviations minimal; ensure existing truncation behavior remains correct.
- **[Risk] Parentheses styling clashes with badge ANSI styling** → **Mitigation:** render annotation as separate dim text after the badge string (not inside the inverted badge).
- **[Risk] Users interpret missing annotation as “off” or “unknown”** → **Mitigation:** annotate `off` explicitly; consider adding a short help hint in the menu header if confusion persists.
