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

{{#if pre_computed_observations}}
## Pre-analyzed File Observations

The following file analyses have already been performed. Use these observations directly instead of calling analyze_files for these files:

{{pre_computed_observations}}
{{/if}}

Use the git_* tools to inspect changes and finish by calling propose_commit or split_commit.