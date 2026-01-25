<context>
Changelog: {{ changelog_path }}
{{#if is_package_changelog}}Scope: Package-level changelog. Omit package name prefix from entries.{{/if}}
</context>
{{#if existing_entries}}
<existing_entries>
Already documented—skip these:
{{ existing_entries }}
</existing_entries>
{{/if}}

<diff_summary>
{{ stat }}
</diff_summary>

<diff>
{{ diff }}
</diff>