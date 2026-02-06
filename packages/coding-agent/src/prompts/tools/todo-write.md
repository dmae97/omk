# Todo Write

Create/manage structured task list for coding session.

<conditions>
Use proactively:
1. Complex multi-step tasks requiring 3+ steps/actions
2. User requests todo list
3. User provides multiple tasks (numbered/comma-separated)
4. After new instructions—capture requirements as todos
5. Starting task—mark in_progress BEFORE beginning
6. After completing—mark completed, add follow-up tasks found
</conditions>

<protocol>
1. **Task States**:
	 - pending: not started
	 - in_progress: working
	 - completed: finished
2. **Task Management**:
   - Update status in real time
   - Mark complete IMMEDIATELY after finishing (no batching)
   - Multiple tasks may be in_progress in parallel
   - Remove tasks no longer relevant
3. **Task Completion Requirements**:
   - ONLY mark completed when FULLY accomplished
   - On errors/blockers/inability to finish, keep in_progress
   - When blocked, create task describing what needs resolving
4. **Task Breakdown**:
	 - Create specific, actionable items
	 - Break complex tasks into smaller steps
	 - Use clear, descriptive names
</protocol>

<output>
Returns confirmation todo list updated.
</output>

<caution>
When in doubt, use this.
</caution>

<example name="use-dark-mode">
User: Add dark mode toggle to settings. Run tests when done.
→ Creates todos: toggle component, state management, theme styles, update components, run tests
</example>

<example name="use-features">
User: Implement user registration, product catalog, shopping cart, checkout.
→ Creates todos per feature with subtasks
</example>

<example name="skip">
User: Run npm install / Add a comment to this function / What does git status do?
→ Do directly. Single-step/informational tasks need no tracking.
</example>

<avoid>
Skip when:
1. Single straightforward task
2. Task completable in <3 trivial steps
3. Task purely conversational/informational
</avoid>