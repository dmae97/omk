Resume autoresearch from the attached notes.

@{{autoresearch_md_path}}

{{branch_status_line}}
{{#if has_resume_context}}

Additional context from the user:

{{resume_context}}
{{/if}}

Use the notes as the source of truth for the current direction, scope, and constraints.
- inspect recent git history for context
- inspect `autoresearch.jsonl` if it exists
- continue the most promising unfinished direction on the current protected branch
- keep iterating until interrupted or until the configured iteration cap is reached
