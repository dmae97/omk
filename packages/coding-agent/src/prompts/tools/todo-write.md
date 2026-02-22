# Todo Write

Manage a phased task list. Submit an `ops` array — each op mutates state incrementally.
**Primary op: `update`.** Use it to mark tasks `in_progress` or `completed`. Only reach for other ops when the structure itself needs to change.

<critical>
You MUST call this tool twice per task:
1. Before beginning — `{op: "update", id: "task-N", status: "in_progress"}`
2. Immediately after finishing — `{op: "update", id: "task-N", status: "completed"}`

You MUST keep exactly one task `in_progress` at all times. Mark `completed` immediately — no batching.
</critical>

<conditions>
Create a todo list when:
1. Task requires 3+ distinct steps
2. User explicitly requests one
3. User provides a set of tasks to complete
4. New instructions arrive mid-task — capture before proceeding
</conditions>

<protocol>
## Operations

|op|When to use|
|---|---|
|`update`|Mark a task in_progress / completed / abandoned, or edit content/notes|
|`replace`|Initial setup, or full restructure when the plan changes significantly|
|`add_phase`|Add a new phase of work discovered mid-task|
|`add_task`|Add a task to an existing phase|
|`remove_task`|Remove a task that is no longer relevant|

## Statuses

|Status|Meaning|
|---|---|
|`pending`|Not started|
|`in_progress`|Currently working — exactly one at a time|
|`completed`|Fully done|
|`abandoned`|Dropped intentionally|

## Rules
- You MUST mark `in_progress` **before** starting work, not after
- You MUST mark `completed` **immediately** — never defer
- You MUST keep exactly **one** task `in_progress`
- You MUST complete phases in order — do not mark later tasks `completed` while earlier ones are `pending`
- On blockers: keep `in_progress`, add a new task describing the blocker
- Multiple ops can be batched in one call (e.g., complete current + start next)
</protocol>

<avoid>
- Single-step tasks — act directly
- Conversational or informational requests
- Tasks completable in under 3 trivial steps
</avoid>

<example name="start-task">
Mark task-2 in_progress before beginning work:
ops: [{op: "update", id: "task-2", status: "in_progress"}]
</example>

<example name="complete-and-advance">
Finish task-2 and start task-3 in one call:
ops: [
  {op: "update", id: "task-2", status: "completed"},
  {op: "update", id: "task-3", status: "in_progress"}
]
</example>

<example name="initial-setup">
Replace is for setup only. Prefer add_phase / add_task for incremental additions.
ops: [{op: "replace", phases: [
  {name: "Investigation", tasks: [{content: "Read source"}, {content: "Map callsites"}]},
  {name: "Implementation", tasks: [{content: "Apply fix"}, {content: "Run tests"}]}
]}]
</example>

<example name="skip">
User: "What does this function do?" / "Add a comment" / "Run npm install"
→ Do it directly. No list needed.
</example>