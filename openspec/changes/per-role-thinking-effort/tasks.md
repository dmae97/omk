## 1. ModelSpec parsing + resolution

- [x] 1.1 Add a ModelSpec resolver helper for role values (`modelRoles.<role>`) that can return: resolved concrete model (if any), explicit thinking level (including `off`), and whether thinking was explicitly specified.
- [x] 1.2 Update `resolveModelFromString(...)` to support `provider/modelId:<thinking>` by falling back to `parseModelPattern(...)` when the strict `provider/modelId` lookup fails.
- [x] 1.3 Update `resolveModelOverride(...)` to preserve explicit `off` and expose “explicit thinking provided” so downstream code can distinguish `default` (no explicit override) vs explicit `off`.

## 2. Apply ModelSpec to modelRoles consumers + writers

- [x] 2.1 Update interactive startup (`packages/coding-agent/src/sdk.ts`) to resolve `modelRoles.default` via ModelSpec and apply role thinking only when there is no existing thinking-level entry in session history.
- [x] 2.2 Update scoped-model startup selection (`packages/coding-agent/src/main.ts`) to match remembered default role model against scoped models while ignoring any configured thinking suffix.
- [x] 2.3 Update role switching (`AgentSession.cycleRoleModels`) to apply explicit role thinking on every switch (including explicit `off`), and preserve current thinking when role thinking is `default`.
- [x] 2.4 Update all code paths that write `modelRoles.<role>` (Model Selector, `AgentSession.setModel`, model cycling) to preserve an existing role’s thinking suffix unless the user explicitly changes thinking.

## 3. Subagent thinking precedence (task.agentModelOverrides)

- [x] 3.1 Update subagent execution (`packages/coding-agent/src/task/executor.ts`) so an explicit thinking suffix in `task.agentModelOverrides[agentName]` overrides agent frontmatter `thinking-level`.
- [x] 3.2 Ensure override previews (Agent Dashboard) correctly display explicit thinking, including `off`, using the updated resolution output.

## 4. TUI /model window: per-role thinking display + editing

- [x] 4.1 Extend Model Selector role state to track each built-in role’s configured thinking mode (`default` vs explicit level) in addition to model assignment.
- [x] 4.2 Update the Model Selector details panel to display “Roles on this model” with per-role thinking for roles that resolve to the highlighted model.
- [x] 4.3 Extend role assignment flow: after selecting “Set as <role>”, show a thinking submenu with options `default|off|minimal|low|medium|high` (+ `xhigh` when supported), preselected to the role’s current thinking.
- [x] 4.4 Persist role selection as `provider/modelId[:thinking]` (omit suffix for `default`) and update the active session model/thinking when setting the `default` role.

## 5. Tests, docs, verification

- [x] 5.1 Extend `packages/coding-agent/test/model-resolver.test.ts` to cover `:off`, `provider/model:thinking` fallback behavior, and colon-containing model IDs with thinking suffix.
- [x] 5.2 Add/update tests covering role switching thinking semantics (explicit thinking overwrites on every switch; `default` preserves), using existing session tests or a new focused test.
- [x] 5.3 Add/update tests for task/subagent thinking precedence: override `:thinking` beats agent frontmatter `thinking-level`.
- [x] 5.4 Update `README.md` config.yml example to demonstrate role thinking via `modelRoles.<role>:<thinkingLevel>`.
- [x] 5.5 Run `bun check:ts` and the updated test suite (at minimum the tests touched in 5.1–5.3) to verify correctness.
