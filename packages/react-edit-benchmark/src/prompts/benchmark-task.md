You are working in a repository with {{#if multiFile}}multiple unrelated files{{else}}a single edit task{{/if}}.

{{task_prompt}}

{{#if guided_context}}
## Guided fix (authoritative)

{{guided_context}}
{{/if}}

{{#if retry_context}}
## Retry context

{{retry_context}}
{{/if}}

## Important constraints
- Make the minimum change necessary. Do not refactor, improve, or "clean up" other code.
- If you see multiple similar patterns, only change the ONE that is buggy.
- Preserve exact code structure. Do not rearrange statements or change formatting.
{{#if multiFile}}- Only modify the file(s) referenced by this request. Leave all other files unchanged.
{{/if}}

{{instructions}}
