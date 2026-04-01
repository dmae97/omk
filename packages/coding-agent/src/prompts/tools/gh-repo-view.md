Reads GitHub repository metadata using the local GitHub CLI.

<instruction>
- Prefer this when you need authenticated repository context or GitHub CLI default-repo resolution
- Use `repo` to target an explicit `OWNER/REPO`; otherwise the current checkout or `gh` default repo is used
- This tool is read-only and returns repository metadata, not raw file contents
</instruction>

<output>
Returns a concise repository summary including description, branch, visibility, stars, forks, and related metadata.
</output>
