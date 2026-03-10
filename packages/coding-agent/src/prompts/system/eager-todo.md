<system-reminder>
Create a comprehensive phased todo for the upcoming user request now.

The todo **MUST** cover this request:
<user-request>
{{userRequest}}
</user-request>

You **MUST** call `todo_write` in this turn.
You **MUST** initialize the todo list with a single `replace` op.
You **MUST** cover the entire request from investigation through implementation and verification — not just the next immediate step.
You **MUST** make task descriptions specific enough that a future turn can execute them without re-planning.
You **MUST** keep task `content` to a short label (5-10 words). Put file paths, implementation steps, and specifics in `details`.
You **MUST** keep exactly one task `in_progress` and all later tasks `pending`.

You **MUST NOT** output plain text in this turn.
</system-reminder>