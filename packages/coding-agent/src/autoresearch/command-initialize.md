Set up autoresearch for this intent:

{{intent}}

{{branch_status_line}}

Collected setup:

- benchmark command: `{{benchmark_command}}`
- primary metric: `{{metric_name}}`
- metric unit: `{{metric_unit}}`
- direction: `{{direction}}`
- tradeoff metrics:
{{{secondary_metrics_block}}}
- files in scope:
{{{scope_paths_block}}}
- off limits:
{{{off_limits_block}}}
- constraints:
{{{constraints_block}}}

Explain briefly what autoresearch will do in this repository, then initialize the workspace.

Your first actions:
- write `autoresearch.md`
- record the collected benchmark command, primary metric, metric unit, direction, tradeoff metrics, scope, off-limits list, and constraints in `autoresearch.md`
- add a short preflight section in `autoresearch.md` covering prerequisites, one-time setup, and the comparability invariant that must stay fixed across runs
- explicitly mark the ground-truth evaluator, fixed datasets, and other measurement-critical files as off-limits or hard constraints when they define the benchmark contract
- write or update `autoresearch.program.md` when you learn durable heuristics, failure patterns, or repo-specific strategy that future resume turns should inherit
- define the benchmark entrypoint in `autoresearch.sh`
- optionally add `autoresearch.checks.sh` if correctness or quality needs a hard gate
- run `init_experiment` with the exact collected benchmark command, metric definition, scope paths, off-limits list, and constraints
- run and log the baseline
- keep iterating until interrupted or until the configured iteration cap is reached
