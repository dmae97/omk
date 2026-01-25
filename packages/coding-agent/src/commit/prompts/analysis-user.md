{{#if context_files}}
<project_context>
{{#each context_files}}
<file path="{{ path }}">
{{ content }}
</file>
{{/each}}
</project_context>
{{/if}}
{{#if user_context}}
<user_context>
{{ user_context }}
</user_context>
{{/if}}
{{#if types_description}}
<commit_types>
{{ types_description }}
</commit_types>
{{/if}}

<diff_statistics>
{{ stat }}
</diff_statistics>

<scope_candidates>
{{ scope_candidates }}
</scope_candidates>
{{#if common_scopes}}
<common_scopes>
{{ common_scopes }}
</common_scopes>
{{/if}}
{{#if recent_commits}}
<style_patterns>
{{ recent_commits }}
</style_patterns>
{{/if}}

<diff>
{{ diff }}
</diff>