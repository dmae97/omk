Generate a conventional commit proposal for the current staged changes.

{{#if user_context}}
User context:
{{user_context}}
{{/if}}

{{#if changelog_targets}}
Changelog targets (you must call propose_changelog for these files):
{{changelog_targets}}
{{/if}}

{{#if existing_changelog_entries}}
## Existing Unreleased Changelog Entries
You may include entries from this list in the propose_changelog `deletions` field if they should be removed.
{{#each existing_changelog_entries}}
### {{path}}
{{#each sections}}
{{name}}:
{{#list items prefix="- " join="\n"}}{{this}}{{/list}}
{{/each}}
{{/each}}
{{/if}}

Use the git_* tools to inspect changes. Call analyze_files to spawn parallel file analysis if you need deeper per-file summaries. Finish by calling propose_commit or split_commit.