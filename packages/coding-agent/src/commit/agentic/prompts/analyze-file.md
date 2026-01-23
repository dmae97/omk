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

Call the complete tool with the JSON payload.