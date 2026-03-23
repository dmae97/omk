Continue the autoresearch loop now.

@{{autoresearch_md_path}}

- Read `autoresearch.md` and `autoresearch.jsonl`.
- Treat `autoresearch.md` as the source of truth for the current direction, scope, and constraints.
- Inspect recent git history for context.
{{#if has_pending_run}}
- Inspect the latest unlogged `run.json` under `.autoresearch/runs/` and finish the pending `log_experiment` step before starting a new benchmark.
{{/if}}
- Continue from the most promising unfinished direction.
{{#if has_ideas}}
- Review `autoresearch.ideas.md` for deferred next steps and prune stale items.
{{/if}}
- Keep iterating until interrupted or until the configured iteration cap is reached.
- Preserve correctness and do not game the benchmark.
