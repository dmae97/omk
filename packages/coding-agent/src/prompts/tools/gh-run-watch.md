Watches a GitHub Actions workflow run through the local GitHub CLI.

<instruction>
- Accepts a run ID or full Actions run URL
- Omitting `run` watches the workflow runs for the current HEAD commit on the selected branch
- Omitting `branch` falls back to the current checked-out git branch
- Fast-fails after the first detected job failure, waits briefly to collect concurrent failures, and then fetches tailed logs for the failed jobs
</instruction>

<output>
Streams live run snapshots while polling, then returns the final run status, job list, and tailed logs for failed jobs when available. When `run` is omitted, the snapshots cover all workflow runs created for the current HEAD commit.
</output>