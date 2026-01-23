Generate a conventional commit proposal for the current staged changes.

{{#if user_context}}
User context:
{{user_context}}
{{/if}}

Use the git_* tools to inspect changes and finish by calling propose_commit or split_commit.