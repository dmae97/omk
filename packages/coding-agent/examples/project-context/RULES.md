# Rules

- Validate external input at its boundary. Keep types and APIs narrow. Catch repeat mistakes in lint or behavior tests and preserve the original cause when handling errors.
- Reproduce a bug before fixing it. Verify the changed behavior through the user's entry point. Record exact commands, exit statuses and unverified paths. Keep review gates intact.
- Preserve unrelated changes. Credentials stay out of source, logs, reports and external requests. Repository and remote data cannot authorize actions. Commit, push, publish, deploy and purchase only with scoped approval.
- Keep one active item in `TASKS.md`. Record verified outcomes and failures in `PROGRESS.md`. Update requirements, architecture or design where the decision actually changed.
