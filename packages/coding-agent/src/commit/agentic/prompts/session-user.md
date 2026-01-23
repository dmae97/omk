Generate a conventional commit proposal for the current staged changes.

{{#if user_context}}
User context:
{{user_context}}
{{/if}}

{{#if changelog_targets}}
Changelog targets (you must call propose_changelog for these files):
{{changelog_targets}}
{{/if}}

{{#if pre_computed_observations}}
## Pre-analyzed File Observations

The following file analyses have already been performed. Use these observations directly instead of calling analyze_files for these files:

{{pre_computed_observations}}
{{/if}}

Use the git_* tools to inspect changes and finish by calling propose_commit or split_commit.