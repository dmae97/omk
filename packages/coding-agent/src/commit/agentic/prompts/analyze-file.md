Analyze the file at {{file}}.

Goal:
{{#if goal}}
{{goal}}
{{else}}
Summarize its purpose and the commit-relevant changes.
{{/if}}

Return a concise JSON object with:
- summary: one-sentence description of the file's role
- highlights: 2-5 bullet points about notable behaviors or changes
- risks: any edge cases or risks worth noting (empty array if none)

{{#if related_files}}
## Other Files in This Change
{{related_files}}

Consider how this file's changes relate to the above files.
{{/if}}

Call the complete tool with the JSON payload.