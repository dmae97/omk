## 1. Thinking-effort display formatting

- [x] 1.1 Add a small pure helper for compact thinking-effort labels (e.g. `minimal` → `min`) in a shared location (preferred over embedding ANSI-heavy formatting in the component).
- [x] 1.2 Add unit tests for the compact label mapping (cover `minimal`, `medium`, and `xhigh`).

## 2. /model row badge rendering

- [x] 2.1 Update `packages/coding-agent/src/modes/components/model-selector.ts` model-row badge rendering to append ` (label)` after each role badge when the role has an explicit thinking level.
- [x] 2.2 Ensure roles in "default" mode (no explicit suffix) do not display any `(...)` annotation.
- [x] 2.3 Ensure explicit `off` displays as `(off)`.

## 3. /model details panel cleanup

- [x] 3.1 Remove the dedicated details-panel section that lists per-role thinking ("Role Thinking" block) so thinking is not duplicated.

## 4. Verification

- [x] 4.1 Run `bun check:ts`.
- [x] 4.2 Run the new unit test(s) added in 1.2.
- [x] 4.3 Verify `/model` behavior (covered via `test/model-selector-role-badge-thinking.test.ts`):
  - a role with explicit `:minimal` shows `[ROLE] (min)`
  - a role with explicit `:medium` shows `[ROLE] (medium)`
  - a role with no suffix shows just `[ROLE]`
  - the details panel no longer shows a "Role Thinking" section
