Transitions to plan mode for designing implementation approaches before writing code.

<conditions>
Prefer using EnterPlanMode for implementation tasks unless they're simple. Use it when ANY of these conditions apply:
1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" — where should it go? What should happen on click?
   - Example: "Add form validation" — what rules? What error messages?
2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" — could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" — many optimization strategies possible
3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" — what exactly should change?
   - Example: "Refactor this component" — what's the target architecture?
4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" — WebSockets vs SSE vs polling
   - Example: "Implement state management" — Redux vs Context vs custom solution
5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"
6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" — need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" — need to investigate root cause
7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would use `ask` to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context
</conditions>

<instruction>
In plan mode:
1. Explore codebase with `find`, `grep`, `read`, `ls`
2. Understand existing patterns and architecture
3. Design implementation approach
4. Use `ask` if clarification needed
5. Call `exit_plan_mode` when ready
</instruction>

<output>
Requires user approval to enter. Once approved, you enter read-only exploration mode with restricted tool access.
</output>

<example name="auth">
User: "Add user authentication to the app"
→ Use plan mode: architectural decisions (session vs JWT, where to store tokens, middleware structure)
</example>

<example name="optimization">
User: "Optimize the database queries"
→ Use plan mode: multiple approaches possible, need to profile first, significant impact
</example>

<example name="dark-mode">
User: "Implement dark mode"
→ Use plan mode: architectural decision on theme system, affects many components
</example>

<example name="delete-button">
User: "Add a delete button to the user profile"
→ Use plan mode: seems simple but involves placement, confirmation dialog, API call, error handling, state updates
</example>

<example name="error-handling">
User: "Update the error handling in the API"
→ Use plan mode: affects multiple files, user should approve the approach
</example>

<example name="typo-skip">
User: "Fix the typo in the README"
→ Skip plan mode: straightforward, no planning needed
</example>

<example name="debug-skip">
User: "Add a console.log to debug this function"
→ Skip plan mode: simple, obvious implementation
</example>

<example name="research-skip">
User: "What files handle routing?"
→ Skip plan mode: research task, not implementation planning
</example>

<avoid>
- Single-line or few-line fixes (typos, obvious bugs)
- Adding a single function with clear requirements
- Tasks with very specific, detailed instructions
- Pure research/exploration tasks
</avoid>

<critical>
- This tool REQUIRES user approval — they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning — alignment upfront beats rework
- Users appreciate being consulted before significant changes are made to their codebase
</critical>