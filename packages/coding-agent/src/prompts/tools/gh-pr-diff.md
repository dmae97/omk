Reads a GitHub pull request diff through the local GitHub CLI.

<instruction>
- Accepts a pull request number, URL, or branch name
- Omitting `pr` targets the pull request associated with the current branch
- Use `nameOnly: true` when you only need changed file names
- Use `exclude` to drop generated or irrelevant paths from the diff
</instruction>

<output>
Returns a unified diff or changed-file list for the selected pull request.
</output>
