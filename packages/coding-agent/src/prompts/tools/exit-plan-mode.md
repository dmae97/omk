Signals plan completion, requests user approval to begin implementation.

<conditions>
Use when:
- Plan written to plan file
- No unresolved questions about requirements or approach
- Ready for user review and approval
</conditions>

<instruction>
- Write plan to plan file BEFORE calling this tool
- Tool reads plan from file—does not take plan content as parameter
- User sees plan contents when reviewing
</instruction>

<output>
Presents plan to user for approval. If approved, exits plan mode with full tool access restored.
</output>

<example name="ready">
Plan complete at specified path, no open questions.
→ Call `exit_plan_mode`
</example>

<example name="unclear">
Unsure about auth method (OAuth vs JWT).
→ Use `ask` first to clarify, then call `exit_plan_mode`
</example>

<avoid>
- Calling before plan written to file
- Using `ask` to request plan approval (this tool does that)
- Calling after pure research tasks (no implementation planned)
</avoid>

<critical>
Only use when planning implementation steps. Research tasks (searching, reading, understanding) do not need this tool.
</critical>